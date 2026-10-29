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
// Spec 2026-08-20: system-wide loose/strict action matching, driven end-to-end through the REAL
// loop (claim -> invokeDueStep -> httpActionInvoker -> stub action server) rather than against
// the invoker in isolation — the point of these cases is that the mode, the frozen recipe's
// names, and the invoked oid all travel the whole dispatch path and land in step_instance.
//
// The harness (step/seedQueued/traceOf/stepRow/instanceRow/sleep/addSeconds/makeClock/
// makeHttpDeps) is copied verbatim from test/action-execution.test.ts, per that file's own
// not-imported convention — those helpers are file-local there, not exported.
import { afterEach, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { setActionMatchingMode } from 'mission-control-db/src/dao/system-settings';
import { requestPause } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { startStubActionServer, type StubActionServer, type StubCapabilitiesPayload } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { closeMonitoring } from '../src/actions/monitor.js';
import type { EngineDeps } from '../src/config.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

async function seedQueued(db: any, spec: unknown, oid: string): Promise<{ id: string; workCenterId: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id };
}

async function traceOf(db: any, instanceId: string): Promise<Array<[string | null, string, string | null | undefined]>> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(traceEntry.orderIndex);
  return rows.map((r: any) => [r.stepOid, r.state, r.error]);
}

async function stepRow(db: any, instanceId: string, stepOid: string): Promise<any> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === stepOid);
}

async function instanceRow(db: any, instanceId: string): Promise<any> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function addSeconds(d: Date, secs: number): Date {
  return new Date(d.getTime() + secs * 1000);
}

/** A mutable fake clock shared by `deps.now` and the test's own clock-advance calls. */
function makeClock(start = new Date('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (secs: number) => { now = addSeconds(now, secs); } };
}

/** Wires a real ActionClient + httpActionInvoker at the given stub server, with a short poll
 *  cadence so tests don't need large clock jumps, and dbLookup fixed to always resolve to the
 *  stub's own URI (unless overridden — the "missing binding" test passes null). */
function makeHttpDeps(
  stub: StubActionServer,
  clock: { now: () => Date },
  opts: { dbLookup?: (workCenterId?: string, environmentOid?: string) => Promise<string | null>; invokeGraceSecs?: number } = {},
): { deps: EngineDeps; client: ActionClient } {
  const allowlist = [new URL(stub.uri).origin];
  const client = new ActionClient(allowlist);
  const dbLookup = opts.dbLookup ?? (async () => stub.uri);
  const deps = testDeps({
    now: clock.now,
    invoker: httpActionInvoker(client, dbLookup),
    config: {
      databaseUrl: 'unused', port: 3006, workerConcurrency: 1,
      actionServerAllowlist: allowlist, scriptTimeoutMs: 200,
      actionPollSecs: 5, invokeGraceSecs: opts.invokeGraceSecs ?? 5,
      actionFetchTimeoutMs: 10_000,
      propertyWatchEnabled: true, propertyWatchReconcileMs: 5000,
      authSecret: 'test-secret', baseUrl: 'http://127.0.0.1:3006', internalToken: null,
    },
  });
  return { deps, client };
}

// ── fixtures ──

/** The frozen recipe: environment `env-w` named "Kitchen", action `act-w` named "PreheatOven".
 *  NONE of those oids exist on the container the tests below run against — which is exactly the
 *  situation loose matching exists for (a package authored against one library, executed against
 *  a container whose objects were created independently). */
const looseSpec = (
  oid: string,
  includedActions: Array<{ action_oid?: string; oid?: string; action_name?: string; action_library?: string }> =
    [{ action_oid: 'act-w', action_name: 'PreheatOven', action_library: 'lib-1' }],
) => ({
  local_id: oid, oid, version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [{
    local_id: 'Kitchen', oid: 'env-w', version: '1.0.0', last_modified_date: '2026-01-01',
    included_actions: includedActions,
  }],
  steps: [
    step('start', 'START'),
    step('act', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-w', environment_oid: 'env-w' } }),
    step('end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'act' },
    { from_step_id: 'act', to_step_id: 'end' },
  ],
});

/** The container's own view of the world: same NAMES, entirely different OIDs. */
const containerCaps = (actionName = 'PreheatOven'): StubCapabilitiesPayload => ({
  data: {
    environments: [{
      environment_oid: 'env-c', environment_name: 'Kitchen',
      actions: [{
        action_oid: 'act-c', action_name: actionName, visibility: 'observable',
        input_parameters: [], output_parameters: [],
        supported_commands: ['PAUSE', 'RESUME', 'HOLD', 'UNHOLD', 'ABORT', 'STOP', 'CLEAR'],
      }],
    }],
  },
});

let stub: StubActionServer;
afterEach(async () => {
  if (stub) await stub.close();
});

// ── loose (the shipped default): names win, container oids are what actually get invoked ──

test('loose (default): resolves entirely different container oids and completes', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0, { capabilities: containerCaps() });
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = looseSpec('wf-loose');
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps); // parks AND invokes in one go — wake_at is due immediately

  // No mode was ever written to system_settings: the absent row reads 'loose'.
  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked.state).toBe('WAITING_ACTION');
  expect(invoked.actionInstanceId).toBeTruthy();
  // The whole point: the workflow says act-w/env-w, the container was handed act-c/env-c.
  expect(invoked.actionInvokedOid).toBe('act-c');
  expect(stub.invokes.at(-1)).toMatchObject({ actionOid: 'act-c', body: { environment_oid: 'env-c' } });

  await sleep(100); // let the SSE GET establish (Task 14 precedent)
  stub.control.advance(invoked.actionInstanceId, 'COMPLETED');

  await vi.waitFor(async () => {
    const row = await stepRow(db, wi.id, 'act');
    expect(row.state).toBe('COMPLETED');
  }, { timeout: 2000, interval: 20 });

  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  const endRow = await stepRow(db, wi.id, 'end');
  expect(endRow.state).toBe('COMPLETED');

  await close();
});

