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
// Spec 2026-09-14 (GATE bound-property events) §6 items 4-8: end to end over the stub action
// server's REST-12 stream — the same harness shape as test/gate-bindings.test.ts (a real
// ActionClient + httpActionInvoker, a fake clock the tests never advance unless a test says so),
// plus startPropertyWatch wired exactly the way index.ts wires it. The loop is driven by
// pumpUntilQuiet; `wake` is a spy standing in for the loop handle's wake().
import { afterEach, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import { requestPause, requestResume } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { startStubActionServer, type StubActionServer, type StubOptions } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { startPropertyWatch, markGatesDue, type PropertyWatchHandle } from '../src/core/property-watch.js';
import type { EngineConfig, EngineDeps } from '../src/config.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

// Matches STUB_ENV in stub-action-server.ts (oid 'env-1').
const ENV_SPECS = [{ local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01', included_actions: [] }];

function addSeconds(d: Date, secs: number): Date { return new Date(d.getTime() + secs * 1000); }

function makeClock(start = new Date('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (secs: number) => { now = addSeconds(now, secs); } };
}

function makeHttpDeps(stub: StubActionServer, clock: { now: () => Date }, configOverrides: Partial<EngineConfig> = {}): { deps: EngineDeps; client: ActionClient } {
  const allowlist = [new URL(stub.uri).origin];
  const client = new ActionClient(allowlist);
  const deps = testDeps({
    now: clock.now,
    invoker: httpActionInvoker(client, async () => stub.uri),
    config: {
      databaseUrl: 'unused', port: 3006, workerConcurrency: 1,
      actionServerAllowlist: allowlist, scriptTimeoutMs: 5000,
      actionPollSecs: 20, invokeGraceSecs: 60,
      actionFetchTimeoutMs: 10_000,
      propertyWatchEnabled: true, propertyWatchReconcileMs: 5000,
      authSecret: 'test-secret', baseUrl: 'http://127.0.0.1:3006', internalToken: null,
      ...configOverrides,
    },
  });
  return { deps, client };
}

// START -> GATE(reads Sensor.Value @ env-1 as `f`, cycle `cycleSeconds`) -> END.
function gateSpec(oid: string, cycleSeconds: number) {
  return {
    local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step('s', 'START'),
      step('g', 'GATE', {
        gate_config: {
          cycle_seconds: cycleSeconds,
          source: 'return Number(f) > 100;',
          action_property_bindings: [{ parameter_id: 'f', environment_oid: 'env-1', property: 'Sensor.Value' }],
        },
        input_parameter_specifications: [{ id: 'f', default_value: '', value_type: 'literal' }],
      }),
      step('e', 'END'),
    ],
    connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
  };
}

async function seedQueued(db: any, spec: any): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id };
}

async function stepRow(db: any, instanceId: string, stepOid: string): Promise<any> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === stepOid);
}

async function instanceRow(db: any, instanceId: string): Promise<any> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

let stub: StubActionServer;
let watch: PropertyWatchHandle | null = null;

afterEach(async () => {
  watch?.stop();
  watch = null;
  if (stub) await stub.close();
  vi.restoreAllMocks();
});

/** Parks one bound gate FALSE (server value 50) at `cycleSeconds` and returns the harness. */
async function parkBoundGate(oid: string, cycleSeconds: number, stubOpts: StubOptions = {}, configOverrides: Partial<EngineConfig> = {}) {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0, stubOpts);
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '50' }]);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock, configOverrides);
  const start = clock.now();
  const wi = await seedQueued(db, gateSpec(oid, cycleSeconds));
  await pumpUntilQuiet(db, deps);
  const parked = await stepRow(db, wi.id, 'g');
  expect(parked.state).toBe('WAITING_GATE');
  expect(new Date(parked.wakeAt).getTime()).toBe(addSeconds(start, cycleSeconds).getTime());
  return { db, close, clock, deps, client, start, wi };
}

