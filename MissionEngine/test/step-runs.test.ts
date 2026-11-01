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
// Spec 2026-10-27 §6: one step_run row per execution of a step — loops, user submissions,
// failures (caught and uncaught), sub-workflow paths, stop and force-complete.
import { expect, test } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import {
  workCenter, workflow, workflowInstance, stepInstance, stepRun, instanceAssignment, appUser,
} from 'mission-control-db/src/db/schema/index';
import { requestAbort, requestStop } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { submitUserAction } from '../src/core/submit.js';
import { runControlPass } from '../src/core/control.js';
import { forceCompleteStep } from '../src/core/force-complete.js';
import { settleFailedInstance } from '../src/loop.js';

function step(localId: string, oid: string, stepType: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { local_id: localId, oid, step_type: stepType, version: '1.0.0', last_modified_date: '2026-01-01', ...extra };
}
const s = (oid: string, stepType: string, extra: Record<string, unknown> = {}) => step(oid, oid, stepType, extra);

async function seedQueued(db: any, spec: any): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return wi;
}

async function runsOf(db: any, instanceId: string, stepOid: string): Promise<any[]> {
  return db.select().from(stepRun)
    .where(and(eq(stepRun.workflowInstanceId, instanceId), eq(stepRun.stepOid, stepOid)))
    .orderBy(asc(stepRun.runNumber));
}

async function stepRow(db: any, instanceId: string, stepOid: string): Promise<any> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === stepOid);
}

async function statusOf(db: any, id: string): Promise<string> {
  return (await db.select().from(workflowInstance).where(eq(workflowInstance.id, id)))[0].status;
}

async function seedUser(db: any, loginName: string): Promise<string> {
  const [u] = await db.insert(appUser).values({ email: `${loginName}-${Math.random()}@t.test`, displayName: loginName, loginName }).returning();
  return u.id;
}

const YES_NO = { yes_no_config: { yes_value: 'true', no_value: 'false' } };

// START -> bump (n = n + 1) -> ask -> [true] bump | [false] END
const LOOP_SPEC = {
  local_id: 'wf', oid: 'wf-sr-loop', version: '1.0.0', last_modified_date: '2026-01-01',
  value_property_specifications: [{ name: 'N', entries: [{ name: 'Value', value: '0' }] }],
  steps: [
    s('start', 'START'),
    s('bump', 'SCRIPT', {
      script_config: { source: 'output.n = String(Number(n) + 1);' },
      input_parameter_specifications: [{ id: 'n', default_value: 'N.Value', value_type: 'property' }],
      output_parameter_specifications: [{ id: 'n', target: 'N.Value' }],
    }),
    s('ask', 'YES_NO', YES_NO),
    s('end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'bump' },
    { from_step_id: 'bump', to_step_id: 'ask' },
    { from_step_id: 'ask', to_step_id: 'bump', source_handle_id: 'true' },
    { from_step_id: 'ask', to_step_id: 'end', source_handle_id: 'false' },
  ],
};

test('a loop records one row per execution with run numbers and distinct parameters', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const wi = await seedQueued(db, LOOP_SPEC);
  await pumpUntilQuiet(db, deps);
  for (const [i, answer] of ['true', 'true', 'false'].entries()) {
    await submitUserAction(db, wi.id, { step_oid: 'ask', action: 'button_press', button_output: answer }, i, deps);
  }
  expect(await statusOf(db, wi.id)).toBe('completed');

  const bump = await runsOf(db, wi.id, 'bump');
  expect(bump.map(r => r.runNumber)).toEqual([1, 2, 3]);
  expect(bump.map(r => r.inputParameters.n)).toEqual(['0', '1', '2']);
  expect(bump.map(r => r.outputParameters.n)).toEqual(['1', '2', '3']);
  expect(bump.every(r => r.result === 'completed' && r.performedByKind === 'script' && r.stepType === 'SCRIPT')).toBe(true);
  expect(bump.every(r => r.runtimeLabel === 'RW-1' && r.stepName === 'bump' && r.nodePath.length === 0)).toBe(true);

  const ask = await runsOf(db, wi.id, 'ask');
  expect(ask).toHaveLength(3);
  expect(ask.every(r => r.performedByKind === 'user' && r.performedByLoginName === null)).toBe(true);
  expect(ask.map(r => r.runNumber)).toEqual([1, 2, 3]);

  for (const oid of ['start', 'end']) {
    const rows = await runsOf(db, wi.id, oid);
    expect(rows).toHaveLength(1);
    expect(rows[0].performedByKind).toBe('system');
  }
  // Auto-completing steps never get a step_instance started_at; the run starts as it finishes.
  for (const r of [...bump, ...(await runsOf(db, wi.id, 'start'))]) {
    expect(r.startedAt).not.toBeNull();
    expect(r.startedAt).toEqual(r.finishedAt);
  }
  await close();
});