// ── real-package roster spelling: CM-ingested packages carry the action oid under `oid`,
//    not `action_oid` (observed live 2026-08-20, RW-21: roster entries have oid/action_name/
//    action_library and NO action_oid). Both the activation validator and the loose name
//    lookup must accept either spelling, or every real package dies at activation. ──

test('loose: a roster spelled with `oid` (real-package shape) activates and resolves by name', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0, { capabilities: containerCaps() });
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  // Same consistent package as the first loose test — only the roster's oid FIELD NAME differs.
  const spec = looseSpec('wf-oid-spelling', [
    { oid: 'act-w', action_name: 'PreheatOven', action_library: 'lib-1' },
  ]);
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked?.state).toBe('WAITING_ACTION'); // NOT an activation INVALID_VALIDATION death
  expect(invoked.actionInvokedOid).toBe('act-c'); // and the name lookup found "PreheatOven"
  expect(stub.invokes.at(-1)).toMatchObject({ actionOid: 'act-c', body: { environment_oid: 'env-c' } });

  await close();
});

// ── strict: the recipe's own oids go out on the wire, names are never consulted ──

test('strict: invokes the workflow oid verbatim and records it as the invoked oid', async () => {
  const { db, close } = await makeTestDb();
  // The container still advertises ONLY act-c/env-c — under strict that roster is never read, so
  // the act-w invoke lands anyway (the stub accepts any oid unless told otherwise).
  stub = startStubActionServer(0, { capabilities: containerCaps() });
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  await setActionMatchingMode(db, 'strict');
  const spec = looseSpec('wf-strict');
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked.state).toBe('WAITING_ACTION');
  expect(invoked.actionInvokedOid).toBe('act-w');
  expect(stub.invokes.at(-1)).toMatchObject({ actionOid: 'act-w', body: { environment_oid: 'env-w' } });

  await sleep(100);
  stub.control.advance(invoked.actionInstanceId, 'COMPLETED');
  await vi.waitFor(async () => {
    const row = await stepRow(db, wi.id, 'act');
    expect(row.state).toBe('COMPLETED');
  }, { timeout: 2000, interval: 20 });
  expect((await instanceRow(db, wi.id)).status).toBe('completed');

  await close();
});

// ── F3: the environment matched by name, but it has no action by that name ──

