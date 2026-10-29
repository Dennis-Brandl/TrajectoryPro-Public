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
// Task 12: WORKFLOW PROXY / child-workflow execution — reference engine.ts:674-757
// (activateWorkflowProxy, completeChildWorkflow) + submitAction's child delegation
// (engine.ts:183-194). The three vendored exec-child-*.json fixtures are NOT used as
// correctness oracles here — PROVENANCE.md records that they fail against the reference
// runner itself; Task 13 treats them as known failures. These are hand-rolled specs instead.
import { expect, test } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { submitUserAction } from '../src/core/submit.js';

/** Like the other test files' `step()`, but local_id and oid are independently controllable —
 *  a WORKFLOW PROXY step's child lookup is keyed by LOCAL_ID (reference engine.ts:109-114,
 *  675), so the tests below deliberately give proxy steps a local_id that differs from their
 *  oid, matching the vendored exec-child-* fixtures' own shape (step local_id "child-wf", oid
 *  "proxy"). */
function step(localId: string, oid: string, stepType: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { local_id: localId, oid, step_type: stepType, version: '1.0.0', last_modified_date: '2026-01-01', ...extra };
}

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

/** [stepOid, state, after_action] tuples — matches the convention used by try-catch.test.ts /
 *  routing.test.ts / submit.test.ts's own traceOf. Use traceRows (below) instead when a test
 *  needs order_index. */
async function traceOf(db: any, instanceId: string): Promise<TraceTuple[]> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(asc(traceEntry.id));
  return rows.map((r: any): TraceTuple => [r.stepOid, r.state, r.afterAction ?? null]);
}

async function traceRows(db: any, instanceId: string) {
  return db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(asc(traceEntry.id));
}

async function stepRow(db: any, instanceId: string, stepOid: string) {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === stepOid);
}

async function instanceRow(db: any, instanceId: string) {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

// ── parent -> child starting-param mapping by id (literal + property); child executes and
// returns outputs to parent targets; per-context trace order restart ──
//
// The proxy step's local_id ("ChildRef") deliberately differs from its oid ("proxy") — the
// child lookup is by LOCAL_ID (reference engine.ts:675), and this spec exercises that directly
// rather than coincidentally matching via oid===local_id like the other test files' step().
const PARAM_MAPPING_SPEC = {
  local_id: 'parent-wf', oid: 'wf-param-mapping', version: '1.0.0', last_modified_date: '2026-01-01',
  value_property_specifications: [{ name: 'Input', entries: [{ name: 'Value', value: 'hello-from-parent' }] }],
  steps: [
    step('start', 'p-start', 'START'),
    step('ChildRef', 'proxy', 'WORKFLOW PROXY', {
      input_parameter_specifications: [
        { id: 'literalParam', default_value: 'literal-value', value_type: 'literal' },
        { id: 'propParam', default_value: 'Input.Value', value_type: 'property' },
      ],
      output_parameter_specifications: [{ id: 'result', target: 'Output.Result' }],
    }),
    step('end', 'p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'proxy' },
    { from_step_id: 'proxy', to_step_id: 'p-end' },
  ],
  children: [
    {
      local_id: 'ChildRef', oid: 'child-param-mapping', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      starting_parameter_specifications: [
        { id: 'literalParam', default_value: '' },
        { id: 'propParam', default_value: '' },
      ],
      output_parameter_specifications: [{ id: 'result', target: 'result' }],
      steps: [
        step('c-start', 'c-start', 'START'),
        step('c-script', 'c-script', 'SCRIPT', {
          script_config: { source: "output.result = literalParam + '|' + propParam;" },
          input_parameter_specifications: [
            { id: 'literalParam', default_value: 'literalParam', value_type: 'property' },
            { id: 'propParam', default_value: 'propParam', value_type: 'property' },
          ],
          output_parameter_specifications: [{ id: 'result', target: 'result' }],
        }),
        step('c-end', 'c-end', 'END'),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-script' },
        { from_step_id: 'c-script', to_step_id: 'c-end' },
      ],
    },
  ],
};

test('parent input params map to child starting params by id (literal + property, resolved through the PARENT store)', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, PARAM_MAPPING_SPEC, 'wf-param-mapping');
  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  // literalParam took its literal default_value verbatim; propParam resolved "Input.Value"
  // through the PARENT's property store before being handed to the child.
  expect(after.propertyStore).toMatchObject({ 'Output.Result': 'literal-value|hello-from-parent' });
  await close();
});

test('child executes and returns outputs to parent targets (output_parameter_specifications matched by id)', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, PARAM_MAPPING_SPEC, 'wf-param-mapping-2');
  await pumpUntilQuiet(db, testDeps());

  const proxy = await stepRow(db, wi.id, 'proxy');
  expect(proxy.state).toBe('COMPLETED');
  const cEnd = await stepRow(db, wi.id, 'c-end');
  expect(cEnd.state).toBe('COMPLETED');
  expect(cEnd.nodeOid).toBe('child-param-mapping'); // child steps carry the CHILD spec's oid
  const pEnd = await stepRow(db, wi.id, 'p-end');
  expect(pEnd.state).toBe('COMPLETED');
  expect(pEnd.nodeOid).toBe('wf-param-mapping'); // parent steps carry the ROOT spec's oid
  await close();
});

test('child trace merges with the parent trace, restarting its OWN per-context order counter at 1', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, PARAM_MAPPING_SPEC, 'wf-param-mapping-3');
  await pumpUntilQuiet(db, testDeps());

  const rows = await traceRows(db, wi.id);
  const childTrace = rows.filter((r: any) => ['c-start', 'c-script', 'c-end'].includes(r.stepOid));
  expect(childTrace.map((r: any) => [r.stepOid, r.state, r.orderIndex])).toEqual([
    ['c-start', 'COMPLETED', 1],
    ['c-script', 'COMPLETED', 2],
    ['c-end', 'COMPLETED', 3],
  ]);

  const parentTrace = rows.filter((r: any) => ['p-start', 'proxy', 'p-end'].includes(r.stepOid));
  // p-start never gets its own step_instance row (instance.ts traces START directly), but it
  // DOES get a trace entry — order 1 in the ROOT's own counter, independent of the child's.
  expect(parentTrace.map((r: any) => [r.stepOid, r.state, r.orderIndex])).toEqual([
    ['p-start', 'COMPLETED', 1],
    ['proxy', 'EXECUTING', 2],
    ['proxy', 'COMPLETED', 3],
    ['p-end', 'COMPLETED', 4],
  ]);
  await close();
});

// ── missing child auto-completes as a no-op ──

const MISSING_CHILD_SPEC = {
  local_id: 'wf', oid: 'wf-missing-child', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('start', 's1', 'START'),
    step('NoSuchChild', 'proxy', 'WORKFLOW PROXY'),
    step('end', 'e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'proxy' },
    { from_step_id: 'proxy', to_step_id: 'e1' },
  ],
  // No `children` array at all — the local_id "NoSuchChild" matches nothing.
};

