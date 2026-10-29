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
// Spec 2026-09-14 (GATE bound-property events) §4.1-§4.5: core/property-watch.ts. Part 1 is the
// data layer against PGlite (key resolution mirrors core/property-overlay.ts; the mark-due UPDATE
// is the §4.3 predicate). Part 2 (Task 7) is the registry over a fake subscriber with fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { testDeps } from './helpers/pump.js';
import { ActionClient } from '../src/actions/client.js';
import {
  groupOf, watchKey, resolveGateKeys, loadWaitingGates, markGatesDue, createPropertyWatch, startPropertyWatch,
  type WatchedGateRow, type PropertyWatchKey, type PropertyWatchIo,
} from '../src/core/property-watch.js';
import type { EventStreamCallbacks, PropertyStreamEvent } from '../src/actions/sse.js';
import type { Db } from '../src/db.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});
const env = (local_id: string, oid: string) => ({ local_id, oid, version: '1.0.0', last_modified_date: '2026-01-01', included_actions: [] });

/** Every resolution path in one gate: a, b share a group; c resolves by unique name; d's oid
 *  misses and its name resolves; e's name is ambiguous; f's environment has no bound server;
 *  g's server is not trusted. */
const KEY_SPEC = {
  local_id: 'wf', oid: 'wf-keys', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [env('env', 'env-1'), env('dup', 'env-2'), env('dup', 'env-3'), env('far', 'env-4')],
  steps: [
    step('s', 'START'),
    step('g', 'GATE', {
      gate_config: {
        cycle_seconds: 600, source: 'return true;',
        action_property_bindings: [
          { parameter_id: 'a', environment_oid: 'env-1', property: 'Sensor.Value' },
          { parameter_id: 'b', environment_oid: 'env-1', property: 'Sensor.Other' },
          { parameter_id: 'c', environment_name: 'env', property: 'Tank' },
          { parameter_id: 'd', environment_oid: 'missing', environment_name: 'env', property: 'Pump.On' },
          { parameter_id: 'e', environment_name: 'dup', property: 'X.Y' },
          { parameter_id: 'f', environment_oid: 'env-9', property: 'Q' },
          { parameter_id: 'g', environment_oid: 'env-4', property: 'Blocked.V' },
        ],
      },
    }),
    step('e', 'END'),
  ],
  connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
};

const EPOCH = new Date('2026-01-01T00:00:00.000Z');
function addSeconds(d: Date, secs: number): Date { return new Date(d.getTime() + secs * 1000); }

async function seedRunning(db: any, spec: any): Promise<{ id: string; workCenterId: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', queuedAt: EPOCH,
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id };
}

async function seedStepRow(db: any, instanceId: string, spec: any, opts: { state?: string; stepType?: string; wakeAt: Date | null }): Promise<string> {
  const [row] = await db.insert(stepInstance).values({
    workflowInstanceId: instanceId, nodeOid: spec.oid, stepOid: 'g', stepType: opts.stepType ?? 'GATE',
    state: opts.state ?? 'WAITING_GATE', wakeAt: opts.wakeAt, createdAt: EPOCH, updatedAt: EPOCH,
  }).returning({ id: stepInstance.id });
  return row.id;
}

async function rowById(db: any, id: string): Promise<any> {
  const [row] = await db.select().from(stepInstance).where(eq(stepInstance.id, id));
  return row;
}

describe('groupOf / watchKey (§4.1, §4.2)', () => {
  it('takes the part before the first dot; a bare group is itself', () => {
    expect(groupOf('Sensor.Value')).toBe('Sensor');
    expect(groupOf('Sensor')).toBe('Sensor');
    expect(groupOf('A.B.C')).toBe('A');
  });
  it('formats the registry key as serverUri | environmentOid | group', () => {
    expect(watchKey('http://s:1', 'env-1', 'Sensor')).toBe('http://s:1|env-1|Sensor');
  });
});

