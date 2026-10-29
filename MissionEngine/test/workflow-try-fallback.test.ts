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
// Task 2: workflow-level TRY fallback in failStep + release_on_catch (spec 2026-08-22).
// Header + helpers mirror test/try-catch.test.ts:12-57.
import { expect, test } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { submitUserAction } from '../src/core/submit.js';
import type { FailureMode } from '../src/spec/types.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

async function seedQueued(db: any, spec: unknown, oid: string): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return wi;
}

type TraceTuple = [string, string, number | null];

async function traceOf(db: any, instanceId: string): Promise<TraceTuple[]> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(asc(traceEntry.orderIndex));
  return rows.map((r: any): TraceTuple => [r.stepOid, r.state, r.afterAction ?? null]);
}

async function stepRow(db: any, instanceId: string, stepOid: string) {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === stepOid);
}

async function instanceRow(db: any, instanceId: string) {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

/** The binary-exclusive Lock's `inUse` count, read out of the PERSISTED engine_state — the only
 *  place the ResourceManager's pool state survives a transaction (context.persist serializes it
 *  via InMemoryResourceManager#toJSON: `resources` is a [key, state] pair array, keyed
 *  `${ownerOid}:${name}`). Undefined when the instance declares no resources. */
async function lockInUse(db: any, instanceId: string): Promise<number | undefined> {
  const state = (await instanceRow(db, instanceId)).engineState as
    { resources?: { resources?: [string, { inUse?: number }][] } | null } | null;
  const entry = (state?.resources?.resources ?? []).find(([key]) => key.endsWith(':Lock'));
  return entry?.[1]?.inUse;
}

/** The persisted releasedOnCatch marker map (final-review fix). */
async function releasedOnCatchOf(db: any, instanceId: string): Promise<Record<string, true>> {
  const state = (await instanceRow(db, instanceId)).engineState as { releasedOnCatch?: Record<string, true> };
  return state?.releasedOnCatch ?? {};
}

const ENV_SPECS = [{
  local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
}];
const ACTION_CONFIG = { action_oid: 'act-1', environment_oid: 'env-1' };

// ── Workflow-level catch context: trigger idled (not ERRORED) and all four output fields land ──

const WF_LEVEL_OUTPUTS_SPEC = {
  local_id: 'wf', oid: 'wf-lvl-out', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  try_specifications: [{ mode: 'ERROR', catch_id: 'WF' }],
  value_property_specifications: [
    { local_id: 'FailureContext', oid: 'v1', version: '1.0.0', last_modified_date: '2026-01-01',
      name: 'FailureContext', entries: [
        { name: 'Mode', value: '' }, { name: 'Message', value: '' }, { name: 'Step', value: '' }, { name: 'StepID', value: '' },
      ] },
  ],
  steps: [
    step('s1', 'START'),
    step('s2', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }),
    step('s3', 'END'),
    step('c1', 'CATCH', {
      catch_id: 'WF',
      output_parameter_specifications: [
        { id: 'Reason', target: 'FailureContext.Mode' },
        { id: 'Message', target: 'FailureContext.Message' },
        { id: 'Step', target: 'FailureContext.Step' },
        { id: 'StepID', target: 'FailureContext.StepID' },
      ],
    }),
    step('r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 's3' },
    { from_step_id: 'c1', to_step_id: 'r1' },
  ],
};

test('workflow-level TRY: trigger idled with after_action; CATCH outputs carry the failing step', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, WF_LEVEL_OUTPUTS_SPEC, 'wf-lvl-out');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  await submitUserAction(db, wi.id, { step_oid: 's2', action: 'fail', failure_mode: 'ERROR', error: 'valve stuck' }, 5, deps);

  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['s2', 'IDLE', 5]); // caught → idled, not errored
  expect(trace.some(([oid, state]) => oid === 's2' && state === 'ERRORED')).toBe(false);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('aborted'); // RETURN ABANDON
  expect(after.propertyStore).toMatchObject({
    'FailureContext.Mode': 'ERROR',
    'FailureContext.Message': 'valve stuck',
    'FailureContext.Step': 's2',
    'FailureContext.StepID': 's2',
  });
  await close();
});

// ── release_on_catch (D6): the failing step's declared Release commands run when it routes to
// a catch, unblocking a queued sibling. Counter-case: release_on_catch:false leaves it queued. ──

