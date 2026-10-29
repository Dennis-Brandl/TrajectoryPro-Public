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
// Task 3 (Phase 2b): wires the work-center-shared value-property tier (Task 1's DAO + Task 2's
// SharedPropertyTier/PropertyStore) into the engine's context lifecycle via the new openContext
// factory. Harness reused from linear-flow.test.ts: makeTestDb + pumpUntilQuiet + testDeps.
import { expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { settleFailedInstance } from '../src/loop.js';
import {
  workCenter, workflow, workflowInstance, runtimeHistory, wcValueProperty,
} from 'mission-control-db/src/db/schema/index';
import * as wcValueProps from 'mission-control-db/src/runtime/wc-value-properties';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

function step(oid: string, step_type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra };
}

async function makeWc(db: AnyDb): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  return wc;
}

async function seedShared(
  db: AnyDb, workCenterId: string, rows: Array<{ propertyName: string; entryName: string; value: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(wcValueProperty).values(rows.map((r) => ({ workCenterId, ...r })));
}

async function seedQueuedInWc(db: AnyDb, wc: { id: string }, spec: unknown, oid: string, runtimeNumber = 1): Promise<{ id: string }> {
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return wi;
}

type StepSnapshots = Record<string, { inputParameters?: Record<string, string> }>;

// ── Test 1: a workflow reads an environment value it never declared ──────────────────────────

const READ_SHARED_SPEC = {
  local_id: 'wf', oid: 'wf-read-shared', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'),
    step('s2', 'MATH', {
      input_parameter_specifications: [{ id: 'target', default_value: 'Recipe.Target', value_type: 'property' }],
    }),
    step('s3', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 's3' },
  ],
};

test('a workflow reads a shared value-property it never declared — sees the real value, not the empty string', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await seedShared(db, wc.id, [{ propertyName: 'Recipe', entryName: 'Target', value: '80' }]);
  const wi = await seedQueuedInWc(db, wc, READ_SHARED_SPEC, 'wf-read-shared');

  await pumpUntilQuiet(db, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  const state = after.engineState as { stepSnapshots?: StepSnapshots };
  // Before this phase, an undeclared property always resolved to '' — this is the defect closed.
  expect(state.stepSnapshots?.s2?.inputParameters?.target).toBe('80');

  await close();
});

// ── Test 2: a write from one instance is visible to a second instance opened afterward ───────

const WRITE_SHARED_SPEC = {
  local_id: 'wf', oid: 'wf-write-shared', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'),
    step('s2', 'SCRIPT', {
      script_config: { source: "output.val = '200';" },
      output_parameter_specifications: [{ id: 'val', target: 'Recipe.Target' }],
    }),
    step('s3', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 's3' },
  ],
};

test('a write from one instance is visible to a second instance opened afterward, in the same work center', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await seedShared(db, wc.id, [{ propertyName: 'Recipe', entryName: 'Target', value: '1' }]);

  const writer = await seedQueuedInWc(db, wc, WRITE_SHARED_SPEC, 'wf-write-shared');
  await pumpUntilQuiet(db, testDeps());
  const [writerAfter] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, writer.id));
  expect(writerAfter.status).toBe('completed');

  // Confirm it actually reached the registry row, not just the writer's own in-memory tier.
  const [row] = await db.select().from(wcValueProperty).where(eq(wcValueProperty.workCenterId, wc.id));
  expect(row.value).toBe('200');

  const reader = await seedQueuedInWc(db, wc, READ_SHARED_SPEC, 'wf-read-shared-2', 2);
  await pumpUntilQuiet(db, testDeps());
  const [readerAfter] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, reader.id));
  expect(readerAfter.status).toBe('completed');
  const state = readerAfter.engineState as { stepSnapshots?: StepSnapshots };
  expect(state.stepSnapshots?.s2?.inputParameters?.target).toBe('200');

  await close();
});

// ── Test 3: the shared value is NOT copied into workflow_instance.property_store (Trap-1) ────

test('the shared value is NOT copied into workflow_instance.property_store', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await seedShared(db, wc.id, [{ propertyName: 'Recipe', entryName: 'Target', value: '80' }]);
  const wi = await seedQueuedInWc(db, wc, READ_SHARED_SPEC, 'wf-read-shared-3');

  await pumpUntilQuiet(db, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  const propertyStore = after.propertyStore as Record<string, string>;
  expect(propertyStore['Recipe.Target']).toBeUndefined();
  expect(Object.keys(propertyStore ?? {})).not.toContain('Recipe.Target');

  await close();
});

// ── Test 4: a child workflow shares the tier with its parent, in the same transition ─────────