test('WORKFLOW PROXY with no matching child spec auto-completes as a no-op', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, MISSING_CHILD_SPEC, 'wf-missing-child');
  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  const proxy = await stepRow(db, wi.id, 'proxy');
  expect(proxy.state).toBe('COMPLETED');
  // No park: the no-op path falls straight through finishStep, never tracing EXECUTING —
  // exactly one trace entry for 'proxy', COMPLETED, no after_action.
  const trace = await traceOf(db, wi.id);
  expect(trace.filter(([oid]) => oid === 'proxy')).toEqual([['proxy', 'COMPLETED', null]]);
  await close();
});

// ── a UI step INSIDE the child parks and completes via delegated submit (after_action carried) ──

const UI_CHILD_SPEC = {
  local_id: 'parent-wf', oid: 'wf-ui-child', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('start', 'p-start', 'START'),
    step('ChildRef', 'proxy', 'WORKFLOW PROXY', {
      output_parameter_specifications: [{ id: 'answer', target: 'Result.Answer' }],
    }),
    step('end', 'p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'proxy' },
    { from_step_id: 'proxy', to_step_id: 'p-end' },
  ],
  children: [
    {
      local_id: 'ChildRef', oid: 'child-ui', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      output_parameter_specifications: [{ id: 'answer', target: 'answer' }],
      steps: [
        step('c-start', 'c-start', 'START'),
        step('c-form', 'c-form', 'USER_INTERACTION', {
          form_layout_config: [{
            deviceType: 'phone', canvasWidth: 390, canvasHeight: 844,
            elements: [
              { type: 'textInput', x: 0, y: 0, width: 300, height: 40, fieldName: 'response', outputParameter: 'answer' },
            ],
          }],
          output_parameter_specifications: [{ id: 'answer', target: 'answer' }],
        }),
        step('c-end', 'c-end', 'END'),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-form' },
        { from_step_id: 'c-form', to_step_id: 'c-end' },
      ],
    },
  ],
};

test('a UI step inside the child parks (WAITING_USER) and completes via a submit delegated straight to the child, carrying after_action', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, UI_CHILD_SPEC, 'wf-ui-child');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  const proxy = await stepRow(db, wi.id, 'proxy');
  expect(proxy.state).toBe('WAITING_ACTION'); // parked, action_instance_id stays NULL
  expect(proxy.actionInstanceId).toBeNull();
  const cForm = await stepRow(db, wi.id, 'c-form');
  expect(cForm.state).toBe('WAITING_USER');
  expect(cForm.nodeOid).toBe('child-ui');
  expect((await instanceRow(db, wi.id)).status).toBe('running');

  // Submit targets the CHILD's own step oid directly — submitUserAction resolves the owning
  // context from the row's node_oid, delegating without any special-casing at the call site.
  await submitUserAction(db, wi.id, { step_oid: 'c-form', action: 'submit', form_values: { response: 'user-typed-this' } }, 9, deps);

  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['c-form', 'COMPLETED', 9]); // after_action carried onto the CHILD's own trace
  // The parent's own WORKFLOW PROXY completion trace does NOT carry after_action (reference
  // engine.ts:755's bare recordTrace(parentStepOid, 'COMPLETED') call, no third argument).
  const proxyCompleted = trace.filter(([oid, state]) => oid === 'proxy' && state === 'COMPLETED');
  expect(proxyCompleted).toEqual([['proxy', 'COMPLETED', null]]);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  expect(after.propertyStore).toMatchObject({ 'Result.Answer': 'user-typed-this' });
  await close();
});

// ── nested child-in-child completes, values threading through BOTH levels ──

const NESTED_CHILD_SPEC = {
  local_id: 'outer-wf', oid: 'wf-nested', version: '1.0.0', last_modified_date: '2026-01-01',
  value_property_specifications: [{ name: 'Seed', entries: [{ name: 'Value', value: 'deep-seed' }] }],
  steps: [
    step('start', 'p-start', 'START'),
    step('OuterRef', 'outer-proxy', 'WORKFLOW PROXY', {
      output_parameter_specifications: [{ id: 'out', target: 'Final.Result' }],
    }),
    step('end', 'p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'outer-proxy' },
    { from_step_id: 'outer-proxy', to_step_id: 'p-end' },
  ],
  children: [
    {
      local_id: 'OuterRef', oid: 'mid-child', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      output_parameter_specifications: [{ id: 'out', target: 'out' }],
      steps: [
        step('m-start', 'm-start', 'START'),
        step('InnerRef', 'inner-proxy', 'WORKFLOW PROXY', {
          output_parameter_specifications: [{ id: 'out', target: 'out' }],
        }),
        step('m-end', 'm-end', 'END'),
      ],
      connections: [
        { from_step_id: 'm-start', to_step_id: 'inner-proxy' },
        { from_step_id: 'inner-proxy', to_step_id: 'm-end' },
      ],
      children: [
        {
          local_id: 'InnerRef', oid: 'inner-child', version: '1.0.0', last_modified_date: '2026-01-01',
          parentChildSpecId: null, state: 'Effective',
          output_parameter_specifications: [{ id: 'out', target: 'out' }],
          steps: [
            step('i-start', 'i-start', 'START'),
            step('i-script', 'i-script', 'SCRIPT', {
              script_config: { source: "output.out = seed + '-processed';" },
              input_parameter_specifications: [{ id: 'seed', default_value: 'Seed.Value', value_type: 'property' }],
              output_parameter_specifications: [{ id: 'out', target: 'out' }],
            }),
            step('i-end', 'i-end', 'END'),
          ],
          connections: [
            { from_step_id: 'i-start', to_step_id: 'i-script' },
            { from_step_id: 'i-script', to_step_id: 'i-end' },
          ],
        },
      ],
    },
  ],
};

test('nested child-in-child completes, threading a property value through both levels', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, NESTED_CHILD_SPEC, 'wf-nested');
  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  expect(after.propertyStore).toMatchObject({ 'Final.Result': 'deep-seed-processed' });

  const outerProxy = await stepRow(db, wi.id, 'outer-proxy');
  expect(outerProxy.state).toBe('COMPLETED');
  expect(outerProxy.nodeOid).toBe('wf-nested');
  const innerProxy = await stepRow(db, wi.id, 'inner-proxy');
  expect(innerProxy.state).toBe('COMPLETED');
  expect(innerProxy.nodeOid).toBe('mid-child'); // owned by the MIDDLE spec, not the root
  const iEnd = await stepRow(db, wi.id, 'i-end');
  expect(iEnd.state).toBe('COMPLETED');
  expect(iEnd.nodeOid).toBe('inner-child');

  // Both levels' childActive links are cleared once their children completed.
  const state = after.engineState as { childActive?: Record<string, string> };
  expect(state.childActive ?? {}).toEqual({});
  await close();
});