const releaseSpec = (releaseOnCatch: boolean) => ({
  local_id: 'wf', oid: `wf-release-${releaseOnCatch}`, version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  resource_property_specifications: [{ name: 'Lock', resource_type: 'binary exclusive use' }],
  try_specifications: [{ mode: 'ERROR', catch_id: 'WF', release_on_catch: releaseOnCatch }],
  steps: [
    step('s1', 'START'),
    step('p1', 'PARALLEL'),
    // holder: acquires the Lock, then parks on the action server; its Release command would
    // normally run at completion — release_on_catch runs it at catch time instead.
    step('holder', 'ACTION PROXY', {
      action_proxy_config: ACTION_CONFIG,
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Lock' },
        { command_type: 'Release', resource_name: 'Lock' },
      ],
    }),
    // contender: SCRIPT that needs the same Lock; blocked while holder holds it.
    step('contender', 'SCRIPT', {
      script_config: { language: 'javascript', source: 'return true;' },
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Lock' },
        { command_type: 'Release', resource_name: 'Lock' },
      ],
    }),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
    step('c1', 'CATCH', { catch_id: 'WF' }),
    // Park the catch network on a user step so the instance stays running for assertions.
    step('ack', 'USER_INTERACTION'),
    step('r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'holder' },
    { from_step_id: 'p1', to_step_id: 'contender' },
    { from_step_id: 'holder', to_step_id: 'wa' },
    { from_step_id: 'contender', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
    { from_step_id: 'c1', to_step_id: 'ack' },
    { from_step_id: 'ack', to_step_id: 'r1' },
  ],
});

test('release_on_catch (default true): failing holder releases the Lock; queued contender completes', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, releaseSpec(true), 'wf-release-true');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  expect((await stepRow(db, wi.id, 'holder')).state).toBe('WAITING_ACTION'); // holds Lock
  expect((await stepRow(db, wi.id, 'contender')).state).toBe('READY'); // queued on Lock

  await submitUserAction(db, wi.id, { step_oid: 'holder', action: 'fail', failure_mode: 'ERROR', error: 'x' }, 0, deps);
  await pumpUntilQuiet(db, deps);

  expect((await instanceRow(db, wi.id)).status).toBe('running'); // catch parked at ack
  expect((await stepRow(db, wi.id, 'contender')).state).toBe('COMPLETED'); // release unblocked it
  await close();
});

test('release_on_catch: false — Lock is NOT released; contender stays queued', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, releaseSpec(false), 'wf-release-false');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  await submitUserAction(db, wi.id, { step_oid: 'holder', action: 'fail', failure_mode: 'ERROR', error: 'x' }, 0, deps);
  await pumpUntilQuiet(db, deps);

  expect((await instanceRow(db, wi.id)).status).toBe('running');
  expect((await stepRow(db, wi.id, 'contender')).state).toBe('READY'); // still queued
  await close();
});

// ── Re-entry on a workflow-level CATCH aborts the instance (D8, root scope) ──

test('second failure into an active workflow-level CATCH → CATCH_REENTRY → aborted', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: 'wf-lvl-reentry', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    try_specifications: [{ mode: 'ERROR', catch_id: 'WF' }],
    steps: [
      step('s1', 'START'), step('p1', 'PARALLEL'),
      step('a', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }),
      step('b', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }),
      step('wa', 'WAIT ALL'), step('e1', 'END'),
      step('c1', 'CATCH', { catch_id: 'WF' }),
      step('ack', 'USER_INTERACTION'),
      step('r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 'p1' },
      { from_step_id: 'p1', to_step_id: 'a' }, { from_step_id: 'p1', to_step_id: 'b' },
      { from_step_id: 'a', to_step_id: 'wa' }, { from_step_id: 'b', to_step_id: 'wa' },
      { from_step_id: 'wa', to_step_id: 'e1' },
      { from_step_id: 'c1', to_step_id: 'ack' }, { from_step_id: 'ack', to_step_id: 'r1' },
    ],
  };
  const wi = await seedQueued(db, spec, 'wf-lvl-reentry');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  await submitUserAction(db, wi.id, { step_oid: 'a', action: 'fail', failure_mode: 'ERROR', error: 'first' }, 0, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('running'); // catch armed, parked at ack
  await submitUserAction(db, wi.id, { step_oid: 'b', action: 'fail', failure_mode: 'ERROR', error: 'second' }, 1, deps);

  expect((await instanceRow(db, wi.id)).status).toBe('aborted');
  const trace = await traceOf(db, wi.id);
  expect(trace.some(([oid, state]) => oid === 'b' && state === 'ERRORED')).toBe(true);
  await close();
});

