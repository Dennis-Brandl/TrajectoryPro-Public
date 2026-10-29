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
// Task 17: terminal history persistence — settleTerminal (core/context.ts) now writes a
// matching `runtime_history` row in the SAME transaction as every terminal settle. These tests
// exercise it end-to-end (through the real engine, not by calling writeRuntimeHistory directly)
// so the assembled snapshot's provenance/trace/properties/stepParams all come from a genuine
// pumped instance.
import { expect, test } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import {
  workCenter, workflow, workflowInstance, traceEntry, runtimeHistory, appUser,
} from 'mission-control-db/src/db/schema/index';
import { requestAbort } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { submitUserAction } from '../src/core/submit.js';
import { runControlPass } from '../src/core/control.js';
import { openContext, settleTerminal } from '../src/core/context.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

const FIXED = new Date('2026-01-01T00:00:00.000Z');

async function seedQueued(
  db: any, spec: unknown, oid: string, runtimeLabel = 'RW-1',
): Promise<{ id: string; workCenterId: string; workCenterName: string }> {
  const wcName = `wc-${oid}-${Math.random()}`;
  const [wc] = await db.insert(workCenter).values({ name: wcName, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id, workCenterName: wc.name };
}

async function instanceRow(db: any, instanceId: string): Promise<any> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

async function historyRowFor(db: any, instanceId: string): Promise<any> {
  const [row] = await db.select().from(runtimeHistory).where(eq(runtimeHistory.workflowInstanceId, instanceId));
  return row;
}

async function rawTrace(db: any, instanceId: string): Promise<Array<[string | null, string]>> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(asc(traceEntry.id));
  return rows.map((r: any) => [r.stepOid, r.state]);
}

// ── full-snapshot test: a 3-step linear flow, exact trace/properties/stepParams/provenance ──

const HIST_SPEC = {
  local_id: 'wf', oid: 'wf-hist-1', version: '1.0.0', last_modified_date: '2026-01-01',
  value_property_specifications: [{ name: 'Greeting', entries: [{ name: 'Text', value: 'hi' }] }],
  steps: [
    step('start', 'START'),
    step('calc', 'SCRIPT', {
      script_config: { source: "output.Sum = Text + '!';" },
      input_parameter_specifications: [{ id: 'Text', default_value: 'Greeting.Text', value_type: 'property' }],
      output_parameter_specifications: [{ id: 'Sum', target: 'Result.Sum' }],
    }),
    step('end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'calc' },
    { from_step_id: 'calc', to_step_id: 'end' },
  ],
};

test('completed instance: history row with full exact trace, properties, stepParams, and provenance', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, HIST_SPEC, 'wf-hist-1');

  const deps = testDeps({ now: () => FIXED });
  await pumpUntilQuiet(db, deps);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');

  const history = await historyRowFor(db, wi.id);
  expect(history).toBeDefined();

  // Exact trace — 3 entries, epoch-ms timestamps, no optional fields present at all (not just
  // undefined) since none of these entries carry after_action/error.
  expect(history.trace).toEqual([
    { step_oid: 'start', state: 'COMPLETED', order: 1, timestamp: FIXED.getTime() },
    { step_oid: 'calc', state: 'COMPLETED', order: 2, timestamp: FIXED.getTime() },
    { step_oid: 'end', state: 'COMPLETED', order: 3, timestamp: FIXED.getTime() },
  ]);
  expect(history.trace[0]).not.toHaveProperty('after_action');
  expect(history.trace[0]).not.toHaveProperty('error');

  // Properties/stepParams: passed through VERBATIM from the live context — cross-checked
  // against the instance row's own (still-present; nothing has swept it) engine_state/
  // property_store, which is the strongest possible proof of "passed through unmodified".
  expect(history.properties).toEqual(after.propertyStore);
  expect(history.properties).toEqual({ 'Greeting.Text': 'hi', 'Result.Sum': 'hi!' });
  expect(history.stepParams).toEqual((after.engineState as any).stepSnapshots);
  expect(history.stepParams.calc).toEqual({
    inputParameters: { Text: 'hi' },
    outputParameters: { Sum: 'hi!' },
  });

  // Provenance + timing.
  expect(history.workflowInstanceId).toBe(wi.id);
  expect(history.workCenterId).toBe(wi.workCenterId);
  expect(history.workCenterName).toBe(wi.workCenterName);
  expect(history.runtimeNumber).toBe(1);
  expect(history.masterName).toBe('wf-hist-1');
  expect(history.masterOid).toBe('wf-hist-1');
  expect(history.masterVersion).toBe('1.0.0');
  expect(history.masterState).toBe('Approved');
  expect(history.finalState).toBe('completed');
  // startedAt is NOT the fake engine clock — acquireQueuedRuntimeWorkflows (mission-control-db)
  // stamps it via SQL's own `now()` as part of its atomic UPDATE...RETURNING claim, deliberately
  // real-wall-clock (a pre-existing, Task-1-era contract this task doesn't touch) — cross-check
  // against the instance row's own value instead of the fixed fake clock.
  expect(history.startedAt).toEqual(after.startedAt);
  expect(history.finishedAt).toEqual(FIXED);

  await close();
});

