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
import { describe, expect, test } from 'vitest';
import { InMemoryResourceManager } from '../src/core/resources.js';
import {
  envToken, parseEnvToken, snapshotToSerialized, indexWaiters, diffRegistry,
} from '../src/core/env-resource-bridge.js';
import type { WcRegistrySnapshot } from 'mission-control-db/src/runtime/wc-resources';

const WC = 'wc-1';
const A = 'inst-a';
const B = 'inst-b';

const snapshot = () => ({
  resources: [
    { workCenterId: WC, name: 'Printer', resourceType: 'binary exclusive use',
      useLimit: null, poolNames: [], availableNames: [], inUse: 0 },
    { workCenterId: WC, name: 'Bay', resourceType: 'named pool',
      useLimit: null, poolNames: ['B1', 'B2'], availableNames: ['B1', 'B2'], inUse: 1 },
    { workCenterId: WC, name: 'Slots', resourceType: 'countable use with pool limits',
      useLimit: 5, poolNames: [], availableNames: [], inUse: 2 },
    { workCenterId: WC, name: 'Chan', resourceType: 'sync',
      useLimit: null, poolNames: [], availableNames: [], inUse: 0 },
  ],
  waiters: [] as any[],
});

test('envToken round-trips through parseEnvToken', () => {
  const t = envToken(A, 'step-1');
  expect(t).toBe('inst-a::step-1');
  expect(parseEnvToken(t)).toEqual({ instanceId: A, stepOid: 'step-1' });
});

test('parseEnvToken keeps a stepOid containing colons intact', () => {
  // Step oids are author-supplied; only the FIRST '::' separates the instance id.
  const t = envToken(A, 'weird::oid::here');
  expect(parseEnvToken(t)).toEqual({ instanceId: A, stepOid: 'weird::oid::here' });
});

test('snapshotToSerialized builds a manager whose state matches the rows', () => {
  const ser = snapshotToSerialized(snapshot(), WC);
  const mgr = InMemoryResourceManager.fromJSON(ser);
  const byName = Object.fromEntries(mgr.getSnapshot().map((s) => [s.name, s]));
  expect(byName['Printer'].state).toBe('Free');
  expect(byName['Bay'].state).toBe('2 available, 0 in use');
  expect(byName['Slots'].state).toBe('2/5 in use');
  expect(byName['Chan'].state).toBe('send:0 recv:0 sync:0');
  // Every entry is environment-scoped and owned by the work center.
  for (const s of mgr.getSnapshot()) {
    expect(s.scope).toBe('environment');
    expect(s.ownerId).toBe(WC);
  }
});

test('an environment resource whose bare name contains ":" keeps its full name in getSnapshot', () => {
  // Phase 2a keys environment entries by BARE name; a name may itself contain ':'. Splitting the
  // key at the first ':' truncated it (spec §12.3 item 17). The owner prefix is what gets stripped.
  const snap: WcRegistrySnapshot = {
    resources: [{ workCenterId: WC, name: 'Line:A', resourceType: 'binary exclusive use', useLimit: null, poolNames: [], availableNames: [], inUse: 0 }],
    waiters: [],
  };
  const mgr = InMemoryResourceManager.fromJSON(snapshotToSerialized(snap, WC));
  const [entry] = mgr.getSnapshot();
  expect(entry.resourceName).toBe('Line:A');
  expect(entry.name).toBe('Line:A');
  expect(entry.state).toBe('Free');
});

test('waiters hydrate into the right queue per kind, in id order', () => {
  const snap = snapshot();
  snap.waiters = [
    { id: 1, name: 'Printer', instanceId: A, stepOid: 's1', kind: 'acquire', amount: null, payload: null, granted: false, grantedName: null, grantedPayload: null },
    { id: 2, name: 'Printer', instanceId: B, stepOid: 's2', kind: 'acquire', amount: null, payload: null, granted: false, grantedName: null, grantedPayload: null },
    { id: 3, name: 'Slots', instanceId: B, stepOid: 's3', kind: 'acquire', amount: 4, payload: null, granted: false, grantedName: null, grantedPayload: null },
    { id: 4, name: 'Chan', instanceId: A, stepOid: 's4', kind: 'send', amount: null, payload: 'hello', granted: false, grantedName: null, grantedPayload: null },
    { id: 5, name: 'Chan', instanceId: B, stepOid: 's5', kind: 'receive', amount: null, payload: null, granted: false, grantedName: null, grantedPayload: null },
    { id: 6, name: 'Chan', instanceId: A, stepOid: 's6', kind: 'sync', amount: null, payload: null, granted: false, grantedName: null, grantedPayload: null },
  ];
  const ser = snapshotToSerialized(snap, WC);
  const states = Object.fromEntries(ser.resources);
  expect((states['Printer'] as any).queue).toEqual([envToken(A, 's1'), envToken(B, 's2')]);
  expect((states['Slots'] as any).queue).toEqual([{ stepOid: envToken(B, 's3'), amount: 4 }]);
  const chan = states['Chan'] as any;
  expect(chan.sendQueue).toEqual([{ stepOid: envToken(A, 's4'), data: 'hello' }]);
  expect(chan.receiveQueue).toEqual([envToken(B, 's5')]);
  expect(chan.pendingSync).toEqual([envToken(A, 's6')]);
});