// ── D3 bubbling. Child spec shape mirrors child-workflows.test.ts: the child is matched by
// local_id === the WORKFLOW PROXY step's local_id; parentChildSpecId/state are schema-required. ──

/** The child of bubbleSpec: START -> ACTION PROXY ('c-act', the step every bubbling test fails)
 *  -> END, plus its own CATCH/RETURN pair — armed only when `tries` are supplied. */
function bubbleChild(rootOid: string, tries?: unknown[]) {
  return {
    local_id: 'Child', oid: `${rootOid}-child`, version: '1.0.0', last_modified_date: '2026-01-01',
    parentChildSpecId: null, state: 'Effective',
    ...(tries ? { try_specifications: tries } : {}),
    steps: [
      step('c-start', 'START'),
      step('c-act', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }),
      step('c-end', 'END'),
      step('c-catch', 'CATCH', { catch_id: 'CHILD' }),
      step('c-ret', 'RETURN', { return_config: { command: 'COMPLETE' } }),
    ],
    connections: [
      { from_step_id: 'c-start', to_step_id: 'c-act' },
      { from_step_id: 'c-act', to_step_id: 'c-end' },
      { from_step_id: 'c-catch', to_step_id: 'c-ret' },
    ],
  };
}

/** Root with one WORKFLOW PROXY ('Child') and a failing ACTION PROXY inside the child.
 *  Knobs: rows on the proxy step, rows on the root workflow, rows on the child workflow. */
function bubbleSpec(opts: {
  oid: string;
  proxyTries?: unknown[];
  rootTries?: unknown[];
  childTries?: unknown[];
  rootReturnCommand?: 'ABANDON' | 'COMPLETE' | 'RETRY';
}) {
  return {
    local_id: 'wf', oid: opts.oid, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    ...(opts.rootTries ? { try_specifications: opts.rootTries } : {}),
    steps: [
      step('s1', 'START'),
      { ...step('proxy', 'WORKFLOW PROXY', opts.proxyTries ? { try_specifications: opts.proxyTries } : {}), local_id: 'Child' },
      step('s3', 'END'),
      step('c1', 'CATCH', { catch_id: 'ROOT' }),
      step('r1', 'RETURN', { return_config: { command: opts.rootReturnCommand ?? 'ABANDON' } }),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 'proxy' },
      { from_step_id: 'proxy', to_step_id: 's3' },
      { from_step_id: 'c1', to_step_id: 'r1' },
    ],
    children: [bubbleChild(opts.oid, opts.childTries)],
  };
}

async function runToFailure(spec: { oid: string }, mode: FailureMode = 'ERROR') {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, spec, spec.oid);
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'c-act')).state).toBe('WAITING_ACTION'); // child parked
  await submitUserAction(db, wi.id, { step_oid: 'c-act', action: 'fail', failure_mode: mode, error: 'child boom' }, 0, deps);
  await pumpUntilQuiet(db, deps);
  return { db, close, wi, deps };
}

test('child own workflow-level TRY catches before any escalation (COMPLETE → child finishes → instance completes)', async () => {
  const { db, close, wi } = await runToFailure(bubbleSpec({ oid: 'wf-bub-child', childTries: [{ mode: 'ERROR', catch_id: 'CHILD' }] }));
  expect((await instanceRow(db, wi.id)).status).toBe('completed'); // child catch COMPLETEs c-act → c-end → child done → proxy completes → root END
  await close();
});

test('child uncaught → escalates to the parent PROXY step TRY', async () => {
  const { db, close, wi } = await runToFailure(bubbleSpec({ oid: 'wf-bub-proxy', proxyTries: [{ mode: 'ERROR', catch_id: 'ROOT' }] }));
  expect((await instanceRow(db, wi.id)).status).toBe('aborted'); // root catch → ABANDON
  const trace = await traceOf(db, wi.id);
  expect(trace.some(([oid, state]) => oid === 'c-act' && state === 'ERRORED')).toBe(true); // origin documented
  expect(trace).toContainEqual(['proxy', 'IDLE', null]); // proxy idled by the caught path
  // torn-down child leaves no rows behind
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, wi.id));
  expect(rows.some((r: any) => r.nodeOid === 'wf-bub-proxy-child')).toBe(false);
  await close();
});