test('headline (§6.4): a property change wakes a bound gate on a 600 s cycle without the clock advancing; without an event nothing happens; after completion the subscription closes and a late event touches nothing', async () => {
  const { db, close, clock, deps, client, start, wi } = await parkBoundGate('wf-gate-events-headline', 600);
  const wake = vi.fn();
  watch = startPropertyWatch(db, deps, client, wake);
  await watch.reconcileNow();
  await vi.waitFor(() => expect(stub.control.propertySubscribers('env-1', 'Sensor')).toBe(1));
  await vi.waitFor(() => expect(watch!.snapshot()[0]?.live).toBe(true));
  expect(watch.snapshot()[0]!.members).toEqual([(await stepRow(db, wi.id, 'g')).id]);

  // Twin: no event, no clock advance → the gate stays parked at its cycle.
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE');
  expect(new Date((await stepRow(db, wi.id, 'g')).wakeAt).getTime()).toBe(addSeconds(start, 600).getTime());
  expect(wake).not.toHaveBeenCalled();

  // The event: the server's value crosses the threshold.
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '150' }]);
  await vi.waitFor(() => expect(wake).toHaveBeenCalledTimes(1), { timeout: 2000 });
  expect(new Date((await stepRow(db, wi.id, 'g')).wakeAt).getTime()).toBe(start.getTime()); // pulled to now

  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  expect((await stepRow(db, wi.id, 'g')).state).toBe('COMPLETED');
  expect(clock.now().getTime()).toBe(start.getTime()); // the clock never moved

  // Settled gate (§6.6): reconcile finds no member → the stream closes; a late event is inert.
  await watch.reconcileNow();
  expect(watch.snapshot()).toEqual([]);
  await vi.waitFor(() => expect(stub.control.propertySubscribers('env-1', 'Sensor')).toBe(0), { timeout: 2000 });
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '200' }]);
  await new Promise((r) => setTimeout(r, 100));
  expect(wake).toHaveBeenCalledTimes(1);
  await close();
});

test('backstop (§6.5): when the stream answers 404 the gate still evaluates on its cycle; the failure is logged once and retried with backoff', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { db, close, clock, deps, client, wi } = await parkBoundGate('wf-gate-events-backstop', 2, { propertyEventsUnavailable: true });
  const wake = vi.fn();
  watch = startPropertyWatch(db, deps, client, wake, { backoffBaseMs: 600_000 });
  await watch.reconcileNow();
  await vi.waitFor(() => expect(watch!.snapshot()[0]?.attempt).toBe(1));
  expect(watch.snapshot()[0]).toMatchObject({ live: false, attempt: 1 });
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]![0]).toContain('404');
  expect(warn.mock.calls[0]![0]).toContain('retrying with backoff');

  // Nobody is subscribed, so this publishes to no one; the cycle picks the value up.
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '150' }]);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE');
  clock.advance(2);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  expect(wake).not.toHaveBeenCalled();

  await watch.reconcileNow();                          // gate gone → entry closed, retry cancelled
  expect(watch.snapshot()).toEqual([]);
  await close();
});

test('a dropped stream reconnects (§6.5) and a later event wakes the gate again', async () => {
  const { db, close, deps, client, start, wi } = await parkBoundGate('wf-gate-events-drop', 600);
  const wake = vi.fn();
  // 1000 ms base: the "down" window is now a full second, so a 50 ms poll under full-suite
  // contention cannot miss it; the reconnect still lands well inside the 3 s wait below.
  watch = startPropertyWatch(db, deps, client, wake, { backoffBaseMs: 1000 });
  await watch.reconcileNow();
  await vi.waitFor(() => expect(watch!.snapshot()[0]?.live).toBe(true));

  stub.control.dropPropertyStreams('env-1', 'Sensor');
  await vi.waitFor(() => expect(watch!.snapshot()[0]).toMatchObject({ live: false, attempt: 1, lastReason: 'stream ended' }));
  await vi.waitFor(() => expect(watch!.snapshot()[0]?.live).toBe(true), { timeout: 3000 });   // reconnected
  await vi.waitFor(() => expect(stub.control.propertySubscribers('env-1', 'Sensor')).toBe(1));
  expect(watch.snapshot()[0]).toMatchObject({ attempt: 0, lastReason: null });

  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '150' }]);
  await vi.waitFor(() => expect(wake).toHaveBeenCalledTimes(1), { timeout: 2000 });
  expect(new Date((await stepRow(db, wi.id, 'g')).wakeAt).getTime()).toBe(start.getTime());
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  await close();
});