// ── child sharing the parent resource manager: acquire in parent blocks child acquire until
// the parent releases (reference engine.ts:707's shared resourceManager) ──
//
// Adapted from submit.test.ts's RES_BLOCK_SPEC shape: a PARALLEL fan-out where one branch
// ('holder', a parked USER_INTERACTION) acquires-and-holds a binary-exclusive Lock while the
// OTHER branch drives a WORKFLOW PROXY whose child tries to acquire the SAME Lock. The child's
// resource command must set `resource_source_oid` explicitly to the ROOT's oid — resource
// commands default their source to the ACTIVE context's OWN spec oid (buildResourceKey), so a
// child step reaching for a root-scoped resource, exactly like the reference's own
// buildResourceKey defaulting to `this.workflow.oid`, has to say so.
const SHARED_RESOURCE_SPEC = {
  local_id: 'wf', oid: 'wf-shared-resource', version: '1.0.0', last_modified_date: '2026-01-01',
  resource_property_specifications: [{ name: 'Lock', resource_type: 'binary exclusive use' }],
  steps: [
    step('start', 's1', 'START'),
    step('p1', 'p1', 'PARALLEL'),
    step('holder', 'holder', 'USER_INTERACTION', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Lock' },
        { command_type: 'Release', resource_name: 'Lock' },
      ],
    }),
    step('ChildRef', 'proxy', 'WORKFLOW PROXY'),
    step('wa', 'wa', 'WAIT ALL'),
    step('end', 'e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'holder' },
    { from_step_id: 'p1', to_step_id: 'proxy' },
    { from_step_id: 'holder', to_step_id: 'wa' },
    { from_step_id: 'proxy', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
  children: [
    {
      local_id: 'ChildRef', oid: 'child-shared-resource', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      steps: [
        step('c-start', 'c-start', 'START'),
        step('c-acquire', 'c-acquire', 'MATH', {
          resource_command_specifications: [
            { command_type: 'Acquire', resource_name: 'Lock', resource_source_oid: 'wf-shared-resource' },
          ],
        }),
        step('c-end', 'c-end', 'END'),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-acquire' },
        { from_step_id: 'c-acquire', to_step_id: 'c-end' },
      ],
    },
  ],
};

test('child shares the parent ResourceManager: acquiring in the parent blocks the child\'s acquire until the parent releases', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, SHARED_RESOURCE_SPEC, 'wf-shared-resource');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  const holder = await stepRow(db, wi.id, 'holder');
  expect(holder.state).toBe('WAITING_USER'); // holds the Lock while parked

  const cAcquire = await stepRow(db, wi.id, 'c-acquire');
  expect(cAcquire.state).toBe('READY'); // blocked, but queue state stays READY per design
  expect(cAcquire.nodeOid).toBe('child-shared-resource');
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['c-acquire', 'WAITING', null]);
  expect((await instanceRow(db, wi.id)).status).toBe('running');

  // Releasing the parent's holder must unblock the CHILD's queued Acquire — the shared
  // ResourceManager's grant crosses the parent/child boundary, and resumeGrantedSteps must
  // resolve the grant into the CHILD's own context to finish it.
  await submitUserAction(db, wi.id, { step_oid: 'holder', action: 'submit' }, 0, deps);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  const cAcquireAfter = await stepRow(db, wi.id, 'c-acquire');
  expect(cAcquireAfter.state).toBe('COMPLETED');
  const cEnd = await stepRow(db, wi.id, 'c-end');
  expect(cEnd.state).toBe('COMPLETED');
  const proxy = await stepRow(db, wi.id, 'proxy');
  expect(proxy.state).toBe('COMPLETED');
  const wa = await stepRow(db, wi.id, 'wa');
  expect(wa.state).toBe('COMPLETED');
  await close();
});

// ── C1 regression (post-Task-12 review, Critical): view-aliasing data loss. Pre-fix,
// contextForNode minted a NEW WorkflowContext + PropertyStore per call for a child spec oid —
// when finishStep(viewA, e.g. the step releasing a resource) triggered resumeGrantedSteps to
// resume a DIFFERENT step in the SAME child, findStep minted viewB; viewB's SCRIPT wrote a
// value, but the ORIGINAL caller's later persist() flushed the STALE viewA over it, silently
// discarding viewB's write. Fixed by memoizing views per spec oid on the root. Reproduced
// WITHOUT any racy PARALLEL ordering: c-a and c-b are both plain USER_INTERACTION parks (no
// resource contention at all during the initial pump, so BOTH park deterministically regardless
// of pick order); only submitting c-b (routing to c-b2, whose Acquire is GUARANTEED to block —
// c-a already holds the Lock) creates the contention, and submitting c-a afterward is what
// drives the release -> resumeGrantedSteps -> cross-context-resume cascade the bug lived in. ──

const C1_REGRESSION_SPEC = {
  local_id: 'parent-wf', oid: 'wf-c1-regression', version: '1.0.0', last_modified_date: '2026-01-01',
  resource_property_specifications: [{ name: 'Lock', resource_type: 'binary exclusive use' }],
  steps: [
    step('start', 'p-start', 'START'),
    step('ChildRef', 'proxy', 'WORKFLOW PROXY', {
      output_parameter_specifications: [{ id: 'result', target: 'Final.Result' }],
    }),
    step('end', 'p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'proxy' },
    { from_step_id: 'proxy', to_step_id: 'p-end' },
  ],
  children: [
    {
      local_id: 'ChildRef', oid: 'child-c1-regression', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      output_parameter_specifications: [{ id: 'result', target: 'result' }],
      steps: [
        step('c-start', 'c-start', 'START'),
        step('c-p1', 'c-p1', 'PARALLEL'),
        step('c-a', 'c-a', 'USER_INTERACTION', {
          resource_command_specifications: [
            { command_type: 'Acquire', resource_name: 'Lock', resource_source_oid: 'wf-c1-regression' },
            { command_type: 'Release', resource_name: 'Lock', resource_source_oid: 'wf-c1-regression' },
          ],
        }),
        step('c-b', 'c-b', 'USER_INTERACTION'), // no resource commands of its own — always parks
        step('c-b2', 'c-b2', 'SCRIPT', {
          resource_command_specifications: [
            { command_type: 'Acquire', resource_name: 'Lock', resource_source_oid: 'wf-c1-regression' },
          ],
          script_config: { source: "output.result = 'child-value';" },
          output_parameter_specifications: [{ id: 'result', target: 'result' }],
        }),
        step('c-wa', 'c-wa', 'WAIT ALL'),
        step('c-end', 'c-end', 'END'),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-p1' },
        { from_step_id: 'c-p1', to_step_id: 'c-a' },
        { from_step_id: 'c-p1', to_step_id: 'c-b' },
        { from_step_id: 'c-b', to_step_id: 'c-b2' },
        { from_step_id: 'c-a', to_step_id: 'c-wa' },
        { from_step_id: 'c-b2', to_step_id: 'c-wa' },
        { from_step_id: 'c-wa', to_step_id: 'c-end' },
      ],
    },
  ],
};

test('C1 regression: releasing c-a resumes c-b2 (same child) whose SCRIPT write is not lost to view aliasing', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, C1_REGRESSION_SPEC, 'wf-c1-regression');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  const cA = await stepRow(db, wi.id, 'c-a');
  expect(cA.state).toBe('WAITING_USER'); // holds the Lock (both c-a and c-b park unconditionally — no race)
  const cB = await stepRow(db, wi.id, 'c-b');
  expect(cB.state).toBe('WAITING_USER');
  expect((await instanceRow(db, wi.id)).status).toBe('running');

  // Submit c-b: routes to c-b2, whose Acquire is GUARANTEED to block (c-a already holds Lock,
  // and c-b2 did not exist as a row until just now).
  await submitUserAction(db, wi.id, { step_oid: 'c-b', action: 'submit' }, 0, deps);
  const cB2 = await stepRow(db, wi.id, 'c-b2');
  expect(cB2.state).toBe('READY'); // blocked, queue state stays READY per design
  const trace1 = await traceOf(db, wi.id);
  expect(trace1).toContainEqual(['c-b2', 'WAITING', null]);

  // Submit c-a: releases the Lock -> resumeGrantedSteps must resolve c-b2 into the SAME
  // memoized child context c-a's own view resolved to, not a fresh (pre-fix: aliased) one.
  await submitUserAction(db, wi.id, { step_oid: 'c-a', action: 'submit' }, 1, deps);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  // The proof: the value c-b2's SCRIPT wrote must have survived to the PARENT's mapped
  // target — pre-fix, a stale view's persist() clobbered it back to ''.
  expect(after.propertyStore).toMatchObject({ 'Final.Result': 'child-value' });
  const cB2After = await stepRow(db, wi.id, 'c-b2');
  expect(cB2After.state).toBe('COMPLETED');
  await close();
});