test('child uncaught → proxy has no row for the mode → parent WORKFLOW-level TRY', async () => {
  const { db, close, wi } = await runToFailure(bubbleSpec({ oid: 'wf-bub-root', rootTries: [{ mode: 'ERROR', catch_id: 'ROOT' }] }));
  expect((await instanceRow(db, wi.id)).status).toBe('aborted');
  await close();
});

test('nothing catches anywhere → instance ERRORED (parked-parent hole is gone)', async () => {
  const { db, close, wi } = await runToFailure(bubbleSpec({ oid: 'wf-bub-none' }));
  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('errored'); // pre-escalation behavior: 'running' forever
  const trace = await traceOf(db, wi.id);
  expect(trace.some(([oid, state]) => oid === 'proxy' && state === 'ERRORED')).toBe(true);
  await close();
});

test('escalated catch context: trigger = proxy step; Message wraps the child detail', async () => {
  const spec = bubbleSpec({ oid: 'wf-bub-msg', proxyTries: [{ mode: 'ERROR', catch_id: 'ROOT' }] });
  // wire the ROOT catch's outputs like the Task-2 outputs test
  const catchStep = (spec.steps as any[]).find((s) => s.oid === 'c1');
  catchStep.output_parameter_specifications = [
    { id: 'Step', target: 'FC.Step' }, { id: 'StepID', target: 'FC.StepID' }, { id: 'Message', target: 'FC.Message' },
  ];
  (spec as any).value_property_specifications = [
    { local_id: 'FC', oid: 'v1', version: '1.0.0', last_modified_date: '2026-01-01', name: 'FC',
      entries: [{ name: 'Step', value: '' }, { name: 'StepID', value: '' }, { name: 'Message', value: '' }] },
  ];
  const { db, close, wi } = await runToFailure(spec);
  const after = await instanceRow(db, wi.id);
  expect(after.propertyStore).toMatchObject({
    'FC.Step': 'Child',    // the proxy step's local_id — the failing step in the CATCHING flow
    'FC.StepID': 'proxy',
    'FC.Message': "Uncaught ERROR in child workflow 'Child' at step 'c-act': child boom",
  });
  await close();
});

test('RETRY from an escalated catch re-runs the child from scratch', async () => {
  const { db, close, wi, deps } = await runToFailure(
    bubbleSpec({ oid: 'wf-bub-retry', proxyTries: [{ mode: 'ERROR', catch_id: 'ROOT' }], rootReturnCommand: 'RETRY' }));
  // RETRY reset + re-activated the proxy → a FRESH child run parks at c-act again
  const cAct = await stepRow(db, wi.id, 'c-act');
  expect(cAct.state).toBe('WAITING_ACTION');
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  // complete it this time → whole instance completes
  await submitUserAction(db, wi.id, { step_oid: 'c-act', action: 'submit' }, 1, deps);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  await close();
});

// ── Torn-down child's in-flight cascade must NOT resurrect rows: the failure fires from a
// SCRIPT throw mid-cascade INSIDE the child, with a sibling branch queued behind it. ──

test('escalation mid-cascade: dead child cascade stops; no child rows resurrected', async () => {
  const spec = {
    local_id: 'wf', oid: 'wf-bub-dead', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    try_specifications: [{ mode: 'ERROR', catch_id: 'ROOT' }],
    steps: [
      step('s1', 'START'),
      { ...step('proxy', 'WORKFLOW PROXY'), local_id: 'Child' },
      step('s3', 'END'),
      step('c1', 'CATCH', { catch_id: 'ROOT' }),
      step('ack', 'USER_INTERACTION'),
      step('r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 'proxy' },
      { from_step_id: 'proxy', to_step_id: 's3' },
      { from_step_id: 'c1', to_step_id: 'ack' },
      { from_step_id: 'ack', to_step_id: 'r1' },
    ],
    children: [{
      local_id: 'Child', oid: 'wf-bub-dead-child', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      steps: [
        step('c-start', 'START'),
        step('c-par', 'PARALLEL'),
        // branch 1: throwing script — fails DURING the child's own activation cascade
        step('c-boom', 'SCRIPT', { script_config: { language: 'javascript', source: 'throw new Error("mid-cascade");' } }),
        // branch 2: a user park that would sit active if the branch ran
        step('c-park', 'USER_INTERACTION'),
        step('c-wa', 'WAIT ALL'),
        step('c-end', 'END'),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-par' },
        { from_step_id: 'c-par', to_step_id: 'c-boom' },
        { from_step_id: 'c-par', to_step_id: 'c-park' },
        { from_step_id: 'c-boom', to_step_id: 'c-wa' },
        { from_step_id: 'c-park', to_step_id: 'c-wa' },
        { from_step_id: 'c-wa', to_step_id: 'c-end' },
      ],
    }],
  };
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, spec, 'wf-bub-dead');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  // the SCRIPT threw during the initial pump → escalated → root workflow catch parked at ack
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  expect((await stepRow(db, wi.id, 'ack')).state).toBe('WAITING_USER');
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, wi.id));
  expect(rows.filter((r: any) => r.nodeOid === 'wf-bub-dead-child')).toEqual([]); // nothing resurrected
  const state = (await instanceRow(db, wi.id)).engineState as { childActive?: Record<string, string> };
  expect(state.childActive ?? {}).toEqual({});
  await close();
});

