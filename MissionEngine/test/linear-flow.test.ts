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

import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { buildClaimInstanceQuery, runOnce, settleFailedInstance, MAX_START_ATTEMPTS } from '../src/loop.js';
import { WorkflowContext } from '../src/core/context.js';
import { MAX_CASCADE_ACTIVATIONS } from '../src/core/transition.js';

const step = (oid: string, step_type: string) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01',
});
const LINEAR_SPEC = {
  local_id: 'wf', oid: 'wf', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('s1', 'START'), step('s2', 'MATH'), step('s3', 'END')],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 's3' },
  ],
};

// Task 12 implemented the last permanently-unimplemented step type (WORKFLOW PROXY), so the
// C2 (head-of-line) poison mechanism can no longer rely on an unimplemented step type always
// throwing. Per the Task 10 reviewer's suggestion, poison is now an injected deps seam
// (EngineDeps.beforeStepActivation, config.ts) — a test-only hook called at the top of every
// step's activation that this test arms to throw for one specific step oid. The spec itself is
// an ordinary, fully-supported linear flow; only the injected hook makes 'p2' poisonous.
const POISON_SPEC = {
  local_id: 'poison', oid: 'poison', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('p1', 'START'), step('p2', 'MATH'), step('p3', 'END')],
  connections: [
    { from_step_id: 'p1', to_step_id: 'p2' },
    { from_step_id: 'p2', to_step_id: 'p3' },
  ],
};

const SCRIPT_SPEC = {
  local_id: 'wf-script', oid: 'wf-script', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'),
    {
      ...step('s2', 'SCRIPT'),
      script_config: { source: 'output.result = "42";' },
      output_parameter_specifications: [{ id: 'result', target: 'demo.result' }],
    },
    step('s3', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 's3' },
  ],
};

async function seedQueued(db: any, spec: unknown, oid = 'wf') {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return wi;
}

test('linear machine flow completes with reference-vocabulary trace', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, LINEAR_SPEC);
  await pumpUntilQuiet(db, testDeps());
  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  expect(after.finalState).toBe('completed');
  expect(after.startedAt).toBeTruthy();
  expect(after.completedAt).toBeTruthy();
  const trace = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, wi.id)).orderBy(traceEntry.id);
  expect(trace.map(t => [t.stepOid, t.state, t.orderIndex])).toEqual([
    ['s1', 'COMPLETED', 1], ['s2', 'COMPLETED', 2], ['s3', 'COMPLETED', 3],
  ]);
  const steps = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, wi.id));
  for (const s of steps) { expect(s.state).toBe('COMPLETED'); expect(s.nodeOid).toBe('wf'); }
  await close();
});

test('invalid spec errors the instance at acquire', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, { ...LINEAR_SPEC, steps: LINEAR_SPEC.steps.slice(0, 2) }); // no END
  await pumpUntilQuiet(db, testDeps());
  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('errored');
  const trace = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, wi.id));
  expect(trace.some(t => t.error)).toBe(true);
  await close();
});

test('runOnce reports idle when nothing is due', async () => {
  const { db, close } = await makeTestDb();
  expect(await runOnce(db, testDeps())).toBe(false);
  await close();
});

test('instance claim query really contains FOR UPDATE SKIP LOCKED (rendered from the live query, not a decorative pin)', () => {
  const dialect = new PgDialect();
  const { sql: rendered } = dialect.sqlToQuery(buildClaimInstanceQuery(['running']));
  expect(rendered.toLowerCase()).toContain('for update skip locked');
});

test('C1: acquire + instance start is one atomic transaction — a mid-start throw rolls all the way back to queued', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, LINEAR_SPEC);

  const originalPersist = WorkflowContext.prototype.persist;
  let armed = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  WorkflowContext.prototype.persist = async function (this: WorkflowContext, ...args: any[]) {
    if (armed) {
      armed = false;
      throw new Error('injected failure for C1 atomicity test');
    }
    return (originalPersist as any).apply(this, args);
  };

  try {
    // startInstanceFromQueued's final step is context.persist(tx) — by the time it throws,
    // the trace insert + successor step_instance insert have already run inside the SAME
    // transaction as acquireQueuedRuntimeWorkflows's queued->running flip. If the fix is
    // correct, ALL of it rolls back together.
    expect(await runOnce(db, testDeps())).toBe(false);
    const [afterThrow] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
    expect(afterThrow.status).toBe('queued');
    expect(afterThrow.startedAt).toBeFalsy();
    const stepsAfterThrow = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, wi.id));
    expect(stepsAfterThrow).toHaveLength(0);
    const traceAfterThrow = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, wi.id));
    expect(traceAfterThrow).toHaveLength(0);
  } finally {
    WorkflowContext.prototype.persist = originalPersist;
  }

  // Unpoisoned now: a clean pump completes it from scratch, proving the rollback left the
  // row in a legitimately retryable state rather than some half-started limbo.
  await pumpUntilQuiet(db, testDeps());
  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');

  await close();
});

