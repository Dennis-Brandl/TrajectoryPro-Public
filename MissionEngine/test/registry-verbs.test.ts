// Copyright 2026 Dennis L. Brandl
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Phase 4a Task 3: the verb core is pure — a manager hydrated from a registry snapshot, the
// resource's holder rows, and the verb. Every counter-touching case ends by asserting the
// wedge invariant the whole program exists to protect: in_use equals what the ledger plus the
// still-reserved grants can account for. Write-back is exercised through diffRegistry, exactly
// as Task 4's runner will do it.
import { expect, test } from 'vitest';
import { InMemoryResourceManager } from '../src/core/resources.js';
import { snapshotToSerialized, indexWaiters, diffRegistry } from '../src/core/env-resource-bridge.js';
import { applyResourceVerb, untrackedCapacity, OPERATOR_INSTANCE_ID, VerbError } from '../src/core/registry-verbs.js';
import type { WcRegistrySnapshot, WcResourceRow, WcWaiterRow, ResourceHolderRow } from 'mission-control-db/src/runtime/wc-resources';

const WC = 'wc-1';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const row = (over: Partial<WcResourceRow>): WcResourceRow => ({
  workCenterId: WC, name: 'R', resourceType: 'binary exclusive use', useLimit: null, poolNames: [], availableNames: [], inUse: 0, ...over,
});
const waiter = (id: number, instanceId: string, stepOid: string, over: Partial<WcWaiterRow> = {}): WcWaiterRow => ({
  id, name: 'R', instanceId, stepOid, kind: 'acquire', amount: null, payload: null, granted: false, grantedName: null, grantedPayload: null, ...over,
});
const holder = (id: number, instanceId: string, stepOid: string, amount = 1, heldName: string | null = null): ResourceHolderRow => ({
  id, instanceId, name: 'R', stepOid, amount, heldName, acquiredAt: new Date('2026-09-02T00:00:00Z'),
});

function run(r: WcResourceRow, holders: ResourceHolderRow[], waiters: WcWaiterRow[], input: Parameters<typeof applyResourceVerb>[0]['input']) {
  const snap: WcRegistrySnapshot = { resources: [r], waiters };
  const manager = InMemoryResourceManager.fromJSON(snapshotToSerialized(snap, WC));
  const effect = applyResourceVerb({ manager, row: r, holders, waiters, input });
  const diff = diffRegistry({ snap, manager, index: indexWaiters(snap), instanceId: OPERATOR_INSTANCE_ID, holds: [] });
  return { effect, diff, manager };
}

/** VerbError carries its code in `code`, never in the message (the message is what the CM toasts).
 *  Assert the code and hand the error back so a message fragment can be checked too. */
function throwsCode(fn: () => unknown, code: string): VerbError {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(VerbError);
  expect((caught as VerbError).code).toBe(code);
  return caught as VerbError;
}

/** The wedge invariant after a verb: the counter equals the surviving ledger plus every grant
 *  still reserved (granted rows that survived, newly flagged grants). Named pools: held names. */
function accounted(r: WcResourceRow, holders: ResourceHolderRow[], waiters: WcWaiterRow[], out: ReturnType<typeof run>) {
  const survivingHolders = holders.filter((h) => !out.effect.deleteHolderIds.includes(h.id));
  const gone = new Set([...out.diff.deleteWaiterIds, ...out.effect.extraDeleteWaiterIds]);
  const newlyGranted = new Set(out.diff.grantWaiters.map((g) => g.id));
  const reserved = waiters.filter((w) => !gone.has(w.id) && (w.granted || newlyGranted.has(w.id)));
  const counter = out.diff.counters.find((c) => c.name === r.name)!;
  if (r.resourceType === 'named pool') {
    const held = r.poolNames.filter((n) => !counter.availableNames.includes(n)).sort();
    const names = [...survivingHolders.map((h) => h.heldName!), ...reserved.map((w) => out.diff.grantWaiters.find((g) => g.id === w.id)?.grantedName ?? w.grantedName!)].sort();
    return { counter: held, ledger: names };
  }
  const units = (x: { amount: number | null }) => x.amount ?? 1;
  return { counter: counter.inUse, ledger: survivingHolders.reduce((s, h) => s + h.amount, 0) + reserved.reduce((s, w) => s + units(w), 0) };
}

