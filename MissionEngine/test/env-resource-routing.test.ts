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
// Task 4 (Phase 2a): routing environment resource commands to the shared tier. Task 3 built the
// hydration seam (openContext loads context.envResources/envSnapshot/envIndex/envKnownNames/
// envScope) and env-scope.ts's isEnvironmentCommand; this task wires transition.ts's activation/
// completion/resume paths to actually READ that tier instead of the per-instance one, appends/
// removes EngineState.envHolds as acquires are granted and released, sweeps the env tier's
// token-keyed queues alongside the workflow tier's bare-oid ones on cancellation (Ruling A), and
// removes the now-unreachable local registration of environment resources (Ruling B).
import { expect, test, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { submitUserAction } from '../src/core/submit.js';
import {
  workCenter, workflow, workflowInstance, stepInstance, traceEntry, wcResource, wcResourceHolder,
  wcResourceWaiter,
} from 'mission-control-db/src/db/schema/index';
import { InMemoryResourceManager, type SerializedResources } from '../src/core/resources.js';
import type { EngineState } from '../src/core/engine-state.js';

// review fix (Finding 2): identify, among the `this` receivers a spied-on
// InMemoryResourceManager method was actually called on, the ones that are genuinely the
// ENVIRONMENT tier for `resourceName` — via getSnapshot()'s own `scope` field, which Ruling B
// guarantees only the env manager ever carries for a name that is never locally
// double-registered. This is an OUTCOME check on the real receiver object, not an argument
// check: a wrong-but-plausible implementation that builds the right token Set but sweeps
// `context.resources` instead of `context.root.envResources` would satisfy an argument-only
// assertion while never touching this manager at all — it cannot satisfy this one, because
// `context.resources` never has a scope:'environment' entry for this name to begin with.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function envInstancesWith(spy: { mock: { instances: any[] } }, resourceName: string): InMemoryResourceManager[] {
  return spy.mock.instances.filter((inst: InMemoryResourceManager) =>
    inst.getSnapshot().some((s) => s.scope === 'environment' && s.resourceName === resourceName));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

async function seedQueued(db: AnyDb, spec: unknown, oid: string): Promise<{ id: string; workCenterId: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id };
}

async function instanceRow(db: AnyDb, instanceId: string) {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

async function stepRow(db: AnyDb, instanceId: string, stepOid: string) {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: { stepOid: string }) => r.stepOid === stepOid);
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────

const ENV_PRINTER = {
  local_id: 'env-printer-lib', oid: 'env-printer', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'Printer', resource_type: 'binary exclusive use' }],
};

// One step, two Acquires: one environment-scoped ('Printer'), one workflow-scoped ('Ink'). Both
// are immediately grantable (nothing else holds either), so the whole instance runs straight to
// completion in one pump — this isolates ROUTING from any blocking/resume behavior.
const MIXED_SPEC = {
  local_id: 'wf', oid: 'wf-mixed', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  resource_property_specifications: [{ name: 'Ink', resource_type: 'binary exclusive use' }],
  steps: [
    step('s1', 'START'),
    step('s2', 'MATH', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
        { command_type: 'Acquire', resource_name: 'Ink' },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 'e1' },
  ],
};

test('an environment-scoped Acquire routes to the shared tier and records envHolds; a workflow-scoped Acquire in the SAME step stays local only', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, MIXED_SPEC, 'wf-mixed');
  await db.insert(wcResource).values({ workCenterId: wi.workCenterId, name: 'Printer', resourceType: 'binary exclusive use' });

  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');

  const engineState = after.engineState as EngineState;
  // Ruling B: the environment resource must NEVER be double-registered into the local manager
  // — 'Ink' (workflow-scoped) is the only entry the local serialized manager should carry.
  const localKeys = (engineState.resources as SerializedResources).resources.map(([k]) => k);
  expect(localKeys).toEqual(['wf-mixed:Ink']);

  // Task 5 landed after this test was first written: an instance that reaches 'completed'
  // still holding an environment resource now auto-releases it as part of that same settle
  // (spec §5.5 / user decision U4) — envHolds is drained to empty rather than surviving into
  // the persisted engine_state, and the registry itself shows the capacity freed again.
  expect(engineState.envHolds).toEqual([]);
  const [printerRow] = await db.select().from(wcResource).where(eq(wcResource.name, 'Printer'));
  expect(printerRow.inUse).toBe(0);

  await close();
});