const CHILD_SHARED_WRITE_SPEC = {
  local_id: 'parent-wf', oid: 'wf-child-shares-tier', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('p-start', 'START'),
    { local_id: 'ChildRef', oid: 'proxy', step_type: 'WORKFLOW PROXY', version: '1.0.0', last_modified_date: '2026-01-01' },
    step('p-read', 'MATH', {
      input_parameter_specifications: [{ id: 'sharedVal', default_value: 'Recipe.Target', value_type: 'property' }],
    }),
    step('p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'proxy' },
    { from_step_id: 'proxy', to_step_id: 'p-read' },
    { from_step_id: 'p-read', to_step_id: 'p-end' },
  ],
  children: [
    {
      local_id: 'ChildRef', oid: 'child-shares-tier', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      steps: [
        step('c-start', 'START'),
        step('c-script', 'SCRIPT', {
          script_config: { source: "output.val = '80';" },
          output_parameter_specifications: [{ id: 'val', target: 'Recipe.Target' }],
        }),
        step('c-end', 'END'),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-script' },
        { from_step_id: 'c-script', to_step_id: 'c-end' },
      ],
    },
  ],
};

test('a child workflow writes a shared value; the parent reads it back in the same transition', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await seedShared(db, wc.id, [{ propertyName: 'Recipe', entryName: 'Target', value: '1' }]);
  const wi = await seedQueuedInWc(db, wc, CHILD_SHARED_WRITE_SPEC, 'wf-child-shares-tier');

  await pumpUntilQuiet(db, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  const state = after.engineState as { stepSnapshots?: StepSnapshots };
  // p-read activates AFTER the child (proxy) has already run and written Recipe.Target — both
  // the child's view and the parent's root context attach the SAME SharedPropertyTier instance
  // by reference, so the write is visible immediately, within the one open transaction.
  expect(state.stepSnapshots?.['p-read']?.inputParameters?.sharedVal).toBe('80');

  await close();
});

// ── Test 5: RESTART CLEAN resets local values only; a shared write survives ──────────────────

const RESTART_CLEAN_SPEC = {
  local_id: 'wf', oid: 'wf-restart-clean', version: '1.0.0', last_modified_date: '2026-01-01',
  value_property_specifications: [{ name: 'Local', entries: [{ name: 'Count', value: '0' }] }],
  steps: [
    step('s1', 'START'),
    step('sel', 'SELECT 1', {
      select1_config: {
        input_name: 'Cycle.Phase',
        input_value_type: 'property',
        options: [
          { id: 'to-script', label: 'First pass', operator: '==', value: 'first', value_type: 'literal', is_default: false },
          { id: 'to-end', label: 'Done', operator: '==', value: '', value_type: 'literal', is_default: true },
        ],
      },
    }),
    step('script1', 'SCRIPT', {
      script_config: { source: "output.count = '5'; output.phase = 'second'; output.target = '99';" },
      output_parameter_specifications: [
        { id: 'count', target: 'Local.Count' },
        { id: 'phase', target: 'Cycle.Phase' },
        { id: 'target', target: 'Recipe.Target' },
      ],
    }),
    step('r1', 'RETURN', { return_config: { command: 'RESTART', restart_mode: 'CLEAN' } }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'sel' },
    { from_step_id: 'sel', to_step_id: 'script1', connection_id: 'to-script' },
    { from_step_id: 'sel', to_step_id: 'e1', connection_id: 'to-end' },
    { from_step_id: 'script1', to_step_id: 'r1' },
  ],
};

test('RESTART CLEAN resets a workflow-declared local property to its spec default, but a shared value the instance wrote survives', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  // 'Cycle.Phase' doubles as the loop-breaker: pass 1 flips it 'first' -> 'second' in the
  // SHARED tier (which RESTART CLEAN must NOT touch), so pass 2 takes the 'to-end' branch
  // instead of restarting forever.
  await seedShared(db, wc.id, [
    { propertyName: 'Cycle', entryName: 'Phase', value: 'first' },
    { propertyName: 'Recipe', entryName: 'Target', value: '0' },
  ]);
  const wi = await seedQueuedInWc(db, wc, RESTART_CLEAN_SPEC, 'wf-restart-clean');

  await pumpUntilQuiet(db, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  // Local.Count was dirtied to '5' by script1's first pass, then reset to its spec default '0'
  // by RESTART CLEAN's re-seed — pass 2 never runs script1 again, so '0' is the final value.
  const propertyStore = after.propertyStore as Record<string, string>;
  expect(propertyStore['Local.Count']).toBe('0');

  // The shared writes from pass 1 (Cycle.Phase, Recipe.Target) are untouched by the CLEAN
  // reset — both flushed to the registry once the instance finally settles.
  const sharedRows = await db.select().from(wcValueProperty).where(eq(wcValueProperty.workCenterId, wc.id));
  const byKey = Object.fromEntries(sharedRows.map((r: { propertyName: string; entryName: string; value: string }) => [`${r.propertyName}.${r.entryName}`, r.value]));
  expect(byKey['Cycle.Phase']).toBe('second');
  expect(byKey['Recipe.Target']).toBe('99');

  await close();
});