test('release-holder on a binary exclusive resource frees it and grants the FIFO head to a FOREIGN instance', () => {
  const r = row({ inUse: 1 });
  const holders = [holder(10, A, 's-a')];
  const waiters = [waiter(1, B, 's-b'), waiter(2, C, 's-c')];
  const out = run(r, holders, waiters, { verb: 'release-holder', name: 'R', holderId: 10 });
  expect(out.effect.deleteHolderIds).toEqual([10]);
  expect(out.diff.counters).toEqual([{ name: 'R', inUse: 1, availableNames: [] }]); // re-reserved for B
  expect(out.diff.grantWaiters).toEqual([{ id: 1, grantedName: null, grantedPayload: null }]);
  expect(out.diff.deleteWaiterIds).toEqual([]);
  expect(out.diff.insertWaiters).toEqual([]);
  expect(out.diff.foreignGrantInstanceIds).toEqual([B]);
  expect(out.effect.affectedInstanceIds).toEqual([A]);
  const acc = accounted(r, holders, waiters, out); expect(acc.counter).toEqual(acc.ledger);
});

test('release-holder: unknown holder → HOLDER_NOT_FOUND; a stale holder on an already-free counter is still removed', () => {
  throwsCode(() => run(row({ inUse: 1 }), [holder(10, A, 's')], [], { verb: 'release-holder', name: 'R', holderId: 99 }), 'HOLDER_NOT_FOUND');
  const out = run(row({ inUse: 0 }), [holder(10, A, 's')], [], { verb: 'release-holder', name: 'R', holderId: 10 }); // ledger mismatch shape
  expect(out.effect.deleteHolderIds).toEqual([10]);
  expect(out.effect.summary).toMatch(/counter was already free/);
});

test("release-holder on countable and named pools releases the holder's amount / name", () => {
  const c = row({ resourceType: 'countable use with pool limits', useLimit: 5, inUse: 4 });
  const cw = [waiter(1, B, 's-b', { amount: 3 })];
  const co = run(c, [holder(10, A, 's-a', 2), holder(11, C, 's-c', 2)], cw, { verb: 'release-holder', name: 'R', holderId: 10 });
  expect(co.diff.counters[0].inUse).toBe(5); // 4 − 2 + 3 (B's grant fits now)
  expect(co.diff.grantWaiters.map((g) => g.id)).toEqual([1]);
  const acc = accounted(c, [holder(10, A, 's-a', 2), holder(11, C, 's-c', 2)], cw, co); expect(acc.counter).toEqual(acc.ledger);

  const n = row({ resourceType: 'named pool', poolNames: ['X', 'Y'], availableNames: [] });
  const nh = [holder(10, A, 's-a', 1, 'X'), holder(11, C, 's-c', 1, 'Y')];
  const no = run(n, nh, [waiter(1, B, 's-b')], { verb: 'release-holder', name: 'R', holderId: 11 });
  expect(no.diff.counters[0].availableNames).toEqual([]); // Y went straight to B
  expect(no.diff.grantWaiters).toEqual([{ id: 1, grantedName: 'Y', grantedPayload: null }]);
  expect(throwsCode(() => run(n, [holder(12, A, 's', 1, null)], [], { verb: 'release-holder', name: 'R', holderId: 12 }), 'NOTHING_TO_RELEASE').message).toMatch(/no held name/);
});

test('untracked release is bounded by what no holder and no reservation accounts for (D14)', () => {
  const r = row({ resourceType: 'countable use with pool limits', useLimit: 5, inUse: 4 });
  const holders = [holder(10, A, 's-a', 1)];
  const waiters = [waiter(1, B, 's-b', { amount: 1, granted: true })]; // reserved 1 for B
  expect(untrackedCapacity(r, holders, waiters)).toEqual({ units: 2, names: [] }); // 4 − 1 − 1
  expect(throwsCode(() => run(r, holders, waiters, { verb: 'release', name: 'R', amount: 3 }), 'NOTHING_TO_RELEASE').message).toMatch(/only 2/);
  const out = run(r, holders, waiters, { verb: 'release', name: 'R', amount: 2 });
  expect(out.diff.counters[0].inUse).toBe(2);
  expect(out.effect.deleteHolderIds).toEqual([]);
  expect(out.effect.extraDeleteWaiterIds).toEqual([]); // B's reservation untouched
  const acc = accounted(r, holders, waiters, out); expect(acc.counter).toEqual(acc.ledger);
  // Fully accounted → nothing to release.
  throwsCode(() => run(row({ inUse: 1 }), [holder(10, A, 's')], [], { verb: 'release', name: 'R' }), 'NOTHING_TO_RELEASE');
  // The wedge shape itself: in_use 1, no holders, no waiters → releasable.
  const wedge = run(row({ inUse: 1 }), [], [], { verb: 'release', name: 'R' });
  expect(wedge.diff.counters[0].inUse).toBe(0);
});