// ── envHolds append via the resumeGrantedSteps grant path ───────────────────────────────────
//
// NOTE on design: submit.test.ts's RES_BLOCK_SPEC (the workflow-scoped original this was first
// adapted from) parks the holder via USER_INTERACTION and releases it with a LATER, SEPARATE
// submitUserAction call/transaction. That pattern does NOT carry over to the environment tier
// within Task 4's scope: envResources is rebuilt FRESH from the wc_resource/wc_resource_waiter
// registry on every openContext call, and Task 5 (write-back) has not landed yet — so a queued
// token from one transaction is invisible to the next. Everything below therefore stays inside
// ONE eager cascade (startInstanceFromQueued's own drainCascade, a single transaction): a
// PARALLEL fans out to 'blocked' (Acquires a pre-seeded-busy Lock, genuinely queues — PARALLEL's
// own connection-routing loop materializes+activates both siblings before EITHER'S dequeue-time
// release runs, so 'blocked' really does see Lock as held) and 'releaser' (a bare Release, no
// Acquire of its own — the resources.ts model doesn't require symmetry, matching how an operator
// or a differently-scoped step can free a resource nothing in THIS instance ever held). When
// 'releaser' is dequeued, its Release frees Lock and resumeGrantedSteps immediately resumes
// 'blocked' — the ONLY place a queued (as opposed to immediately-granted) environment Acquire's
// envHolds entry is recorded.
const ENV_LOCK = {
  local_id: 'env-lock-lib', oid: 'env-lock', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'Lock', resource_type: 'binary exclusive use' }],
};

// review Minor: a trailing USER_INTERACTION park after the WAIT ALL join gives this test a
// genuine mid-transition checkpoint — 'blocked' completes (still holding Lock, never released)
// and the cascade parks at 'ui' rather than running straight through to 'completed' (and hence
// straight through auto-release) in the SAME transaction. That lets the holder row's own
// step-attribution be asserted directly against the registry, not just inferred from the
// eventual release.
const ENV_RES_BLOCK_SPEC = {
  local_id: 'wf', oid: 'wf-env-res-block', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_LOCK],
  steps: [
    step('s1', 'START'),
    step('p1', 'PARALLEL'),
    step('blocked', 'SCRIPT', {
      script_config: { source: "output.b = 'done';" },
      output_parameter_specifications: [{ id: 'b', target: 'Result.B' }],
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Lock', resource_source_oid: 'env-lock' },
      ],
    }),
    step('releaser', 'SCRIPT', {
      script_config: { source: 'output.r = 1;' },
      resource_command_specifications: [
        { command_type: 'Release', resource_name: 'Lock', resource_source_oid: 'env-lock' },
      ],
    }),
    step('wa', 'WAIT ALL'),
    step('ui', 'USER_INTERACTION'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'blocked' },
    { from_step_id: 'p1', to_step_id: 'releaser' },
    { from_step_id: 'blocked', to_step_id: 'wa' },
    { from_step_id: 'releaser', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'ui' },
    { from_step_id: 'ui', to_step_id: 'e1' },
  ],
};