test('C2: a poisoned instance is settled errored instead of wedging a healthy instance behind it', async () => {
  const { db, close } = await makeTestDb();
  const poison = await seedQueued(db, POISON_SPEC, 'poison');
  await new Promise((r) => setTimeout(r, 2)); // distinct queued_at/updated_at ordering
  const healthy = await seedQueued(db, LINEAR_SPEC, 'wf');

  const deps = testDeps({
    beforeStepActivation: (stepOid) => {
      if (stepOid === 'p2') throw new Error('injected poison for C2 test');
    },
  });
  await pumpUntilQuiet(db, deps);

  const [poisonAfter] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, poison.id));
  expect(poisonAfter.status).toBe('errored');
  expect(poisonAfter.finalState).toBe('errored');
  expect(poisonAfter.completedAt).toBeTruthy();
  const poisonSteps = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, poison.id));
  // p2 (MATH, poisoned by the injected hook) never got a chance to complete; it must not be
  // left dangling in a non-terminal queue state now that the instance itself is errored.
  const p2 = poisonSteps.find((s) => s.stepOid === 'p2');
  expect(p2?.state).toBe('ERRORED');

  const [healthyAfter] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, healthy.id));
  expect(healthyAfter.status).toBe('completed');
  expect(healthyAfter.finalState).toBe('completed');

  await close();
});

// ── I3 (Important, Task 13 post-review): drainCascade must be bounded — a validator-accepted
// machine cycle (the validator only proves every step is REACHABLE, never that every path
// TERMINATES) would otherwise run forever inside one open PG transaction. UNMATCHED_PARALLEL
// requires every PARALLEL to have SOME path reaching a WAIT ALL (validator.ts's
// hasMatchingWaitAll is a reachability BFS, not a "every branch converges" rule) — so the cycle
// lives on its OWN branch (cycle_a <-> cycle_b, forever), while a SEPARATE sibling branch
// ('healthy') is what actually satisfies the WAIT ALL/END requirement structurally. The cycle
// branch is never reached by anything that would let the instance finish; drainCascade's cap
// throws well before the healthy branch's own completion could matter. ──
const CYCLE_SPEC = {
  local_id: 'wf', oid: 'cycle', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('s1', 'START'), step('p1', 'PARALLEL'), step('cycle_a', 'MATH'), step('cycle_b', 'MATH'), step('healthy', 'MATH'), step('wa', 'WAIT ALL'), step('e1', 'END')],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'cycle_a' },
    { from_step_id: 'p1', to_step_id: 'healthy' },
    { from_step_id: 'cycle_a', to_step_id: 'cycle_b' },
    { from_step_id: 'cycle_b', to_step_id: 'cycle_a' },
    { from_step_id: 'healthy', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
};

test('I3: a cascade exceeding the hard activation cap settles the instance errored (not run forever), and the worker loop still reaches a healthy instance right after', async () => {
  const { db, close } = await makeTestDb();
  const poison = await seedQueued(db, CYCLE_SPEC, 'cycle');
  await new Promise((r) => setTimeout(r, 2));
  const healthy = await seedQueued(db, LINEAR_SPEC, 'wf-i3-healthy');

  const deps = testDeps();
  // Single runOnce: acquire+start is one atomic transaction (C1), so the WHOLE cycle_a<->cycle_b
  // ping-pong — thousands of activations — runs inside this ONE call before the cap throws and
  // instance.ts's own inline recovery (unaffected by this test) settles it errored.
  expect(await runOnce(db, deps)).toBe(true);

  const [poisonAfter] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, poison.id));
  expect(poisonAfter.status).toBe('errored');
  expect(poisonAfter.finalState).toBe('errored');
  const trace = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, poison.id));
  expect(trace.some((t) => t.error?.includes(`cascade exceeded ${MAX_CASCADE_ACTIVATIONS} activations`))).toBe(true);

  // The worker loop must still make progress on the healthy instance right after — the cap
  // firing settles the poisoned instance outright (no retry needed, unlike I4's transient-
  // failure case), so a single further pump suffices.
  await pumpUntilQuiet(db, deps);
  const [healthyAfter] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, healthy.id));
  expect(healthyAfter.status).toBe('completed');

  await close();
}, 60_000); // 10,000 cascade activations against PGlite needs real wall-clock time

