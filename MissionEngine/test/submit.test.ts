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
// Task 10: submitUserAction's own contract — reference engine.ts:181-259 submitAction, minus
// child delegation (Task 12). Park -> submit -> after_action; the non-EXECUTING and
// non-running throws; pause/resume; and the resource block -> release -> re-activate cascade
// (resumeGrantedSteps, driven through submit.ts's finishStep pipeline).
import { expect, test, describe } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, and, asc } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry, instanceAssignment, appUser } from 'mission-control-db/src/db/schema/index';
import { submitUserAction, EngineError } from '../src/core/submit.js';
import { runOnce } from '../src/loop.js';

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

// ── USER_INTERACTION parks, submit completes with after_action ──

const UI_SPEC = {
  local_id: 'wf', oid: 'wf-ui', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'),
    step('ui', 'USER_INTERACTION', {
      form_layout_config: [{
        deviceType: 'phone', canvasWidth: 390, canvasHeight: 844,
        elements: [
          { type: 'textInput', x: 0, y: 0, width: 300, height: 40, fieldName: 'name', label: 'Name', outputParameter: 'Response.Name' },
          { type: 'button', x: 0, y: 60, width: 300, height: 40, label: 'Submit', outputValue: 'done' },
        ],
      }],
      output_parameter_specifications: [{ id: 'Response.Name', target: 'Response.Name' }],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'ui' },
    { from_step_id: 'ui', to_step_id: 'e1' },
  ],
};

test('USER_INTERACTION parks (trace EXECUTING, state WAITING_USER); submit completes with after_action', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, UI_SPEC, 'wf-ui');
  await pumpUntilQuiet(db, testDeps());

  let ui = await stepRow(db, wi.id, 'ui');
  expect(ui.state).toBe('WAITING_USER');
  let trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['ui', 'EXECUTING', null]);

  await submitUserAction(db, wi.id, {
    step_oid: 'ui', action: 'button_press', button_output: 'done', form_values: { name: 'Alice' },
  }, 7, testDeps());

  ui = await stepRow(db, wi.id, 'ui');
  expect(ui.state).toBe('COMPLETED');
  trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['ui', 'COMPLETED', 7]);

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  expect(after.propertyStore).toMatchObject({ 'Response.Name': 'Alice' });
  await close();
});

// ── submit against a non-parked step throws ──
//
// The instance itself must still be 'running' (else the earlier NOT_RUNNING guard fires
// first) while the TARGET step is already COMPLETED — a trailing USER_INTERACTION keeps the
// instance running after m1 auto-completes on its own.
const NON_PARKED_SPEC = {
  local_id: 'wf', oid: 'wf-non-parked', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('s1', 'START'), step('m1', 'MATH'), step('ui', 'USER_INTERACTION'), step('e1', 'END')],
  connections: [
    { from_step_id: 's1', to_step_id: 'm1' },
    { from_step_id: 'm1', to_step_id: 'ui' },
    { from_step_id: 'ui', to_step_id: 'e1' },
  ],
};

test('submit against a step that is not parked throws "is not EXECUTING"', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, NON_PARKED_SPEC, 'wf-non-parked');
  await pumpUntilQuiet(db, testDeps());
  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('running'); // parked on ui, still running
  const m1 = await stepRow(db, wi.id, 'm1');
  expect(m1.state).toBe('COMPLETED'); // m1 already ran to COMPLETED on its own

  await expect(
    submitUserAction(db, wi.id, { step_oid: 'm1', action: 'submit' }, 0, testDeps()),
  ).rejects.toThrow('Step m1 is not EXECUTING');
  await close();
});

// ── C1 (Critical, proven by review): a failed mission must not persist as 'completed' ──
//
// ui -> {bad SCRIPT throws, good MATH} -> e1 END. submitUserAction completes ui, which routes
// to BOTH bad and good in the same transaction; the pump-to-quiescence loop then picks bad
// first (its READY row is older) and its SCRIPT failure settles the instance 'errored' via
// failStep. Before the fix, the pump loop kept calling processReadyStep afterward with no
// status re-check, so a later call could pick up 'good' -> e1 and isWorkflowComplete/
// settleTerminal would overwrite the 'errored' status with 'completed'. The final status must
// be 'errored' regardless of which of bad/good the (createdAt/id-tiebroken) pump happens to
// process first — see the fix's own comment for why that's true either way.
const C1_PROBE_SPEC = {
  local_id: 'wf', oid: 'wf-c1-probe', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'),
    step('ui', 'USER_INTERACTION'),
    step('bad', 'SCRIPT', { script_config: { source: 'throw new Error("boom");' } }),
    step('good', 'MATH'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'ui' },
    { from_step_id: 'ui', to_step_id: 'bad' },
    { from_step_id: 'ui', to_step_id: 'good' },
    { from_step_id: 'bad', to_step_id: 'e1' },
    { from_step_id: 'good', to_step_id: 'e1' },
  ],
};