// ── I1 regression (post-Task-12 review, Important): ACTIVE_ROW_STATES omitted 'EXECUTING', so
// returnAbandon's own sweep couldn't clear a parked WAIT ALL row (they park EXECUTING, not one
// of the queue-vocabulary park states). Pre-Task-12 cosmetic (ABANDON always settled the whole
// instance regardless of leftover rows — settleTerminal never consults step_instance). Now a
// liveness bug: a CHILD-scoped ABANDON does NOT settle the whole instance (see
// errorReturnStep's doc comment) — its OWN generic tail instead calls settleIfComplete, which
// checks isChildComplete (any END reached AND no non-terminal rows for that child). A LEFTOVER
// EXECUTING row permanently blocks that check even once every OTHER branch has legitimately
// resolved and the child's END was already reached via an unrelated branch — reproduced below:
// c-main reaches c-end WHILE c-b1/c-wa are still active, then c-b1 fails, catches, and ABANDONs
// — c-wa (parked, waiting on c-b1 which will never arrive) is the row that must be cleared for
// isChildComplete to finally see "done", completing the parent proxy and the whole instance. ──

const ENV_SPECS_I1 = [{
  local_id: 'env', oid: 'env-i1', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-i1', action_name: 'DoThing', action_library: 'lib-1' }],
}];
const ACTION_CONFIG_I1 = { action_oid: 'act-i1', environment_oid: 'env-i1' };

const I1_REGRESSION_SPEC = {
  local_id: 'parent-wf', oid: 'wf-i1-regression', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('start', 'p-start', 'START'),
    step('ChildRef', 'proxy', 'WORKFLOW PROXY'),
    step('end', 'p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'proxy' },
    { from_step_id: 'proxy', to_step_id: 'p-end' },
  ],
  children: [
    {
      local_id: 'ChildRef', oid: 'child-i1-regression', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      environment_specifications: ENV_SPECS_I1,
      steps: [
        step('c-start', 'c-start', 'START'),
        step('c-p1', 'c-p1', 'PARALLEL'),
        step('c-main', 'c-main', 'MATH'),
        step('c-end', 'c-end', 'END'),
        step('c-b1', 'c-b1', 'ACTION PROXY', {
          action_proxy_config: ACTION_CONFIG_I1,
          try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }],
        }),
        step('c-b2', 'c-b2', 'MATH'),
        step('c-wa', 'c-wa', 'WAIT ALL'),
        step('c-after', 'c-after', 'MATH'),
        step('c-c1', 'c-c1', 'CATCH', { catch_id: 'C1' }),
        step('c-r1', 'c-r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-p1' },
        { from_step_id: 'c-p1', to_step_id: 'c-main' },
        { from_step_id: 'c-main', to_step_id: 'c-end' },
        { from_step_id: 'c-p1', to_step_id: 'c-b1' },
        { from_step_id: 'c-b1', to_step_id: 'c-wa' },
        { from_step_id: 'c-p1', to_step_id: 'c-b2' },
        { from_step_id: 'c-b2', to_step_id: 'c-wa' },
        { from_step_id: 'c-wa', to_step_id: 'c-after' },
        { from_step_id: 'c-c1', to_step_id: 'c-r1' },
      ],
    },
  ],
};

test('I1 regression: ABANDON inside a child clears a parked WAIT ALL (EXECUTING) row, letting an already-END-reached child (and the whole instance) complete', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, I1_REGRESSION_SPEC, 'wf-i1-regression');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  const cEnd = await stepRow(db, wi.id, 'c-end');
  expect(cEnd.state).toBe('COMPLETED'); // the child's END already reached via the unrelated c-main branch
  const cWa = await stepRow(db, wi.id, 'c-wa');
  expect(cWa.state).toBe('EXECUTING'); // parked, waiting on c-b1's arrival (which will never come)
  const cB1 = await stepRow(db, wi.id, 'c-b1');
  expect(cB1.state).toBe('WAITING_ACTION');
  expect((await instanceRow(db, wi.id)).status).toBe('running');

  await submitUserAction(db, wi.id, { step_oid: 'c-b1', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, deps);

  // The parked WAIT ALL row must be GONE (idled+deleted), not left dangling as EXECUTING —
  // pre-fix it would survive forever and permanently block isChildComplete.
  const cWaAfter = await stepRow(db, wi.id, 'c-wa');
  expect(cWaAfter).toBeUndefined();
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['c-wa', 'IDLE', null]);

  // With c-wa cleared, every remaining row for the child is terminal and its END was already
  // reached — isChildComplete now sees the child as done, completing the parent proxy and
  // routing the WHOLE instance through to its own END.
  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  const proxy = await stepRow(db, wi.id, 'proxy');
  expect(proxy.state).toBe('COMPLETED');
  await close();
});