test('a blocked environment Acquire is granted via resumeGrantedSteps, which records its envHolds entry', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, ENV_RES_BLOCK_SPEC, 'wf-env-res-block');
  // Pre-busy with no real holder in this instance — 'releaser' plays that role generically.
  await db.insert(wcResource).values({ workCenterId: wi.workCenterId, name: 'Lock', resourceType: 'binary exclusive use', inUse: 1 });

  await pumpUntilQuiet(db, testDeps());

  // Parked at 'ui', NOT 'completed' yet — the trailing USER_INTERACTION park means the whole
  // PARALLEL/release/resume cascade already ran and committed via a normal (non-terminal)
  // persist(), so 'blocked's genuinely-held Lock is a REAL row in the registry right now.
  const mid = await instanceRow(db, wi.id);
  expect(mid.status).toBe('running');
  const uiRow = await stepRow(db, wi.id, 'ui');
  expect(uiRow.state).toBe('WAITING_USER');

  const trace = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, wi.id));
  const blockedStates = trace
    .filter((t: { stepOid: string | null }) => t.stepOid === 'blocked')
    .map((t: { state: string }) => t.state);
  // Genuinely queued (WAITING) before being resumed to COMPLETED — proves this exercised the
  // resume path, not an immediate grant.
  expect(blockedStates).toEqual(['WAITING', 'COMPLETED']);

  // review Minor: shape assertion against the REAL holder row — a wrong stepOid (or a missing
  // envHolds append in resumeGrantedSteps) would never produce this exact row.
  const midHolders = await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, wi.id));
  expect(midHolders).toHaveLength(1);
  expect(midHolders[0]).toMatchObject({ name: 'Lock', stepOid: 'blocked', amount: 1, heldName: null });

  // Now finish the instance — auto-release must drain what write-back just proved was really
  // held.
  await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'submit' }, 0, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  const engineState = after.engineState as EngineState;
  expect(engineState.envHolds).toEqual([]);
  const [lockRow] = await db.select().from(wcResource).where(eq(wcResource.name, 'Lock'));
  expect(lockRow.inUse).toBe(0);
  expect((await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, wi.id)))).toEqual([]);

  await close();
});

// ── envHolds removal on release ───────────────────────────────────────────────────────────────

const ENV_LOCK3 = {
  local_id: 'env-lock3-lib', oid: 'env-lock3', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'Lock3', resource_type: 'binary exclusive use' }],
};

const ACQUIRE_RELEASE_SPEC = {
  local_id: 'wf', oid: 'wf-acquire-release', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_LOCK3],
  steps: [
    step('s1', 'START'),
    step('s2', 'MATH', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Lock3', resource_source_oid: 'env-lock3' },
        { command_type: 'Release', resource_name: 'Lock3', resource_source_oid: 'env-lock3' },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 'e1' },
  ],
};

test('an environment Release removes the matching envHolds entry recorded at Acquire', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, ACQUIRE_RELEASE_SPEC, 'wf-acquire-release');
  await db.insert(wcResource).values({ workCenterId: wi.workCenterId, name: 'Lock3', resourceType: 'binary exclusive use' });

  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  const engineState = after.engineState as EngineState;
  // Acquired then released within the SAME step's own activation + dequeue-time completion — if
  // the envHolds reconciliation were missing (or matched nothing), this would still carry the
  // 's2' entry.
  expect(engineState.envHolds).toEqual([]);

  await close();
});

// ── review fix (Finding 1): the envHolds reconciliation must account for a PARTIAL pool
// ── release, and must never remove an entry for a release that did not actually happen ───────

const ENV_SLOTS = {
  local_id: 'env-slots-lib', oid: 'env-slots', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'Slots', resource_type: 'countable use with pool limits', use_limit: 5 }],
};