// ── D8 uniform re-entry: a child failure escalating into an ALREADY-ACTIVE parent catch
// aborts the whole instance (previously: silent dead branch). ──

test('escalation into an active catch → CATCH_REENTRY → instance aborted', async () => {
  const ROOT_TRY = [{ mode: 'ERROR', catch_id: 'ROOT' }];
  // s1 → p0 → { proxy(Child), a2 } → wa2 → s3, with a root catch network that PARKS
  // (c1 → ack → r1) so it stays active, and a second fallible root step (a2) sharing the
  // same catch — a2's failure arms the catch, the child's escalation then re-enters it.
  const spec = {
    local_id: 'wf', oid: 'wf-bub-reentry', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step('s1', 'START'),
      step('p0', 'PARALLEL'),
      { ...step('proxy', 'WORKFLOW PROXY', { try_specifications: ROOT_TRY }), local_id: 'Child' },
      step('a2', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG, try_specifications: ROOT_TRY }),
      step('wa2', 'WAIT ALL'),
      step('s3', 'END'),
      step('c1', 'CATCH', { catch_id: 'ROOT' }),
      step('ack', 'USER_INTERACTION'),
      step('r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 'p0' },
      { from_step_id: 'p0', to_step_id: 'proxy' }, { from_step_id: 'p0', to_step_id: 'a2' },
      { from_step_id: 'proxy', to_step_id: 'wa2' }, { from_step_id: 'a2', to_step_id: 'wa2' },
      { from_step_id: 'wa2', to_step_id: 's3' },
      { from_step_id: 'c1', to_step_id: 'ack' }, { from_step_id: 'ack', to_step_id: 'r1' },
    ],
    children: [bubbleChild('wf-bub-reentry')],
  };

  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, spec, 'wf-bub-reentry');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  await submitUserAction(db, wi.id, { step_oid: 'a2', action: 'fail', failure_mode: 'ERROR', error: 'first' }, 0, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('running'); // catch armed, parked at ack
  await submitUserAction(db, wi.id, { step_oid: 'c-act', action: 'fail', failure_mode: 'ERROR', error: 'second' }, 1, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('aborted'); // escalated re-entry aborts, never silently dies
  await close();
});

// ── Fix round 1 (Critical): an escalation that fires while the PARENT context is mid-drain must
// NOT run its own settleIfComplete. Mid-drain, failStep's activateAndCascade is re-entrant, so
// the catch network is merely QUEUED at that instant — while the trigger proxy row is already
// idled and the child subtree torn down. An EARLIER child's COMPLETED END row is enough for
// isWorkflowComplete to see "an END completed + nothing non-terminal" and settle 'completed',
// stranding the queued catch network inside a terminal instance.
//
// Trigger shape: two SEQUENTIAL WORKFLOW PROXY steps. ChildA parks on a USER_INTERACTION and is
// completed by a submit — whose completeChildWorkflow tail opens a ROOT drain that activates
// ChildB. ChildB dies uncaught DURING that activation (a throwing SCRIPT, so the failure lands
// inside the live root drain rather than in a later, drain-free submit) and escalates into the
// root's workflow-level TRY. ──