test('C1: a SCRIPT failure discovered mid-pump settles errored and is never overwritten by a later branch reaching END', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, C1_PROBE_SPEC, 'wf-c1-probe');
  await pumpUntilQuiet(db, testDeps());
  const ui = await stepRow(db, wi.id, 'ui');
  expect(ui.state).toBe('WAITING_USER');

  await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'submit' }, 0, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('errored');
  expect(after.finalState).toBe('errored');

  const bad = await stepRow(db, wi.id, 'bad');
  expect(bad.state).toBe('ERRORED');

  const trace = await traceOf(db, wi.id);
  const errorTraceCount = trace.filter(([, state]) => state === 'ERRORED').length;
  expect(errorTraceCount).toBe(1); // settled exactly once — no double-settle noise
  await close();
});

// ── submit on a non-running instance throws NOT_RUNNING ──

test('submit on a non-running (e.g. paused) instance throws EngineError(NOT_RUNNING)', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, UI_SPEC, 'wf-ui-paused');
  await pumpUntilQuiet(db, testDeps());
  await db.update(workflowInstance).set({ status: 'paused' }).where(eq(workflowInstance.id, wi.id));

  const err = await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'button_press', button_output: 'done' }, 0, testDeps())
    .catch((e) => e);
  expect(err).toBeInstanceOf(EngineError);
  expect((err as EngineError).code).toBe('NOT_RUNNING');
  await close();
});

// ── pause/resume short-circuit ──

test('pause parks a step as PAUSED (trace PAUSED); resume restores its exact park state (trace EXECUTING) and it can still be completed', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, UI_SPEC, 'wf-ui-pause');
  await pumpUntilQuiet(db, testDeps());

  await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'pause' }, 0, testDeps());
  let ui = await stepRow(db, wi.id, 'ui');
  expect(ui.state).toBe('PAUSED');

  await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'resume' }, 0, testDeps());
  ui = await stepRow(db, wi.id, 'ui');
  expect(ui.state).toBe('WAITING_USER'); // restored, not just a generic "EXECUTING"

  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['ui', 'PAUSED', null]);

  await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'button_press', button_output: 'done' }, 1, testDeps());
  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  await close();
});

// ── resource block -> WAITING trace -> release re-activates ──
//
// Adapted from res-binary-002's PARALLEL/binary-exclusive/WAIT-ALL shape: under this engine's
// one-step-per-transaction pump model, two SCRIPT branches would never actually contend (the
// first always completes-and-releases before the second is ever picked up). Making the FIRST
// holder a USER_INTERACTION step (parked, so it holds the lock until an explicit submit) gives
// deterministic control to force real contention — the second branch's Acquire genuinely
// blocks while the first is still parked.
const RES_BLOCK_SPEC = {
  local_id: 'wf', oid: 'wf-res-block', version: '1.0.0', last_modified_date: '2026-01-01',
  resource_property_specifications: [{ name: 'Lock', resource_type: 'binary exclusive use' }],
  steps: [
    step('s1', 'START'),
    step('p1', 'PARALLEL'),
    step('branch-a', 'USER_INTERACTION', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Lock' },
        { command_type: 'Release', resource_name: 'Lock' },
      ],
    }),
    step('branch-b', 'SCRIPT', {
      script_config: { source: "output.b = 'done';" },
      output_parameter_specifications: [{ id: 'b', target: 'Result.B' }],
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Lock' },
        { command_type: 'Release', resource_name: 'Lock' },
      ],
    }),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'branch-a' },
    { from_step_id: 'p1', to_step_id: 'branch-b' },
    { from_step_id: 'branch-a', to_step_id: 'wa' },
    { from_step_id: 'branch-b', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
};

