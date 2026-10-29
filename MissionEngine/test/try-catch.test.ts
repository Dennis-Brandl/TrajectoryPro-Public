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
// Task 11: TRY/CATCH/RETURN failure routing — reference engine.ts:262-441 (handleStepFailure,
// findCatchByCatchId, findActiveCatchForReturn, cleanupCatchNetwork, dispatchReturn + its five
// command handlers). The `exec-try-catch-*` conformance fixtures (vendored under
// src/conformance/fixtures/execution/) are driven directly here as spec templates — a small
// preview of Task 13's future harness, scoped to just these 8 — plus hand-rolled tests for
// scenarios the fixtures don't cover: CATCH_REENTRY (no fixture exists for it) and the
// COMPLETE-vs-ABANDON branch-clearing contrast (fixture 008 is a simple linear flow with no
// sibling branch to observe).
import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, asc } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { submitUserAction } from '../src/core/submit.js';

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

const ENV_SPECS = [{
  local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
}];
const ACTION_CONFIG = { action_oid: 'act-1', environment_oid: 'env-1' };

// ── Fixture-driven: all 8 vendored exec-try-catch-* conformance fixtures ──
//
// Each fixture's user_actions ARE UserAction objects (the fixture format and the engine's
// UserAction type are the same shape), so they're passed straight through to
// submitUserAction. A pumpUntilQuiet after every action is a harmless safety net regardless of
// whether submitUserAction's own internal pump-to-quiescence already fully drained the
// cascade — it's a no-op when nothing is READY.

const STATUS_TO_STATE: Record<string, string> = {
  running: 'RUNNING', completed: 'COMPLETED', aborted: 'ABORTED', errored: 'ERRORED', stopped: 'STOPPED',
};

const EXEC_DIR = join(import.meta.dirname, '../src/conformance/fixtures/execution');
const tryCatchFixtures = readdirSync(EXEC_DIR).filter(f => f.startsWith('exec-try-catch') && f.endsWith('.json')).sort();

for (const file of tryCatchFixtures) {
  test(`execution fixture ${file}`, async () => {
    const { db, close } = await makeTestDb();
    const fixture = JSON.parse(readFileSync(join(EXEC_DIR, file), 'utf8'));
    const wi = await seedQueued(db, fixture.workflow, fixture.workflow.oid);
    const deps = testDeps();
    await pumpUntilQuiet(db, deps);

    let idx = 0;
    for (const ua of fixture.user_actions ?? []) {
      await submitUserAction(db, wi.id, ua, idx, deps);
      await pumpUntilQuiet(db, deps);
      idx++;
    }

    const after = await instanceRow(db, wi.id);
    expect(STATUS_TO_STATE[after.status]).toBe(fixture.expected.workflow_state);
    if (fixture.expected.final_properties) {
      expect(after.propertyStore).toMatchObject(fixture.expected.final_properties);
    }
    await close();
  });
}

// ── Trace-level assertions the fixture loop above doesn't check: the trigger is idled with
// the submitted action's after_action index, and all four CatchContext fields land. ──

test('TRY ERROR: trigger idled with after_action; CATCH writes Message/Reason/Step/StepID', async () => {
  const { db, close } = await makeTestDb();
  const fixture = JSON.parse(readFileSync(join(EXEC_DIR, 'exec-try-catch-007-all-trigger-fields.json'), 'utf8'));
  const wi = await seedQueued(db, fixture.workflow, fixture.workflow.oid);
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  await submitUserAction(db, wi.id, fixture.user_actions[0], 3, deps);

  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['s2', 'IDLE', 3]); // idled WITH the after_action index
  expect(trace.some(([oid, state]) => oid === 's2' && state === 'ERRORED')).toBe(false); // failure swallowed, never traced ERRORED

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('aborted');
  expect(after.propertyStore).toMatchObject({
    'FailureContext.Mode': 'ERROR',
    'FailureContext.Message': 'thermocouple failure',
    'FailureContext.Step': 'Action',
    'FailureContext.StepID': 's2',
  });
  await close();
});

// ── CATCH_REENTRY (spec §6.4) — no vendored fixture exists for this. Reachable in THIS
// engine (unlike a fully-synchronous in-memory one) whenever the catch network itself parks
// on a user-facing step before reaching RETURN: CATCH -> ack (USER_INTERACTION) -> RETURN.
// Two independent PARALLEL branches share the SAME catch_id; the first failure arms the catch
// and rides it all the way to `ack`'s park (RETURN hasn't dispatched, so the catch is still
// active); the second failure on the OTHER branch must hit CATCH_REENTRY. ──