const PARTIAL_POOL_RELEASE_SPEC = {
  local_id: 'wf', oid: 'wf-partial-pool-release', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_SLOTS],
  steps: [
    step('s1', 'START'),
    step('s2', 'MATH', {
      resource_command_specifications: [
        { command_type: 'Acquire Pool Amount', resource_name: 'Slots', resource_source_oid: 'env-slots', amount: 3 },
        { command_type: 'Release Pool Amount', resource_name: 'Slots', resource_source_oid: 'env-slots', amount: 1 },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 'e1' },
  ],
};

test('a PARTIAL environment Release Pool Amount decrements the matched envHolds entry instead of deleting it', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, PARTIAL_POOL_RELEASE_SPEC, 'wf-partial-pool-release');
  await db.insert(wcResource).values({
    workCenterId: wi.workCenterId, name: 'Slots', resourceType: 'countable use with pool limits', useLimit: 5,
  });

  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  const engineState = after.engineState as EngineState;
  // Task 5: the instance reaches 'completed' still holding the remaining 2 units (acquired 3,
  // explicitly released only 1) — settleTerminal's auto-release drains the rest. A
  // splice-the-whole-entry bug in removeEnvHoldAt would empty envHolds the moment the PARTIAL
  // release ran, so auto-release would see nothing to do and never release the other 2 —
  // leaving the registry wedged at inUse 2 (not 0) even though the instance is 'completed'.
  expect(engineState.envHolds).toEqual([]);
  const [slotsRow] = await db.select().from(wcResource).where(eq(wcResource.name, 'Slots'));
  expect(slotsRow.inUse).toBe(0);

  await close();
});

const ENV_BAY = {
  local_id: 'env-bay-lib', oid: 'env-bay', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'Bay', resource_type: 'named pool', names: ['A', 'B'] }],
};

const FAILED_RELEASE_SPEC = {
  local_id: 'wf', oid: 'wf-failed-release', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_BAY],
  steps: [
    step('s1', 'START'),
    step('s2', 'MATH', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Bay', resource_source_oid: 'env-bay', target: 'Result.BayName' },
        // Deliberately no `target`: cmd.target is undefined, so the resolved release `name` is
        // undefined too — mgr.release() for a named pool returns false without touching state.
        { command_type: 'Release', resource_name: 'Bay', resource_source_oid: 'env-bay' },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 'e1' },
  ],
};

test('a FAILED environment Release (no name resolved) leaves the envHolds entry in place', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, FAILED_RELEASE_SPEC, 'wf-failed-release');
  await db.insert(wcResource).values({
    workCenterId: wi.workCenterId, name: 'Bay', resourceType: 'named pool',
    poolNames: ['A', 'B'], availableNames: ['A', 'B'],
  });

  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  const engineState = after.engineState as EngineState;
  // Task 5: the explicit Release never actually happened (mgr.release returned false — no
  // `target`, so no name resolved), so the instance reaches 'completed' still holding 'A'.
  // settleTerminal's auto-release is what finally returns it to the pool. An un-gated removal
  // in removeEnvHoldAt would have dropped this entry the moment the FAILED release ran, so
  // auto-release would see nothing to do and 'A' would stay reserved forever even though the
  // instance is 'completed' — the registry's availableNames is what actually proves it came
  // back.
  expect(engineState.envHolds).toEqual([]);
  const [bayRow] = await db.select().from(wcResource).where(eq(wcResource.name, 'Bay'));
  expect(bayRow.availableNames).toEqual(expect.arrayContaining(['A']));
  expect(bayRow.inUse).toBe(0);

  await close();
});

// ── the no-backfill trap: fail loudly, never silently fall back to the local manager ─────────

const ENV_GHOST = {
  local_id: 'env-ghost-lib', oid: 'env-ghost', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'Ghost', resource_type: 'binary exclusive use' }],
};

const UNHYDRATED_SPEC = {
  local_id: 'wf', oid: 'wf-unhydrated', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_GHOST],
  steps: [
    step('s1', 'START'),
    step('s2', 'MATH', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Ghost', resource_source_oid: 'env-ghost' },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 'e1' },
  ],
};

test('an environment command whose name has no wc_resource row fails loudly (naming the resource) instead of silently running unshared', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, UNHYDRATED_SPEC, 'wf-unhydrated');
  // Deliberately NOT seeding a wc_resource row for 'Ghost' — the standing no-backfill trap: a
  // work center whose environment spec was never (re-)loaded is missing the registry row a
  // newer recipe declares.

  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('errored');

  const trace = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, wi.id));
  const errored = trace.find((t: { state: string }) => t.state === 'ERRORED');
  expect(errored?.error).toContain('Ghost');
  expect(errored?.error).toMatch(/re-?load/i);

  await close();
});