test('escalation mid-parent-drain: queued catch network is not pre-empted by a stale completion check', async () => {
  const spec = {
    local_id: 'wf', oid: 'wf-bub-seq', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    try_specifications: [{ mode: 'ERROR', catch_id: 'ROOT' }],
    steps: [
      step('s1', 'START'),
      { ...step('proxyA', 'WORKFLOW PROXY'), local_id: 'ChildA' },
      { ...step('proxyB', 'WORKFLOW PROXY'), local_id: 'ChildB' },
      step('e2', 'END'),
      step('c1', 'CATCH', { catch_id: 'ROOT' }),
      step('ack', 'USER_INTERACTION'),
      step('r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 'proxyA' },
      { from_step_id: 'proxyA', to_step_id: 'proxyB' },
      { from_step_id: 'proxyB', to_step_id: 'e2' },
      { from_step_id: 'c1', to_step_id: 'ack' },
      { from_step_id: 'ack', to_step_id: 'r1' },
    ],
    children: [
      {
        local_id: 'ChildA', oid: 'wf-bub-seq-a', version: '1.0.0', last_modified_date: '2026-01-01',
        parentChildSpecId: null, state: 'Effective',
        steps: [step('a-start', 'START'), step('a-ui', 'USER_INTERACTION'), step('a-end', 'END')],
        connections: [
          { from_step_id: 'a-start', to_step_id: 'a-ui' },
          { from_step_id: 'a-ui', to_step_id: 'a-end' },
        ],
      },
      {
        local_id: 'ChildB', oid: 'wf-bub-seq-b', version: '1.0.0', last_modified_date: '2026-01-01',
        parentChildSpecId: null, state: 'Effective',
        steps: [
          step('b-start', 'START'),
          step('b-boom', 'SCRIPT', { script_config: { language: 'javascript', source: 'throw new Error("child B");' } }),
          step('b-end', 'END'),
        ],
        connections: [
          { from_step_id: 'b-start', to_step_id: 'b-boom' },
          { from_step_id: 'b-boom', to_step_id: 'b-end' },
        ],
      },
    ],
  };
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, spec, 'wf-bub-seq');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'a-ui')).state).toBe('WAITING_USER');

  // Completing ChildA leaves its COMPLETED END row behind AND activates ChildB from inside the
  // root's own drain — ChildB then dies uncaught and escalates while that drain is still live.
  await submitUserAction(db, wi.id, { step_oid: 'a-ui', action: 'submit' }, 0, deps);
  await pumpUntilQuiet(db, deps);

  const after = await instanceRow(db, wi.id);
  expect(after.status).not.toBe('completed'); // the defect settled 'completed' mid-escalation
  expect(after.status).toBe('running');
  expect((await stepRow(db, wi.id, 'ack')).state).toBe('WAITING_USER'); // catch network actually ran
  expect((await stepRow(db, wi.id, 'a-end')).state).toBe('COMPLETED'); // the END row that armed the defect

  await submitUserAction(db, wi.id, { step_oid: 'ack', action: 'submit' }, 1, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('aborted'); // RETURN ABANDON, reached normally
  await close();
});

// ── Final review (Critical): exactly ONE release per acquire when a catch-time release
// (release_on_catch) is followed by RETURN COMPLETE.
//
// failStep's caught path runs the failing step's Release commands at catch time; RETURN COMPLETE
// then force-completes that SAME trigger step and seeds it into drainCascade, whose dequeue loop
// releases every dequeued step's completion commands unconditionally (Task 13's I2 fix). Without
// the releasedOnCatch marker the trigger's Release therefore runs TWICE — for a binary-exclusive
// lock the first release hands it to a queued contender and the second flips inUse 1 -> 0 while
// that contender still holds it, so a third acquirer walks into the critical section. The
// resource manager has no per-holder tracking (resources.ts), so nothing downstream notices.
//
// Shared shape: PARALLEL fans out to a Lock-holding ACTION PROXY ('holder') and a second branch;
// both join a WAIT ALL before END. The workflow-level TRY's catch network is c1 -> [ack] -> r1.

const LOCK_CMDS = [
  { command_type: 'Acquire', resource_name: 'Lock' },
  { command_type: 'Release', resource_name: 'Lock' },
];