const REENTRY_SPEC = {
  local_id: 'wf', oid: 'wf-reentry', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  steps: [
    step('s1', 'START'),
    step('p1', 'PARALLEL'),
    step('triggerA', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG, try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
    step('triggerB', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG, try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
    step('c1', 'CATCH', { catch_id: 'C1' }),
    step('ack', 'USER_INTERACTION'),
    step('r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'triggerA' },
    { from_step_id: 'p1', to_step_id: 'triggerB' },
    { from_step_id: 'triggerA', to_step_id: 'wa' },
    { from_step_id: 'triggerB', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
    { from_step_id: 'c1', to_step_id: 'ack' },
    { from_step_id: 'ack', to_step_id: 'r1' },
  ],
};

test('CATCH_REENTRY: a second failure on a still-active catch (its RETURN not yet dispatched) aborts the workflow', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, REENTRY_SPEC, 'wf-reentry');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  await submitUserAction(db, wi.id, { step_oid: 'triggerA', action: 'fail', failure_mode: 'ERROR', error: 'first failure' }, 0, deps);

  // The catch cascaded to `ack` and parked — RETURN hasn't dispatched, so C1 is still active.
  const ack = await stepRow(db, wi.id, 'ack');
  expect(ack.state).toBe('WAITING_USER');
  const triggerBMid = await stepRow(db, wi.id, 'triggerB');
  expect(triggerBMid.state).toBe('WAITING_ACTION'); // untouched — independent branch
  expect((await instanceRow(db, wi.id)).status).toBe('running');

  await submitUserAction(db, wi.id, { step_oid: 'triggerB', action: 'fail', failure_mode: 'ERROR', error: 'second failure' }, 1, deps);

  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['triggerB', 'ERRORED', 1]);
  const triggerBAfter = await stepRow(db, wi.id, 'triggerB');
  expect(triggerBAfter.state).toBe('ERRORED');
  expect(triggerBAfter.error).toBe('CATCH_REENTRY on C1');

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('aborted');
  await close();
});

// ── RETURN COMPLETE vs RETURN ABANDON: branch-clearing contrast. Same shape (PARALLEL into a
// TRY-wrapped trigger + an independent sibling, joined at a WAIT ALL) so the only variable is
// the RETURN command. ──

function branchSpec(command: 'COMPLETE' | 'ABANDON') {
  return {
    local_id: 'wf', oid: `wf-return-${command.toLowerCase()}`, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step('s1', 'START'),
      step('p1', 'PARALLEL'),
      step('trigger', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG, try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      step('sibling', 'USER_INTERACTION'),
      step('wa', 'WAIT ALL'),
      step('e1', 'END'),
      step('c1', 'CATCH', { catch_id: 'C1' }),
      step('r1', 'RETURN', { return_config: { command } }),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 'p1' },
      { from_step_id: 'p1', to_step_id: 'trigger' },
      { from_step_id: 'p1', to_step_id: 'sibling' },
      { from_step_id: 'trigger', to_step_id: 'wa' },
      { from_step_id: 'sibling', to_step_id: 'wa' },
      { from_step_id: 'wa', to_step_id: 'e1' },
      { from_step_id: 'c1', to_step_id: 'r1' },
    ],
  };
}

test('RETURN COMPLETE force-completes the trigger and its successors WITHOUT clearing the sibling branch', async () => {
  const { db, close } = await makeTestDb();
  const spec = branchSpec('COMPLETE');
  const wi = await seedQueued(db, spec, spec.oid);
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  await submitUserAction(db, wi.id, { step_oid: 'trigger', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, deps);

  // The sibling branch is completely untouched by COMPLETE — still parked.
  const sibling = await stepRow(db, wi.id, 'sibling');
  expect(sibling.state).toBe('WAITING_USER');
  expect((await instanceRow(db, wi.id)).status).toBe('running');

  // Completing the sibling lets the WAIT ALL join and the workflow finish normally.
  await submitUserAction(db, wi.id, { step_oid: 'sibling', action: 'submit' }, 1, deps);
  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  await close();
});

test('RETURN ABANDON idles the active sibling branch (row deleted, traced IDLE) and aborts the instance', async () => {
  const { db, close } = await makeTestDb();
  const spec = branchSpec('ABANDON');
  const wi = await seedQueued(db, spec, spec.oid);
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  await submitUserAction(db, wi.id, { step_oid: 'trigger', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, deps);

  const sibling = await stepRow(db, wi.id, 'sibling');
  expect(sibling).toBeUndefined(); // idled = row deleted (lazy materialization — no IDLE row state)
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['sibling', 'IDLE', null]);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('aborted');
  await close();
});