// START -> ui -> sc (auto SCRIPT) -> END
const CLAIM_SPEC = {
  local_id: 'wf', oid: 'wf-sr-claim', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    s('start', 'START'),
    s('ui', 'USER_INTERACTION'),
    s('sc', 'SCRIPT', { script_config: { source: "output.x = 'y';" } }),
    s('end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'ui' },
    { from_step_id: 'ui', to_step_id: 'sc' },
    { from_step_id: 'sc', to_step_id: 'end' },
  ],
};

test("a claimed submit records the claimant's login name", async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const wi = await seedQueued(db, CLAIM_SPEC);
  await pumpUntilQuiet(db, deps);
  const userId = await seedUser(db, 'jdoe');
  const ui = await stepRow(db, wi.id, 'ui');
  const [offer] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, ui.id));
  expect(offer.status).toBe('offered');
  await db.update(instanceAssignment).set({ status: 'claimed', assignedUserId: userId }).where(eq(instanceAssignment.id, offer.id));

  await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'submit' }, 'auto', deps, { assignmentId: offer.id, userId });
  expect(await statusOf(db, wi.id)).toBe('completed');

  const [uiRun] = await runsOf(db, wi.id, 'ui');
  expect(uiRun).toMatchObject({ performedByLoginName: 'jdoe', performedByKind: 'user', performedByUserId: userId, result: 'completed' });
  expect(uiRun.stepInstanceId).toBe(ui.id);
  expect(uiRun.startedAt).not.toBeNull();
  const [scRun] = await runsOf(db, wi.id, 'sc');
  expect(scRun).toMatchObject({ performedByKind: 'script', performedByLoginName: null, performedByUserId: null });
  await close();
});

test('a failed script records result failed with the error', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: 'wf-sr-fail', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [s('start', 'START'), s('sc', 'SCRIPT', { script_config: { source: "throw new Error('kaboom');" } }), s('end', 'END')],
    connections: [{ from_step_id: 'start', to_step_id: 'sc' }, { from_step_id: 'sc', to_step_id: 'end' }],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, testDeps());
  expect(await statusOf(db, wi.id)).toBe('errored');
  const rows = await runsOf(db, wi.id, 'sc');
  expect(rows).toHaveLength(1);
  expect(rows[0].result).toBe('failed');
  expect(rows[0].error).toContain('kaboom');
  await close();
});