test('paused instance (§6.6): the event still writes wake_at, evaluation waits for resume', async () => {
  const { db, close, deps, client, start, wi } = await parkBoundGate('wf-gate-events-paused', 600);
  const wake = vi.fn();
  watch = startPropertyWatch(db, deps, client, wake);
  await watch.reconcileNow();
  await vi.waitFor(() => expect(watch!.snapshot()[0]?.live).toBe(true));

  await requestPause(db, wi.id);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('paused');
  await watch.reconcileNow();                          // a paused gate keeps its subscription
  expect(watch.snapshot()).toHaveLength(1);

  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '150' }]);
  await vi.waitFor(() => expect(wake).toHaveBeenCalledTimes(1), { timeout: 2000 });
  expect(new Date((await stepRow(db, wi.id, 'g')).wakeAt).getTime()).toBe(start.getTime());

  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE');   // paused: never evaluated
  expect((await instanceRow(db, wi.id)).status).toBe('paused');

  await requestResume(db, wi.id);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  await close();
});

test('trust (§6.7): a strict policy that rejects the origin subscribes to nothing and logs once', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { db, close, deps, wi } = await parkBoundGate('wf-gate-events-trust', 600);
  const wake = vi.fn();
  // The gate itself parked through an allowing client; the WATCH asks a rejecting one.
  watch = startPropertyWatch(db, deps, new ActionClient([]), wake);
  await watch.reconcileNow();
  await watch.reconcileNow();
  expect(watch.snapshot()).toEqual([]);
  expect(stub.control.propertySubscribers('env-1', 'Sensor')).toBe(0);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]![0]).toBe(`[mission-engine] property watch: gate step ${(await stepRow(db, wi.id, 'g')).id} not watched — binding 'f': action server ${stub.uri} is not allowed by the current trust policy`);

  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '150' }]);
  await new Promise((r) => setTimeout(r, 100));
  expect(wake).not.toHaveBeenCalled();
  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE');
  await close();
});

test('kill switch (§6.8): PROPERTY_WATCH_ENABLED=false subscribes to nothing; the gate cycles exactly as before', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const { db, close, clock, deps, client, wi } = await parkBoundGate('wf-gate-events-off', 2, {}, { propertyWatchEnabled: false });
  const wake = vi.fn();
  watch = startPropertyWatch(db, deps, client, wake);
  await watch.reconcileNow();
  watch.reconcileSoon();
  expect(watch.snapshot()).toEqual([]);
  expect(log).toHaveBeenCalledWith('[mission-engine] property watch disabled (PROPERTY_WATCH_ENABLED=false) — bound gates evaluate on their cycle only');
  await new Promise((r) => setTimeout(r, 100));
  expect(stub.control.propertySubscribers('env-1', 'Sensor')).toBe(0);

  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '150' }]);
  await new Promise((r) => setTimeout(r, 100));
  expect(wake).not.toHaveBeenCalled();
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE');
  clock.advance(2);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  await close();
});

test('§4.8: a change that lands while the fetch is in flight is not missed — the gate re-evaluates on the next turn of the loop, not the next cycle_seconds', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  let wi: { id: string } | null = null;
  let fired = 0;
  let moved = -1;
  stub = startStubActionServer(0, {
    onPropertyRead: async () => {
      if (fired++ > 0 || !wi) return; // one-shot: only the FIRST fetch races
      // The change and the event's effect (exactly what property-watch.ts's markGatesDue does), landing
      // after the read above was served but before the fresh transaction evaluates it. The claim
      // transaction had re-armed wake_at one cycle AHEAD, so the pull moves exactly one row.
      stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '150' }]);
      const gate = await stepRow(db, wi.id, 'g');
      moved = await markGatesDue(db, clock.now(), [gate.id]);
    },
  });
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '50' }]);
  const { deps } = makeHttpDeps(stub, clock);
  const start = clock.now();

  wi = await seedQueued(db, gateSpec('wf-gate-events-midfetch', 600));
  await pumpUntilQuiet(db, deps);

  expect(moved).toBe(1);                                   // the race really happened during the fetch
  expect(fired).toBe(2);                                   // fetch #1 served 50 (raced), fetch #2 served 150
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  expect((await stepRow(db, wi.id, 'g')).state).toBe('COMPLETED');
  expect(clock.now().getTime()).toBe(start.getTime());     // no cycle boundary was needed
  await close();
});