describe('resolveGateKeys (§4.2)', () => {
  const row: WatchedGateRow = { stepInstanceId: 'si-1', stepOid: 'g', nodeOid: KEY_SPEC.oid, workCenterId: 'wc-1', spec: KEY_SPEC as any };
  const bindingLookup = async (_wc: string, envOid: string) =>
    envOid === 'env-9' ? null : envOid === 'env-4' ? 'http://far:1' : 'http://near:1';
  const isAllowed = async (uri: string) => uri === 'http://near:1';

  it('dotted bindings collapse to their group; oid, unique name, and oid-miss-then-name all resolve; two groups give two keys; every failure is reported and skipped', async () => {
    const { keys, skipped } = await resolveGateKeys(row, { bindingLookup, isAllowed });
    expect(keys.map((k) => k.key)).toEqual([
      'http://near:1|env-1|Sensor', 'http://near:1|env-1|Tank', 'http://near:1|env-1|Pump',
    ]);
    expect(keys[0]).toEqual({ key: 'http://near:1|env-1|Sensor', serverUri: 'http://near:1', environmentOid: 'env-1', group: 'Sensor' });
    expect(skipped).toEqual([
      { stepInstanceId: 'si-1', reason: "binding 'e': no resolvable environment" },
      { stepInstanceId: 'si-1', reason: "binding 'f': no action server bound for environment env-9" },
      { stepInstanceId: 'si-1', reason: "binding 'g': action server http://far:1 is not allowed by the current trust policy" },
    ]);
  });

  it('a gate without bindings, or a step def that cannot be found, yields nothing and nothing skipped', async () => {
    const noBindings = { ...KEY_SPEC, oid: 'wf-none', steps: [step('s', 'START'), step('g', 'GATE', { gate_config: { source: 'return true;' } }), step('e', 'END')] };
    expect(await resolveGateKeys({ ...row, nodeOid: 'wf-none', spec: noBindings as any }, { bindingLookup, isAllowed })).toEqual({ keys: [], skipped: [] });
    expect(await resolveGateKeys({ ...row, stepOid: 'nope' }, { bindingLookup, isAllowed })).toEqual({ keys: [], skipped: [] });
  });
});

describe('loadWaitingGates (§4.4)', () => {
  it('returns every WAITING_GATE gate row with a live timer, joined to its instance; ignores NULL wake_at, other states and other step types', async () => {
    const { db, close } = await makeTestDb();
    const wi = await seedRunning(db, KEY_SPEC);
    const wanted = await seedStepRow(db, wi.id, KEY_SPEC, { wakeAt: addSeconds(EPOCH, 600) });
    await seedStepRow(db, wi.id, KEY_SPEC, { wakeAt: null });                          // open armed gate
    await seedStepRow(db, wi.id, KEY_SPEC, { state: 'COMPLETED', wakeAt: addSeconds(EPOCH, 600) });
    await seedStepRow(db, wi.id, KEY_SPEC, { stepType: 'ACTION PROXY', state: 'WAITING_ACTION', wakeAt: addSeconds(EPOCH, 600) });

    const rows = await loadWaitingGates(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stepInstanceId: wanted, stepOid: 'g', nodeOid: KEY_SPEC.oid, workCenterId: wi.workCenterId });
    expect(rows[0]!.spec.oid).toBe('wf-keys');
    await close();
  });
});