function netReleaseSpec(opts: {
  oid: string;
  command: 'COMPLETE' | 'RETRY';
  /** omitted = the default (true) path; false exercises the no-catch-time-release counter-case */
  releaseOnCatch?: boolean;
  /** true: the second branch contests the same Lock. false: it declares no resources at all, so
   *  the Lock is free for a RETRY re-run to re-acquire. */
  contendsForLock: boolean;
  /** park the catch network on a USER_INTERACTION, so its RETURN dispatches in a LATER
   *  transaction than the failure — the case that makes the marker's PERSISTENCE load-bearing. */
  parkCatch?: boolean;
}) {
  const otherOid = opts.contendsForLock ? 'contender' : 'other';
  const tryRow: Record<string, unknown> = { mode: 'ERROR', catch_id: 'WF' };
  if (opts.releaseOnCatch !== undefined) tryRow.release_on_catch = opts.releaseOnCatch;
  return {
    local_id: 'wf', oid: opts.oid, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    resource_property_specifications: [{ name: 'Lock', resource_type: 'binary exclusive use' }],
    try_specifications: [tryRow],
    steps: [
      step('s1', 'START'),
      step('p1', 'PARALLEL'),
      step('holder', 'ACTION PROXY', {
        action_proxy_config: ACTION_CONFIG,
        resource_command_specifications: LOCK_CMDS,
      }),
      step(otherOid, 'USER_INTERACTION', opts.contendsForLock ? { resource_command_specifications: LOCK_CMDS } : {}),
      step('wa', 'WAIT ALL'),
      step('e1', 'END'),
      step('c1', 'CATCH', { catch_id: 'WF' }),
      ...(opts.parkCatch ? [step('ack', 'USER_INTERACTION')] : []),
      step('r1', 'RETURN', { return_config: { command: opts.command } }),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 'p1' },
      { from_step_id: 'p1', to_step_id: 'holder' },
      { from_step_id: 'p1', to_step_id: otherOid },
      { from_step_id: 'holder', to_step_id: 'wa' },
      { from_step_id: otherOid, to_step_id: 'wa' },
      { from_step_id: 'wa', to_step_id: 'e1' },
      ...(opts.parkCatch
        ? [{ from_step_id: 'c1', to_step_id: 'ack' }, { from_step_id: 'ack', to_step_id: 'r1' }]
        : [{ from_step_id: 'c1', to_step_id: 'r1' }]),
    ],
  };
}

test('catch-time release + RETURN COMPLETE: the trigger is not released twice (contender keeps the Lock)', async () => {
  const { db, close } = await makeTestDb();
  const spec = netReleaseSpec({ oid: 'wf-net-complete', command: 'COMPLETE', contendsForLock: true });
  const wi = await seedQueued(db, spec, 'wf-net-complete');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  expect((await stepRow(db, wi.id, 'holder')).state).toBe('WAITING_ACTION'); // holds the Lock
  expect((await stepRow(db, wi.id, 'contender')).state).toBe('READY');       // queued on the Lock
  expect(await lockInUse(db, wi.id)).toBe(1);

  // One transaction: catch-time release hands the Lock to the contender, the catch network runs
  // straight through to RETURN COMPLETE, and COMPLETE re-seeds 'holder' into the SAME (already
  // draining) cascade — the dequeue-time release lands right after the catch-time one.
  await submitUserAction(db, wi.id, { step_oid: 'holder', action: 'fail', failure_mode: 'ERROR', error: 'x' }, 0, deps);
  await pumpUntilQuiet(db, deps);

  expect((await instanceRow(db, wi.id)).status).toBe('running');
  expect((await stepRow(db, wi.id, 'contender')).state).toBe('WAITING_USER'); // granted by the catch-time release
  expect((await stepRow(db, wi.id, 'holder')).state).toBe('COMPLETED');       // forced by RETURN COMPLETE
  // THE regression assertion: reads 0 without the fix — the second release freed a Lock the
  // contender was still holding.
  expect(await lockInUse(db, wi.id)).toBe(1);
  expect(await releasedOnCatchOf(db, wi.id)).toEqual({}); // marker consumed by the dequeue

  await submitUserAction(db, wi.id, { step_oid: 'contender', action: 'submit' }, 1, deps);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  expect(await lockInUse(db, wi.id)).toBe(0); // the contender's own release — net one per acquire
  await close();
});

test('catch-time release marker is persisted: parked catch dispatches RETURN COMPLETE in a later transaction', async () => {
  const { db, close } = await makeTestDb();
  const spec = netReleaseSpec({ oid: 'wf-net-park', command: 'COMPLETE', contendsForLock: true, parkCatch: true });
  const wi = await seedQueued(db, spec, 'wf-net-park');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);
  expect(await lockInUse(db, wi.id)).toBe(1);

  // Transaction A: the failure. The catch network parks at 'ack', so RETURN never runs here.
  await submitUserAction(db, wi.id, { step_oid: 'holder', action: 'fail', failure_mode: 'ERROR', error: 'x' }, 0, deps);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'ack')).state).toBe('WAITING_USER');
  expect((await stepRow(db, wi.id, 'contender')).state).toBe('WAITING_USER'); // catch-time release granted it
  expect(await lockInUse(db, wi.id)).toBe(1);
  // Round-tripped through engine_state jsonb — an in-memory-only marker would be gone by now.
  expect(await releasedOnCatchOf(db, wi.id)).toEqual({ holder: true });

  // Transaction B: a brand-new WorkflowContext dispatches RETURN COMPLETE.
  await submitUserAction(db, wi.id, { step_oid: 'ack', action: 'submit' }, 1, deps);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'holder')).state).toBe('COMPLETED');
  expect(await lockInUse(db, wi.id)).toBe(1); // still the contender's
  expect(await releasedOnCatchOf(db, wi.id)).toEqual({});

  await submitUserAction(db, wi.id, { step_oid: 'contender', action: 'submit' }, 2, deps);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  expect(await lockInUse(db, wi.id)).toBe(0);
  await close();
});