test('loose F3: an environment without the named action errors the step with the exact message', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0, { capabilities: containerCaps('Other') });
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = looseSpec('wf-f3');
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const F3 = 'loose match: environment "Kitchen" has no action named "PreheatOven". Check this environment\'s binding in this work center.';
  const row = await stepRow(db, wi.id, 'act');
  expect(row.state).toBe('ERRORED');
  expect(row.error).toBe(F3);
  expect(await traceOf(db, wi.id)).toContainEqual(['act', 'ERRORED', F3]);
  expect((await instanceRow(db, wi.id)).status).toBe('errored');
  // Nothing was ever dispatched — the failure happened before any invoke.
  expect(stub.invokes).toHaveLength(0);

  await close();
});

// ── F6: the package itself carries no name to match with ──
//
// DEVIATION from the brief's "seed included_actions: []": that spec never reaches dispatch at
// all — validator.ts's actionProxyValidation (§14.2) rejects an ACTION PROXY whose action_oid is
// absent from its environment's roster, so the instance errors at activation and no step row is
// ever created (measured: no `act` row at all). Dropping just `action_name` from the entry is
// rejected too, by workflow-schema.json's IncludedAction `required: [action_name,
// action_library]`. The nameless-but-VALID shape F6 is actually reachable through is a roster
// entry whose name was never filled in — `action_name: ''` — which is what this seeds.

test('loose F6: a roster entry carrying no usable action name errors before any capabilities lookup', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0, { capabilities: containerCaps() });
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = looseSpec('wf-f6', [{ action_oid: 'act-w', action_name: '', action_library: 'lib-1' }]);
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const F6 = 'loose match: the workflow package carries no name for action oid "act-w" '
    + '(or environment oid "env-w") — cannot match by name';
  const row = await stepRow(db, wi.id, 'act');
  expect(row.state).toBe('ERRORED');
  expect(row.error).toBe(F6);
  expect(await traceOf(db, wi.id)).toContainEqual(['act', 'ERRORED', F6]);
  expect((await instanceRow(db, wi.id)).status).toBe('errored');
  expect(stub.invokes).toHaveLength(0);

  await close();
});

// ── command legality follows the INVOKED oid, not the workflow's (control.ts :132 / :354) ──
//
// Beyond the brief's five cases, but the control.ts half of this task is otherwise unproven: a
// loosely-dispatched step's capabilities live under the CONTAINER's oid, so a pause pass that
// still asked about the workflow's `act-w` would find nothing, read PAUSE as unsupported, and
// silently leave the step running (control.ts's E3 branch) instead of pausing it.

test('control legality is checked against the loose-resolved oid, so a loose step still pauses', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0, { capabilities: containerCaps() });
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');

  const spec = looseSpec('wf-legality');
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked.actionInvokedOid).toBe('act-c'); // the only oid CONTAINER_CAPS knows commands for

  await requestPause(db, wi.id);
  await pumpUntilQuiet(db, deps);

  const paused = await stepRow(db, wi.id, 'act');
  expect(paused.state).toBe('PAUSED');
  expect(sendCommandSpy).toHaveBeenCalledWith(stub.uri, invoked.actionInstanceId, 'PAUSE');
  expect(await traceOf(db, wi.id)).toContainEqual(['act', 'PAUSED', null]);
  expect((await instanceRow(db, wi.id)).status).toBe('paused');

  // This is the only test here that leaves its action alive (paused, still observed) rather than
  // driving it to a terminal — drop the SSE subscription explicitly, or the stub's server can
  // never finish closing in afterEach and the hook times out.
  closeMonitoring(invoked.id);
  await close();
});

// ── the mode is read per dispatch: flipping it mid-flight changes the NEXT invoke, no restart ──