// ── I2a regression (post-Task-12 review, Important): ABANDON/RESTART inside a child never
// tore down an active GRANDCHILD — a WORKFLOW PROXY step (itself one of the child's own rows,
// hence swept by returnAbandon) that had spawned a grandchild left the GRANDCHILD's rows alive
// (their node_oid is a different value, excluded by the nodeOid-scoped delete) plus a dangling
// childActive entry, permanently blocking isChildComplete just like I1's stray WAIT ALL row.
// Fixed via tearDownActiveChild, called for every row a sweep processes. Shape mirrors I1: a
// mid-child's OWN END is reached via an unrelated branch, while a SEPARATE branch spawns an
// active grandchild (a parked USER_INTERACTION inside it) and a THIRD branch fails and
// ABANDONs — proving the grandchild's rows + childActive are fully cleared and the whole
// instance can still complete. ──

const I2A_REGRESSION_SPEC = {
  local_id: 'outer-wf', oid: 'wf-i2a-regression', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('start', 'p-start', 'START'),
    step('OuterRef', 'outer-proxy', 'WORKFLOW PROXY'),
    step('end', 'p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'outer-proxy' },
    { from_step_id: 'outer-proxy', to_step_id: 'p-end' },
  ],
  children: [
    {
      local_id: 'OuterRef', oid: 'mid-child-i2a', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      environment_specifications: ENV_SPECS_I1,
      steps: [
        step('m-start', 'm-start', 'START'),
        step('m-p1', 'm-p1', 'PARALLEL'),
        step('m-main', 'm-main', 'MATH'),
        step('m-end', 'm-end', 'END'),
        step('m-b1', 'm-b1', 'ACTION PROXY', {
          action_proxy_config: ACTION_CONFIG_I1,
          try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }],
        }),
        step('InnerRef', 'm-innerproxy', 'WORKFLOW PROXY'),
        step('m-c1', 'm-c1', 'CATCH', { catch_id: 'C1' }),
        step('m-r1', 'm-r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
      ],
      connections: [
        { from_step_id: 'm-start', to_step_id: 'm-p1' },
        { from_step_id: 'm-p1', to_step_id: 'm-main' },
        { from_step_id: 'm-main', to_step_id: 'm-end' },
        { from_step_id: 'm-p1', to_step_id: 'm-b1' },
        { from_step_id: 'm-p1', to_step_id: 'm-innerproxy' },
        { from_step_id: 'm-c1', to_step_id: 'm-r1' },
      ],
      children: [
        {
          local_id: 'InnerRef', oid: 'inner-child-i2a', version: '1.0.0', last_modified_date: '2026-01-01',
          parentChildSpecId: null, state: 'Effective',
          steps: [
            step('i-start', 'i-start', 'START'),
            step('i-form', 'i-form', 'USER_INTERACTION'),
            step('i-end', 'i-end', 'END'),
          ],
          connections: [
            { from_step_id: 'i-start', to_step_id: 'i-form' },
            { from_step_id: 'i-form', to_step_id: 'i-end' },
          ],
        },
      ],
    },
  ],
};

test('I2a regression: mid-child ABANDON recursively tears down an active grandchild — no orphan rows, childActive clean, instance still completable', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, I2A_REGRESSION_SPEC, 'wf-i2a-regression');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  const mEnd = await stepRow(db, wi.id, 'm-end');
  expect(mEnd.state).toBe('COMPLETED');
  const iForm = await stepRow(db, wi.id, 'i-form');
  expect(iForm.state).toBe('WAITING_USER'); // the parked grandchild
  expect(iForm.nodeOid).toBe('inner-child-i2a');
  const mInnerProxy = await stepRow(db, wi.id, 'm-innerproxy');
  expect(mInnerProxy.state).toBe('WAITING_ACTION');
  const mB1 = await stepRow(db, wi.id, 'm-b1');
  expect(mB1.state).toBe('WAITING_ACTION');
  expect((await instanceRow(db, wi.id)).status).toBe('running');

  await submitUserAction(db, wi.id, { step_oid: 'm-b1', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, deps);

  // No orphan rows: both the grandchild's own row and the mid-level proxy row are gone.
  expect(await stepRow(db, wi.id, 'i-form')).toBeUndefined();
  expect(await stepRow(db, wi.id, 'm-innerproxy')).toBeUndefined();

  const after = await instanceRow(db, wi.id);
  const state = after.engineState as { childActive?: Record<string, string> };
  expect(state.childActive ?? {}).toEqual({}); // clean — both the mid- and inner-level links dropped

  // Every remaining row for the mid-child is terminal and its END was already reached —
  // isChildComplete now sees it as done, cascading all the way to the outer instance.
  expect(after.status).toBe('completed');
  const outerProxy = await stepRow(db, wi.id, 'outer-proxy');
  expect(outerProxy.state).toBe('COMPLETED');
  await close();
});

// ── I2b regression (post-Task-12 review, Important, "PROBE6"): a mid-child RESTART must tear
// down an active grandchild too, AND the memoized-view fix (C1) must not let a stale cached
// view survive the restart — activateWorkflowProxy's "fresh child every activation" reset now
// also drops the cached view, not just the childProperties JSON blob, so a form parked in
// attempt #1 cannot satisfy attempt #2 (a stale cached PropertyStore would otherwise be handed
// straight back out, bypassing the freshly emptied JSON entirely). ──

const I2B_REGRESSION_SPEC = {
  local_id: 'outer-wf', oid: 'wf-i2b-regression', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('start', 'p-start', 'START'),
    step('OuterRef', 'outer-proxy', 'WORKFLOW PROXY'),
    step('end', 'p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'outer-proxy' },
    { from_step_id: 'outer-proxy', to_step_id: 'p-end' },
  ],
  children: [
    {
      local_id: 'OuterRef', oid: 'mid-child-i2b', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      environment_specifications: ENV_SPECS_I1,
      steps: [
        step('m-start', 'm-start', 'START'),
        step('m-p1', 'm-p1', 'PARALLEL'),
        step('m-b1', 'm-b1', 'ACTION PROXY', {
          action_proxy_config: ACTION_CONFIG_I1,
          try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }],
        }),
        step('InnerRef', 'm-innerproxy', 'WORKFLOW PROXY', {
          output_parameter_specifications: [{ id: 'answer', target: 'answer' }],
        }),
        step('m-end', 'm-end', 'END'),
        step('m-c1', 'm-c1', 'CATCH', { catch_id: 'C1' }),
        step('m-r1', 'm-r1', 'RETURN', { return_config: { command: 'RESTART', restart_mode: 'KEEP' } }),
      ],
      connections: [
        { from_step_id: 'm-start', to_step_id: 'm-p1' },
        { from_step_id: 'm-p1', to_step_id: 'm-b1' },
        { from_step_id: 'm-p1', to_step_id: 'm-innerproxy' },
        { from_step_id: 'm-innerproxy', to_step_id: 'm-end' },
        { from_step_id: 'm-c1', to_step_id: 'm-r1' },
      ],
      children: [
        {
          local_id: 'InnerRef', oid: 'inner-child-i2b', version: '1.0.0', last_modified_date: '2026-01-01',
          parentChildSpecId: null, state: 'Effective',
          output_parameter_specifications: [{ id: 'answer', target: 'answer' }],
          steps: [
            step('i-start', 'i-start', 'START'),
            step('i-form', 'i-form', 'USER_INTERACTION', {
              form_layout_config: [{
                deviceType: 'phone', canvasWidth: 390, canvasHeight: 844,
                elements: [
                  { type: 'textInput', x: 0, y: 0, width: 300, height: 40, fieldName: 'response', outputParameter: 'answer' },
                ],
              }],
              output_parameter_specifications: [{ id: 'answer', target: 'answer' }],
            }),
            step('i-end', 'i-end', 'END'),
          ],
          connections: [
            { from_step_id: 'i-start', to_step_id: 'i-form' },
            { from_step_id: 'i-form', to_step_id: 'i-end' },
          ],
        },
      ],
    },
  ],
};