test('a resource block records a WAITING trace and stays queue-state READY; releasing re-activates it', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, RES_BLOCK_SPEC, 'wf-res-block');
  await pumpUntilQuiet(db, testDeps());

  const branchA = await stepRow(db, wi.id, 'branch-a');
  expect(branchA.state).toBe('WAITING_USER'); // holds the Lock while parked

  const branchB = await stepRow(db, wi.id, 'branch-b');
  expect(branchB.state).toBe('READY'); // blocked, but queue state stays READY per design
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['branch-b', 'WAITING', null]);

  const [blocked] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  const engineState = blocked.engineState as { blockedOnResources?: Record<string, unknown> };
  expect(engineState.blockedOnResources?.['branch-b']).toBeTruthy();

  // Submitting branch-a releases the Lock, which must unblock and fully re-activate branch-b
  // (a SCRIPT step — it runs the rest of the way to COMPLETED on its own) within the SAME
  // release cascade, and the WAIT ALL join + END must follow.
  await submitUserAction(db, wi.id, { step_oid: 'branch-a', action: 'submit' }, 0, testDeps());

  const branchBAfter = await stepRow(db, wi.id, 'branch-b');
  expect(branchBAfter.state).toBe('COMPLETED');
  const traceAfter = await traceOf(db, wi.id);
  const branchBStates = traceAfter.filter(([oid]) => oid === 'branch-b').map(([, state]) => state);
  expect(branchBStates).toEqual(['WAITING', 'COMPLETED']);

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  expect(after.propertyStore).toMatchObject({ 'Result.B': 'done' });

  const [finalState] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  const finalEngineState = finalState.engineState as { blockedOnResources?: Record<string, unknown> };
  expect(finalEngineState.blockedOnResources?.['branch-b']).toBeUndefined();
  await close();
});

// ── I3 (Important, proven by review): a grant produced by an EARLIER command in a blocking
// activation list must not strand ──
//
// 'sender's own activation list is [Send(Chan), Acquire(Lock)]: the Send succeeds immediately
// and queues a grant for 'receiver' (already parked waiting on Receive), but the Acquire right
// after it blocks (holder never releases Lock). Before the fix, processReadyStep recorded the
// WAITING trace for 'sender' and returned WITHOUT flushing that grant — 'receiver' would never
// resume, since nothing else in this instance would ever call resumeGrantedSteps for it.
// filler1/filler2 exist purely to guarantee 'sender' is created (via a longer chain) strictly
// after holder/receiver's PARALLEL-fan-out siblings have already had their turn.
const I3_SPEC = {
  local_id: 'wf', oid: 'wf-i3-grant-strand', version: '1.0.0', last_modified_date: '2026-01-01',
  resource_property_specifications: [
    { name: 'Chan', resource_type: 'sync' },
    { name: 'Lock', resource_type: 'binary exclusive use' },
  ],
  steps: [
    step('s1', 'START'),
    step('p1', 'PARALLEL'),
    step('holder', 'MATH', { resource_command_specifications: [{ command_type: 'Acquire', resource_name: 'Lock' }] }),
    step('receiver', 'MATH', { resource_command_specifications: [{ command_type: 'Receive', resource_name: 'Chan', target: 'Result.Data' }] }),
    step('filler1', 'MATH'),
    step('filler2', 'MATH'),
    step('sender', 'SCRIPT', {
      script_config: { source: "output.ok = 'yes';" },
      output_parameter_specifications: [{ id: 'ok', target: 'Result.Sent' }],
      resource_command_specifications: [
        { command_type: 'Send', resource_name: 'Chan' },
        { command_type: 'Acquire', resource_name: 'Lock' },
      ],
    }),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'holder' },
    { from_step_id: 'p1', to_step_id: 'receiver' },
    { from_step_id: 'p1', to_step_id: 'filler1' },
    { from_step_id: 'filler1', to_step_id: 'filler2' },
    { from_step_id: 'filler2', to_step_id: 'sender' },
    { from_step_id: 'holder', to_step_id: 'wa' },
    { from_step_id: 'receiver', to_step_id: 'wa' },
    { from_step_id: 'sender', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
};

test('I3: a grant produced by an earlier command in a blocking activation list (Send-then-blocked-Acquire) is flushed, not stranded', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, I3_SPEC, 'wf-i3-grant-strand');
  await pumpUntilQuiet(db, testDeps());

  const receiver = await stepRow(db, wi.id, 'receiver');
  expect(receiver.state).toBe('COMPLETED'); // its Receive grant must not strand

  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['receiver', 'WAITING', null]);
  expect(trace).toContainEqual(['receiver', 'COMPLETED', null]);

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  await close();
});