test('untracked release on a named pool needs an untracked held NAME', () => {
  const n = row({ resourceType: 'named pool', poolNames: ['X', 'Y', 'Z'], availableNames: ['Z'] });
  const holders = [holder(10, A, 's-a', 1, 'X')]; // Y is held by nobody the ledger knows
  expect(untrackedCapacity(n, holders, [])).toEqual({ units: 1, names: ['Y'] });
  throwsCode(() => run(n, holders, [], { verb: 'release', name: 'R', poolName: 'X' }), 'NOTHING_TO_RELEASE'); // tracked
  expect(throwsCode(() => run(n, holders, [], { verb: 'release', name: 'R' }), 'VALIDATION').message).toMatch(/poolName/);
  const out = run(n, holders, [], { verb: 'release', name: 'R', poolName: 'Y' });
  expect(out.diff.counters[0].availableNames.sort()).toEqual(['Y', 'Z']);
});

test("the unaccounted figure counts only THIS resource's granted waiters (review Important 1)", () => {
  // `waiters` may be a whole-work-center list. A sibling resource's granted-unconsumed row must
  // not inflate this ledger, or `release` refuses a genuinely untracked unit — disabling the one
  // verb aimed at the wedge exactly when grants are outstanding.
  const c = row({ resourceType: 'countable use with pool limits', useLimit: 5, inUse: 4 });
  const holders = [holder(10, A, 's-a', 1)];
  const mixed = [
    waiter(1, B, 's-b', { name: 'OTHER', amount: 3, granted: true }), // a DIFFERENT resource
    waiter(2, C, 's-c', { amount: 1, granted: true }),                // ours: reserved 1
  ];
  expect(untrackedCapacity(c, holders, mixed)).toEqual({ units: 2, names: [] }); // 4 − 1 − 1, not 4 − 1 − 1 − 3
  const rel = run(c, holders, mixed, { verb: 'release', name: 'R', amount: 2 });
  expect(rel.diff.counters[0].inUse).toBe(2);
  const acc = accounted(c, holders, mixed.filter((w) => w.name === 'R'), rel); expect(acc.counter).toEqual(acc.ledger);

  // Named pools commonly share short names, so a sibling pool's grantedName must not mark ours tracked.
  const n = row({ resourceType: 'named pool', poolNames: ['X', 'Y', 'Z'], availableNames: ['Z'] });
  const nh = [holder(10, A, 's-a', 1, 'X')];
  const nw = [waiter(1, B, 's-b', { name: 'OTHER', granted: true, grantedName: 'Y' })];
  expect(untrackedCapacity(n, nh, nw)).toEqual({ units: 1, names: ['Y'] });
  const no = run(n, nh, nw, { verb: 'release', name: 'R', poolName: 'Y' });
  expect(no.diff.counters[0].availableNames.sort()).toEqual(['Y', 'Z']);
});

test('reset zeroes the counter, drops every holder row, and lets the preserved queue proceed (D15)', () => {
  const r = row({ resourceType: 'binary shared use with pool limits', useLimit: 2, inUse: 2 });
  const holders = [holder(10, A, 's-a'), holder(11, C, 's-c')];
  const waiters = [waiter(1, B, 's-b')];
  const out = run(r, holders, waiters, { verb: 'reset', name: 'R' });
  expect(out.effect.deleteHolderIds).toEqual([10, 11]);
  expect(out.diff.counters[0].inUse).toBe(1); // B granted from the freed pool
  expect(out.diff.grantWaiters.map((g) => g.id)).toEqual([1]);
  expect(out.effect.affectedInstanceIds.sort()).toEqual([A, C].sort());
  const acc = accounted(r, holders, waiters, out); expect(acc.counter).toEqual(acc.ledger);
  const n = run(row({ resourceType: 'named pool', poolNames: ['X', 'Y'], availableNames: [] }), [holder(10, A, 's', 1, 'X')], [], { verb: 'reset', name: 'R' });
  expect(n.diff.counters[0].availableNames.sort()).toEqual(['X', 'Y']);
});