describe('markGatesDue (§3, §4.3)', () => {
  it('pulls a future wake_at to now, and only that: NULL, already-due, non-WAITING_GATE and non-member rows are untouched; a second call is a no-op', async () => {
    const { db, close } = await makeTestDb();
    const wi = await seedRunning(db, KEY_SPEC);
    const now = addSeconds(EPOCH, 10);
    const future = await seedStepRow(db, wi.id, KEY_SPEC, { wakeAt: addSeconds(EPOCH, 600) });
    const nul = await seedStepRow(db, wi.id, KEY_SPEC, { wakeAt: null });
    const past = await seedStepRow(db, wi.id, KEY_SPEC, { wakeAt: addSeconds(EPOCH, 5) });
    const done = await seedStepRow(db, wi.id, KEY_SPEC, { state: 'COMPLETED', wakeAt: addSeconds(EPOCH, 600) });
    const other = await seedStepRow(db, wi.id, KEY_SPEC, { wakeAt: addSeconds(EPOCH, 600) });

    expect(await markGatesDue(db, now, [future, nul, past, done])).toBe(1);

    const f = await rowById(db, future);
    expect(new Date(f.wakeAt).getTime()).toBe(now.getTime());
    expect(new Date(f.updatedAt).getTime()).toBe(now.getTime());
    expect((await rowById(db, nul)).wakeAt).toBeNull();
    expect(new Date((await rowById(db, past)).wakeAt).getTime()).toBe(addSeconds(EPOCH, 5).getTime());
    expect(new Date((await rowById(db, done)).wakeAt).getTime()).toBe(addSeconds(EPOCH, 600).getTime());
    expect(new Date((await rowById(db, other)).wakeAt).getTime()).toBe(addSeconds(EPOCH, 600).getTime());

    expect(await markGatesDue(db, now, [future, nul, past, done])).toBe(0);
    expect(await markGatesDue(db, now, [])).toBe(0);
    await close();
  });
});

// ── Part 2: the registry over a fake subscriber, fake timers, no HTTP (§4.4, §4.5) ──

type Callbacks = EventStreamCallbacks<PropertyStreamEvent>;

interface FakeState {
  rows: WatchedGateRow[];
  keysByStep: Record<string, PropertyWatchKey[]>;
  skipsByStep?: Record<string, string[]>;
}

/** A PropertyWatchIo whose every port is a recording spy. `subscribes` keeps each subscribe
 *  call's callbacks so a test can fire onOpen / onEvent / onEnd by hand. */
function fakeIo(state: FakeState) {
  const subscribes: Array<{ key: PropertyWatchKey; callbacks: Callbacks; closed: boolean }> = [];
  let subscribeMode: 'ok' | 'reject' = 'ok';
  const loadGates = vi.fn(async () => state.rows);
  const resolve = vi.fn(async (row: WatchedGateRow) => ({
    keys: state.keysByStep[row.stepInstanceId] ?? [],
    skipped: (state.skipsByStep?.[row.stepInstanceId] ?? []).map((reason) => ({ stepInstanceId: row.stepInstanceId, reason })),
  }));
  const subscribe = vi.fn(async (key: PropertyWatchKey, callbacks: Callbacks) => {
    if (subscribeMode === 'reject') throw new Error('Action server is not in the allowlist');
    const sub = { key, callbacks, closed: false };
    subscribes.push(sub);
    return { close: () => { sub.closed = true; } };
  });
  const markDue = vi.fn(async (ids: string[]) => ids.length);
  const wake = vi.fn();
  const io: PropertyWatchIo = { loadGates, resolve, subscribe, markDue, wake };
  return { io, subscribes, loadGates, resolve, subscribe, markDue, wake, setSubscribeMode: (m: 'ok' | 'reject') => { subscribeMode = m; } };
}

const gateRow = (id: string): WatchedGateRow => ({
  stepInstanceId: id, stepOid: 'g', nodeOid: 'wf', workCenterId: 'wc',
  spec: { local_id: 'wf', oid: 'wf', version: '1.0.0', last_modified_date: '2026-01-01', steps: [], connections: [] } as any,
});
const K = (server: string, envOid: string, group: string): PropertyWatchKey =>
  ({ key: watchKey(server, envOid, group), serverUri: server, environmentOid: envOid, group });