// ── M5 (ledgered from Task 9's review): a resource-blocked instance with nothing else READY
// must not wedge every OTHER runnable instance behind it ──
//
// claimInstanceForWork orders by updated_at ASC; before this fix, processReadyStep's "every
// READY row is blocked" branch returned false WITHOUT touching the row, so a permanently
// blocked instance (nothing left in ITS OWN READY queue that could ever trigger the release)
// would keep sorting first forever and get re-claimed ahead of any healthy instance on every
// single runOnce call. This is the same head-of-line-blocking shape C2 guards against, but
// silent (a plain `false`, not a throw), so C2's settleFailedInstance recovery never sees it.
//
// Note: this drives runOnce directly in a bounded loop rather than pumpUntilQuiet — pumpUntilQuiet
// stops on the FIRST `false`, which is exactly what a permanently-blocked instance produces on
// every claim, so it isn't a fair driver once more than one instance is in play (the production
// startLoop isn't affected: its per-slot idle-wait means one slot's `false` doesn't stop the
// others). The fix under test (bumping the blocked instance's updated_at) is what lets repeated
// runOnce calls keep making room for the healthy instance instead of re-claiming the blocked one
// every time.
// More steps than the blocked instance's own "warm up" (PARALLEL, branch-a's park, branch-b's
// block-detection — 3 real units) needs, so the healthy instance still has pending READY work
// by the time the blocked instance goes permanently idle — otherwise fair (oldest-updated_at-
// first) interleaving alone would let it finish before the starvation window even opens, and
// the test would pass whether or not the M5 fix is present.
const MATH_CHAIN = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
const HEALTHY_LINEAR_SPEC = {
  local_id: 'wf', oid: 'wf-linear-m5', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('s1', 'START'), ...MATH_CHAIN.map(oid => step(oid, 'MATH')), step('e1', 'END')],
  connections: [
    { from_step_id: 's1', to_step_id: MATH_CHAIN[0] },
    ...MATH_CHAIN.slice(0, -1).map((oid, i) => ({ from_step_id: oid, to_step_id: MATH_CHAIN[i + 1] })),
    { from_step_id: MATH_CHAIN[MATH_CHAIN.length - 1], to_step_id: 'e1' },
  ],
};

test('M5: a permanently resource-blocked instance does not starve a healthy instance behind it', async () => {
  const { db, close } = await makeTestDb();
  const blockedInstance = await seedQueued(db, RES_BLOCK_SPEC, 'wf-res-block-m5');
  await new Promise((r) => setTimeout(r, 2)); // distinct queued_at/updated_at ordering
  const healthy = await seedQueued(db, HEALTHY_LINEAR_SPEC, 'wf-linear-m5');

  const deps = testDeps();
  for (let i = 0; i < 30; i++) {
    await runOnce(db, deps);
  }

  const [healthyAfter] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, healthy.id));
  expect(healthyAfter.status).toBe('completed');

  const [blockedAfter] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, blockedInstance.id));
  expect(blockedAfter.status).toBe('running'); // still stuck on branch-a's park — expected
  const branchB = await stepRow(db, blockedInstance.id, 'branch-b');
  expect(branchB.state).toBe('READY'); // still blocked, never re-attempted from scratch
  await close();
});