// ── Test 6: terminal history records the merged view (local + shared) ────────────────────────

const HISTORY_SPEC = {
  local_id: 'wf', oid: 'wf-history-shared', version: '1.0.0', last_modified_date: '2026-01-01',
  value_property_specifications: [{ name: 'Local', entries: [{ name: 'Count', value: '7' }] }],
  steps: [step('s1', 'START'), step('s2', 'MATH'), step('s3', 'END')],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 's3' },
  ],
};

test('terminal history records the merged view — both a local and a shared key', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await seedShared(db, wc.id, [{ propertyName: 'Recipe', entryName: 'Target', value: '80' }]);
  const wi = await seedQueuedInWc(db, wc, HISTORY_SPEC, 'wf-history-shared');

  await pumpUntilQuiet(db, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  // property_store itself stays local-only (Trap-1) ...
  expect((after.propertyStore as Record<string, string>)['Recipe.Target']).toBeUndefined();

  // ... but runtime_history's snapshot is the MERGED view: local AND shared together.
  const [history] = await db.select().from(runtimeHistory).where(eq(runtimeHistory.workflowInstanceId, wi.id));
  expect(history).toBeTruthy();
  const properties = history.properties as Record<string, string>;
  expect(properties['Local.Count']).toBe('7');
  expect(properties['Recipe.Target']).toBe('80');

  await close();
});

// ── Test 7: zero shared rows behaves exactly as before ────────────────────────────────────────

const GHOST_SPEC = {
  local_id: 'wf', oid: 'wf-empty-wc', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'),
    step('s2', 'MATH', {
      input_parameter_specifications: [{ id: 'ghost', default_value: 'Ghost.Value', value_type: 'property' }],
    }),
    step('s3', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 's3' },
  ],
};

test('an instance in a work center with zero shared rows behaves exactly as before — no tier attached', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db); // no wc_value_property rows seeded
  const wi = await seedQueuedInWc(db, wc, GHOST_SPEC, 'wf-empty-wc');

  const spy = vi.spyOn(wcValueProps, 'loadSharedValueProperties');
  await pumpUntilQuiet(db, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  const state = after.engineState as { stepSnapshots?: StepSnapshots };
  // An undeclared, unshared key still resolves to '' — exactly as before this phase.
  expect(state.stepSnapshots?.s2?.inputParameters?.ghost).toBe('');

  // Loaded exactly once (root construction at instance start) and came back empty — an empty
  // work center costs one cheap SELECT and attaches nothing, never a growing number of queries.
  expect(spy).toHaveBeenCalledTimes(1);
  await expect(spy.mock.results[0]!.value).resolves.toEqual([]);
  spy.mockRestore();

  await close();
});

// ── Test 8 (review fix): the TENTH root construction site — settleFailedInstance's C2 lock- ──
// starvation recovery path (loop.ts) — also carries shared values into terminal history. This
// site settles an instance that never got a chance to call openContext itself (a transition
// threw mid-flight and rolled back); settleFailedInstance is the one that constructs a FRESH
// context to record the failure and settle terminal, so IT must go through openContext or the
// resulting runtime_history row silently loses every shared value. Drives the exact path
// loop.ts uses: seed a 'running' instance (as if a transition had already been under way and
// then rolled back — the scenario recoverFailedControlPass's own doc comment describes), then
// call settleFailedInstance directly, exactly like linear-flow.test.ts's own coverage of it.

test('settleFailedInstance (the tenth root construction site) carries shared values into runtime_history, not just local ones', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await seedShared(db, wc.id, [{ propertyName: 'Recipe', entryName: 'Target', value: '80' }]);

  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid: 'wf-settle-failed', name: 'wf-settle-failed', version: '1.0.0',
    state: 'Approved', specJsonb: HISTORY_SPEC,
  }).returning();
  // A 'running' row with an already-persisted LOCAL property, as if a transition had gotten
  // partway through before throwing and rolling back — settleFailedInstance's own scenario
  // (loop.ts: "a transition threw mid-way through processReadyStep, so its transaction rolled
  // back"). No step_instance rows needed — settleFailedInstance's own UPDATE on non-terminal
  // step rows is a no-op when there are none.
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running',
    startedAt: new Date(), specJsonb: HISTORY_SPEC, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: 'wf-settle-failed', masterOid: 'wf-settle-failed', masterVersion: '1.0.0',
    masterState: 'Approved', propertyStore: { 'Local.Count': '7' },
  }).returning();

  await settleFailedInstance(db, wi.id, new Error('injected C2 recovery for shared-tier regression test'), testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('errored');
  expect(after.finalState).toBe('errored');

  const [history] = await db.select().from(runtimeHistory).where(eq(runtimeHistory.workflowInstanceId, wi.id));
  expect(history).toBeTruthy();
  const properties = history.properties as Record<string, string>;
  expect(properties['Local.Count']).toBe('7');
  // This is the assertion that was FALSE before loop.ts:185 was converted to openContext: with
  // sharedProps never attached, toHistoryJSON() degraded to toJSON()'s local-only output and
  // this key was silently absent.
  expect(properties['Recipe.Target']).toBe('80');

  await close();
});