test('reset drops a GRANTED-but-unconsumed reservation before re-granting the preserved queue (P4)', () => {
  const r = row({ inUse: 1 }); // reserved for B by an earlier release; C queued behind it
  const waiters = [waiter(1, B, 's-b', { granted: true }), waiter(2, C, 's-c')];
  const out = run(r, [], waiters, { verb: 'reset', name: 'R' });
  expect(out.effect.extraDeleteWaiterIds).toEqual([1]);         // B's grant dropped — its row goes
  expect(out.diff.grantWaiters.map((g) => g.id)).toEqual([2]); // C granted from the clean counter
  expect(out.diff.counters[0].inUse).toBe(1);                   // exactly C's reservation, not 2
  expect(out.effect.affectedInstanceIds).toEqual([B]);
  expect(out.effect.touched).toEqual([{ instanceId: B, stepOid: 's-b', detail: expect.stringMatching(/unconsumed grant/) }]);
  const acc = accounted(r, [], waiters, out); expect(acc.counter).toEqual(acc.ledger);
  // Named pool: the reserved name comes back BEFORE the roster is restored, so it is never issued twice.
  const n = row({ resourceType: 'named pool', poolNames: ['X'], availableNames: [] });
  const nw = [waiter(1, B, 's-b', { granted: true, grantedName: 'X' }), waiter(2, C, 's-c')];
  const no = run(n, [], nw, { verb: 'reset', name: 'R' });
  expect(no.effect.extraDeleteWaiterIds).toEqual([1]);
  expect(no.diff.grantWaiters).toEqual([{ id: 2, grantedName: 'X', grantedPayload: null }]);
  expect(no.diff.counters[0].availableNames).toEqual([]);
});

test('reset refuses a type the engine cannot model, and on a sync resource IS clear-sync (review Important 2)', () => {
  // An unknown type is skipped by snapshotToSerialized, so resetResources has no key to reset and
  // diffRegistry emits NO counter — deleting the holder rows anyway would leave in_use non-zero
  // with zero holders and zero waiters: the wedge shape, made by the recovery verb itself.
  const unknown = row({ resourceType: 'binary exclusiv use', inUse: 1 }); // e.g. a typo'd spec
  const snap: WcRegistrySnapshot = { resources: [unknown], waiters: [] };
  const bare = InMemoryResourceManager.fromJSON(snapshotToSerialized(snap, WC));
  expect(diffRegistry({ snap, manager: bare, index: indexWaiters(snap), instanceId: OPERATOR_INSTANCE_ID, holds: [] }).counters).toEqual([]);
  expect(throwsCode(() => run(unknown, [holder(10, A, 's-a')], [], { verb: 'reset', name: 'R' }), 'NOT_SUPPORTED').message).toMatch(/cannot model it/);

  // Sync: spec §7.3 offers Reset on every row, so it must do the clear-sync thing, not nothing.
  const s = row({ resourceType: 'sync' });
  const sw = [
    waiter(1, A, 's-a', { kind: 'send', payload: 'p' }), waiter(2, B, 's-b', { kind: 'receive' }),
    waiter(3, C, 's-c', { kind: 'send', payload: 'q', granted: true, grantedPayload: 'q' }),
  ];
  const cleared = run(s, [], sw, { verb: 'clear-sync', name: 'R' });
  const reset = run(s, [], sw, { verb: 'reset', name: 'R' });
  expect(reset.effect.extraDeleteWaiterIds).toEqual(cleared.effect.extraDeleteWaiterIds);
  expect(reset.effect.affectedInstanceIds).toEqual(cleared.effect.affectedInstanceIds);
  expect(reset.diff.deleteWaiterIds).toEqual(cleared.diff.deleteWaiterIds);
  expect(reset.diff.grantWaiters).toEqual(cleared.diff.grantWaiters);
  expect(reset.effect.deleteHolderIds).toEqual([]); // a sync resource has no holder ledger
  expect(reset.effect.summary).toMatch(/^reset "R"/); // the trace still names the verb pressed
});