// ── Ruling A: the cancel sweep must also reach the environment tier ──────────────────────────
//
// Adapted from try-catch.test.ts's branchSpec/RETURN ABANDON pattern: an ACTION PROXY trigger
// (independently failed via submitUserAction, so the timing is fully controlled) routes through
// a CATCH into RETURN ABANDON, which calls returnAbandon -> releaseAllInstanceResources. A
// sibling SCRIPT step blocks on an environment resource (pre-seeded already in use, so it queues
// on its very first activation attempt, well before the ABANDON is ever triggered) — proving the
// env tier's cancelQueuedWaiters/flushGranted sweep actually receives THIS instance's token, not
// just that the workflow-tier sweep (bare oids) still runs.
const ENV_ACTIONS = [{
  local_id: 'env-actions-lib', oid: 'env-actions', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-sweep', action_name: 'DoThing', action_library: 'lib-1' }],
}];
const ACTION_CONFIG = { action_oid: 'act-sweep', environment_oid: 'env-actions' };

const ENV_LOCK2 = {
  local_id: 'env-lock2-lib', oid: 'env-lock2', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'Lock2', resource_type: 'binary exclusive use' }],
};

const ABANDON_SWEEP_SPEC = {
  local_id: 'wf', oid: 'wf-abandon-sweep', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_ACTIONS[0], ENV_LOCK2],
  steps: [
    step('s1', 'START'),
    step('p1', 'PARALLEL'),
    step('trigger', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG, try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
    step('blocked', 'SCRIPT', {
      script_config: { source: 'output.x = 1;' },
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Lock2', resource_source_oid: 'env-lock2' },
      ],
    }),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
    step('c1', 'CATCH', { catch_id: 'C1' }),
    step('r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'trigger' },
    { from_step_id: 'p1', to_step_id: 'blocked' },
    { from_step_id: 'trigger', to_step_id: 'wa' },
    { from_step_id: 'blocked', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
    { from_step_id: 'c1', to_step_id: 'r1' },
  ],
};

test('RETURN ABANDON sweeps the environment tier\'s queue too, using the SAME token releaseAllInstanceResources would need to unwedge the resource', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, ABANDON_SWEEP_SPEC, 'wf-abandon-sweep');
  // Pre-busy with no real holder — irrelevant to this test; the point is that 'blocked' queues.
  await db.insert(wcResource).values({ workCenterId: wi.workCenterId, name: 'Lock2', resourceType: 'binary exclusive use', inUse: 1 });

  await pumpUntilQuiet(db, testDeps());
  const blocked = await stepRow(db, wi.id, 'blocked');
  expect(blocked?.state).toBe('READY'); // blocked, still queue-state READY
  const trace1 = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, wi.id));
  expect(trace1.some((t: { stepOid: string | null; state: string }) => t.stepOid === 'blocked' && t.state === 'WAITING')).toBe(true);

  const cancelSpy = vi.spyOn(InMemoryResourceManager.prototype, 'cancelQueuedWaiters');
  const flushSpy = vi.spyOn(InMemoryResourceManager.prototype, 'flushGranted');

  await submitUserAction(db, wi.id, { step_oid: 'trigger', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('aborted');

  // review fix (Finding 2): OUTCOME, not just call arguments — the manager instance that
  // genuinely owns the environment-scoped 'Lock2' resource (identified via getSnapshot(),
  // which only the env manager ever reports scope:'environment' for) must show its queue
  // empty after the sweep, and flushGranted must have been invoked on that SAME instance.
  const cancelledOnEnv = envInstancesWith(cancelSpy, 'Lock2');
  expect(cancelledOnEnv.length).toBeGreaterThan(0);
  const lock2 = cancelledOnEnv[0].getSnapshot().find((s) => s.scope === 'environment' && s.resourceName === 'Lock2');
  expect(lock2?.queued).toBe(0);

  const flushedOnEnv = envInstancesWith(flushSpy, 'Lock2');
  expect(flushedOnEnv.length).toBeGreaterThan(0);

  cancelSpy.mockRestore();
  flushSpy.mockRestore();
  await close();
});