const SENSOR = K('http://s:1', 'env-1', 'Sensor');
const TANK = K('http://s:1', 'env-1', 'Tank');
const PROPERTY_EVENT: PropertyStreamEvent = {
  type: 'property', environment_oid: 'env-1', property_name: 'Sensor', changed_entries: ['Value'],
  entries: [{ name: 'Value', value: '150' }], ts: 't', eventId: 1,
};
/** Ten microtask turns — enough for `await io.markDue()` → `io.wake()` and for a rejected
 *  subscribe's catch to run — without advancing fake time. */
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('createPropertyWatch (§4.1, §4.4, §4.5)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('reconcile opens one stream per key with the member set, updates members in place, and closes an entry whose last member left', async () => {
    const state: FakeState = { rows: [gateRow('a'), gateRow('b')], keysByStep: { a: [SENSOR], b: [SENSOR, TANK] } };
    const { io, subscribes } = fakeIo(state);
    const watch = createPropertyWatch(io, { reconcileMs: 5000 });

    await watch.reconcileNow();
    expect(subscribes.map((s) => s.key.key)).toEqual(['http://s:1|env-1|Sensor', 'http://s:1|env-1|Tank']);
    expect(watch.snapshot()).toEqual([
      { key: 'http://s:1|env-1|Sensor', members: ['a', 'b'], live: false, attempt: 0, lastReason: null },
      { key: 'http://s:1|env-1|Tank', members: ['b'], live: false, attempt: 0, lastReason: null },
    ]);

    state.rows = [gateRow('a')];
    await watch.reconcileNow();
    expect(subscribes).toHaveLength(2);            // the surviving key was not re-subscribed
    expect(subscribes[1]!.closed).toBe(true);      // Tank lost its last member: closed
    expect(watch.snapshot()).toEqual([{ key: 'http://s:1|env-1|Sensor', members: ['a'], live: false, attempt: 0, lastReason: null }]);

    watch.stop();
    expect(subscribes[0]!.closed).toBe(true);
    expect(watch.snapshot()).toEqual([]);
  });

  it('a property event marks every member due and wakes the loop; heartbeats and a zero-row update never wake', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {}); // the `live` line from onOpen below
    const { io, subscribes, markDue, wake } = fakeIo({ rows: [gateRow('a'), gateRow('b')], keysByStep: { a: [SENSOR], b: [SENSOR] } });
    const watch = createPropertyWatch(io, { reconcileMs: 5000 });
    await watch.reconcileNow();
    const sub = subscribes[0]!;
    sub.callbacks.onOpen?.();
    expect(watch.snapshot()[0]!.live).toBe(true);

    sub.callbacks.onEvent({ type: 'heartbeat', ts: 't' });
    await flush();
    expect(markDue).not.toHaveBeenCalled();

    sub.callbacks.onEvent(PROPERTY_EVENT);
    await flush();
    expect(markDue).toHaveBeenCalledTimes(1);
    expect(markDue.mock.calls[0]![0]).toEqual(['a', 'b']);
    expect(wake).toHaveBeenCalledTimes(1);

    markDue.mockResolvedValueOnce(0);              // a late event: nothing had a future wake_at
    sub.callbacks.onEvent(PROPERTY_EVENT);
    await flush();
    expect(markDue).toHaveBeenCalledTimes(2);
    expect(wake).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  it('a mark-due failure is logged and never escapes the event callback', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { io, subscribes, markDue, wake } = fakeIo({ rows: [gateRow('a')], keysByStep: { a: [SENSOR] } });
    const watch = createPropertyWatch(io, { reconcileMs: 5000 });
    await watch.reconcileNow();
    markDue.mockRejectedValueOnce(new Error('db down'));
    subscribes[0]!.callbacks.onEvent(PROPERTY_EVENT);
    await flush();
    expect(wake).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toBe('[mission-engine] property watch http://s:1|env-1|Sensor: could not mark 1 gate(s) due — the cycle still applies: db down');
    watch.stop();
  });

  it('a failed open logs once, retries at 5 s, 10 s, 20 s, 40 s then 60 s; a changed reason logs again; a successful open logs live and resets the attempt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { io, subscribes } = fakeIo({ rows: [gateRow('a')], keysByStep: { a: [SENSOR] } });
    const watch = createPropertyWatch(io, { reconcileMs: 600_000 });
    await watch.reconcileNow();
    expect(subscribes).toHaveLength(1);

    subscribes[0]!.callbacks.onEnd?.('stream open failed (404): {"error":{"code":"PROPERTY_NOT_FOUND"}}');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe('[mission-engine] property watch http://s:1|env-1|Sensor: stream open failed (404): {"error":{"code":"PROPERTY_NOT_FOUND"}} — retrying with backoff; the gate keeps evaluating on its cycle');
    expect(watch.snapshot()[0]).toMatchObject({ live: false, attempt: 1, lastReason: 'stream open failed (404): {"error":{"code":"PROPERTY_NOT_FOUND"}}' });

    await vi.advanceTimersByTimeAsync(4999);
    expect(subscribes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(subscribes).toHaveLength(2);            // retry #1 at 5 s
    subscribes[1]!.callbacks.onEnd?.('stream open failed (404): {"error":{"code":"PROPERTY_NOT_FOUND"}}');
    expect(warn).toHaveBeenCalledTimes(1);         // same reason: silent

    await vi.advanceTimersByTimeAsync(10_000);
    expect(subscribes).toHaveLength(3);            // retry #2 at 10 s
    subscribes[2]!.callbacks.onEnd?.('connect failed: ECONNREFUSED');
    expect(warn).toHaveBeenCalledTimes(2);         // changed reason: logged

    await vi.advanceTimersByTimeAsync(20_000);
    expect(subscribes).toHaveLength(4);            // retry #3 at 20 s
    subscribes[3]!.callbacks.onEnd?.('connect failed: ECONNREFUSED');
    await vi.advanceTimersByTimeAsync(40_000);
    expect(subscribes).toHaveLength(5);            // retry #4 at 40 s
    subscribes[4]!.callbacks.onEnd?.('connect failed: ECONNREFUSED');
    await vi.advanceTimersByTimeAsync(59_999);
    expect(subscribes).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(subscribes).toHaveLength(6);            // retry #5 capped at 60 s
    expect(watch.snapshot()[0]!.attempt).toBe(5);

    subscribes[5]!.callbacks.onOpen?.();
    expect(log).toHaveBeenCalledWith('[mission-engine] property watch live: http://s:1|env-1|Sensor');
    expect(watch.snapshot()[0]).toMatchObject({ live: true, attempt: 0, lastReason: null });

    subscribes[5]!.callbacks.onEnd?.('stream ended');
    expect(warn).toHaveBeenCalledTimes(3);         // a new outage logs its reason again
    await vi.advanceTimersByTimeAsync(5000);
    expect(subscribes).toHaveLength(7);            // back to the 5 s base
    watch.stop();
  });

  it('a rejected subscribe (allowlist / policy read) is a failure like any other: logged once, retried with backoff', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { io, subscribes, setSubscribeMode } = fakeIo({ rows: [gateRow('a')], keysByStep: { a: [SENSOR] } });
    setSubscribeMode('reject');
    const watch = createPropertyWatch(io, { reconcileMs: 600_000 });
    await watch.reconcileNow();
    await flush();
    expect(subscribes).toHaveLength(0);
    expect(watch.snapshot()[0]).toMatchObject({ live: false, attempt: 1, lastReason: 'subscribe failed: Action server is not in the allowlist' });
    expect(warn).toHaveBeenCalledTimes(1);

    setSubscribeMode('ok');
    await vi.advanceTimersByTimeAsync(5000);
    expect(subscribes).toHaveLength(1);
    watch.stop();
  });

  it('closing an entry cancels its pending retry; stop() closes every stream and ignores later reconcile requests', async () => {
    const state: FakeState = { rows: [gateRow('a')], keysByStep: { a: [SENSOR] } };
    const { io, subscribes, loadGates } = fakeIo(state);
    const watch = createPropertyWatch(io, { reconcileMs: 600_000 });
    await watch.reconcileNow();
    subscribes[0]!.callbacks.onEnd?.('stream ended');   // retry now pending at 5 s

    state.rows = [];
    await watch.reconcileNow();                          // the gate settled: entry closed
    expect(watch.snapshot()).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(subscribes).toHaveLength(1);                  // the cancelled retry never fired

    state.rows = [gateRow('a')];
    await watch.reconcileNow();
    expect(subscribes).toHaveLength(2);
    const calls = loadGates.mock.calls.length;
    watch.stop();
    expect(subscribes[1]!.closed).toBe(true);
    watch.reconcileSoon();
    await watch.reconcileNow();
    await vi.advanceTimersByTimeAsync(700_000);
    expect(loadGates.mock.calls.length).toBe(calls);     // nothing runs after stop()
    watch.stop();                                        // idempotent
  });

  it('reconcileSoon debounces to one run per 500 ms; the interval reconciles every reconcileMs', async () => {
    const { io, loadGates } = fakeIo({ rows: [], keysByStep: {} });
    const watch = createPropertyWatch(io, { reconcileMs: 5000 });
    expect(loadGates).toHaveBeenCalledTimes(0);

    watch.reconcileSoon(); watch.reconcileSoon(); watch.reconcileSoon();
    await vi.advanceTimersByTimeAsync(499);
    expect(loadGates).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(loadGates).toHaveBeenCalledTimes(1);          // t = 500: one debounced run
    await vi.advanceTimersByTimeAsync(4500);
    expect(loadGates).toHaveBeenCalledTimes(2);          // t = 5000: the interval
    await vi.advanceTimersByTimeAsync(5000);
    expect(loadGates).toHaveBeenCalledTimes(3);          // t = 10000
    watch.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(loadGates).toHaveBeenCalledTimes(3);
  });

  it('unresolvable bindings log once per (gate, reason) and again only for a new reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state: FakeState = { rows: [gateRow('a')], keysByStep: {}, skipsByStep: { a: ["binding 'f': no action server bound for environment env-9"] } };
    const { io } = fakeIo(state);
    const watch = createPropertyWatch(io, { reconcileMs: 600_000 });
    await watch.reconcileNow();
    await watch.reconcileNow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe("[mission-engine] property watch: gate step a not watched — binding 'f': no action server bound for environment env-9");

    state.skipsByStep = { a: ["binding 'f': action server http://far:1 is not allowed by the current trust policy"] };
    await watch.reconcileNow();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(watch.snapshot()).toEqual([]);

    // The gate leaves and comes back with the ORIGINAL reason: logged again (memory is pruned to live rows).
    state.rows = [];
    await watch.reconcileNow();
    state.rows = [gateRow('a')];
    state.skipsByStep = { a: ["binding 'f': no action server bound for environment env-9"] };
    await watch.reconcileNow();
    expect(warn).toHaveBeenCalledTimes(3);
    watch.stop();
  });

  it('a reconcile whose gate load throws logs once per distinct message and leaves the registry untouched', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const state: FakeState = { rows: [gateRow('a')], keysByStep: { a: [SENSOR] } };
    const { io, subscribes, loadGates } = fakeIo(state);
    const watch = createPropertyWatch(io, { reconcileMs: 600_000 });
    await watch.reconcileNow();
    expect(subscribes).toHaveLength(1);

    loadGates.mockRejectedValueOnce(new Error('db down'));
    await watch.reconcileNow();
    loadGates.mockRejectedValueOnce(new Error('db down'));
    await watch.reconcileNow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toBe('[mission-engine] property watch: reconcile failed (registry left as is): db down');
    expect(watch.snapshot()).toHaveLength(1);
    expect(subscribes[0]!.closed).toBe(false);

    await watch.reconcileNow();                          // recovers
    loadGates.mockRejectedValueOnce(new Error('db down'));
    await watch.reconcileNow();
    expect(errorSpy).toHaveBeenCalledTimes(2);           // logged again after a success
    watch.stop();
  });

  it('reconcile requests that arrive while one is running fold into exactly one follow-up run', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { io, loadGates } = fakeIo({ rows: [], keysByStep: {} });
    loadGates.mockImplementationOnce(async () => { await gate; return []; });
    const watch = createPropertyWatch(io, { reconcileMs: 600_000 });

    const first = watch.reconcileNow();
    const second = watch.reconcileNow();
    const third = watch.reconcileNow();
    release();
    await Promise.all([first, second, third]);
    expect(loadGates).toHaveBeenCalledTimes(2);
    watch.stop();
  });

  it('a row whose resolve throws is skipped (logged once) while the other rows still resolve', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { io, subscribes, resolve } = fakeIo({ rows: [gateRow('a'), gateRow('b')], keysByStep: { a: [SENSOR], b: [TANK] } });
    resolve.mockImplementationOnce(async () => { throw new Error('binding DAO down'); });   // row a, first pass only
    const watch = createPropertyWatch(io, { reconcileMs: 600_000 });
    await watch.reconcileNow();
    expect(subscribes.map((s) => s.key.key)).toEqual(['http://s:1|env-1|Tank']);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe('[mission-engine] property watch: gate step a not watched — resolution failed: binding DAO down');
    await watch.reconcileNow();                              // row a resolves now → Sensor opens too
    expect(subscribes.map((s) => s.key.key)).toEqual(['http://s:1|env-1|Tank', 'http://s:1|env-1|Sensor']);
    watch.stop();
  });
});