test('a granted waiter becomes a pending grant, not a queue entry', () => {
  const snap = snapshot();
  snap.waiters = [
    { id: 1, name: 'Bay', instanceId: A, stepOid: 's1', kind: 'acquire', amount: null, payload: null, granted: true, grantedName: 'B1', grantedPayload: null },
    { id: 2, name: 'Chan', instanceId: A, stepOid: 's2', kind: 'receive', amount: null, payload: null, granted: true, grantedName: null, grantedPayload: 'payload-x' },
  ];
  const ser = snapshotToSerialized(snap, WC);
  const states = Object.fromEntries(ser.resources);
  expect((states['Bay'] as any).queue).toEqual([]);
  expect(ser.pendingGrants).toEqual([
    { stepOid: envToken(A, 's1'), resourceKey: 'Bay' },
    { stepOid: envToken(A, 's2'), resourceKey: 'Chan' },
  ]);
  expect(ser.pendingNamedAssignments).toEqual([[envToken(A, 's1'), 'B1']]);
  expect(ser.syncMatchedData).toEqual([[envToken(A, 's2'), 'payload-x']]);
});

describe('diffRegistry', () => {
  const setup = () => {
    const snap = snapshot();
    // Printer is genuinely held: resources.ts's own acquire()/release() invariant is that a
    // non-empty queue can only exist once inUse=1, so inUse=0 with queued waiters is a state
    // the registry itself can never legitimately reach - don't fixture an unreachable state.
    snap.resources = snap.resources.map((r) => (r.name === 'Printer' ? { ...r, inUse: 1 } : r));
    snap.waiters = [
      { id: 10, name: 'Printer', instanceId: A, stepOid: 's1', kind: 'acquire', amount: null, payload: null, granted: false, grantedName: null, grantedPayload: null },
      { id: 11, name: 'Printer', instanceId: B, stepOid: 's2', kind: 'acquire', amount: null, payload: null, granted: false, grantedName: null, grantedPayload: null },
    ];
    const mgr = InMemoryResourceManager.fromJSON(snapshotToSerialized(snap, WC));
    return { snap, mgr, index: indexWaiters(snap) };
  };

  test('an unchanged queue produces no waiter churn', () => {
    const { snap, mgr, index } = setup();
    const d = diffRegistry({ snap, manager: mgr, index, instanceId: A, holds: [] });
    expect(d.deleteWaiterIds).toEqual([]);
    expect(d.insertWaiters).toEqual([]);
    expect(d.grantWaiters).toEqual([]);
  });

  test('a newly queued waiter is inserted and an existing one keeps its row', () => {
    const { snap, mgr, index } = setup();
    mgr.acquire('Printer', envToken(A, 's9'));   // pool busy -> queues at the tail
    const d = diffRegistry({ snap, manager: mgr, index, instanceId: A, holds: [] });
    expect(d.insertWaiters).toEqual([
      { name: 'Printer', stepOid: 's9', kind: 'acquire', amount: null, payload: null },
    ]);
    expect(d.deleteWaiterIds).toEqual([]);
  });

  test('a grant for THIS instance deletes its waiter row', () => {
    const { snap, mgr, index } = setup();
    mgr.release('Printer');                       // grants the head, which is A's s1
    const d = diffRegistry({ snap, manager: mgr, index, instanceId: A, holds: [] });
    expect(d.deleteWaiterIds).toEqual([10]);
    expect(d.grantWaiters).toEqual([]);
    expect(d.foreignGrantInstanceIds).toEqual([]);
  });

  test('a grant for a FOREIGN instance marks its waiter granted and names the instance', () => {
    const { snap, mgr, index } = setup();
    mgr.release('Printer');                       // grants A's s1
    mgr.flushGranted(new Set([envToken(A, 's1')])); // this instance consumes its own grant
    mgr.release('Printer');                       // now grants B's s2 - foreign
    const d = diffRegistry({ snap, manager: mgr, index, instanceId: A, holds: [] });
    expect(d.grantWaiters).toEqual([{ id: 11, grantedName: null, grantedPayload: null }]);
    expect(d.deleteWaiterIds).toEqual([10]);
    expect(d.foreignGrantInstanceIds).toEqual([B]);
  });

  test('a cancelled waiter is deleted without being granted', () => {
    const { snap, mgr, index } = setup();
    mgr.cancelQueuedWaiters(new Set([envToken(A, 's1')]));
    const d = diffRegistry({ snap, manager: mgr, index, instanceId: A, holds: [] });
    expect(d.deleteWaiterIds).toEqual([10]);
    expect(d.grantWaiters).toEqual([]);
  });

  test('counters and holders come straight through', () => {
    const { snap, mgr, index } = setup();
    const holds = [{ name: 'Bay', stepOid: 's7', amount: 1, heldName: 'B1' }];
    const d = diffRegistry({ snap, manager: mgr, index, instanceId: A, holds });
    const bay = d.counters.find((c) => c.name === 'Bay');
    expect(bay).toEqual({ name: 'Bay', inUse: 0, availableNames: ['B1', 'B2'] });
    expect(d.holders).toEqual(holds);
  });

  test('a foreign named-pool grant carries the reserved name across', () => {
    const snap = snapshot();
    // Bay's pool is fully checked out; B is queued for the next free slot.
    snap.resources = snap.resources.map((r) => (r.name === 'Bay' ? { ...r, availableNames: [] } : r));
    snap.waiters = [
      { id: 30, name: 'Bay', instanceId: B, stepOid: 's1', kind: 'acquire', amount: null, payload: null, granted: false, grantedName: null, grantedPayload: null },
    ];
    const mgr = InMemoryResourceManager.fromJSON(snapshotToSerialized(snap, WC));
    const index = indexWaiters(snap);
    mgr.releaseNamed('Bay', 'B1');   // a name comes back to the pool -> grants B's queued waiter
    const d = diffRegistry({ snap, manager: mgr, index, instanceId: A, holds: [] });
    expect(d.grantWaiters).toEqual([{ id: 30, grantedName: 'B1', grantedPayload: null }]);
    expect(d.foreignGrantInstanceIds).toEqual([B]);
  });

  test('a foreign sync receive grant carries the matched payload across', () => {
    const snap = snapshot();
    snap.waiters = [
      { id: 40, name: 'Chan', instanceId: B, stepOid: 's1', kind: 'receive', amount: null, payload: null, granted: false, grantedName: null, grantedPayload: null },
    ];
    const mgr = InMemoryResourceManager.fromJSON(snapshotToSerialized(snap, WC));
    const index = indexWaiters(snap);
    mgr.send('Chan', envToken(A, 's2'), 'hello-payload');   // A's local send matches B's queued receive
    const d = diffRegistry({ snap, manager: mgr, index, instanceId: A, holds: [] });
    expect(d.grantWaiters).toEqual([{ id: 40, grantedName: null, grantedPayload: 'hello-payload' }]);
    expect(d.foreignGrantInstanceIds).toEqual([B]);
  });

  test('a cross-instance grant this instance already consumed gets its stale waiter row deleted', () => {
    const snap = snapshot();
    snap.waiters = [
      { id: 50, name: 'Printer', instanceId: A, stepOid: 's1', kind: 'acquire', amount: null, payload: null, granted: true, grantedName: null, grantedPayload: null },
    ];
    const mgr = InMemoryResourceManager.fromJSON(snapshotToSerialized(snap, WC));
    const index = indexWaiters(snap);
    mgr.flushGranted(new Set([envToken(A, 's1')]));   // this instance consumes its own pre-existing grant
    const d = diffRegistry({ snap, manager: mgr, index, instanceId: A, holds: [] });
    expect(d.deleteWaiterIds).toEqual([50]);
  });

  test('a cross-instance grant this instance has not yet consumed keeps its waiter row', () => {
    const snap = snapshot();
    snap.waiters = [
      { id: 51, name: 'Printer', instanceId: A, stepOid: 's1', kind: 'acquire', amount: null, payload: null, granted: true, grantedName: null, grantedPayload: null },
    ];
    const mgr = InMemoryResourceManager.fromJSON(snapshotToSerialized(snap, WC));
    const index = indexWaiters(snap);
    const d = diffRegistry({ snap, manager: mgr, index, instanceId: A, holds: [] });
    expect(d.deleteWaiterIds).toEqual([]);
  });

  test('a foreign granted-at-load row is left alone', () => {
    const snap = snapshot();
    snap.waiters = [
      { id: 52, name: 'Printer', instanceId: B, stepOid: 's2', kind: 'acquire', amount: null, payload: null, granted: true, grantedName: null, grantedPayload: null },
    ];
    const mgr = InMemoryResourceManager.fromJSON(snapshotToSerialized(snap, WC));
    const index = indexWaiters(snap);
    const d = diffRegistry({ snap, manager: mgr, index, instanceId: A, holds: [] });
    expect(d.deleteWaiterIds).toEqual([]);
  });
});