// review fix (Finding 2): escalateChildFailure is the OTHER site worth a dedicated outcome
// test — it passes a DIFFERENT oid set (childKnown, not releaseAllInstanceResources' own
// `known`), so a wrong-but-plausible set there would otherwise go unnoticed. A child spec's own
// PARALLEL fans out to an ACTION PROXY trigger and a sibling that blocks on a pre-busy
// environment resource; failing the trigger uncaught (nothing catches anywhere in this fixture)
// escalates through escalateChildFailure, which tears the whole child subtree down and must
// sweep the blocked sibling's environment waiter along with it.
const ENV_ESC_ACTIONS = [{
  local_id: 'env-esc-actions-lib', oid: 'env-esc-actions', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-esc', action_name: 'DoThing', action_library: 'lib-1' }],
}];
const ESC_ACTION_CONFIG = { action_oid: 'act-esc', environment_oid: 'env-esc-actions' };

const ENV_LOCK5 = {
  local_id: 'env-lock5-lib', oid: 'env-lock5', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'Lock5', resource_type: 'binary exclusive use' }],
};

const ESCALATION_SWEEP_CHILD = {
  local_id: 'Child', oid: 'child-esc-sweep', version: '1.0.0', last_modified_date: '2026-01-01',
  parentChildSpecId: null, state: 'Effective',
  steps: [
    step('c-start', 'START'),
    step('c-p1', 'PARALLEL'),
    step('c-trigger', 'ACTION PROXY', { action_proxy_config: ESC_ACTION_CONFIG }),
    step('c-blocked', 'SCRIPT', {
      script_config: { source: 'output.x = 1;' },
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Lock5', resource_source_oid: 'env-lock5' },
      ],
    }),
    step('c-wa', 'WAIT ALL'),
    step('c-end', 'END'),
  ],
  connections: [
    { from_step_id: 'c-start', to_step_id: 'c-p1' },
    { from_step_id: 'c-p1', to_step_id: 'c-trigger' },
    { from_step_id: 'c-p1', to_step_id: 'c-blocked' },
    { from_step_id: 'c-trigger', to_step_id: 'c-wa' },
    { from_step_id: 'c-blocked', to_step_id: 'c-wa' },
    { from_step_id: 'c-wa', to_step_id: 'c-end' },
  ],
};

const ESCALATION_SWEEP_SPEC = {
  local_id: 'wf', oid: 'wf-escalation-sweep', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_ESC_ACTIONS[0], ENV_LOCK5],
  steps: [
    step('s1', 'START'),
    { ...step('proxy', 'WORKFLOW PROXY'), local_id: 'Child' },
    step('s3', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'proxy' },
    { from_step_id: 'proxy', to_step_id: 's3' },
  ],
  children: [ESCALATION_SWEEP_CHILD],
};

test('a child escalation (escalateChildFailure) sweeps the environment tier for the dead subtree too', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, ESCALATION_SWEEP_SPEC, 'wf-escalation-sweep');
  await db.insert(wcResource).values({ workCenterId: wi.workCenterId, name: 'Lock5', resourceType: 'binary exclusive use', inUse: 1 });

  await pumpUntilQuiet(db, testDeps());
  const cBlocked = await stepRow(db, wi.id, 'c-blocked');
  expect(cBlocked?.state).toBe('READY'); // blocked inside the child, still queue-state READY
  const trace1 = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, wi.id));
  expect(trace1.some((t: { stepOid: string | null; state: string }) => t.stepOid === 'c-blocked' && t.state === 'WAITING')).toBe(true);

  const cancelSpy = vi.spyOn(InMemoryResourceManager.prototype, 'cancelQueuedWaiters');

  await submitUserAction(db, wi.id, { step_oid: 'c-trigger', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('errored'); // uncaught anywhere in this fixture -> root settles errored

  const cancelledOnEnv = envInstancesWith(cancelSpy, 'Lock5');
  expect(cancelledOnEnv.length).toBeGreaterThan(0);
  const lock5 = cancelledOnEnv[0].getSnapshot().find((s) => s.scope === 'environment' && s.resourceName === 'Lock5');
  expect(lock5?.queued).toBe(0);

  cancelSpy.mockRestore();
  await close();
});