// ── runtime_label freezing (spec 2026-10-07 §4.1) ──

test('freezes runtime_label into runtime_history (spec 2026-10-07 §4.1)', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, HIST_SPEC, 'wf-hist-label', 'MIX-20261007-001');

  const deps = testDeps({ now: () => FIXED });
  await pumpUntilQuiet(db, deps);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  // The frozen copy on the instance row itself is untouched by settlement.
  expect(after.runtimeLabel).toBe('MIX-20261007-001');

  const history = await historyRowFor(db, wi.id);
  expect(history).toBeDefined();
  expect(history.runtimeLabel).toBe('MIX-20261007-001');

  await close();
});

// ── idempotency: settling twice writes exactly one row ──

test('settling an already-terminal instance a second time writes no additional history row', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, HIST_SPEC, 'wf-hist-idem');
  const deps = testDeps({ now: () => FIXED });
  await pumpUntilQuiet(db, deps);

  const before = await db.select().from(runtimeHistory).where(eq(runtimeHistory.workflowInstanceId, wi.id));
  expect(before).toHaveLength(1);

  // A second, redundant settle attempt against the now-completed row (simulating a stray/racing
  // caller) — settleTerminal's guard (status must still equal `from`) must make this a no-op.
  await db.transaction(async (tx: any) => {
    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
    // M1 fix (post-Phase-2b review): a root context reaching settleTerminal must have gone
    // through openContext — WorkflowContext's own row constructor is no longer enough on its
    // own (assertHydrated would throw). openContext is the real construction seam every
    // production call site uses.
    const context = await openContext(tx, row, testDeps({ now: () => FIXED }));
    await settleTerminal(tx, context, 'completed', 'completed', () => FIXED);
  });

  const after = await db.select().from(runtimeHistory).where(eq(runtimeHistory.workflowInstanceId, wi.id));
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(before[0].id);

  await close();
});

// ── abort-from-queued: empty trace, null startedAt ──

test('abort from queued (never started): history row has empty trace and null startedAt', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, HIST_SPEC, 'wf-hist-abortq');
  await requestAbort(db, wi.id);

  const deps = testDeps({ now: () => FIXED });
  const did = await runControlPass(db, deps);
  expect(did).toBe(true);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('aborted');
  expect(after.startedAt).toBeNull();

  const history = await historyRowFor(db, wi.id);
  expect(history).toBeDefined();
  expect(history.trace).toEqual([]);
  expect(history.startedAt).toBeNull();
  expect(history.finalState).toBe('aborted');
  expect(history.finishedAt).toEqual(FIXED);

  await close();
});