test('clear-sync drops every waiter row on a sync resource, granted or not, and refuses other types', () => {
  const s = row({ resourceType: 'sync' });
  const waiters = [
    waiter(1, A, 's-a', { kind: 'send', payload: 'p' }), waiter(2, B, 's-b', { kind: 'receive' }),
    waiter(3, C, 's-c', { kind: 'send', payload: 'q', granted: true, grantedPayload: 'q' }),
  ];
  const out = run(s, [], waiters, { verb: 'clear-sync', name: 'R' });
  expect([...out.diff.deleteWaiterIds, ...out.effect.extraDeleteWaiterIds].sort()).toEqual([1, 2, 3]);
  expect(out.diff.grantWaiters).toEqual([]);
  expect(out.effect.affectedInstanceIds.sort()).toEqual([A, B, C].sort());
  throwsCode(() => run(row({ inUse: 0 }), [], [], { verb: 'clear-sync', name: 'R' }), 'NOT_A_SYNC_RESOURCE');
});

test('cancel-waiter dequeues one token; a countable head removal re-runs the grant pass', () => {
  const r = row({ resourceType: 'countable use with pool limits', useLimit: 3, inUse: 2 });
  const holders = [holder(10, A, 's-a', 2)];
  const waiters = [waiter(1, B, 's-b', { amount: 2 }), waiter(2, C, 's-c', { amount: 1 })]; // head too large, tail fits
  const out = run(r, holders, waiters, { verb: 'cancel-waiter', name: 'R', waiterId: 1 });
  expect(out.diff.deleteWaiterIds).toEqual([1]);
  expect(out.diff.grantWaiters.map((g) => g.id)).toEqual([2]); // C's request now fits
  expect(out.diff.counters[0].inUse).toBe(3);
  expect(out.effect.affectedInstanceIds).toEqual([B]);
  expect(out.effect.touched).toEqual([{ instanceId: B, stepOid: 's-b', detail: expect.stringMatching(/cancel/) }]);
  const acc = accounted(r, holders, waiters, out); expect(acc.counter).toEqual(acc.ledger);
  throwsCode(() => run(r, holders, waiters, { verb: 'cancel-waiter', name: 'R', waiterId: 9 }), 'WAITER_NOT_FOUND');
});

test('cancel-waiter on a GRANTED-but-unconsumed row gives the reservation back (D13)', () => {
  const r = row({ inUse: 1 }); // reserved for B by an earlier release; A queued behind
  const waiters = [waiter(1, B, 's-b', { granted: true }), waiter(2, A, 's-a')];
  const out = run(r, [], waiters, { verb: 'cancel-waiter', name: 'R', waiterId: 1 });
  expect(out.effect.extraDeleteWaiterIds).toEqual([1]); // granted-at-load rows are not in the index
  expect(out.diff.grantWaiters.map((g) => g.id)).toEqual([2]); // capacity went to A, not lost
  expect(out.diff.counters[0].inUse).toBe(1);
  const acc = accounted(r, [], waiters, out); expect(acc.counter).toEqual(acc.ledger);
  const n = row({ resourceType: 'named pool', poolNames: ['X'], availableNames: [] });
  const nw = [waiter(1, B, 's-b', { granted: true, grantedName: 'X' })];
  const no = run(n, [], nw, { verb: 'cancel-waiter', name: 'R', waiterId: 1 });
  expect(no.diff.counters[0].availableNames).toEqual(['X']);
});

test('an operator diff never inserts a waiter, and the verb vocabulary is closed', () => {
  const out = run(row({ inUse: 1 }), [holder(10, A, 's')], [waiter(1, B, 's-b')], { verb: 'release-holder', name: 'R', holderId: 10 });
  expect(out.diff.insertWaiters).toEqual([]);
  throwsCode(() => run(row({}), [], [], { verb: 'explode' as never, name: 'R' }), 'VALIDATION');
});