test('I2b regression ("PROBE6"): mid-child RESTART tears down the grandchild\'s row and cached view — a form parked in attempt #1 does not satisfy attempt #2', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, I2B_REGRESSION_SPEC, 'wf-i2b-regression');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  const iFormAttempt1 = await stepRow(db, wi.id, 'i-form');
  expect(iFormAttempt1.state).toBe('WAITING_USER');
  const mB1 = await stepRow(db, wi.id, 'm-b1');
  expect(mB1.state).toBe('WAITING_ACTION');

  // Trigger the mid-child RESTART. Never submit attempt #1's i-form.
  await submitUserAction(db, wi.id, { step_oid: 'm-b1', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, deps);

  // Exactly one i-form row exists (attempt #2), and it is a GENUINELY NEW row — a different id
  // than attempt #1's, not the same row left lingering in WAITING_USER from before.
  const allSteps = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, wi.id));
  const iFormRows = allSteps.filter((s: any) => s.stepOid === 'i-form');
  expect(iFormRows).toHaveLength(1);
  const iFormAttempt2 = iFormRows[0];
  expect(iFormAttempt2.id).not.toBe(iFormAttempt1.id);
  expect(iFormAttempt2.state).toBe('WAITING_USER');
  expect((await instanceRow(db, wi.id)).status).toBe('running');

  // Submitting attempt #2's OWN form value must complete the grandchild and the mid-level
  // proxy correctly — if the stale cached view (pre-fix) had survived, this submit would
  // either target orphaned state or the write would be lost, exactly like C1.
  await submitUserAction(db, wi.id, { step_oid: 'i-form', action: 'submit', form_values: { response: 'attempt-2-answer' } }, 1, deps);

  const iEnd = await stepRow(db, wi.id, 'i-end');
  expect(iEnd.state).toBe('COMPLETED');
  const mInnerProxy = await stepRow(db, wi.id, 'm-innerproxy');
  expect(mInnerProxy.state).toBe('COMPLETED');
  const after = await instanceRow(db, wi.id);
  const state = after.engineState as { childProperties?: Record<string, Record<string, string>> };
  expect(state.childProperties?.['mid-child-i2b']?.['answer']).toBe('attempt-2-answer');
  await close();
});

// ── M1 regression (post-Task-12 review, Minor): a user action against the parked WORKFLOW
// PROXY row itself (not one of its child's own steps) was silently ACCEPTED and later
// double-completed it once the child finished on its own via completeChildWorkflow. Guarded
// with the same "is not EXECUTING" error the reference's own not-parked guard uses. ──

test('M1 regression: submitting directly against a WORKFLOW PROXY row parked with an active child is rejected', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, UI_CHILD_SPEC, 'wf-m1-regression');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  const proxy = await stepRow(db, wi.id, 'proxy');
  expect(proxy.state).toBe('WAITING_ACTION');

  await expect(submitUserAction(db, wi.id, { step_oid: 'proxy', action: 'submit' }, 0, deps))
    .rejects.toThrow('is not EXECUTING');

  // Untouched: still parked, still exactly one trace entry (the original EXECUTING park) — no
  // premature/duplicate COMPLETED trace from the rejected submit.
  const proxyAfter = await stepRow(db, wi.id, 'proxy');
  expect(proxyAfter.state).toBe('WAITING_ACTION');
  const trace = await traceOf(db, wi.id);
  expect(trace.filter(([oid, state]) => oid === 'proxy' && state === 'COMPLETED')).toHaveLength(0);
  await close();
});

// ── M2 regression (post-Task-12 review, Minor): resume on a PAUSED WORKFLOW PROXY restored
// WAITING_USER instead of WAITING_ACTION — only 'ACTION PROXY' was special-cased. Fixed by
// also checking childActive. ──

test('M2 regression: resuming a paused WORKFLOW PROXY row (with an active child) restores WAITING_ACTION, not WAITING_USER', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, UI_CHILD_SPEC, 'wf-m2-regression');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  const proxy = await stepRow(db, wi.id, 'proxy');
  expect(proxy.state).toBe('WAITING_ACTION');

  await submitUserAction(db, wi.id, { step_oid: 'proxy', action: 'pause' }, 0, deps);
  const paused = await stepRow(db, wi.id, 'proxy');
  expect(paused.state).toBe('PAUSED');

  await submitUserAction(db, wi.id, { step_oid: 'proxy', action: 'resume' }, 1, deps);
  const resumed = await stepRow(db, wi.id, 'proxy');
  expect(resumed.state).toBe('WAITING_ACTION'); // NOT WAITING_USER

  // The child underneath is untouched by the parent's own pause/resume cycle and can still
  // complete normally via a delegated submit to its own step.
  const cForm = await stepRow(db, wi.id, 'c-form');
  expect(cForm.state).toBe('WAITING_USER');
  await submitUserAction(db, wi.id, { step_oid: 'c-form', action: 'submit', form_values: { response: 'still-works' } }, 2, deps);
  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  await close();
});