test('a caught failure records result caught', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = {
    local_id: 'wf', oid: 'wf-sr-caught', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [
      s('start', 'START'),
      s('trig', 'USER_INTERACTION', { try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      s('end', 'END'),
      s('c1', 'CATCH', { catch_id: 'C1' }),
      s('r1', 'RETURN', { return_config: { command: 'COMPLETE' } }),
    ],
    connections: [
      { from_step_id: 'start', to_step_id: 'trig' },
      { from_step_id: 'trig', to_step_id: 'end' },
      { from_step_id: 'c1', to_step_id: 'r1' },
    ],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  await submitUserAction(db, wi.id, { step_oid: 'trig', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, deps);
  expect(await statusOf(db, wi.id)).toBe('completed');
  const caught = (await runsOf(db, wi.id, 'trig')).filter(r => r.result === 'caught');
  expect(caught).toHaveLength(1);
  expect(caught[0]).toMatchObject({ runNumber: 1, error: 'boom', performedByKind: 'user' });
  await close();
});

// START -> proxy (child Kid) -> ask -> [true] proxy | [false] END. The child parks on its own
// form so each pass ends through a submit.
const CHILD_LOOP_SPEC = {
  local_id: 'parent', oid: 'wf-sr-child', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('start', 'p-start', 'START'),
    step('Kid', 'proxy', 'WORKFLOW PROXY'),
    step('ask', 'ask', 'YES_NO', YES_NO),
    step('end', 'p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'proxy' },
    { from_step_id: 'proxy', to_step_id: 'ask' },
    { from_step_id: 'ask', to_step_id: 'proxy', source_handle_id: 'true' },
    { from_step_id: 'ask', to_step_id: 'p-end', source_handle_id: 'false' },
  ],
  children: [{
    local_id: 'Kid', oid: 'child-kid', version: '1.0.0', last_modified_date: '2026-01-01',
    parentChildSpecId: null, state: 'Effective',
    steps: [
      step('c-start', 'c-start', 'START'),
      step('c-form', 'c-form', 'USER_INTERACTION'),
      step('c-end', 'c-end', 'END'),
    ],
    connections: [
      { from_step_id: 'c-start', to_step_id: 'c-form' },
      { from_step_id: 'c-form', to_step_id: 'c-end' },
    ],
  }],
};

test('child steps carry node path with the proxy run', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const wi = await seedQueued(db, CHILD_LOOP_SPEC);
  await pumpUntilQuiet(db, deps);
  await submitUserAction(db, wi.id, { step_oid: 'c-form', action: 'submit' }, 0, deps);
  await submitUserAction(db, wi.id, { step_oid: 'ask', action: 'button_press', button_output: 'true' }, 1, deps);
  await submitUserAction(db, wi.id, { step_oid: 'c-form', action: 'submit' }, 2, deps);
  await submitUserAction(db, wi.id, { step_oid: 'ask', action: 'button_press', button_output: 'false' }, 3, deps);
  expect(await statusOf(db, wi.id)).toBe('completed');

  for (const oid of ['c-start', 'c-form', 'c-end']) {
    const rows = await runsOf(db, wi.id, oid);
    expect(rows.map(r => r.runNumber)).toEqual([1, 2]); // per step oid per instance (§6.1)
    expect(rows.map(r => r.nodePath)).toEqual([
      [{ proxyStepOid: 'proxy', proxyRun: 1, workflowName: 'Kid' }],
      [{ proxyStepOid: 'proxy', proxyRun: 2, workflowName: 'Kid' }],
    ]);
  }
  const proxy = await runsOf(db, wi.id, 'proxy');
  expect(proxy.map(r => r.runNumber)).toEqual([1, 2]);
  expect(proxy.every(r => r.nodePath.length === 0 && r.performedByKind === 'system')).toBe(true);
  await close();
});

test('stop records stopped rows for active steps', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const wi = await seedQueued(db, LOOP_SPEC);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'ask')).state).toBe('WAITING_USER');
  await requestStop(db, wi.id);
  await runControlPass(db, deps);
  expect(await statusOf(db, wi.id)).toBe('stopped');
  const rows = await runsOf(db, wi.id, 'ask');
  expect(rows).toHaveLength(1);
  expect(rows[0].result).toBe('stopped');
  await close();
});

test('force-complete records the operator', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = {
    local_id: 'wf', oid: 'wf-sr-fc', version: '1.0.0', last_modified_date: '2026-01-01', schemaVersion: '5.0',
    steps: [s('s', 'START'), s('g', 'GATE', { gate_config: { mode: 'timer', delay_seconds: 600 } }), s('e', 'END')],
    connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  const g = await stepRow(db, wi.id, 'g');
  const actor = await seedUser(db, 'fcop');
  await forceCompleteStep(db, deps, null, { instanceId: wi.id, stepInstanceId: g.id, actorUserId: actor, source: 'commander' });
  expect(await statusOf(db, wi.id)).toBe('completed');
  const rows = await runsOf(db, wi.id, 'g');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ result: 'completed', performedByKind: 'user', performedByLoginName: 'fcop', performedByUserId: actor });
  await close();
});