// ── I2 (Important, Task 13 post-review, proven divergence): release + resume must run at
// DEQUEUE time (after every sibling from the SAME wave already had its own first activation
// attempt), never at the completing step's own completion time — driven directly against the
// VENDORED res-binary-002 fixture's own shape (not a transcribed copy), since that fixture's
// own `expected` block carries no `execution_trace` and so could never catch this divergence
// through the conformance suite alone. Two PARALLEL siblings (branch-a, branch-b) both Acquire
// then Release the SAME binary-exclusive Lock; branch-a is declared first, so it wins the race
// and completes first — but pre-fix, ITS OWN release fired immediately at completion, inside
// PARALLEL's own routing for-loop, BEFORE branch-b (the very next sibling in that SAME loop)
// ever got a chance to attempt its own Acquire — so branch-b's Acquire always succeeded
// immediately and the reference's WAITING trace entry never appeared. ──
test('I2 regression: release + resume run at dequeue time, not completion time (res-binary-002 fixture shape) — branch-b records WAITING before the sibling release unblocks it', async () => {
  const { db, close } = await makeTestDb();
  const fixturePath = join(import.meta.dirname, '../src/conformance/fixtures/resources/res-binary-002-exclusive-wait.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const wi = await seedQueued(db, fixture.workflow, fixture.workflow.oid);
  await pumpUntilQuiet(db, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  expect(after.propertyStore).toMatchObject({ 'Result.A': 'done', 'Result.B': 'done' });

  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['branch-b', 'WAITING', null]);
  // Full hand-derived order (see the header comment above): branch-a wins the race and
  // completes first; branch-b blocks (WAITING) while branch-a is still just sitting queued, not
  // yet dequeued; branch-a's OWN dequeue is what releases the lock and resumes branch-b, which
  // then completes in the SAME cascade; 'wait' is satisfied on branch-a's own arrival (branch-b
  // is already COMPLETED in the DB by then, even though its own routing to 'wait' hasn't run
  // yet) — no EXECUTING park for the join.
  expect(trace).toEqual([
    ['start', 'COMPLETED', null], ['parallel', 'COMPLETED', null], ['branch-a', 'COMPLETED', null],
    ['branch-b', 'WAITING', null], ['branch-b', 'COMPLETED', null], ['wait', 'COMPLETED', null], ['end', 'COMPLETED', null],
  ]);

  await close();
});

// ── Task 6: claim guard + auto action index ──
//
// Operator-API claim guard (spec §4.3): submitUserAction now takes an optional 6th `claim`
// argument ({assignmentId, userId}), checked INSIDE the same claimed transaction as the target
// step lookup — so a concurrent release/cancel of the assignment can't slip between check and
// submit. And the reconcile tail (Task 5's reconcileAndNotify) now runs at the END of
// submitUserAction's own transaction, closing the assignment the moment the step completes —
// offers.test.ts's Scenario E used to call reconcileAndNotify explicitly as a stand-in for this;
// that explicit call is now redundant (removed there, same commit).

async function seedUser(db: any, email: string): Promise<{ id: string }> {
  const [u] = await db.insert(appUser).values({ email, displayName: email }).returning();
  return u;
}

/** The live instance_assignment row for a given step — joined through step_instance, since
 *  instance_assignment carries no workflow_instance_id column of its own. */
async function assignmentForStep(db: any, instanceId: string, stepOid: string): Promise<any> {
  const rows = await db.select({
    id: instanceAssignment.id,
    status: instanceAssignment.status,
    stepInstanceId: instanceAssignment.stepInstanceId,
    assignedUserId: instanceAssignment.assignedUserId,
  }).from(instanceAssignment)
    .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
    .where(and(eq(stepInstance.workflowInstanceId, instanceId), eq(stepInstance.stepOid, stepOid)));
  return rows[0];
}

const TWO_UI_SPEC = {
  local_id: 'wf', oid: 'wf-two-ui', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('s1', 'START'), step('ui1', 'USER_INTERACTION'), step('ui2', 'USER_INTERACTION'), step('e1', 'END')],
  connections: [
    { from_step_id: 's1', to_step_id: 'ui1' },
    { from_step_id: 'ui1', to_step_id: 'ui2' },
    { from_step_id: 'ui2', to_step_id: 'e1' },
  ],
};