// review round 2 (Critical): give back a cancelled branch's UNCONSUMED reservation.
//
// The three cancel-sweep sites captured a live grant via flushGranted and then discarded it -
// worse, cancelQueuedWaiters ALSO clears matching pendingGrants entries as a side effect
// (resources.ts's own doc comment), so the reservation vanished from bookkeeping entirely:
// never released back through the manager (no FIFO cascade to the next waiter), never recorded
// in envHolds (only a CONSUMED grant is ever recorded there). Three instances share ONE work
// center's 'LockGB': A holds it (parks, then releases on submit); B queues behind A, then gets
// FIFO-granted by A's release but is made to never consume that grant (its OWN action-proxy
// trigger fails on a completely SEPARATE branch, routing straight to RETURN ABANDON with
// nothing in that cascade ever touching b-blocked); C queues behind B. If the fix works, B's
// ABANDON must give the reservation back, and C (the next FIFO waiter) must inherit it.
async function makeSharedWc(db: AnyDb): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  return wc;
}

async function seedQueuedIn(db: AnyDb, wc: { id: string }, spec: unknown, oid: string, runtimeNumber: number): Promise<{ id: string }> {
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id };
}

const ENV_LOCK_GIVEBACK = {
  local_id: 'env-lock-giveback-lib', oid: 'env-lock-giveback', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'LockGB', resource_type: 'binary exclusive use' }],
};

const GIVEBACK_HOLDER_SPEC = {
  local_id: 'wf', oid: 'wf-giveback-holder', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_LOCK_GIVEBACK],
  steps: [
    step('s1', 'START'),
    step('a-hold', 'USER_INTERACTION', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'LockGB', resource_source_oid: 'env-lock-giveback' },
        { command_type: 'Release', resource_name: 'LockGB', resource_source_oid: 'env-lock-giveback' },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'a-hold' },
    { from_step_id: 'a-hold', to_step_id: 'e1' },
  ],
};

const ENV_ACTIONS_GIVEBACK = [{
  local_id: 'env-giveback-actions-lib', oid: 'env-giveback-actions', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-giveback', action_name: 'DoThing', action_library: 'lib-1' }],
}];
const GIVEBACK_ACTION_CONFIG = { action_oid: 'act-giveback', environment_oid: 'env-giveback-actions' };

const GIVEBACK_BLOCKED_ABANDON_SPEC = {
  local_id: 'wf', oid: 'wf-giveback-blocked-abandon', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_LOCK_GIVEBACK, ENV_ACTIONS_GIVEBACK[0]],
  steps: [
    step('s1', 'START'),
    step('p1', 'PARALLEL'),
    step('b-blocked', 'SCRIPT', {
      script_config: { source: 'output.x = 1;' },
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'LockGB', resource_source_oid: 'env-lock-giveback' },
      ],
    }),
    step('b-trigger', 'ACTION PROXY', { action_proxy_config: GIVEBACK_ACTION_CONFIG, try_specifications: [{ mode: 'ERROR', catch_id: 'CGB' }] }),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
    step('cgb', 'CATCH', { catch_id: 'CGB' }),
    step('rgb', 'RETURN', { return_config: { command: 'ABANDON' } }),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'b-blocked' },
    { from_step_id: 'p1', to_step_id: 'b-trigger' },
    { from_step_id: 'b-blocked', to_step_id: 'wa' },
    { from_step_id: 'b-trigger', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
    { from_step_id: 'cgb', to_step_id: 'rgb' },
  ],
};