test('RETURN ABANDON records cancelled for an active sibling', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = {
    local_id: 'wf', oid: 'wf-sr-abandon', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [
      s('start', 'START'), s('p1', 'PARALLEL'),
      s('trig', 'USER_INTERACTION', { try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      s('sibling', 'USER_INTERACTION'), s('wa', 'WAIT ALL'), s('end', 'END'),
      s('c1', 'CATCH', { catch_id: 'C1' }), s('r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
    ],
    connections: [
      { from_step_id: 'start', to_step_id: 'p1' },
      { from_step_id: 'p1', to_step_id: 'trig' }, { from_step_id: 'p1', to_step_id: 'sibling' },
      { from_step_id: 'trig', to_step_id: 'wa' }, { from_step_id: 'sibling', to_step_id: 'wa' },
      { from_step_id: 'wa', to_step_id: 'end' }, { from_step_id: 'c1', to_step_id: 'r1' },
    ],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  await submitUserAction(db, wi.id, { step_oid: 'trig', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, deps);
  expect(await statusOf(db, wi.id)).toBe('aborted');
  expect((await runsOf(db, wi.id, 'sibling')).map(r => r.result)).toEqual(['cancelled']);
  expect((await runsOf(db, wi.id, 'trig')).map(r => r.result)).toEqual(['caught']);
  await close();
});

test('an escalated child failure records cancelled for the torn-down child steps, with their node path', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'parent', oid: 'wf-sr-escalate', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('start', 'p-start', 'START'), step('Kid', 'proxy', 'WORKFLOW PROXY'), step('end', 'p-end', 'END')],
    connections: [{ from_step_id: 'p-start', to_step_id: 'proxy' }, { from_step_id: 'proxy', to_step_id: 'p-end' }],
    children: [{
      local_id: 'Kid', oid: 'child-esc', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      steps: [
        step('c-start', 'c-start', 'START'), step('c-par', 'c-par', 'PARALLEL'),
        step('c-form', 'c-form', 'USER_INTERACTION'),
        step('c-bad', 'c-bad', 'SCRIPT', { script_config: { source: "throw new Error('kaboom');" } }),
        step('c-wa', 'c-wa', 'WAIT ALL'), step('c-end', 'c-end', 'END'),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-par' },
        { from_step_id: 'c-par', to_step_id: 'c-form' }, { from_step_id: 'c-par', to_step_id: 'c-bad' },
        { from_step_id: 'c-form', to_step_id: 'c-wa' }, { from_step_id: 'c-bad', to_step_id: 'c-wa' },
        { from_step_id: 'c-wa', to_step_id: 'c-end' },
      ],
    }],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, testDeps());
  expect(await statusOf(db, wi.id)).toBe('errored');
  const path = [{ proxyStepOid: 'proxy', proxyRun: 1, workflowName: 'Kid' }];
  const [form] = await runsOf(db, wi.id, 'c-form');
  expect(form).toMatchObject({ result: 'cancelled', nodePath: path });
  const [bad] = await runsOf(db, wi.id, 'c-bad');
  expect(bad).toMatchObject({ result: 'failed', nodePath: path });
  const proxy = await runsOf(db, wi.id, 'proxy');
  expect(proxy.map(r => [r.result, r.nodePath])).toEqual([['failed', []]]);
  await close();
});

// The same proxy loop, stopped while the child is parked: the proxy's own run row and its
// child's are written in one unordered sweep, so the proxy run must not depend on which comes
// first.
async function parkChildOnPass(db: any, pass: 1 | 2): Promise<{ id: string }> {
  const deps = testDeps();
  const wi = await seedQueued(db, { ...CHILD_LOOP_SPEC, oid: `wf-sr-child-p${pass}` });
  await pumpUntilQuiet(db, deps);
  if (pass === 2) {
    await submitUserAction(db, wi.id, { step_oid: 'c-form', action: 'submit' }, 0, deps);
    await submitUserAction(db, wi.id, { step_oid: 'ask', action: 'button_press', button_output: 'true' }, 1, deps);
  }
  expect((await stepRow(db, wi.id, 'c-form')).state).toBe('WAITING_USER');
  return wi;
}

for (const pass of [1, 2] as const) {
  test(`abort with the child parked on pass ${pass} records proxy run ${pass} on the child`, async () => {
    const { db, close } = await makeTestDb();
    const wi = await parkChildOnPass(db, pass);
    await requestAbort(db, wi.id);
    await runControlPass(db, testDeps());
    expect(await statusOf(db, wi.id)).toBe('aborted');
    const form = await runsOf(db, wi.id, 'c-form');
    expect(form.at(-1)).toMatchObject({ result: 'aborted', nodePath: [{ proxyStepOid: 'proxy', proxyRun: pass, workflowName: 'Kid' }] });
    const proxy = await runsOf(db, wi.id, 'proxy');
    expect(proxy.map(r => r.result)).toEqual(pass === 1 ? ['aborted'] : ['completed', 'aborted']);
    await close();
  });
}

test('the give-up path records failed runs with the right proxy run', async () => {
  const { db, close } = await makeTestDb();
  const wi = await parkChildOnPass(db, 2);
  await settleFailedInstance(db, wi.id, new Error('poisoned'), testDeps());
  expect(await statusOf(db, wi.id)).toBe('errored');
  const form = await runsOf(db, wi.id, 'c-form');
  expect(form.at(-1)).toMatchObject({ result: 'failed', error: 'poisoned', nodePath: [{ proxyStepOid: 'proxy', proxyRun: 2, workflowName: 'Kid' }] });
  expect((await runsOf(db, wi.id, 'proxy')).map(r => r.result)).toEqual(['completed', 'failed']);
  await close();
});

test('the actor is credited only once per transaction', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  // A claimed failure is caught and RETURN COMPLETE re-completes the trigger in the same
  // transaction: only the caught run is the claimant's.
  const spec = {
    local_id: 'wf', oid: 'wf-sr-actor-once', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [
      s('start', 'START'),
      s('trig', 'USER_INTERACTION', { try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      s('end', 'END'),
      s('c1', 'CATCH', { catch_id: 'C1' }),
      s('r1', 'RETURN', { return_config: { command: 'COMPLETE' } }),
    ],
    connections: [
      { from_step_id: 'start', to_step_id: 'trig' },
      { from_step_id: 'trig', to_step_id: 'end' },
      { from_step_id: 'c1', to_step_id: 'r1' },
    ],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  const userId = await seedUser(db, 'jroe');
  const trig = await stepRow(db, wi.id, 'trig');
  const [offer] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, trig.id));
  await db.update(instanceAssignment).set({ status: 'claimed', assignedUserId: userId }).where(eq(instanceAssignment.id, offer.id));
  await submitUserAction(db, wi.id, { step_oid: 'trig', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 'auto', deps, { assignmentId: offer.id, userId });
  expect(await statusOf(db, wi.id)).toBe('completed');
  const runs = await runsOf(db, wi.id, 'trig');
  expect(runs.map(r => [r.result, r.performedByLoginName])).toEqual([['caught', 'jroe'], ['completed', null]]);
  await close();
});

// A settle that ends the run while other steps are still active records them 'cancelled'.
test('an uncaught failure on one branch records cancelled for the step parked on another', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: 'wf-sr-settle-cancel', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [
      s('start', 'START'), s('p1', 'PARALLEL'),
      s('bad', 'SCRIPT', { script_config: { source: "throw new Error('kaboom');" } }),
      s('ask', 'YES_NO', YES_NO), s('wa', 'WAIT ALL'), s('end', 'END'),
    ],
    connections: [
      { from_step_id: 'start', to_step_id: 'p1' },
      { from_step_id: 'p1', to_step_id: 'ask' }, { from_step_id: 'p1', to_step_id: 'bad' },
      { from_step_id: 'bad', to_step_id: 'wa' }, { from_step_id: 'ask', to_step_id: 'wa' },
      { from_step_id: 'wa', to_step_id: 'end' },
    ],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, testDeps());
  expect(await statusOf(db, wi.id)).toBe('errored');
  expect((await runsOf(db, wi.id, 'bad')).map(r => r.result)).toEqual(['failed']);
  expect((await runsOf(db, wi.id, 'ask')).map(r => r.result)).toEqual(['cancelled']);
  await close();
});