describe('submitUserAction: claim guard + auto action index (Task 6)', () => {
  test('NOT_CLAIMANT: assignment is claimed, but by a DIFFERENT user than the caller', async () => {
    const { db, close } = await makeTestDb();
    const wi = await seedQueued(db, UI_SPEC, 'wf-ui-claim-a');
    await pumpUntilQuiet(db, testDeps());
    const userA = await seedUser(db, `a-${Math.random()}@t.test`);
    const userB = await seedUser(db, `b-${Math.random()}@t.test`);
    const offer = await assignmentForStep(db, wi.id, 'ui');
    await db.update(instanceAssignment).set({ status: 'claimed', assignedUserId: userA.id })
      .where(eq(instanceAssignment.id, offer.id));

    const err = await submitUserAction(
      db, wi.id, { step_oid: 'ui', action: 'submit' }, 'auto', testDeps(),
      { assignmentId: offer.id, userId: userB.id },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe('NOT_CLAIMANT');
    await close();
  });

  test('NOT_CLAIMANT: assignment is still just offered (never claimed by anyone)', async () => {
    const { db, close } = await makeTestDb();
    const wi = await seedQueued(db, UI_SPEC, 'wf-ui-claim-b');
    await pumpUntilQuiet(db, testDeps());
    const userA = await seedUser(db, `a-${Math.random()}@t.test`);
    const offer = await assignmentForStep(db, wi.id, 'ui');
    expect(offer.status).toBe('offered'); // never claimed

    const err = await submitUserAction(
      db, wi.id, { step_oid: 'ui', action: 'submit' }, 'auto', testDeps(),
      { assignmentId: offer.id, userId: userA.id },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe('NOT_CLAIMANT');
    await close();
  });

  test('NOT_CLAIMANT: assignment is validly claimed by the caller, but for a DIFFERENT step', async () => {
    const { db, close } = await makeTestDb();
    const wiA = await seedQueued(db, UI_SPEC, 'wf-ui-claim-c1');
    const wiB = await seedQueued(db, UI_SPEC, 'wf-ui-claim-c2');
    await pumpUntilQuiet(db, testDeps());
    const userA = await seedUser(db, `a-${Math.random()}@t.test`);

    const offerB = await assignmentForStep(db, wiB.id, 'ui');
    await db.update(instanceAssignment).set({ status: 'claimed', assignedUserId: userA.id })
      .where(eq(instanceAssignment.id, offerB.id));

    // offerB is validly held by userA, but it points at instance B's step row — submitting
    // against instance A's own 'ui' step with it must still be rejected.
    const err = await submitUserAction(
      db, wiA.id, { step_oid: 'ui', action: 'submit' }, 'auto', testDeps(),
      { assignmentId: offerB.id, userId: userA.id },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe('NOT_CLAIMANT');
    await close();
  });

  test('happy path with claim: claimed by userA, submit as userA resolves; step COMPLETED, assignment completed (reconcile tail)', async () => {
    const { db, close } = await makeTestDb();
    const wi = await seedQueued(db, UI_SPEC, 'wf-ui-claim-happy');
    await pumpUntilQuiet(db, testDeps());
    const userA = await seedUser(db, `a-${Math.random()}@t.test`);
    const offer = await assignmentForStep(db, wi.id, 'ui');
    await db.update(instanceAssignment).set({ status: 'claimed', assignedUserId: userA.id })
      .where(eq(instanceAssignment.id, offer.id));

    await submitUserAction(
      db, wi.id, { step_oid: 'ui', action: 'submit' }, 3, testDeps(),
      { assignmentId: offer.id, userId: userA.id },
    );

    const ui = await stepRow(db, wi.id, 'ui');
    expect(ui.state).toBe('COMPLETED');

    // The reconcile tail now runs INSIDE submitUserAction's own transaction — proves the
    // wiring; no separate explicit reconcileAndNotify call is needed anymore.
    const after = await assignmentForStep(db, wi.id, 'ui');
    expect(after.status).toBe('completed');

    const [instAfter] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
    expect(instAfter.status).toBe('completed');
    await close();
  });

  test("'auto' numbering: two sequential UI steps submitted with 'auto' carry after_action 0 then 1", async () => {
    const { db, close } = await makeTestDb();
    const wi = await seedQueued(db, TWO_UI_SPEC, 'wf-two-ui-a');
    await pumpUntilQuiet(db, testDeps());
    const deps = testDeps();

    const ui1 = await stepRow(db, wi.id, 'ui1');
    expect(ui1.state).toBe('WAITING_USER');

    await submitUserAction(db, wi.id, { step_oid: 'ui1', action: 'submit' }, 'auto', deps);
    let trace = await traceOf(db, wi.id);
    expect(trace).toContainEqual(['ui1', 'COMPLETED', 0]);

    const ui2 = await stepRow(db, wi.id, 'ui2');
    expect(ui2.state).toBe('WAITING_USER'); // parked in the same cascade that completed ui1

    await submitUserAction(db, wi.id, { step_oid: 'ui2', action: 'submit' }, 'auto', deps);
    trace = await traceOf(db, wi.id);
    expect(trace).toContainEqual(['ui2', 'COMPLETED', 1]);

    const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
    expect(after.status).toBe('completed');
    await close();
  });

  test('numeric actionIndex is still honored (harness compatibility): explicit 5 -> after_action 5', async () => {
    const { db, close } = await makeTestDb();
    const wi = await seedQueued(db, UI_SPEC, 'wf-ui-numeric');
    await pumpUntilQuiet(db, testDeps());

    await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'submit' }, 5, testDeps());

    const trace = await traceOf(db, wi.id);
    expect(trace).toContainEqual(['ui', 'COMPLETED', 5]);
    await close();
  });
});