// ── I1 (Important, Task 13 post-review, proven divergence): nested drainCascade calls must
// share ONE queue per context — the reference's `completionQueue` is a PERSISTENT INSTANCE
// FIELD on WorkflowEngine (engine.ts), not a value created fresh per `drainCompletionQueue()`
// call, so a nested re-entrant trigger (here: completeChildWorkflow's own post-completion
// routing, fired synchronously from INSIDE activateWorkflowProxy while the OUTER PARALLEL
// fan-out's own routing loop is still mid-iteration) must append to — and let the ALREADY-
// ACTIVE outer loop drain — the SAME queue, not start an isolated one.
//
// Topology: START -> PARALLEL -> {a -> a2, proxy(spawns a TRIVIAL, synchronously-completing
// child) -> x2} -> WAIT ALL -> END, with 'a' declared BEFORE 'proxy' in PARALLEL's own outgoing
// connections. Hand-derived by simulating the reference's drainCompletionQueue exactly (see
// transition.ts's drainCascade doc comment for the full derivation): PARALLEL's for-loop
// activates 'a' first (queuing it), THEN 'proxy' — whose child completes synchronously inline,
// triggering completeChildWorkflow's re-entrant drain on the SAME shared queue, which finds 'a'
// STILL sitting there and dequeues it FIRST (FIFO) — completing a2 BEFORE proxy's own routing to
// x2 ever runs. By the time a2 arrives at 'wa', x2 is ALREADY complete (proxy->x2 resolved
// immediately after, within that SAME re-entrant drain), so 'wa' is satisfied on FIRST touch —
// no EXECUTING park. Pre-fix (isolated per-call queues), the nested completeChildWorkflow drain
// never saw 'a' waiting its turn, so it processed ONLY proxy->x2 in isolation — x2 arrived at
// 'wa' first (not yet satisfied, since a2 hadn't run), producing an EXTRA wa:EXECUTING entry and
// reversing a2/x2's relative order once the OUTER loop finally got around to 'a'.
const I1_SHARED_QUEUE_SPEC = {
  local_id: 'wf', oid: 'wf-i1-shared-queue', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('start', 's1', 'START'),
    step('p1', 'p1', 'PARALLEL'),
    step('a', 'a', 'MATH'),
    step('a2', 'a2', 'MATH'),
    step('ChildRef', 'proxy', 'WORKFLOW PROXY'),
    step('x2', 'x2', 'MATH'),
    step('wa', 'wa', 'WAIT ALL'),
    step('end', 'e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'a' },
    { from_step_id: 'p1', to_step_id: 'proxy' },
    { from_step_id: 'a', to_step_id: 'a2' },
    { from_step_id: 'a2', to_step_id: 'wa' },
    { from_step_id: 'proxy', to_step_id: 'x2' },
    { from_step_id: 'x2', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
  children: [
    {
      local_id: 'ChildRef', oid: 'child-i1-shared-queue', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      steps: [
        step('c-start', 'c-start', 'START'),
        step('c-end', 'c-end', 'END'),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-end' },
      ],
    },
  ],
};

test('I1 regression: nested drainCascade calls share one queue per context — PARALLEL siblings interleave with a synchronously-completing child exactly like the reference (9-entry root trace, no extra wa:EXECUTING)', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, I1_SHARED_QUEUE_SPEC, 'wf-i1-shared-queue');
  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');

  const rows = await traceRows(db, wi.id);
  const rootTrace = rows
    .filter((r: any) => ['s1', 'p1', 'a', 'a2', 'proxy', 'x2', 'wa', 'e1'].includes(r.stepOid))
    .map((r: any) => [r.stepOid, r.state]);
  expect(rootTrace).toEqual([
    ['s1', 'COMPLETED'],
    ['p1', 'COMPLETED'],
    ['a', 'COMPLETED'],
    ['proxy', 'EXECUTING'],
    ['proxy', 'COMPLETED'],
    ['a2', 'COMPLETED'],
    ['x2', 'COMPLETED'],
    ['wa', 'COMPLETED'], // NOT EXECUTING — satisfied on first touch (the pre-fix bug emitted an extra EXECUTING here)
    ['e1', 'COMPLETED'],
  ]);

  const childTrace = rows.filter((r: any) => ['c-start', 'c-end'].includes(r.stepOid)).map((r: any) => [r.stepOid, r.state]);
  expect(childTrace).toEqual([['c-start', 'COMPLETED'], ['c-end', 'COMPLETED']]);

  await close();
});

// ── F2 (flagged in Task 13's own report, confirmed by review): per-context orderCounters (and
// every OTHER per-child-step-scoped EngineState map) must reset when a WORKFLOW PROXY
// re-activates its child — the reference builds a genuinely FRESH WorkflowEngine per activation
// (`traceOrder = 0` in its own constructor), so a RESTART re-firing the SAME proxy step must see
// the child's trace order restart at 1, not continue counting up from the FIRST attempt. ──
const F2_RESTART_CHILD_SPEC = {
  local_id: 'wf', oid: 'wf-f2-restart-child', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [{
    local_id: 'env', oid: 'env-f2', version: '1.0.0', last_modified_date: '2026-01-01',
    included_actions: [{ action_oid: 'act-f2', action_name: 'DoThing', action_library: 'lib-1' }],
  }],
  steps: [
    step('start', 'p-start', 'START'),
    step('p1', 'p1', 'PARALLEL'),
    step('trigger', 'trigger', 'ACTION PROXY', {
      action_proxy_config: { action_oid: 'act-f2', environment_oid: 'env-f2' },
      try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }],
    }),
    step('ChildRef', 'proxy', 'WORKFLOW PROXY'),
    step('wa', 'wa', 'WAIT ALL'),
    step('end', 'p-end', 'END'),
    step('c1', 'c1', 'CATCH', { catch_id: 'C1' }),
    step('r1', 'r1', 'RETURN', { return_config: { command: 'RESTART', restart_mode: 'KEEP' } }),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'p1' },
    // 'trigger' and 'proxy' are PARALLEL siblings (not sequential) so proxy's child can run to
    // completion WHILE trigger is still parked, unresolved — exactly what lets attempt #1's
    // child order 1..4 be observed before anything triggers the RESTART.
    { from_step_id: 'p1', to_step_id: 'trigger' },
    { from_step_id: 'p1', to_step_id: 'proxy' },
    { from_step_id: 'trigger', to_step_id: 'wa' },
    { from_step_id: 'proxy', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'p-end' },
    { from_step_id: 'c1', to_step_id: 'r1' },
  ],
  children: [
    {
      local_id: 'ChildRef', oid: 'child-f2-restart', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      steps: [
        step('c-start', 'c-start', 'START'),
        step('c-m1', 'c-m1', 'MATH'),
        step('c-m2', 'c-m2', 'MATH'),
        step('c-end', 'c-end', 'END'),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-m1' },
        { from_step_id: 'c-m1', to_step_id: 'c-m2' },
        { from_step_id: 'c-m2', to_step_id: 'c-end' },
      ],
    },
  ],
};