// ── TRACE MERGE ORDER (Task 12/13 binding ruling, task-17-brief.md): a parent that traces
// DURING a still-active child's execution produces raw insertion order that DIVERGES from the
// reference engine's merged trace order — the merged order splices the ENTIRE child trace as one
// contiguous block immediately before the parent WORKFLOW PROXY step's own COMPLETED entry,
// regardless of what else interleaved chronologically. Topology: START -> PARALLEL -> { sibling
// -> sib-tail ; proxy (spawns a child that ALSO parks) } -> WAIT ALL -> END (a PARALLEL requires
// a matching WAIT ALL — validator.ts's UNMATCHED_PARALLEL check). 'sibling' is declared BEFORE
// 'proxy' in PARALLEL's own outgoing connections, so it activates first and is still the one
// parked when 'proxy' spawns its child. Submitting 'sibling' (a ROOT-level trace, all the way
// through to the WAIT ALL's own first, unsatisfied EXECUTING touch) happens WHILE the child's
// 'c-wait' is still parked — exactly the scenario this shared assembler (core/trace-assembly.ts)
// must get right, and had zero direct test coverage for before this task.
const MERGE_ORDER_SPEC = {
  local_id: 'wf', oid: 'wf-hist-merge', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'),
    step('p1', 'PARALLEL'),
    step('sibling', 'USER_INTERACTION'),
    step('sib-tail', 'MATH'),
    { local_id: 'ChildRef', oid: 'proxy', step_type: 'WORKFLOW PROXY', version: '1.0.0', last_modified_date: '2026-01-01' },
    step('wa', 'WAIT ALL'),
    step('end', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'sibling' },
    { from_step_id: 'p1', to_step_id: 'proxy' },
    { from_step_id: 'sibling', to_step_id: 'sib-tail' },
    { from_step_id: 'sib-tail', to_step_id: 'wa' },
    { from_step_id: 'proxy', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'end' },
  ],
  children: [
    {
      local_id: 'ChildRef', oid: 'child-hist-merge', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      steps: [
        step('c-start', 'START'),
        step('c-wait', 'USER_INTERACTION'),
        step('c-end', 'END'),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-wait' },
        { from_step_id: 'c-wait', to_step_id: 'c-end' },
      ],
    },
  ],
};

test('parent traces during a still-active child: history.trace is the MERGED order, not raw insertion order', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, MERGE_ORDER_SPEC, 'wf-hist-merge');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  // Both branches now parked: root 'sibling' (WAITING_USER) and the child's 'c-wait' (WAITING_USER).
  await submitUserAction(db, wi.id, { step_oid: 'sibling', action: 'submit' }, 0, deps);
  await submitUserAction(db, wi.id, { step_oid: 'c-wait', action: 'submit' }, 1, deps);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');

  const history = await historyRowFor(db, wi.id);
  expect(history).toBeDefined();
  const mergedOrder = history.trace.map((e: any) => [e.step_oid, e.state]);
  expect(mergedOrder).toEqual([
    ['s1', 'COMPLETED'],
    ['p1', 'COMPLETED'],
    ['sibling', 'EXECUTING'],
    ['proxy', 'EXECUTING'],
    ['sibling', 'COMPLETED'],
    ['sib-tail', 'COMPLETED'],
    ['wa', 'EXECUTING'],
    ['c-start', 'COMPLETED'],
    ['c-wait', 'EXECUTING'],
    ['c-wait', 'COMPLETED'],
    ['c-end', 'COMPLETED'],
    ['proxy', 'COMPLETED'],
    ['wa', 'COMPLETED'],
    ['end', 'COMPLETED'],
  ]);

  // Proves this scenario genuinely exercises the merge (not a no-op case where raw order would
  // coincide with the merged order anyway): 'sibling' completed WHILE 'c-wait' was still parked,
  // so raw insertion order puts sibling:COMPLETED/sib-tail:COMPLETED BEFORE the child ever
  // reaches c-wait:COMPLETED/c-end — a naive global sort-by-id would misplace them relative to
  // the merged order's "whole child block right before proxy:COMPLETED" rule.
  const raw = await rawTrace(db, wi.id);
  expect(raw).not.toEqual(mergedOrder);

  // step_names (Phase 7, spec D6): oid -> local_id for every step, root AND nested child —
  // 'proxy' is the one entry where oid !== local_id (the WORKFLOW PROXY step's own local_id is
  // 'ChildRef', matching the child spec's top-level local_id per activateWorkflowProxy's lookup),
  // so this also proves the map isn't an accidental oid->oid identity.
  expect(history.stepNames).toEqual({
    s1: 's1', p1: 'p1', sibling: 'sibling', 'sib-tail': 'sib-tail',
    proxy: 'ChildRef', wa: 'wa', end: 'end',
    'c-start': 'c-start', 'c-wait': 'c-wait', 'c-end': 'c-end',
  });

  await close();
});