test('mode flip takes effect on the next dispatch without restarting the engine', async () => {
  const { db, close } = await makeTestDb();
  // Now the container behaves like a real one: only act-c exists, so a strict act-w invoke 404s.
  stub = startStubActionServer(0, { capabilities: containerCaps(), invokableActionOids: ['act-c'] });
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  // Run 1 — loose (default): resolves onto the container's oid and completes.
  const specA = looseSpec('wf-flip-a');
  const wiA = await seedQueued(db, specA, specA.oid);
  await pumpUntilQuiet(db, deps);

  const invokedA = await stepRow(db, wiA.id, 'act');
  expect(invokedA.actionInvokedOid).toBe('act-c');
  await sleep(100);
  stub.control.advance(invokedA.actionInstanceId, 'COMPLETED');
  await vi.waitFor(async () => {
    expect((await instanceRow(db, wiA.id)).status).toBe('completed');
  }, { timeout: 2000, interval: 20 });

  // Flip the system-wide mode. The engine object graph (deps, invoker, client) is UNCHANGED and
  // still live — nothing is re-created between the two runs.
  await setActionMatchingMode(db, 'strict');

  // Run 2 — strict: the same recipe now dispatches act-w, which this container does not have.
  const specB = looseSpec('wf-flip-b');
  const wiB = await seedQueued(db, specB, specB.oid);
  await pumpUntilQuiet(db, deps);

  const rowB = await stepRow(db, wiB.id, 'act');
  expect(rowB.state).toBe('ERRORED');
  expect(rowB.error).toMatch(/^http:\/\/127\.0\.0\.1:\d+ has no action "PreheatOven" for environment "Kitchen"\. Check this environment.s binding in this work center\.$/);
  expect(rowB.actionInvokedOid).toBeNull();
  expect((await instanceRow(db, wiB.id)).status).toBe('errored');
  // Proof it really tried the workflow's own oid this time, and that run 1 really tried the
  // container's: the stub only ever accepted act-c.
  expect(stub.invokes.map((i) => i.actionOid)).toEqual(['act-c']);

  await close();
});

// ── 2026-08-21 name binding: package-internal resolution + binding re-key ──
//
// DEVIATION from the brief: the brief's P1/P2/strict cases assert via `traceOf(...).find(...)`
// with terminal state `'ERROR'`. This file's actual ERRORED path (applyActionTerminal ->
// recordTrace) writes state `'ERRORED'`, not `'ERROR'` — proven by the existing F3/F6 tests
// just above, which assert `row.state === 'ERRORED'` / `row.error === <exact>` via `stepRow`,
// plus a `traceOf` containment check with the SAME `'ERRORED'` state. Adapted all three
// error-path tests to that exact shape. The two success-path tests (name fallback, binding
// re-key) needed no adaptation — they only read `stepRow`, same as the brief.

const namedSpec = (
  oid: string,
  cfg: Record<string, unknown>,
  envs?: Array<Record<string, unknown>>,
) => ({
  local_id: oid, oid, version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: envs ?? [{
    local_id: 'Kitchen', oid: 'env-w', version: '1.0.0', last_modified_date: '2026-01-01',
    included_actions: [{ action_oid: 'act-w', action_name: 'PreheatOven', action_library: 'lib-1' }],
  }],
  steps: [
    step('start', 'START'),
    step('act', 'ACTION PROXY', { action_proxy_config: cfg }),
    step('end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'act' },
    { from_step_id: 'act', to_step_id: 'end' },
  ],
});

test('loose: dangling action oid dispatches via the config action_name fallback', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0, { capabilities: containerCaps() });
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);
  const spec = namedSpec('wf-namefb', {
    action_oid: 'act-dangling', environment_oid: 'env-w',
    action_name: 'PreheatOven', environment_name: 'Kitchen',
  });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked.state).toBe('WAITING_ACTION');
  expect(invoked.actionInvokedOid).toBe('act-c');
  await close();
});

test('dangling env oid: binding re-keyed by the name-resolved embedded env spec oid', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0, { capabilities: containerCaps() });
  const clock = makeClock();
  const bindingKeys: string[] = [];
  const { deps } = makeHttpDeps(stub, clock, {
    dbLookup: async (_wc, envOid) => {
      bindingKeys.push(envOid as string);
      return envOid === 'env-w' ? stub.uri : null;
    },
  });
  const spec = namedSpec('wf-rekey', {
    action_oid: 'act-dangling', environment_oid: 'env-dangling',
    action_name: 'PreheatOven', environment_name: 'Kitchen',
  });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked.state).toBe('WAITING_ACTION');
  expect(bindingKeys).toContain('env-w');
  expect(bindingKeys).not.toContain('env-dangling');
  expect(invoked.actionInvokedOid).toBe('act-c');
  await close();
});