// ── Test 9 (I1 fix): the child-seeding route — a parent's PRIVATE local declaration must never ─
// leak into the shared tier through a child that inherits it via initializeFromSetup. Concrete
// route from the review: the registry ALSO holds Recipe.Target; the parent declares its OWN
// private Recipe.Target ('5'); it activates a child via WORKFLOW PROXY, which seeds the child's
// LOCAL store from the parent's flat map (transition.ts's activateWorkflowProxy,
// `childCtx.props.initializeFromSetup(context.props.toFlatMap())`) — bypassing declaredLocally
// entirely; the child's OWN spec declares nothing, so its declaredLocally is empty. Pre-fix,
// PropertyStore.set() routed the child's write to the SHARED tier (declaredLocally doesn't cover
// it, and the registry DOES hold an exact "Recipe.Target" pair) even though the value the child
// is overwriting came from the parent's PRIVATE declaration, not from the registry — the write
// would both lose its own read-back (get() prefers local, which still held the parent's stale
// '5') and overwrite the registry's row for every other workflow in the work center.

const CHILD_SEEDED_FROM_PRIVATE_PARENT_SPEC = {
  local_id: 'parent-wf', oid: 'wf-child-seeding-private', version: '1.0.0', last_modified_date: '2026-01-01',
  // The parent's OWN private declaration of Recipe — same name as the registry's property, but
  // a completely different value, and never meant to be shared.
  value_property_specifications: [{ name: 'Recipe', entries: [{ name: 'Target', value: '5' }] }],
  steps: [
    step('p-start', 'START'),
    { local_id: 'ChildRef', oid: 'proxy', step_type: 'WORKFLOW PROXY', version: '1.0.0', last_modified_date: '2026-01-01' },
    step('p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'proxy' },
    { from_step_id: 'proxy', to_step_id: 'p-end' },
  ],
  children: [
    {
      local_id: 'ChildRef', oid: 'child-seeding-private', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      // Declares NOTHING of its own — declaredLocally is empty for this child, exactly the gap
      // I1 closes.
      steps: [
        step('c-start', 'START'),
        step('c-write', 'SCRIPT', {
          script_config: { source: "output.val = '9';" },
          output_parameter_specifications: [{ id: 'val', target: 'Recipe.Target' }],
        }),
        step('c-read', 'MATH', {
          input_parameter_specifications: [{ id: 'echo', default_value: 'Recipe.Target', value_type: 'property' }],
        }),
        step('c-end', 'END'),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-write' },
        { from_step_id: 'c-write', to_step_id: 'c-read' },
        { from_step_id: 'c-read', to_step_id: 'c-end' },
      ],
    },
  ],
};

test('I1 fix: a child seeded from a parent private local declaration writes locally, reads its own value back, and never touches the registry row', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  // The registry ALSO holds an exact "Recipe.Target" pair — the condition PropertyStore.set()
  // checks for shared routing — with a DIFFERENT value than the parent's private declaration, so
  // any leak between the two is unambiguous in the assertions below.
  await seedShared(db, wc.id, [{ propertyName: 'Recipe', entryName: 'Target', value: '1' }]);
  const wi = await seedQueuedInWc(db, wc, CHILD_SEEDED_FROM_PRIVATE_PARENT_SPEC, 'wf-child-seeding-private');

  await pumpUntilQuiet(db, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  const state = after.engineState as { stepSnapshots?: StepSnapshots };
  // (a) the child reads back its OWN write ('9'), not the registry's value and not the parent's
  // original seed ('5').
  expect(state.stepSnapshots?.['c-read']?.inputParameters?.echo).toBe('9');

  // (b) the registry row for the work center is UNCHANGED — the child's write never left its own
  // local store, so no other workflow in the work center ever sees it.
  const [row] = await db.select().from(wcValueProperty).where(eq(wcValueProperty.workCenterId, wc.id));
  expect(row.value).toBe('1');

  // Bonus: the parent's own private declaration is untouched too — the child's write landed in
  // the CHILD's local store (state.childProperties), never clobbering the parent's own.
  const propertyStore = after.propertyStore as Record<string, string>;
  expect(propertyStore['Recipe.Target']).toBe('5');

  await close();
});