describe('startPropertyWatch no-op outcomes (§4.5, §4.7)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('a non-dispatching invoker (nullActionInvoker) yields an inert handle and one log line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handle = startPropertyWatch({} as unknown as Db, testDeps(), new ActionClient([]), vi.fn());
    await handle.reconcileNow();
    handle.reconcileSoon();
    expect(handle.snapshot()).toEqual([]);
    handle.stop();
    expect(log).toHaveBeenCalledWith('[mission-engine] property watch inactive — the action invoker does not dispatch, so no gate can bind a server');
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('repeating SCRIPT rows (spec 2026-10-13 §6.2)', () => {
  const SCRIPT_SPEC = {
    local_id: 'wf', oid: 'wf-script-keys', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: [env('env', 'env-1')],
    steps: [
      step('s', 'START'),
      step('g', 'SCRIPT', {
        script_config: { source: 'return false;', repeat: {} },
        action_property_bindings: [{ parameter_id: 'a', environment_oid: 'env-1', property: 'Sensor.Value' }],
      }),
      step('e', 'END'),
    ],
    connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
  };

  it('resolveGateKeys reads a script step-level bindings', async () => {
    const row: WatchedGateRow = { stepInstanceId: 'si-9', stepOid: 'g', nodeOid: SCRIPT_SPEC.oid, workCenterId: 'wc-1', spec: SCRIPT_SPEC as any };
    const { keys } = await resolveGateKeys(row, { bindingLookup: async () => 'http://near:1', isAllowed: async () => true });
    expect(keys.map((k) => k.key)).toEqual(['http://near:1|env-1|Sensor']);
  });

  it('loadWaitingGates and markGatesDue include WAITING_SCRIPT rows', async () => {
    const { db, close } = await makeTestDb();
    const wi = await seedRunning(db, SCRIPT_SPEC);
    const id = await seedStepRow(db, wi.id, SCRIPT_SPEC, { stepType: 'SCRIPT', state: 'WAITING_SCRIPT', wakeAt: addSeconds(EPOCH, 600) });
    expect((await loadWaitingGates(db)).map((r) => r.stepInstanceId)).toEqual([id]);
    expect(await markGatesDue(db, addSeconds(EPOCH, 10), [id])).toBe(1);
    await close();
  });
});