// ── I4 (Important, Task 13 post-review): a DB-level failure that escapes even instance.ts's own
// inline recovery (its recovery statements THEMSELVES throw — simulated here by making
// WorkflowContext.prototype.persist always throw, scoped to the poisoned instance's own id so
// the healthy instance's unrelated persist calls are unaffected) must not permanently
// head-of-line-block the queue, and must not settle 'errored' on the very first transient blip
// either — bounded retry (rotate to the back of the queue) then give up. ──
test('I4: a DB-level failure escaping instance.ts\'s own recovery gets bounded retries (rotated to the back of the queue), never permanently head-of-line-blocks, then settles errored once exhausted', async () => {
  const { db, close } = await makeTestDb();
  const poison = await seedQueued(db, POISON_SPEC, 'poison-i4');
  await new Promise((r) => setTimeout(r, 2));
  const healthy = await seedQueued(db, LINEAR_SPEC, 'wf-i4-healthy');

  const originalPersist = WorkflowContext.prototype.persist;
  WorkflowContext.prototype.persist = async function (this: WorkflowContext, ...args: unknown[]) {
    if (this.id === poison.id) {
      throw new Error('injected DB-level failure for I4 test');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalPersist as any).apply(this, args);
  };

  const deps = testDeps({
    beforeStepActivation: (stepOid) => {
      if (stepOid === 'p2') throw new Error('injected poison for I4 test');
    },
  });

  try {
    // Attempt 1: startInstanceFromQueued's own drainCascade throws (poisoned 'p2'); instance.ts's
    // inline catch tries to recover, but ITS OWN context.persist(tx) call ALSO throws (poisoned
    // by id) — escaping the whole acquire+start transaction into loop.ts's NEW recoverFailedStart.
    expect(await runOnce(db, deps)).toBe(true);
    const [afterAttempt1] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, poison.id));
    expect(afterAttempt1.status).toBe('queued'); // NOT errored on the first blip
    expect((afterAttempt1.engineState as { startAttempts?: number } | null)?.startAttempts).toBe(1);

    // The poisoned instance's queued_at was just bumped to "now" — later than the healthy
    // instance's own (earlier) seed time — so it's no longer head-of-line-blocking: the very
    // next runOnce call must reach the healthy instance instead.
    expect(await runOnce(db, deps)).toBe(true);
    const [healthyAfter] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, healthy.id));
    expect(healthyAfter.status).toBe('completed');

    // Nothing else is queued now — subsequent runOnce calls keep re-attempting (and re-failing)
    // the poisoned instance until MAX_START_ATTEMPTS is reached, then it settles errored.
    expect(await runOnce(db, deps)).toBe(true); // attempt 2
    const [afterAttempt2] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, poison.id));
    expect(afterAttempt2.status).toBe('queued');
    expect((afterAttempt2.engineState as { startAttempts?: number } | null)?.startAttempts).toBe(2);

    expect(await runOnce(db, deps)).toBe(true); // attempt 3 === MAX_START_ATTEMPTS -> settle
    const [afterAttempt3] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, poison.id));
    expect(afterAttempt3.status).toBe('errored');
    expect(afterAttempt3.finalState).toBe('errored');
    expect(MAX_START_ATTEMPTS).toBe(3); // pins the constant this test's attempt-count reasoning depends on

    // Nothing left to acquire — the loop correctly reports idle rather than looping forever.
    expect(await runOnce(db, deps)).toBe(false);
  } finally {
    WorkflowContext.prototype.persist = originalPersist;
  }

  await close();
}, 30_000);

test('settleFailedInstance never clobbers an instance a different worker already resolved', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, LINEAR_SPEC);

  // Simulate the concurrency scenario directly: by the time this recovery transaction runs,
  // a DIFFERENT worker has already legitimately claimed and completed the instance (PGlite
  // can't run true concurrency, but the guard itself is single-threaded-testable this way).
  const completedAt = new Date();
  await db.update(workflowInstance).set({
    status: 'completed', finalState: 'completed', startedAt: new Date(), completedAt, updatedAt: completedAt,
  }).where(eq(workflowInstance.id, wi.id));

  await settleFailedInstance(db, wi.id, new Error('stale transition failure from a rolled-back worker'), testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  expect(after.finalState).toBe('completed');
  expect(after.completedAt?.getTime()).toBe(completedAt.getTime());

  const trace = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, wi.id));
  expect(trace).toHaveLength(0); // no phantom ERRORED trace appended after the real completion

  const steps = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, wi.id));
  expect(steps).toHaveLength(0); // none touched — the guard bailed before any write

  await close();
});

test('F1: a successful SCRIPT step snapshots its output parameters (reference engine.ts:1149-1162)', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, SCRIPT_SPEC, 'wf-script');
  await pumpUntilQuiet(db, testDeps());
  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  const state = after.engineState as { stepSnapshots?: Record<string, { outputParameters?: Record<string, string> }> };
  expect(state.stepSnapshots?.s2?.outputParameters).toEqual({ result: '42' });
  await close();
});