const GIVEBACK_INHERITOR_SPEC = {
  local_id: 'wf', oid: 'wf-giveback-inheritor', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_LOCK_GIVEBACK],
  steps: [
    step('s1', 'START'),
    step('c-blocked', 'SCRIPT', {
      script_config: { source: 'output.x = 1;' },
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'LockGB', resource_source_oid: 'env-lock-giveback' },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'c-blocked' },
    { from_step_id: 'c-blocked', to_step_id: 'e1' },
  ],
};

test('RETURN ABANDON gives back an unconsumed environment reservation, so the next queued instance inherits the grant instead of the capacity vanishing', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeSharedWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'LockGB', resourceType: 'binary exclusive use' });

  const a = await seedQueuedIn(db, wc, GIVEBACK_HOLDER_SPEC, 'wf-giveback-holder', 1);
  await new Promise((r) => setTimeout(r, 2)); // distinct queued_at ordering
  const b = await seedQueuedIn(db, wc, GIVEBACK_BLOCKED_ABANDON_SPEC, 'wf-giveback-blocked-abandon', 2);
  await new Promise((r) => setTimeout(r, 2));
  const c = await seedQueuedIn(db, wc, GIVEBACK_INHERITOR_SPEC, 'wf-giveback-inheritor', 3);

  await pumpUntilQuiet(db, testDeps());

  // A holds LockGB (parked); B's b-blocked queued behind it; C's c-blocked queued behind B.
  expect((await stepRow(db, a.id, 'a-hold'))?.state).toBe('WAITING_USER');
  expect((await stepRow(db, b.id, 'b-blocked'))?.state).toBe('READY');
  expect((await stepRow(db, c.id, 'c-blocked'))?.state).toBe('READY');

  // A releases - FIFO hands the grant to B (queued first), not C.
  await submitUserAction(db, a.id, { step_oid: 'a-hold', action: 'submit' }, 0, testDeps());
  expect((await instanceRow(db, a.id)).status).toBe('completed');

  let bWaiter = await db.select().from(wcResourceWaiter)
    .where(and(eq(wcResourceWaiter.instanceId, b.id), eq(wcResourceWaiter.stepOid, 'b-blocked')));
  expect(bWaiter).toHaveLength(1);
  expect(bWaiter[0].granted).toBe(true); // B holds the grant now, unconsumed

  let cWaiter = await db.select().from(wcResourceWaiter)
    .where(and(eq(wcResourceWaiter.instanceId, c.id), eq(wcResourceWaiter.stepOid, 'c-blocked')));
  expect(cWaiter).toHaveLength(1);
  expect(cWaiter[0].granted).toBe(false); // still queued behind B

  // B's trigger fails on a COMPLETELY SEPARATE branch - nothing in this cascade ever calls
  // resumeGrantedSteps for b-blocked's grant - and routes straight to RETURN ABANDON.
  await submitUserAction(db, b.id, { step_oid: 'b-trigger', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, testDeps());
  expect((await instanceRow(db, b.id)).status).toBe('aborted');

  // B's own waiter row is gone either way (diffRegistry treats a token no longer in
  // pendingGrants as "consumed here" and deletes it) - the discriminating assertion is whether
  // C inherited the grant, not whether B's row survives.
  bWaiter = await db.select().from(wcResourceWaiter)
    .where(and(eq(wcResourceWaiter.instanceId, b.id), eq(wcResourceWaiter.stepOid, 'b-blocked')));
  expect(bWaiter).toHaveLength(0);

  cWaiter = await db.select().from(wcResourceWaiter)
    .where(and(eq(wcResourceWaiter.instanceId, c.id), eq(wcResourceWaiter.stepOid, 'c-blocked')));
  expect(cWaiter).toHaveLength(1);
  // THE discriminating assertion: without the fix, B's reservation is discarded uncounted and
  // C waits forever (granted stays false). With the fix, releasing it back through the manager
  // cascades the FIFO grant onward to C.
  expect(cWaiter[0].granted).toBe(true);

  const [lockRow] = await db.select().from(wcResource).where(eq(wcResource.workCenterId, wc.id));
  expect(lockRow.inUse).toBe(1); // still held throughout - by C now, never evaporated to 0

  await close();
});