test('F2 regression: RESTART re-activating a WORKFLOW PROXY resets the child\'s per-context trace order back to 1 (and its per-step EngineState maps), matching the reference\'s fresh-engine-per-activation semantics', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, F2_RESTART_CHILD_SPEC, 'wf-f2-restart-child');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  // Attempt #1: proxy activates its child, which runs to completion (c-start/c-m1/c-m2/c-end,
  // order 1..4), then the parent completes normally — but 'trigger' hasn't fired yet, so the
  // instance is still running with the RESTART machinery armed-and-ready via the try/catch on
  // 'trigger'. Confirm attempt #1's child trace really did land at order 1..4 before triggering
  // the restart, so the regression (order continuing from 5 on attempt #2) is unambiguous.
  const rowsAfterAttempt1 = await traceRows(db, wi.id);
  const childTrace1 = rowsAfterAttempt1
    .filter((r: any) => ['c-start', 'c-m1', 'c-m2', 'c-end'].includes(r.stepOid))
    .map((r: any) => [r.stepOid, r.orderIndex]);
  expect(childTrace1).toEqual([['c-start', 1], ['c-m1', 2], ['c-m2', 3], ['c-end', 4]]);
  const proxyAfterAttempt1 = await stepRow(db, wi.id, 'proxy');
  expect(proxyAfterAttempt1.state).toBe('COMPLETED');
  const triggerAfterAttempt1 = await stepRow(db, wi.id, 'trigger');
  expect(triggerAfterAttempt1.state).toBe('WAITING_ACTION');

  // Fail 'trigger' -> catch -> RESTART: re-fires START, re-activating 'proxy' with a FRESH
  // child (same static childSpec.oid, since context.spec.children never changes mid-instance).
  // The instance stays 'running' afterward — RESTART re-parks a fresh 'trigger' too (nothing
  // resolves it a second time here), which is irrelevant to F2's own concern (the child's order
  // counter) — proxy's child still runs to completion on its own, independent of trigger.
  await submitUserAction(db, wi.id, { step_oid: 'trigger', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, deps);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('running');
  const proxyAfterAttempt2 = await stepRow(db, wi.id, 'proxy');
  expect(proxyAfterAttempt2.state).toBe('COMPLETED'); // attempt #2's proxy also ran its child to completion
  expect(proxyAfterAttempt2.id).not.toBe(proxyAfterAttempt1.id); // a genuinely NEW row, not the torn-down attempt #1 one

  const rowsAfterAttempt2 = await traceRows(db, wi.id);
  const childTrace2 = rowsAfterAttempt2
    .filter((r: any) => ['c-start', 'c-m1', 'c-m2', 'c-end'].includes(r.stepOid))
    .map((r: any) => [r.stepOid, r.state, r.orderIndex]);
  // Exactly 8 child-step trace rows total (4 from attempt #1, 4 from attempt #2) — trace is
  // append-only, so attempt #1's rows are still there — but attempt #2's OWN four entries must
  // restart the counter at 1, NOT continue from 5.
  expect(childTrace2).toHaveLength(8);
  const attempt2Entries = childTrace2.slice(4);
  expect(attempt2Entries).toEqual([
    ['c-start', 'COMPLETED', 1], ['c-m1', 'COMPLETED', 2], ['c-m2', 'COMPLETED', 3], ['c-end', 'COMPLETED', 4],
  ]);

  await close();
});

// ── child-declared resources register at proxy activation (2026-08-11 RW-8 bug) ──
//
// The reference's child WorkflowEngine registers ITS OWN resource_property_specifications
// into the SHARED parent manager when it starts (engine.ts:149-156; the manager arrives via
// the ctor setup at 703-706). The port has no per-child engine and never transcribed that
// registration, so the first child step acquiring a child-declared resource threw
// `Resource "<childOid>:<name>" is not registered` out of the activation cascade — 500ing
// the submit that triggered it (RW-8's "display Loop Counters" step).
const CHILD_RESOURCE_SPEC = {
  local_id: 'parent-res', oid: 'wf-child-res', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('start', 'p-start', 'START'),
    step('ChildRes', 'proxy-res', 'WORKFLOW PROXY', {}),
    step('end', 'p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'proxy-res' },
    { from_step_id: 'proxy-res', to_step_id: 'p-end' },
  ],
  children: [
    {
      local_id: 'ChildRes', oid: 'child-res', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      resource_property_specifications: [{ name: 'LibrarySingleUse', resource_type: 'binary exclusive use' }],
      steps: [
        step('c-start', 'cr-start', 'START'),
        step('c-ui', 'cr-ui', 'USER_INTERACTION', {
          resource_command_specifications: [
            { command_type: 'Acquire', resource_name: 'LibrarySingleUse', resource_source_type: 'workflow', resource_source_oid: 'child-res' },
          ],
        }),
        step('c-end', 'cr-end', 'END'),
      ],
      connections: [
        { from_step_id: 'cr-start', to_step_id: 'cr-ui' },
        { from_step_id: 'cr-ui', to_step_id: 'cr-end' },
      ],
    },
  ],
};

test('a child-declared resource registers at proxy activation: the child acquire is granted instead of erroring the instance', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, CHILD_RESOURCE_SPEC, 'wf-child-res');
  await pumpUntilQuiet(db, testDeps());

  // Without registration, the activation cascade throws and recovery settles the instance
  // errored; with it, the acquire is granted and the child's UI step parks WAITING_USER.
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  expect((await stepRow(db, wi.id, 'cr-ui'))?.state).toBe('WAITING_USER');

  await submitUserAction(db, wi.id, { step_oid: 'cr-ui', action: 'button_press', button_output: 'done', form_values: {} }, 'auto', testDeps());
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  await close();
});

// ── a child that finishes inside the parent's activation cascade, then a parking parent step ──
//
// START -> proxy (child START -> END, nothing parks) -> ask (USER_INTERACTION) -> END. The child
// completes during proxy activation; the parent then routes on to `ask`, which waits for an
// operator. The instance must stay running until `ask` is submitted.

const INSTANT_CHILD_THEN_FORM_SPEC = {
  local_id: 'parent-wf', oid: 'wf-instant-child-form', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('start', 'p-start', 'START'),
    step('Kid', 'proxy', 'WORKFLOW PROXY'),
    step('ask', 'ask', 'USER_INTERACTION'),
    step('end', 'p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'proxy' },
    { from_step_id: 'proxy', to_step_id: 'ask' },
    { from_step_id: 'ask', to_step_id: 'p-end' },
  ],
  children: [{
    local_id: 'Kid', oid: 'child-instant', version: '1.0.0', last_modified_date: '2026-01-01',
    parentChildSpecId: null, state: 'Effective',
    steps: [step('c-start', 'c-start', 'START'), step('c-end', 'c-end', 'END')],
    connections: [{ from_step_id: 'c-start', to_step_id: 'c-end' }],
  }],
};

test('a child that completes during proxy activation does not settle the instance while the next parent step waits for an operator', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const wi = await seedQueued(db, INSTANT_CHILD_THEN_FORM_SPEC, 'wf-instant-child-form');
  await pumpUntilQuiet(db, deps);

  expect((await stepRow(db, wi.id, 'proxy')).state).toBe('COMPLETED');
  expect((await stepRow(db, wi.id, 'ask')).state).toBe('WAITING_USER');
  expect((await instanceRow(db, wi.id)).status).toBe('running');

  await submitUserAction(db, wi.id, { step_oid: 'ask', action: 'submit' }, 0, deps);
  expect((await stepRow(db, wi.id, 'p-end')).state).toBe('COMPLETED');
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  await close();
});