test('a completed run records no cancelled rows', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: 'wf-sr-no-cancel', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [s('start', 'START'), s('g', 'USER_INTERACTION'), s('end', 'END')],
    connections: [{ from_step_id: 'start', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'end' }],
  };
  const deps = testDeps();
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  await submitUserAction(db, wi.id, { step_oid: 'g', action: 'submit' }, 0, deps);
  expect(await statusOf(db, wi.id)).toBe('completed');
  const all = await db.select().from(stepRun).where(eq(stepRun.workflowInstanceId, wi.id));
  expect(all.filter((r: any) => r.result === 'cancelled')).toHaveLength(0);
  await close();
});

test('an aborted run keeps its aborted rows and gets no extra cancelled ones', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = {
    local_id: 'wf', oid: 'wf-sr-abort-no-extra', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [s('start', 'START'), s('g', 'USER_INTERACTION'), s('end', 'END')],
    connections: [{ from_step_id: 'start', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'end' }],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  await requestAbort(db, wi.id);
  await runControlPass(db, deps);
  expect(await statusOf(db, wi.id)).toBe('aborted');
  expect((await runsOf(db, wi.id, 'g')).map(r => r.result)).toEqual(['aborted']);
  await close();
});

// START -> bump (n = n + 1) -> gate (open when n >= 2, or after 60 s) -> ask -> [true] bump |
// [false] END. Pass 1 parks the gate (n = 1) and the timer opens it; pass 2 opens it at once.
const GATE_LOOP_SPEC = {
  local_id: 'wf', oid: 'wf-sr-gate-loop', version: '1.0.0', last_modified_date: '2026-01-01', schemaVersion: '5.0',
  value_property_specifications: [{ name: 'N', entries: [{ name: 'Value', value: '0' }] }],
  steps: [
    s('start', 'START'),
    s('bump', 'SCRIPT', {
      script_config: { source: 'output.n = String(Number(n) + 1);' },
      input_parameter_specifications: [{ id: 'n', default_value: 'N.Value', value_type: 'property' }],
      output_parameter_specifications: [{ id: 'n', target: 'N.Value' }],
    }),
    s('gate', 'GATE', {
      gate_config: { mode: 'condition_or_timer', delay_seconds: 60, cycle_seconds: 10, source: 'return Number(n) >= 2;' },
      input_parameter_specifications: [{ id: 'n', default_value: 'N.Value', value_type: 'property' }],
    }),
    s('ask', 'YES_NO', YES_NO),
    s('end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'bump' },
    { from_step_id: 'bump', to_step_id: 'gate' },
    { from_step_id: 'gate', to_step_id: 'ask' },
    { from_step_id: 'ask', to_step_id: 'bump', source_handle_id: 'true' },
    { from_step_id: 'ask', to_step_id: 'end', source_handle_id: 'false' },
  ],
};

test('a re-entered gate that opens at once records its own start, not the previous run’s', async () => {
  const { db, close } = await makeTestDb();
  let now = new Date('2026-01-01T09:00:00.000Z');
  const advance = (secs: number) => { now = new Date(now.getTime() + secs * 1000); };
  const deps = testDeps({ now: () => now });
  const wi = await seedQueued(db, GATE_LOOP_SPEC);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'gate')).state).toBe('WAITING_GATE');
  advance(60);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'ask')).state).toBe('WAITING_USER');

  advance(3600);
  const pass2At = now.getTime();
  await submitUserAction(db, wi.id, { step_oid: 'ask', action: 'button_press', button_output: 'true' }, 0, deps);
  await submitUserAction(db, wi.id, { step_oid: 'ask', action: 'button_press', button_output: 'false' }, 1, deps);
  expect(await statusOf(db, wi.id)).toBe('completed');

  const gate = await runsOf(db, wi.id, 'gate');
  expect(gate.map(r => r.runNumber)).toEqual([1, 2]);
  expect(new Date(gate[0].startedAt).getTime()).toBe(new Date('2026-01-01T09:00:00.000Z').getTime());
  expect(new Date(gate[1].startedAt).getTime()).toBeGreaterThanOrEqual(new Date(gate[0].finishedAt).getTime());
  expect(new Date(gate[1].startedAt).getTime()).toBe(pass2At);
  await close();
});