test('catch-time release + RETURN RETRY: the re-run holder still releases at its own completion', async () => {
  const { db, close } = await makeTestDb();
  const spec = netReleaseSpec({ oid: 'wf-net-retry', command: 'RETRY', contendsForLock: false });
  const wi = await seedQueued(db, spec, 'wf-net-retry');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'holder')).state).toBe('WAITING_ACTION');
  expect((await stepRow(db, wi.id, 'other')).state).toBe('WAITING_USER');
  expect(await lockInUse(db, wi.id)).toBe(1);

  // Fail -> catch-time release (marker set) -> RETURN RETRY re-activates holder, which re-ACQUIRES
  // the now-free Lock. The marker must not survive that: note returnRetry's resetStepIfExists is a
  // no-op here (failStep already deleted the row), so the re-activation itself is what clears it.
  await submitUserAction(db, wi.id, { step_oid: 'holder', action: 'fail', failure_mode: 'ERROR', error: 'x' }, 0, deps);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  expect((await stepRow(db, wi.id, 'holder')).state).toBe('WAITING_ACTION'); // re-parked by RETRY
  expect(await lockInUse(db, wi.id)).toBe(1);                                // re-acquired
  expect(await releasedOnCatchOf(db, wi.id)).toEqual({});                    // cleared by the re-activation

  // The re-run's OWN completion release must fire — suppressing it would strand the Lock at 1.
  await submitUserAction(db, wi.id, { step_oid: 'holder', action: 'submit' }, 1, deps);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('running'); // 'other' branch still parked
  expect(await lockInUse(db, wi.id)).toBe(0);

  await submitUserAction(db, wi.id, { step_oid: 'other', action: 'submit' }, 2, deps);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  expect(await lockInUse(db, wi.id)).toBe(0);
  await close();
});

test('release_on_catch:false + RETURN COMPLETE: the dequeue-time release is NOT suppressed', async () => {
  const { db, close } = await makeTestDb();
  const spec = netReleaseSpec({
    oid: 'wf-net-norelease', command: 'COMPLETE', releaseOnCatch: false, contendsForLock: true, parkCatch: true,
  });
  const wi = await seedQueued(db, spec, 'wf-net-norelease');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);
  expect(await lockInUse(db, wi.id)).toBe(1);

  // No catch-time release: the dead holder's Lock stays held and the contender stays queued.
  // (Delta from the brief's sketch: the catch network is parked at 'ack' precisely so this
  // intermediate state is observable — with c1 -> r1 the RETURN would fire in the same
  // transaction and there would be no point at which to assert "still READY".)
  await submitUserAction(db, wi.id, { step_oid: 'holder', action: 'fail', failure_mode: 'ERROR', error: 'x' }, 0, deps);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  expect((await stepRow(db, wi.id, 'contender')).state).toBe('READY'); // still blocked
  expect(await lockInUse(db, wi.id)).toBe(1);
  expect(await releasedOnCatchOf(db, wi.id)).toEqual({}); // never set — nothing to suppress

  // RETURN COMPLETE's dequeue-time release runs normally and hands the Lock to the contender.
  await submitUserAction(db, wi.id, { step_oid: 'ack', action: 'submit' }, 1, deps);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'holder')).state).toBe('COMPLETED');
  expect((await stepRow(db, wi.id, 'contender')).state).toBe('WAITING_USER'); // granted
  expect(await lockInUse(db, wi.id)).toBe(1);

  await submitUserAction(db, wi.id, { step_oid: 'contender', action: 'submit' }, 2, deps);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  expect(await lockInUse(db, wi.id)).toBe(0);
  await close();
});