test('P1: env name resolves nothing — exact package-resolution error', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0, { capabilities: containerCaps() });
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);
  const spec = namedSpec('wf-p1', {
    action_oid: 'act-dangling', environment_oid: 'env-dangling',
    action_name: 'PreheatOven', environment_name: 'Backyard',
  });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const P1 = 'package resolution: no embedded environment named "Backyard" '
    + '(step\'s environment_oid "env-dangling" is not in the package)';
  const row = await stepRow(db, wi.id, 'act');
  expect(row.state).toBe('ERRORED');
  expect(row.error).toBe(P1);
  expect(await traceOf(db, wi.id)).toContainEqual(['act', 'ERRORED', P1]);
  expect((await instanceRow(db, wi.id)).status).toBe('errored');
  expect(stub.invokes).toHaveLength(0);

  await close();
});

test('P2: ambiguous env name — exact package-resolution error', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0, { capabilities: containerCaps() });
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);
  const spec = namedSpec(
    'wf-p2',
    {
      action_oid: 'act-dangling', environment_oid: 'env-dangling',
      action_name: 'PreheatOven', environment_name: 'Kitchen',
    },
    [
      { local_id: 'Kitchen', oid: 'env-w1', version: '1.0.0', last_modified_date: '2026-01-01', included_actions: [] },
      { local_id: 'Kitchen', oid: 'env-w2', version: '1.0.0', last_modified_date: '2026-01-01', included_actions: [] },
    ],
  );
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const P2 = 'package resolution: multiple embedded environments named "Kitchen" — ambiguous';
  const row = await stepRow(db, wi.id, 'act');
  expect(row.state).toBe('ERRORED');
  expect(row.error).toBe(P2);
  expect(await traceOf(db, wi.id)).toContainEqual(['act', 'ERRORED', P2]);
  expect((await instanceRow(db, wi.id)).status).toBe('errored');
  expect(stub.invokes).toHaveLength(0);

  await close();
});

test('strict: name-carrying dangling action oid activates, then fails at the container', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0, { capabilities: containerCaps(), invokableActionOids: ['act-w'] });
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);
  const spec = namedSpec('wf-strict-dangling', {
    action_oid: 'act-dangling', environment_oid: 'env-w',
    action_name: 'PreheatOven', environment_name: 'Kitchen',
  });
  const wi = await seedQueued(db, spec, spec.oid);
  await setActionMatchingMode(db, 'strict');
  await pumpUntilQuiet(db, deps);

  // NOT rejected at activation (no INVALID_VALIDATION); the step ERRORs with the
  // container's own failure — strict means the oids must line up at the container.
  const row = await stepRow(db, wi.id, 'act');
  expect(row.state).toBe('ERRORED');
  expect(row.error).not.toContain('package resolution');
  expect(row.error).not.toContain('loose match');
  expect(await traceOf(db, wi.id)).toContainEqual(['act', 'ERRORED', row.error]);

  await close();
});

// ── loose F5 checks the STEP's declared inputs only (FirstShop-018, 2026-10-28) ──
//
// The property store adds every workflow starting parameter to each step's resolved inputs as
// a fallback (properties.ts getInputParameters). Those are not the step's parameters, so the
// loose check must not demand that every action declare them. They are still sent.

test('loose: workflow starting parameters the step does not declare are not required of the action', async () => {
  const { db, close } = await makeTestDb();
  const caps = containerCaps();
  caps.data.environments[0]!.actions[0]!.input_parameters = [{ name: 'Size' }];
  stub = startStubActionServer(0, { capabilities: caps });
  const { deps } = makeHttpDeps(stub, makeClock());

  const base = looseSpec('wf-loose-starting');
  const spec = {
    ...base,
    starting_parameter_specifications: [
      { id: 'OrderNumber', default_value: '7' },
      { id: 'Size', default_value: 'large' },
    ],
    steps: base.steps.map((s) => s.oid === 'act'
      ? { ...s, input_parameter_specifications: [{ id: 'Size', default_value: 'Size', value_type: 'property' }] }
      : s),
  };
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked.error).toBeNull();
  expect(invoked.state).toBe('WAITING_ACTION');
  expect((stub.invokes.at(-1)!.body as { input_parameters: unknown }).input_parameters).toEqual(expect.arrayContaining([
    { name: 'Size', value: 'large' }, { name: 'OrderNumber', value: '7' },
  ]));
  await close();
});