// History report bug 2026-10-31: the first step of a run recorded every starting parameter as
// its own input (PropertyStore.getInputParameters' first-pass fallback). A run row records only
// the step's declared inputs.
test('the first step records only its own declared inputs, not the run\'s starting parameters', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = {
    local_id: 'wf', oid: 'wf-sr-first-inputs', version: '1.0.0', last_modified_date: '2026-01-01',
    starting_parameter_specifications: [
      { id: 'Size', default_value: 'large' },
      { id: 'OrderNumber', default_value: '7' },
    ],
    steps: [
      s('start', 'START'),
      s('first', 'SCRIPT', {
        script_config: { source: 'output.out = size;' },
        input_parameter_specifications: [{ id: 'size', default_value: 'Size', value_type: 'property' }],
        output_parameter_specifications: [{ id: 'out', target: 'Out' }],
      }),
      s('none', 'SCRIPT', { script_config: { source: '' } }),
      s('end', 'END'),
    ],
    connections: [
      { from_step_id: 'start', to_step_id: 'first' },
      { from_step_id: 'first', to_step_id: 'none' },
      { from_step_id: 'none', to_step_id: 'end' },
    ],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  expect(await statusOf(db, wi.id)).toBe('completed');

  const [first] = await runsOf(db, wi.id, 'first');
  expect(first.inputParameters).toEqual({ size: 'large' });
  expect(first.outputParameters).toEqual({ out: 'large' });
  const [none] = await runsOf(db, wi.id, 'none');
  expect(none.inputParameters).toEqual({});
  await close();
});