test('history records the workflow outputs and the creating runtime', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    ...HIST_SPEC, oid: 'wf-hist-out',
    output_parameter_specifications: [{ id: 'Sum', target: 'Result.Sum' }],
  };
  const wi = await seedQueued(db, spec, 'wf-hist-out');
  await db.update(workflowInstance).set({
    createdByInstanceId: '22222222-2222-2222-2222-222222222222', createdByLabel: 'Line 0/RW-9',
  }).where(eq(workflowInstance.id, wi.id));

  await pumpUntilQuiet(db, testDeps({ now: () => FIXED }));

  const history = await historyRowFor(db, wi.id);
  expect(history.outputs).toEqual([{ name: 'Sum', value: 'hi!' }]);
  expect(history.createdByInstanceId).toBe('22222222-2222-2222-2222-222222222222');
  expect(history.createdByLabel).toBe('Line 0/RW-9');
  await close();
});

// ── who started the run (spec 2026-10-27) ──

const TINY_SPEC = (oid: string) => ({
  local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('start', 'START'), step('end', 'END')],
  connections: [{ from_step_id: 'start', to_step_id: 'end' }],
});

async function seedStarter(db: any, oid: string, who: { requested?: boolean; created?: boolean }): Promise<string> {
  const [u] = await db.insert(appUser).values({
    email: `jdoe-${Math.random()}@t.test`, displayName: 'J Doe', loginName: 'jdoe',
  }).returning();
  const wi = await seedQueued(db, TINY_SPEC(oid), oid);
  await db.update(workflowInstance).set({
    startRequestedBy: who.requested ? u.id : null, createdBy: who.created ? u.id : null,
  }).where(eq(workflowInstance.id, wi.id));
  return wi.id;
}

test('history records the starting user', async () => {
  const { db, close } = await makeTestDb();
  const id = await seedStarter(db, 'wf-hist-sb1', { requested: true });
  await pumpUntilQuiet(db, testDeps());
  const h = await historyRowFor(db, id);
  expect(h.startedByLoginName).toBe('jdoe');
  expect(h.startedByUserId).toBeTruthy();
  await close();
});

test('history falls back to created_by', async () => {
  const { db, close } = await makeTestDb();
  const id = await seedStarter(db, 'wf-hist-sb2', { created: true });
  await pumpUntilQuiet(db, testDeps());
  expect((await historyRowFor(db, id)).startedByLoginName).toBe('jdoe');
  await close();
});

test('no starter leaves nulls', async () => {
  const { db, close } = await makeTestDb();
  const id = await seedStarter(db, 'wf-hist-sb3', {});
  await pumpUntilQuiet(db, testDeps());
  const h = await historyRowFor(db, id);
  expect(h.startedByUserId).toBeNull();
  expect(h.startedByLoginName).toBeNull();
  await close();
});
