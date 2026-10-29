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
// Task 18: the first place SKIP LOCKED semantics (loop.ts's claimInstanceForWork /
// acquireQueuedRuntimeWorkflows) run against a real, multi-connection Postgres server — every
// other engine test drives PGlite, which is single-connection and so cannot exercise a genuine
// race between two workers touching the SAME row at the SAME time.
//
// Pattern ← mission-control-db/test/real-pg.acquire.test.ts: env guard (REAL_PG_TEST_URL),
// describe.skipIf, migrate inside a beforeAll (idempotent), and a purge of any stray 'queued'
// row before this file's own tests start pumping runOnce db-wide — the Playwright e2e suite
// deliberately leaves one RW-1 instance 'queued' in this shared database, and unlike the acquire
// test (which only CLAIMS rows), this file's runOnce calls actually EXECUTE whatever they claim,
// so a stray leftover would get silently completed as a side effect of these tests if not
// neutralized first.
//
//   REAL_PG_TEST_URL=postgres://postgres:postgres@127.0.0.1:5432/mission_commander_e2e npm test -- real-pg.engine
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq, and, inArray, asc, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  workCenter, workflow, workflowInstance, stepInstance, traceEntry, runtimeHistory,
  wcResource, wcResourceWaiter, wcResourceHolder,
} from 'mission-control-db/src/db/schema/index';
import { createRuntimeWorkflow, requestStart } from 'mission-control-db/src/dao/runtime-workflows';
import { requestPause, requestAbort, requestStop } from 'mission-control-db/src/dao/runtime-control';
import { acquireQueuedRuntimeWorkflows } from 'mission-control-db/src/runtime/engine-access';
import { lockRegistry, applyRegistryWrites, NOTIFY_GRANT_CHANNEL } from 'mission-control-db/src/runtime/wc-resources';
import { createDb, type Db } from '../src/db.js';
import { runOnce } from '../src/loop.js';
import { runSweep } from '../src/core/sweep.js';
import { createWakeListener } from '../src/wake.js';
import { runControlPass } from '../src/core/control.js';
import { submitUserAction } from '../src/core/submit.js';
import { runWorkCenterResourceVerb } from '../src/core/operator-verbs.js';
import { InMemoryResourceManager } from '../src/core/resources.js';
import { envToken, snapshotToSerialized, indexWaiters, diffRegistry, type EnvHold } from '../src/core/env-resource-bridge.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { forceCompleteStep } from '../src/core/force-complete.js';
import type { EngineDeps } from '../src/config.js';
import { startStubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { cachedPolicySource } from '../src/actions/policy-cache.js';
import { getActionServerPolicy } from 'mission-control-db/src/dao/system-settings';

const url = process.env.REAL_PG_TEST_URL;

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

function singleStepSpec(oid: string) {
  return {
    local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('s1', 'START'), step('s2', 'MATH'), step('s3', 'END')],
    connections: [
      { from_step_id: 's1', to_step_id: 's2' },
      { from_step_id: 's2', to_step_id: 's3' },
    ],
  };
}

// PARALLEL 5-way fan-out, all auto-completing (MATH) branches joined by a single WAIT ALL —
// scenario (b)'s vehicle for proving the per-instance trace-order counter survives two workers
// genuinely, concurrently touching the SAME instance row.
const SIMPLE_SPEC_FOR_SWEEP = {
  local_id: 'wf', oid: 'wf-sweep-rpg', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('start', 'START'), step('end', 'END')],
  connections: [{ from_step_id: 'start', to_step_id: 'end' }],
};
const FAN_OUT_BRANCHES = ['b1', 'b2', 'b3', 'b4', 'b5'];
function parallelFanOutSpec(oid: string) {
  return {
    local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [
      step('s1', 'START'), step('p1', 'PARALLEL'),
      ...FAN_OUT_BRANCHES.map((b) => step(b, 'MATH')),
      step('wa', 'WAIT ALL'), step('e1', 'END'),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 'p1' },
      ...FAN_OUT_BRANCHES.map((b) => ({ from_step_id: 'p1', to_step_id: b })),
      ...FAN_OUT_BRANCHES.map((b) => ({ from_step_id: b, to_step_id: 'wa' })),
      { from_step_id: 'wa', to_step_id: 'e1' },
    ],
  };
}

/** Poll `check` until it reports true, or throw once `timeoutMs` has elapsed — preferred over a
 *  fixed sleep so these real-PG tests never guess a "surely long enough by then" delay. */
async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 5000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error('waitFor: condition not met before deadline');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Run `workerCount` independent runOnce loops CONCURRENTLY against the same real connection
 *  pool (genuine multi-connection racing — the whole point of this file) until `isDone` reports
 *  true, or `deadlineMs` elapses. Each worker only sleeps (a short, bounded poll interval, never
 *  a blind fixed wait) when IT personally finds nothing to do; work-bearing cycles never sleep. */
async function pumpConcurrently(
  db: Db, deps: EngineDeps, workerCount: number, isDone: () => Promise<boolean>, deadlineMs = 25_000,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let stop = false;
  async function worker(): Promise<void> {
    while (!stop && Date.now() < deadline) {
      const didWork = await runOnce(db, deps);
      if (!didWork) {
        if (await isDone()) { stop = true; return; }
        await new Promise((r) => setTimeout(r, 5));
      }
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (!stop) throw new Error('pumpConcurrently: deadline exceeded before isDone() reported true');
}

describe.skipIf(!url)('mission engine — real Postgres concurrency (Task 18)', () => {
  const conn = url ? createDb(url) : null;
  const pool = conn?.pool ?? null;
  const db = conn?.db ?? null;

  const cleanupWorkCenterIds: string[] = [];
  const createdInstanceIds: string[] = [];

  async function makeWorkCenterAndWorkflow(spec: unknown, label: string): Promise<{ wcId: string; wfId: string }> {
    const rand = Math.random().toString(36).slice(2, 8);
    const [wc] = await db!.insert(workCenter).values({ name: `RealPG-${label}-${Date.now()}-${rand}` }).returning();
    cleanupWorkCenterIds.push(wc.id);
    const [wf] = await db!.insert(workflow).values({
      workCenterId: wc.id, oid: `${label}-${rand}`, name: label, version: '1.0.0', state: 'Approved', specJsonb: spec,
    }).returning();
    return { wcId: wc.id, wfId: wf.id };
  }

  async function seedQueuedInstance(
    spec: unknown, label: string, wcId: string, wfId: string, runtimeNumber: number,
  ): Promise<string> {
    const [wi] = await db!.insert(workflowInstance).values({
      workflowId: wfId, workCenterId: wcId, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
      specJsonb: spec, startingParams: null, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
      masterName: label, masterOid: label, masterVersion: '1.0.0', masterState: 'Approved',
    }).returning();
    createdInstanceIds.push(wi.id);
    return wi.id;
  }

  beforeAll(async () => {
    if (!db) return;
    await migrate(db, { migrationsFolder: '../mission-control-db/drizzle' }); // idempotent
    // See the file header comment: neutralize the e2e suite's deliberately-left 'queued' RW-1
    // (and any other stray 'queued' row) before this file's own tests start pumping runOnce
    // db-wide — same precedent as mission-control-db/test/real-pg.acquire.test.ts.
    await pool!.query(`UPDATE workflow_instance SET status = 'completed' WHERE status = 'queued'`);
    // The operator-verb tests act as this user. Since migration 0044 a force-complete records
    // its actor in step_run.performed_by_user_id (FK to app_user), so the actor must exist.
    await pool!.query(
      `INSERT INTO app_user (id, email, display_name) VALUES ($1, 'realpg-actor@test.local', 'Real-PG actor') ON CONFLICT DO NOTHING`,
      ['99999999-9999-4999-8999-999999999999'],
    );

    // Task 7 review fix (Important 2): fail LOUDLY, with names, rather than silently — unlike the
    // queued-row purge above, a stray 'running' instance with a READY step is NOT auto-healed
    // here, because doing so would hide exactly the ambiguity this check exists to remove.
    // claimInstanceForWork's C2 branch (['running'], READY_STEP_EXISTS) is DB-WIDE, ordered by
    // updated_at ASC, with no work-center scoping — a claimable 'running'+READY instance already
    // sitting in the database before ANY test here has seeded one can only be a leftover from a
    // PRIOR run against this same (persistent, throwaway-container) database: either an earlier
    // test in THIS file leaked one (an isolation bug — Test 1's own hand-crafted 'running'+READY
    // racers are exactly the shape that can do this if left unresolved, see its own cleanup),
    // or a PRIOR suite invocation against this same container did. Left silent, such a row sorts
    // FIRST for any later test's one-shot concurrent runOnce race — including a completely
    // unrelated test's own workers — turning a real isolation bug into an ambiguous, hard-to
    // -reproduce cross-run flake instead of a loud, self-explaining failure at the one place that
    // can actually name the offender.
    const stray = await pool!.query(`
      select wi.id, wi.status, wi.updated_at
      from workflow_instance wi
      where wi.status = 'running'
        and exists (
          select 1 from step_instance si
          where si.workflow_instance_id = wi.id and si.state = 'READY'
        )
    `);
    if ((stray.rowCount ?? 0) > 0) {
      const detail = (stray.rows as { id: string; status: string; updated_at: Date }[])
        .map((r) => `${r.id} (status=${r.status}, updated_at=${r.updated_at.toISOString()})`)
        .join('; ');
      throw new Error(
        `real-pg.engine.test.ts pre-flight: found ${stray.rowCount} claimable 'running'+READY ` +
        `instance(s) already in the database before any test in this file seeded one. These ` +
        `would silently steal a unit of work from a later test's one-shot concurrent runOnce ` +
        `race (claimInstanceForWork's C2 branch is DB-wide and unscoped). This means either an ` +
        `earlier test in this file has an isolation bug, or this container was reused across a ` +
        `prior run that left state behind — recreate the throwaway container fresh and re-run. ` +
        `Offending instance(s): ${detail}`,
      );
    }
  });

  afterAll(async () => {
    try {
      if (db) {
        if (createdInstanceIds.length) {
          await db.delete(runtimeHistory).where(inArray(runtimeHistory.workflowInstanceId, createdInstanceIds));
          await db.delete(workflowInstance).where(inArray(workflowInstance.id, createdInstanceIds));
        }
        for (const wcId of cleanupWorkCenterIds) {
          await db.delete(workflow).where(eq(workflow.workCenterId, wcId));
          await db.delete(workCenter).where(eq(workCenter.id, wcId));
        }
      }
    } finally {
      await pool?.end();
    }
  });

  // ── (a) two concurrent runOnce loops over 10 queued single-step instances ──

  it('(a) two concurrent runOnce loops over 10 queued single-step instances: every instance completes exactly once', async () => {
    const spec = singleStepSpec('single-step-a');
    const { wcId, wfId } = await makeWorkCenterAndWorkflow(spec, 'scenario-a');

    const instanceIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      instanceIds.push(await seedQueuedInstance(spec, 'single-step-a', wcId, wfId, i + 1));
    }

    const deps = testDeps();
    // Pool is sized max: 10 (src/db.ts's createDb) — comfortably more than the 2 concurrent
    // workers below, so both can genuinely hold their own connection simultaneously rather than
    // queueing behind each other at the pool layer (which would silently defeat the point of
    // this test — it needs REAL simultaneous transactions, not two serialized ones).
    await pumpConcurrently(db!, deps, 2, async () => {
      const rows = await db!.select({ status: workflowInstance.status }).from(workflowInstance)
        .where(inArray(workflowInstance.id, instanceIds));
      return rows.length === instanceIds.length && rows.every((r) => r.status === 'completed');
    });

    const rows = await db!.select().from(workflowInstance).where(inArray(workflowInstance.id, instanceIds));
    expect(rows).toHaveLength(10);
    for (const r of rows) {
      expect(r.status).toBe('completed');
      expect(r.finalState).toBe('completed');
    }

    // Exactly one full, un-duplicated trace per instance — the aggregate proof that no instance
    // was ever double-claimed/double-processed by the two racing workers.
    for (const id of instanceIds) {
      const trace = await db!.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, id)).orderBy(asc(traceEntry.id));
      expect(trace.map((t) => [t.stepOid, t.state, t.orderIndex])).toEqual([
        ['s1', 'COMPLETED', 1], ['s2', 'COMPLETED', 2], ['s3', 'COMPLETED', 3],
      ]);
    }
  }, 40_000);

  // ── (b) instance-serialization: PARALLEL 5-way fan-out under two concurrent workers ──

  it('(b) instance-serialization: a PARALLEL 5-way fan-out under two concurrently-pumping workers gets a gapless, duplicate-free trace order', async () => {
    const spec = parallelFanOutSpec('parallel-b');
    const { wcId, wfId } = await makeWorkCenterAndWorkflow(spec, 'scenario-b');
    const instanceId = await seedQueuedInstance(spec, 'parallel-b', wcId, wfId, 1);

    const deps = testDeps();
    await pumpConcurrently(db!, deps, 2, async () => {
      const [row] = await db!.select({ status: workflowInstance.status }).from(workflowInstance)
        .where(eq(workflowInstance.id, instanceId));
      return row?.status === 'completed';
    });

    const [after] = await db!.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
    expect(after.status).toBe('completed');
    expect(after.finalState).toBe('completed');

    const trace = await db!.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(asc(traceEntry.id));
    const stepOids = ['s1', 'p1', ...FAN_OUT_BRANCHES, 'wa', 'e1'];
    expect(trace).toHaveLength(stepOids.length);

    // Strictly 1..n, no gaps or duplicates — the order counter (context.ts's recordTrace, a
    // read-increment-write on JSON state) is only race-free if claimInstanceForWork's FOR UPDATE
    // genuinely serializes the two workers' access to this ONE row; PGlite (single connection)
    // could never disprove a broken version of this.
    const orders = [...trace.map((t) => t.orderIndex)].sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(orders).toEqual(Array.from({ length: stepOids.length }, (_, i) => i + 1));

    // Every step traced exactly once, all COMPLETED — no duplicate processing under concurrency.
    for (const oid of stepOids) {
      const entries = trace.filter((t) => t.stepOid === oid);
      expect(entries).toHaveLength(1);
      expect(entries[0].state).toBe('COMPLETED');
    }
  }, 40_000);

  // ── (c) kill-mid-transition: an aborted partial transition never wedges a fresh runOnce ──

  it('(c) kill-mid-transition: a rolled-back partial transition leaves nothing behind — a fresh runOnce completes the instance normally', async () => {
    const spec = singleStepSpec('kill-mid-c');
    const { wcId, wfId } = await makeWorkCenterAndWorkflow(spec, 'scenario-c');
    const instanceId = await seedQueuedInstance(spec, 'kill-mid-c', wcId, wfId, 1);

    // Simulate a worker that crashed mid-transition: claim the row, write a PARTIAL transition
    // (flip to running + insert a stray step_instance row) on its own manually-managed
    // connection, then ROLLBACK instead of COMMIT — exactly what Postgres does automatically to
    // an aborted/disconnected transaction. This is real-PG-only in spirit even though PGlite
    // could technically run the same statements: the point is proving a genuinely SEPARATE
    // connection's abort releases the FOR UPDATE lock and leaves zero partial state behind, the
    // same guarantee two independent engine worker processes depend on in production.
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM workflow_instance WHERE id = $1 FOR UPDATE SKIP LOCKED', [instanceId]);
      await client.query(
        `UPDATE workflow_instance SET status = 'running', started_at = now(), updated_at = now() WHERE id = $1`,
        [instanceId],
      );
      await client.query(
        `INSERT INTO step_instance (workflow_instance_id, node_oid, step_oid, step_type, state, created_at, updated_at)
         VALUES ($1, $2, 's1', 'START', 'READY', now(), now())`,
        [instanceId, 'kill-mid-c'],
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // The rollback must have undone everything — proves nothing lingers half-committed.
    const [afterRollback] = await db!.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
    expect(afterRollback.status).toBe('queued');
    const strayRows = await db!.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
    expect(strayRows).toHaveLength(0);

    // A fresh runOnce, unaware anything happened, completes the instance normally.
    await pumpUntilQuiet(db!, testDeps());
    const [after] = await db!.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
    expect(after.status).toBe('completed');
    expect(after.finalState).toBe('completed');
    const trace = await db!.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(asc(traceEntry.id));
    expect(trace.map((t) => [t.stepOid, t.state, t.orderIndex])).toEqual([
      ['s1', 'COMPLETED', 1], ['s2', 'COMPLETED', 2], ['s3', 'COMPLETED', 3],
    ]);
  }, 30_000);

  // ── (d) LISTEN round-trip: createWakeListener really receives the migration 0018 trigger ──

  it('(d) LISTEN round-trip: createWakeListener receives a notification when requestStart -> acquire -> requestPause each fire the workflow_instance status trigger', async () => {
    // Defensive purge (same fix as the Task 13 ledger test below, and for the identical reason):
    // acquireQueuedRuntimeWorkflows claims db-wide, oldest queued_at first, unscoped to any
    // instance id. If an earlier test left a stray 'queued' row with an older queued_at than this
    // test's own (just requestStart'd) instance, the acquire call below would claim the WRONG
    // row — created.id would stay stuck 'queued', and requestPause would then throw
    // RUNTIME_INVALID_STATE ('cannot pause from queued') for a confusing, unrelated reason. In
    // the normal (non-broken) run this is currently masked by an incidental invariant — every
    // earlier scenario's own pump loop happens to drain its queue first — but that invariant was
    // never designed, only assumed; purge explicitly so this test's correctness doesn't depend on
    // every earlier test having fully drained its own work first.
    await pool!.query(`UPDATE workflow_instance SET status = 'completed' WHERE status = 'queued'`);

    const spec = singleStepSpec('wake-d');
    const { wfId } = await makeWorkCenterAndWorkflow(spec, 'scenario-d');
    const created = await createRuntimeWorkflow(db!, { workflowId: wfId, params: {}, userId: null });
    createdInstanceIds.push(created.id);

    const rand = Math.random().toString(36).slice(2, 8);
    const appName = `engine-wake-test-${rand}`;
    const listenerUrl = `${url}${url!.includes('?') ? '&' : '?'}application_name=${appName}`;
    let notifications = 0;
    const handle = createWakeListener(listenerUrl, () => { notifications++; });

    try {
      // createWakeListener exposes no "ready" callback of its own — pg_stat_activity is the only
      // externally-observable signal that its dedicated Client has actually issued LISTEN, so
      // poll for that rather than guessing a fixed connect delay (which would either race the
      // trigger or waste time on every run).
      await waitFor(async () => {
        const res = await pool!.query(
          `select 1 from pg_stat_activity where application_name = $1 and query ilike 'listen%'`,
          [appName],
        );
        return (res.rowCount ?? 0) > 0;
      });

      // requestStart: pending -> queued (UPDATE OF status) fires the trigger.
      const beforeStart = notifications;
      await requestStart(db!, created.id, null);
      await waitFor(async () => notifications > beforeStart);

      // acquireQueuedRuntimeWorkflows: queued -> running (also UPDATE OF status) — needed so
      // requestPause below (which requires status = 'running') is legal; also fires the trigger,
      // proving the trigger isn't special-cased to one particular DAO.
      const beforeAcquire = notifications;
      await acquireQueuedRuntimeWorkflows(db!, 1);
      await waitFor(async () => notifications > beforeAcquire);

      // requestPause: running -> pausing fires the trigger again.
      const beforePause = notifications;
      await requestPause(db!, created.id);
      await waitFor(async () => notifications > beforePause);
    } finally {
      handle.stop();
    }
  }, 20_000);

  // ── Task 13 ledger item: settleFailedInstance's mid-transition (processReadyStep) path ──
  //
  // progress.md's Task 13 note: "settleFailedInstance integration path now dead (C2 poisons at
  // start)" — under the post-Task-13 EAGER cascade model, materializeAndActivate inserts a
  // step's row and calls runStepActivation in the very same call, so a genuinely stray READY row
  // surviving to a LATER, SEPARATE runOnce/processReadyStep transaction cannot occur naturally
  // any more (every existing poison test — linear-flow.test.ts's C2/I3/I4 — throws during the
  // INITIAL acquire+start cascade instead, exercising instance.ts's own inline recovery or
  // recoverFailedStart, never loop.ts's own processReadyStep-driven catch). The existing
  // "settleFailedInstance never clobbers..." test already hand-crafts state to isolate its OWN
  // narrower guard, but calls settleFailedInstance directly — it never proves runOnce's actual
  // C2 try/catch wiring (claim -> processReadyStep -> catch -> settleFailedInstance) fires at
  // all. This test hand-crafts a 'running' instance with a stray READY row up front (the one way
  // left to get such a row in front of processReadyStep) and drives it through the REAL runOnce
  // entry point, then asserts the full result: instance settlement, step quiescence, AND — closing
  // the Task 17 minor gap noted in the same ledger ("no runtime_history CONTENT assertions for...
  // settleFailedInstance") — the actual runtime_history row content.
  it('Task 13 ledger: a genuine processReadyStep throw on an already-running instance is caught by runOnce\'s C2 recovery (settleFailedInstance) — history row + step quiescence', async () => {
    // This test drives exactly ONE runOnce() call and depends on it reaching the C2 branch
    // (nothing queued to steal the acquire+start branch's single unit of work first) — purge any
    // stray 'queued' row defensively, same precedent as beforeAll's own purge, so this test's
    // correctness never depends on every earlier test in this file having fully drained its own
    // work first (verified load-bearing: a deliberately-broken earlier run that left its own
    // instance 'queued' made this exact call silently do THAT unrelated work instead).
    await pool!.query(`UPDATE workflow_instance SET status = 'completed' WHERE status = 'queued'`);

    const spec = singleStepSpec('c2-mid-transition');
    const { wcId, wfId } = await makeWorkCenterAndWorkflow(spec, 'scenario-c2');

    const [wi] = await db!.insert(workflowInstance).values({
      workflowId: wfId, workCenterId: wcId, triggeredBy: 'manual', status: 'running', startedAt: new Date(),
      specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
      masterName: 'c2-mid-transition', masterOid: 'c2-mid-transition', masterVersion: '1.0.0', masterState: 'Approved',
    }).returning();
    createdInstanceIds.push(wi.id);

    await db!.insert(stepInstance).values({
      workflowInstanceId: wi.id, nodeOid: 'c2-mid-transition', stepOid: 's2', stepType: 'MATH', state: 'READY',
    });

    const injectedMessage = 'injected mid-transition failure for Task 13 ledger test';
    const deps = testDeps({
      beforeStepActivation: (stepOid) => {
        if (stepOid === 's2') throw new Error(injectedMessage);
      },
    });

    // A single runOnce: the acquire+start branch finds nothing queued, falls through to C2
    // (claimInstanceForWork(['running'], READY_STEP_EXISTS) finds our hand-crafted row), throws
    // inside processReadyStep, and the catch calls settleFailedInstance — all within this one call.
    const didWork = await runOnce(db!, deps);
    expect(didWork).toBe(true);

    const [after] = await db!.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
    expect(after.status).toBe('errored');
    expect(after.finalState).toBe('errored');
    expect(after.completedAt).toBeTruthy();

    const steps = await db!.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, wi.id));
    expect(steps).toHaveLength(1);
    expect(steps[0].state).toBe('ERRORED');
    expect(steps[0].error).toContain(injectedMessage);

    const trace = await db!.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, wi.id)).orderBy(asc(traceEntry.id));
    expect(trace).toHaveLength(1);
    expect(trace[0].stepOid).toBeNull();
    expect(trace[0].state).toBe('ERRORED');
    expect(trace[0].error).toContain(injectedMessage);

    const [history] = await db!.select().from(runtimeHistory).where(eq(runtimeHistory.workflowInstanceId, wi.id));
    expect(history).toBeDefined();
    expect(history.finalState).toBe('errored');
    expect(history.trace).toEqual([
      { step_oid: '', state: 'ERRORED', order: 1, timestamp: expect.any(Number), error: expect.stringContaining(injectedMessage) },
    ]);
  }, 15_000);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Task 7 (Phase 2a): real-Postgres contention proof for the SHARED work-center resource
  // registry (wc_resource / wc_resource_waiter / wc_resource_holder — mission-control-db's
  // wc-resources.ts, bridged into the engine's InMemoryResourceManager by
  // src/core/env-resource-bridge.ts, routed by src/core/env-scope.ts, hydrated/written back by
  // src/core/context.ts's openContext/persist/settleTerminal). Every OTHER test of this tier
  // (env-resources-hydrate/writeback/routing/migration.test.ts) runs on PGlite, which is
  // single-connection — it can construct the CORRECT end state sequentially, but it can never
  // construct two transactions that are genuinely OPEN AT THE SAME TIME, so it can never
  // disprove a version of `lockRegistry` that dropped its `for update` clause. These seven tests
  // are that proof: each is explained inline for exactly how it forces or discovers genuine
  // multi-connection contention, not just a sequence of separate-but-never-overlapping calls.
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  // included_actions: [] is REQUIRED by full-engine spec validation (the queued -> start path's
  // schema check) on every environment_specifications entry, even an empty one — the hydrate
  // -only PGlite fixtures elsewhere in this suite omit it because they call openContext directly
  // and never go through validation; the full engine path here does.
  const ENV_PRINTER_T7 = {
    local_id: 'env-printer-t7', oid: 'env-printer-t7', version: '1.0.0', last_modified_date: '2026-01-01',
    included_actions: [],
    resource_property_specifications: [{ name: 'Printer', resource_type: 'binary exclusive use' as const }],
  };
  const ENV_BAY_T7 = {
    local_id: 'env-bay-t7', oid: 'env-bay-t7', version: '1.0.0', last_modified_date: '2026-01-01',
    included_actions: [],
    resource_property_specifications: [{ name: 'Bay', resource_type: 'named pool' as const, names: ['Bay-A', 'Bay-B'] }],
  };
  const ENV_CHAN_T7 = {
    local_id: 'env-chan-t7', oid: 'env-chan-t7', version: '1.0.0', last_modified_date: '2026-01-01',
    included_actions: [],
    resource_property_specifications: [{ name: 'Chan', resource_type: 'sync' as const }],
  };
  const ENV_AB_T7 = {
    local_id: 'env-ab-t7', oid: 'env-ab-t7', version: '1.0.0', last_modified_date: '2026-01-01',
    included_actions: [],
    resource_property_specifications: [
      { name: 'ResA', resource_type: 'binary exclusive use' as const },
      { name: 'ResB', resource_type: 'binary exclusive use' as const },
    ],
  };

  /** A step that Acquires `resourceName` then PARKS (USER_INTERACTION never auto-completes) —
   *  holds the resource indefinitely until submitUserAction fires, giving the test full control
   *  over exactly when a hold is released. Mirrors env-resources-writeback.test.ts's
   *  ACQUIRE_PARK_SPEC precedent. */
  function t7ParkAcquireSpec(oid: string) {
    return {
      local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
      environment_specifications: [ENV_PRINTER_T7],
      steps: [
        step('s1', 'START'),
        step('ui', 'USER_INTERACTION', {
          resource_command_specifications: [{ command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer-t7' }],
        }),
        step('e1', 'END'),
      ],
      connections: [{ from_step_id: 's1', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'e1' }],
    };
  }
  /** Same as above but ALSO releases on the same step's completion — lets a single
   *  submitUserAction call drive the release, matching ACQUIRE_RELEASE_PARK_SPEC's precedent. */
  function t7ParkAcquireReleaseSpec(oid: string) {
    return {
      local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
      environment_specifications: [ENV_PRINTER_T7],
      steps: [
        step('s1', 'START'),
        step('ui', 'USER_INTERACTION', {
          resource_command_specifications: [
            { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer-t7' },
            { command_type: 'Release', resource_name: 'Printer', resource_source_oid: 'env-printer-t7' },
          ],
        }),
        step('e1', 'END'),
      ],
      connections: [{ from_step_id: 's1', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'e1' }],
    };
  }
  /** A step that Acquires `resourceName` and, once granted, auto-completes straight through to
   *  END (no park) — used where the test wants a plain "grab or queue" contender. */
  function t7GrabPrinterSpec(oid: string) {
    return {
      local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
      environment_specifications: [ENV_PRINTER_T7],
      steps: [
        step('s1', 'START'),
        step('grab', 'MATH', {
          resource_command_specifications: [{ command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer-t7' }],
        }),
        step('e1', 'END'),
      ],
      connections: [{ from_step_id: 's1', to_step_id: 'grab' }, { from_step_id: 'grab', to_step_id: 'e1' }],
    };
  }
  function t7NamedPoolHolderSpec(oid: string) {
    return {
      local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
      environment_specifications: [ENV_BAY_T7],
      steps: [
        step('s1', 'START'),
        step('ui', 'USER_INTERACTION', {
          resource_command_specifications: [
            { command_type: 'Acquire', resource_name: 'Bay', resource_source_oid: 'env-bay-t7', target: 'Result.Held' },
            { command_type: 'Release', resource_name: 'Bay', resource_source_oid: 'env-bay-t7', target: 'Result.Held' },
          ],
        }),
        step('e1', 'END'),
      ],
      connections: [{ from_step_id: 's1', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'e1' }],
    };
  }
  function t7NamedPoolWaiterSpec(oid: string) {
    return {
      local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
      environment_specifications: [ENV_BAY_T7],
      steps: [
        step('s1', 'START'),
        step('grab', 'MATH', {
          resource_command_specifications: [{ command_type: 'Acquire', resource_name: 'Bay', resource_source_oid: 'env-bay-t7', target: 'Result.Held' }],
        }),
        step('e1', 'END'),
      ],
      connections: [{ from_step_id: 's1', to_step_id: 'grab' }, { from_step_id: 'grab', to_step_id: 'e1' }],
    };
  }
  function t7SenderSpec(oid: string) {
    return {
      local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
      environment_specifications: [ENV_CHAN_T7],
      steps: [
        step('s1', 'START'),
        step('setmsg', 'SCRIPT', {
          script_config: { source: "output.msg = 'payload-from-A';" },
          output_parameter_specifications: [{ id: 'msg', target: 'Result.Payload' }],
        }),
        step('send', 'MATH', {
          resource_command_specifications: [{ command_type: 'Send', resource_name: 'Chan', resource_source_oid: 'env-chan-t7', source: 'Result.Payload' }],
        }),
        step('e1', 'END'),
      ],
      connections: [
        { from_step_id: 's1', to_step_id: 'setmsg' },
        { from_step_id: 'setmsg', to_step_id: 'send' },
        { from_step_id: 'send', to_step_id: 'e1' },
      ],
    };
  }
  function t7ReceiverSpec(oid: string) {
    return {
      local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
      environment_specifications: [ENV_CHAN_T7],
      steps: [
        step('s1', 'START'),
        step('recv', 'MATH', {
          resource_command_specifications: [{ command_type: 'Receive', resource_name: 'Chan', resource_source_oid: 'env-chan-t7', target: 'Result.Received' }],
        }),
        step('e1', 'END'),
      ],
      connections: [{ from_step_id: 's1', to_step_id: 'recv' }, { from_step_id: 'recv', to_step_id: 'e1' }],
    };
  }
  function t7AcquireOrderSpec(oid: string, first: string, second: string) {
    return {
      local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
      environment_specifications: [ENV_AB_T7],
      steps: [
        step('s1', 'START'),
        step('a1', 'MATH', { resource_command_specifications: [{ command_type: 'Acquire', resource_name: first, resource_source_oid: 'env-ab-t7' }] }),
        step('a2', 'MATH', { resource_command_specifications: [{ command_type: 'Acquire', resource_name: second, resource_source_oid: 'env-ab-t7' }] }),
        step('a3', 'MATH', {
          resource_command_specifications: [
            { command_type: 'Release', resource_name: first, resource_source_oid: 'env-ab-t7' },
            { command_type: 'Release', resource_name: second, resource_source_oid: 'env-ab-t7' },
          ],
        }),
        step('e1', 'END'),
      ],
      connections: [
        { from_step_id: 's1', to_step_id: 'a1' }, { from_step_id: 'a1', to_step_id: 'a2' },
        { from_step_id: 'a2', to_step_id: 'a3' }, { from_step_id: 'a3', to_step_id: 'e1' },
      ],
    };
  }

  async function t7MakeWc(label: string): Promise<string> {
    const rand = Math.random().toString(36).slice(2, 8);
    const [wc] = await db!.insert(workCenter).values({ name: `RealPG-T7-${label}-${Date.now()}-${rand}` }).returning();
    cleanupWorkCenterIds.push(wc.id);
    return wc.id;
  }
  async function t7MakeWorkflow(wcId: string, spec: unknown, label: string): Promise<string> {
    const rand = Math.random().toString(36).slice(2, 8);
    const [wf] = await db!.insert(workflow).values({
      workCenterId: wcId, oid: `${label}-${rand}`, name: label, version: '1.0.0', state: 'Approved', specJsonb: spec,
    }).returning();
    return wf.id;
  }
  async function t7SeedQueued(wcId: string, wfId: string, spec: unknown, label: string, runtimeNumber: number): Promise<string> {
    const [wi] = await db!.insert(workflowInstance).values({
      workflowId: wfId, workCenterId: wcId, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
      specJsonb: spec, startingParams: null, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
      masterName: label, masterOid: label, masterVersion: '1.0.0', masterState: 'Approved',
    }).returning();
    createdInstanceIds.push(wi.id);
    return wi.id;
  }
  /** Hand-craft a 'running' instance with ONE READY step already in place — same staging
   *  Task 13's ledger test (above) uses, minimizing preceding work so this instance's very
   *  first `runOnce` call goes straight to the C2 claim path
   *  (claimInstanceForWork(['running'], READY_STEP_EXISTS)) and immediately attempts its
   *  resource command, rather than cascading through a START step first — the point is giving
   *  two racing instances as SYMMETRIC and as SHORT a path as possible to their own
   *  `lockRegistry` call, maximizing the odds their two `SELECT ... FOR UPDATE` calls genuinely
   *  overlap when fired concurrently via Promise.all. */
  async function t7SeedRunningReady(
    wcId: string, wfId: string, spec: unknown, label: string, nodeOid: string, stepOid: string, stepType: string, runtimeNumber: number,
  ): Promise<string> {
    const [wi] = await db!.insert(workflowInstance).values({
      workflowId: wfId, workCenterId: wcId, triggeredBy: 'manual', status: 'running', startedAt: new Date(),
      specJsonb: spec, startingParams: null, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
      masterName: label, masterOid: label, masterVersion: '1.0.0', masterState: 'Approved',
    }).returning();
    createdInstanceIds.push(wi.id);
    await db!.insert(stepInstance).values({ workflowInstanceId: wi.id, nodeOid, stepOid, stepType, state: 'READY' });
    return wi.id;
  }
  async function t7Waiters(wcId: string, name: string) {
    return db!.select().from(wcResourceWaiter)
      .where(and(eq(wcResourceWaiter.workCenterId, wcId), eq(wcResourceWaiter.name, name)))
      .orderBy(asc(wcResourceWaiter.id));
  }
  async function t7Holders(instanceId: string) {
    return db!.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, instanceId));
  }
  async function t7Resource(wcId: string, name: string) {
    const [row] = await db!.select().from(wcResource).where(and(eq(wcResource.workCenterId, wcId), eq(wcResource.name, name)));
    return row;
  }
  async function t7Status(instanceId: string): Promise<string> {
    const [row] = await db!.select({ status: workflowInstance.status }).from(workflowInstance).where(eq(workflowInstance.id, instanceId));
    return row?.status ?? 'MISSING';
  }
  async function t7StepState(instanceId: string, stepOid: string): Promise<string | undefined> {
    const rows = await db!.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
    return rows.find((r) => r.stepOid === stepOid)?.state;
  }
  /** Drain every currently-eligible unit of work on a single connection, sequentially — used
   *  only to establish an UNCONTESTED precondition (e.g. "the holder has acquired and parked")
   *  before a test's own genuinely-concurrent race begins; never used to drive the race itself. */
  async function t7DrainOnce(): Promise<void> {
    await pumpUntilQuiet(db!, testDeps());
  }

  // ── Test 1 (centerpiece): mutual exclusion ──────────────────────────────────────────────────
  //
  // Two instances race to Acquire the SAME binary-exclusive environment resource. Exactly one
  // must proceed (hold it); the other must be left waiting with a waiter row. This is the exact
  // scenario that would have FAILED before Phase 2a existed: pre-phase, each instance's
  // resources lived in its OWN private per-instance engine_state — two instances could each
  // "acquire" their own private copy of the same nominally-exclusive resource and BOTH proceed,
  // no contention at all, because there was no shared row to contend over. Proving mutual
  // exclusion now requires a real `wc_resource` row to genuinely serialize two DIFFERENT
  // connections' concurrent transactions.
  //
  // Genuine concurrency: `a` and `b` are hand-crafted 'running' instances with their Acquire
  // step ALREADY READY (t7SeedRunningReady) — zero preceding cascade work for either — then
  // fired via `Promise.all([runOnce, runOnce])` with no artificial ordering between them. Each
  // call is its own, fully independent `db.transaction()` pulling its own connection from the
  // pool (pool max 10, only 2 needed). A background sampler polls `pg_stat_activity` every 3ms
  // for the count of OTHER backends simultaneously 'active' against this database — PGlite could
  // never produce a SECOND backend at all, so a max >= 2 here is direct, empirical evidence two
  // connections were genuinely in flight at once during THIS run, not an inference from the
  // final state alone.
  it('(T7-1, centerpiece) mutual exclusion: two instances race to Acquire the SAME binary-exclusive environment resource — exactly one proceeds', async () => {
    const wcId = await t7MakeWc('mutex');
    await db!.insert(wcResource).values({ workCenterId: wcId, name: 'Printer', resourceType: 'binary exclusive use' });

    const specA = t7ParkAcquireSpec('t7-mutex-a');
    const specB = t7ParkAcquireSpec('t7-mutex-b');
    const wfA = await t7MakeWorkflow(wcId, specA, 't7-mutex-a');
    const wfB = await t7MakeWorkflow(wcId, specB, 't7-mutex-b');
    const a = await t7SeedRunningReady(wcId, wfA, specA, 't7-mutex-a', 't7-mutex-a', 'ui', 'USER_INTERACTION', 1);
    const b = await t7SeedRunningReady(wcId, wfB, specB, 't7-mutex-b', 't7-mutex-b', 'ui', 'USER_INTERACTION', 2);

    // Review fix (isolation hardening): EVERYTHING from here down is wrapped in try/finally so
    // that a and b are ALWAYS aborted, no matter what fails above — including the concurrency
    // -proof assertion itself, or runOnce throwing outright. A prior version of this test threw
    // on maxConcurrentActive before reaching its own cleanup, leaving the loser permanently
    // 'running'+READY and cascading into a DIFFERENT test's own one-shot concurrent race (Test
    // 2) claiming it instead of one of its own instances. The pre-flight assertion in beforeAll
    // catches this class of leak on a LATER invocation; this try/finally is what stops it
    // happening at all, in THIS run, in the first place.
    try {
      let maxConcurrentActive = 0;
      let sampling = true;
      const sampler = (async () => {
        while (sampling) {
          try {
            // Review fix (hardening, found while re-verifying against a fresh container): count
            // 'idle in transaction' alongside 'active'. A transaction stays open (BEGIN through
            // COMMIT) for its whole lifetime, but is only 'active' for the narrow instants it is
            // actually executing a query — sampling only 'active' can genuinely miss two real,
            // overlapping, uncommitted transactions if both happen to finish their own tiny
            // query sequences faster than this poller's cadence. What this test actually needs
            // to prove is overlapping TRANSACTION LIFETIMES (which PGlite's single connection
            // structurally cannot produce at all), not overlapping QUERY EXECUTION instants —
            // 'idle in transaction' is still definitively a second, distinct, open connection.
            const res = await pool!.query(
              "select count(*)::int as n from pg_stat_activity where datname = current_database() and state in ('active', 'idle in transaction') and pid <> pg_backend_pid()",
            );
            maxConcurrentActive = Math.max(maxConcurrentActive, (res.rows[0] as { n: number }).n);
          } catch { /* connection momentarily unavailable under pool pressure — just skip this sample */ }
          // No artificial delay between samples — the query's own round trip is the natural
          // throttle; a fixed setTimeout here only widens the gaps this sampler can miss through.
        }
      })();

      const deps = testDeps();
      let didA: boolean;
      let didB: boolean;
      try {
        [didA, didB] = await Promise.all([runOnce(db!, deps), runOnce(db!, deps)]);
      } finally {
        sampling = false;
        await sampler;
      }

      expect(didA).toBe(true);
      expect(didB).toBe(true);
      // Empirical proof this race was genuinely concurrent, not two calls that happened to run
      // back-to-back on the same connection.
      expect(maxConcurrentActive).toBeGreaterThanOrEqual(2);

      const printer = await t7Resource(wcId, 'Printer');
      expect(printer.inUse).toBe(1); // exactly one unit in use — never 0 (both lost) or 2 (both granted)

      const holdersA = await t7Holders(a);
      const holdersB = await t7Holders(b);
      expect([holdersA.length > 0, holdersB.length > 0].filter(Boolean)).toHaveLength(1); // exactly one holds it

      const [winner, loser] = holdersA.length > 0 ? [a, b] : [b, a];
      expect(await t7StepState(winner, 'ui')).toBe('WAITING_USER'); // winner holds Printer, parked
      expect(await t7StepState(loser, 'ui')).toBe('READY'); // loser blocked — queue-state stays READY (design convention)

      const waiters = await t7Waiters(wcId, 'Printer');
      expect(waiters).toHaveLength(1);
      expect(waiters[0]).toMatchObject({ instanceId: loser, stepOid: 'ui', granted: false });
    } finally {
      // Isolation: the loser (and, harmlessly, the winner too) must never survive this test
      // claimable — see the comment above the outer try. Swallow (but log) a cleanup failure
      // here rather than letting it MASK whatever the real test failure was, if any.
      try {
        await requestAbort(db!, a);
        await requestAbort(db!, b);
        // runControlPass processes one transitional instance per call and some instances need
        // more than one pass to settle fully (e.g. 'aborting' -> 'aborted') — drain rather than
        // assume a fixed count.
        for (let n = 0; n < 20 && await runControlPass(db!, testDeps()); n++) { /* drain */ }
      } catch (cleanupErr) {
        // eslint-disable-next-line no-console
        console.error('T7-1 cleanup (aborting a/b) failed:', cleanupErr);
      }
    }

    expect(await t7Status(a)).toBe('aborted');
    expect(await t7Status(b)).toBe('aborted');
  }, 20_000);

  // ── Test 2: FIFO across instances ───────────────────────────────────────────────────────────
  //
  // Three instances race to enqueue on ONE already-held resource; releases must grant them back
  // in the order they ACTUALLY enqueued, not the order the test happened to write them.
  //
  // Genuine concurrency: X/Y/Z are hand-crafted 'running'+READY (same staging as Test 1) and
  // fired via `Promise.all` of three concurrent `runOnce` calls — three separate connections
  // racing to INSERT a waiter row on the SAME resource at once. Which one's row actually lands
  // at the lowest `wc_resource_waiter.id` (the FIFO order, per wc-resources.ts's own doc
  // comment) is a fact only genuine concurrent contention can produce; under PGlite there is
  // only ever one connection, so "the order they raced in" would just be "the order the test's
  // own code happened to await them in" — never a genuinely discovered, connection-level fact.
  it('(T7-2) FIFO across instances: three instances race to enqueue on one resource; releases grant them in the REAL enqueue order', async () => {
    const wcId = await t7MakeWc('fifo');
    await db!.insert(wcResource).values({ workCenterId: wcId, name: 'Printer', resourceType: 'binary exclusive use' });

    const holderSpec = t7ParkAcquireReleaseSpec('t7-fifo-h');
    const h = await t7SeedQueued(wcId, await t7MakeWorkflow(wcId, holderSpec, 't7-fifo-h'), holderSpec, 't7-fifo-h', 1);
    await t7DrainOnce();
    expect(await t7StepState(h, 'ui')).toBe('WAITING_USER'); // H holds Printer, parked

    const labels = ['x', 'y', 'z'];
    const specs = labels.map((l) => t7ParkAcquireSpec(`t7-fifo-${l}`));
    const wfs = await Promise.all(specs.map((s, i) => t7MakeWorkflow(wcId, s, `t7-fifo-${labels[i]}`)));
    const ids = await Promise.all(specs.map((s, i) => t7SeedRunningReady(
      wcId, wfs[i], s, `t7-fifo-${labels[i]}`, `t7-fifo-${labels[i]}`, 'ui', 'USER_INTERACTION', i + 2,
    )));

    await Promise.all(ids.map(() => runOnce(db!, testDeps())));
    for (const id of ids) expect(await t7StepState(id, 'ui')).toBe('READY'); // all 3 blocked

    const queued = await t7Waiters(wcId, 'Printer');
    expect(queued).toHaveLength(3);
    expect(queued.every((w) => w.granted === false)).toBe(true);
    const order = queued.map((w) => w.instanceId); // the REAL, discovered FIFO order

    await submitUserAction(db!, h, { step_oid: 'ui', action: 'submit' }, 0, testDeps()); // H releases

    for (const [i, instanceId] of order.entries()) {
      let status = 'running';
      for (let n = 0; n < 50 && status === 'running'; n++) {
        await runOnce(db!, testDeps());
        status = await t7Status(instanceId);
      }
      expect(status).toBe('running'); // parked holding Printer — never auto-releases (no Release cmd)
      expect(await t7StepState(instanceId, 'ui')).toBe('WAITING_USER');
      for (const later of order.slice(i + 1)) {
        expect(await t7StepState(later, 'ui')).toBe('READY'); // no one later in the queue jumped ahead
      }
      await submitUserAction(db!, instanceId, { step_oid: 'ui', action: 'submit' }, 0, testDeps()); // hand off to the next
    }

    expect((await t7Resource(wcId, 'Printer')).inUse).toBe(0);
    expect(await t7Waiters(wcId, 'Printer')).toEqual([]);
  }, 30_000);

  // ── Test 3: countable no-skip across instances ──────────────────────────────────────────────
  //
  // A queued request for 4 of a 5-unit countable resource must not be jumped by a LATER request
  // for just 1 unit, even though 1 unit is numerically free. resources.ts's own tryGrantCountable
  // enforces this ("strict FIFO — don't skip a too-large request"), and acquireAmount only grants
  // immediately when `queue.length === 0` — so the invariant under test is really "does a SECOND
  // connection's Acquire correctly see the FIRST connection's not-yet-committed decision to
  // queue, rather than a stale pre-write snapshot that would let it grant itself out of turn."
  //
  // That specific invariant is inherently precondition-dependent (request B must be an
  // ESTABLISHED, committed queue entry before request C is evaluated) — an unbiased race between
  // two symmetric attempts would land in a DIFFERENT, uninteresting branch (C simply winning
  // outright, nothing queued yet) close to half the time, making the test's power to catch a
  // real regression depend on timing luck. So this test forces a DETERMINISTIC overlap instead:
  // `t7DirectAcquire` is an inlined replay of exactly what openContext's Acquire branch +
  // context.persist() do for ONE Acquire, using ONLY production functions (lockRegistry,
  // InMemoryResourceManager, diffRegistry, applyRegistryWrites) — not a reimplementation of
  // engine logic, just orchestrated by hand instead of routed through the full step-activation
  // machinery, so the test can hold the row lock open for a controlled window (`delayMs`,
  // injected AFTER the in-memory acquire() decision but BEFORE write-back) that a concurrently
  // -fired second call is GUARANTEED to block on — genuine, deterministic multi-connection
  // contention on every run, not a coin flip.
  async function t7DirectAcquire(
    wcId: string, name: string, instanceId: string, stepOid: string, amount: number | undefined, delayMs: number,
  ): Promise<{ granted: boolean }> {
    return db!.transaction(async (tx) => {
      const snap = await lockRegistry(tx, wcId, [name]);
      const index = indexWaiters(snap);
      const manager = InMemoryResourceManager.fromJSON(snapshotToSerialized(snap, wcId));
      const token = envToken(instanceId, stepOid);
      const r = manager.acquire(name, token, amount);
      if (delayMs > 0) await new Promise((res) => setTimeout(res, delayMs));
      const holds: EnvHold[] = r.granted ? [{ name, stepOid, amount: amount ?? 1, heldName: r.name ?? null }] : [];
      const diff = diffRegistry({ snap, manager, index, instanceId, holds });
      await applyRegistryWrites(tx, { workCenterId: wcId, instanceId, ...diff });
      return { granted: r.granted };
    });
  }

  it('(T7-3) countable no-skip across instances: a queued request for 4 of 5 units is not jumped by a later request for 1', async () => {
    const wcId = await t7MakeWc('noskip');
    await db!.insert(wcResource).values({
      workCenterId: wcId, name: 'Slots', resourceType: 'countable use with pool limits', useLimit: 5, inUse: 4,
    });
    const anchorSpec = {
      local_id: 'wf', oid: 'wf-noskip-anchor', version: '1.0.0', last_modified_date: '2026-01-01',
      steps: [step('s1', 'START'), step('e1', 'END')], connections: [{ from_step_id: 's1', to_step_id: 'e1' }],
    };
    const wf = await t7MakeWorkflow(wcId, anchorSpec, 't7-noskip-anchor');
    // b/c/releaser are FK anchors ONLY (wc_resource_waiter/holder.instance_id references
    // workflow_instance) — they are never run through the engine; t7DirectAcquire drives the
    // resource logic directly.
    const b = await t7SeedQueued(wcId, wf, anchorSpec, 't7-noskip-b', 1);
    const c = await t7SeedQueued(wcId, wf, anchorSpec, 't7-noskip-c', 2);

    // B's transaction takes the row lock, decides (blocked: needs 4 of 1 free), then HOLDS the
    // lock open for 150ms before writing back+committing — plenty of margin for C's own query to
    // arrive and genuinely block while B is still uncommitted. C is fired only once a REAL
    // BARRIER confirms B's lock is actually held — polling `pg_locks` for a GRANTED lock on
    // `wc_resource` from a DIFFERENT backend (review fix: a fixed guess-the-timing delay here
    // would silently degrade this test into the "uninteresting branch" it exists to avoid under
    // heavy machine load, exactly the class of load that produced the (a) flake elsewhere in
    // this file — the same "poll for a real signal" idiom Test 1's pg_stat_activity sampler and
    // Test 7's LISTEN-readiness poll already use, applied here to the ROW LOCK itself rather
    // than to a query string). A granted RowShareLock on `wc_resource` held by another backend
    // can only mean B's `SELECT ... FOR UPDATE` inside `lockRegistry` has genuinely executed and
    // is still held — not an inference from elapsed time.
    const bPromise = t7DirectAcquire(wcId, 'Slots', b, 'acquireB', 4, 150);
    await waitFor(async () => {
      const res = await pool!.query(
        `select 1 from pg_locks l join pg_class c on l.relation = c.oid
         where c.relname = 'wc_resource' and l.granted = true and l.pid <> pg_backend_pid()`,
      );
      return (res.rowCount ?? 0) > 0;
    }, 5000, 5);
    const cPromise = t7DirectAcquire(wcId, 'Slots', c, 'acquireC', 1, 0);
    const [bResult, cResult] = await Promise.all([bPromise, cPromise]);

    expect(bResult.granted).toBe(false); // 4 needed, only 1 free -> queues
    expect(cResult.granted).toBe(false); // MUST NOT skip ahead of B despite 1 unit being numerically free

    const queued = await t7Waiters(wcId, 'Slots');
    expect(queued).toHaveLength(2);
    expect(queued.map((w) => w.instanceId)).toEqual([b, c]); // B's row committed (and exists) before C's
    expect(queued.map((w) => w.amount)).toEqual([4, 1]);
    expect((await t7Resource(wcId, 'Slots')).inUse).toBe(4); // unchanged — neither request was granted

    // Close the loop: releasing the original 4 units correctly grants B THEN C, in that order,
    // via the SAME production diffRegistry/applyRegistryWrites write-back — proving no-skip's
    // actual payoff, not just its queuing snapshot.
    const releaser = await t7SeedQueued(wcId, wf, anchorSpec, 't7-noskip-releaser', 3);
    await db!.transaction(async (tx) => {
      const snap = await lockRegistry(tx, wcId, ['Slots']);
      const index = indexWaiters(snap);
      const manager = InMemoryResourceManager.fromJSON(snapshotToSerialized(snap, wcId));
      manager.release('Slots', 4);
      const diff = diffRegistry({ snap, manager, index, instanceId: releaser, holds: [] });
      await applyRegistryWrites(tx, { workCenterId: wcId, instanceId: releaser, ...diff });
    });

    const afterRelease = await t7Waiters(wcId, 'Slots');
    expect(afterRelease).toHaveLength(2);
    expect(afterRelease.every((w) => w.granted)).toBe(true);
    expect(afterRelease.map((w) => w.instanceId)).toEqual([b, c]); // grant order preserves FIFO
    expect((await t7Resource(wcId, 'Slots')).inUse).toBe(5); // 4 (B) + 1 (C) — both fit, in order

    // Isolation: b/c/releaser are deliberate FK anchors, left 'queued' forever by design (they
    // are never run through the engine — t7DirectAcquire drives the resource logic directly).
    // acquireQueuedRuntimeWorkflows's own claim is ALSO DB-wide, ordered by queued_at ASC — left
    // 'queued', these would be the OLDEST candidates for the rest of this suite run and could
    // silently steal a unit of work from a later test's own one-shot concurrent race (the same
    // failure mode Test 1's cleanup above guards against, on the queued side instead of running).
    await db!.update(workflowInstance).set({ status: 'completed', completedAt: new Date() })
      .where(inArray(workflowInstance.id, [b, c, releaser]));
  }, 20_000);

  // ── Test 4: named-pool reservation to a foreign instance ────────────────────────────────────
  //
  // A release must reserve a SPECIFIC free name for the waiting instance, and that instance must
  // receive exactly that name — proven under genuinely concurrent releases so a broken
  // (unlocked) version could actually be caught: two holders release at once; without the row
  // lock serializing them, both could read the SAME stale (pre-release) snapshot and both
  // independently decide to grant their freed name to the SAME queue head, losing the second
  // waiter's grant and corrupting availableNames. `submitUserAction` is a real, symmetric-cost
  // engine entry point for both releases (unlike Test 3's asymmetric no-skip precondition, there
  // is no "uninteresting branch" here — EITHER commit order produces a meaningful, checkable
  // outcome), so this test relies on natural `Promise.all` concurrency rather than a forced delay.
  it('(T7-4) named-pool reservation to a foreign instance: two concurrent releases each hand a DISTINCT name to a different waiting instance', async () => {
    const wcId = await t7MakeWc('named');
    await db!.insert(wcResource).values({
      workCenterId: wcId, name: 'Bay', resourceType: 'named pool', poolNames: ['Bay-A', 'Bay-B'], availableNames: ['Bay-A', 'Bay-B'],
    });

    const specH1 = t7NamedPoolHolderSpec('t7-named-h1');
    const specH2 = t7NamedPoolHolderSpec('t7-named-h2');
    const h1 = await t7SeedQueued(wcId, await t7MakeWorkflow(wcId, specH1, 't7-named-h1'), specH1, 't7-named-h1', 1);
    const h2 = await t7SeedQueued(wcId, await t7MakeWorkflow(wcId, specH2, 't7-named-h2'), specH2, 't7-named-h2', 2);
    await t7DrainOnce();
    expect(await t7StepState(h1, 'ui')).toBe('WAITING_USER');
    expect(await t7StepState(h2, 'ui')).toBe('WAITING_USER');
    expect((await t7Resource(wcId, 'Bay')).availableNames).toEqual([]); // pool exhausted

    const specW1 = t7NamedPoolWaiterSpec('t7-named-w1');
    const specW2 = t7NamedPoolWaiterSpec('t7-named-w2');
    const w1 = await t7SeedQueued(wcId, await t7MakeWorkflow(wcId, specW1, 't7-named-w1'), specW1, 't7-named-w1', 3);
    await t7DrainOnce();
    const w2 = await t7SeedQueued(wcId, await t7MakeWorkflow(wcId, specW2, 't7-named-w2'), specW2, 't7-named-w2', 4);
    await t7DrainOnce();
    expect(await t7StepState(w1, 'grab')).toBe('READY');
    expect(await t7StepState(w2, 'grab')).toBe('READY');
    const queuedBefore = await t7Waiters(wcId, 'Bay');
    expect(queuedBefore.map((w) => w.instanceId)).toEqual([w1, w2]); // real FIFO order, both unset

    await Promise.all([
      submitUserAction(db!, h1, { step_oid: 'ui', action: 'submit' }, 0, testDeps()),
      submitUserAction(db!, h2, { step_oid: 'ui', action: 'submit' }, 0, testDeps()),
    ]);

    expect(await t7Status(h1)).toBe('completed');
    expect(await t7Status(h2)).toBe('completed');

    const granted = await t7Waiters(wcId, 'Bay');
    expect(granted).toHaveLength(2);
    expect(granted.every((w) => w.granted)).toBe(true);
    const names = granted.map((w) => w.grantedName).sort();
    expect(names).toEqual(['Bay-A', 'Bay-B']); // two DISTINCT names — never the same one granted twice
    const byInstance = new Map(granted.map((w) => [w.instanceId, w.grantedName]));
    expect(byInstance.get(w1)).toBeTruthy();
    expect(byInstance.get(w2)).toBeTruthy();
    expect(byInstance.get(w1)).not.toBe(byInstance.get(w2));

    // Full round trip: each waiter can actually consume its OWN distinct reservation.
    for (let n = 0; n < 200 && ((await t7Status(w1)) !== 'completed' || (await t7Status(w2)) !== 'completed'); n++) {
      await runOnce(db!, testDeps());
    }
    expect(await t7Status(w1)).toBe('completed');
    expect(await t7Status(w2)).toBe('completed');
    const [w1Row] = await db!.select().from(workflowInstance).where(eq(workflowInstance.id, w1));
    const [w2Row] = await db!.select().from(workflowInstance).where(eq(workflowInstance.id, w2));
    const heldNames = [
      (w1Row.propertyStore as Record<string, string> | null)?.['Result.Held'],
      (w2Row.propertyStore as Record<string, string> | null)?.['Result.Held'],
    ].sort();
    expect(heldNames).toEqual(['Bay-A', 'Bay-B']); // each received its OWN reserved name, not the other's
    expect((await t7Resource(wcId, 'Bay')).availableNames.slice().sort()).toEqual(['Bay-A', 'Bay-B']); // both freed back at terminal
  }, 30_000);

  // ── Test 5: sync across instances ───────────────────────────────────────────────────────────
  //
  // A Send in one instance matches a Receive in another, and the payload actually arrives.
  //
  // Genuine concurrency: reuses this file's OWN `pumpConcurrently` helper (already the
  // established, reviewed pattern for "genuine multi-connection racing" in this file — see its
  // doc comment above) with two workers pumping two genuinely separate connections until both
  // instances complete. Under PGlite there is only ever ONE connection driving both instances in
  // turn; here the Send and the Receive are genuinely resolved from two independently-scheduled
  // connections, and the payload has to survive a real cross-connection round trip through the
  // `wc_resource_waiter.payload` column to arrive correctly.
  it('(T7-5) sync across instances: a Send in instance A matches a Receive in instance B, and the payload arrives', async () => {
    const wcId = await t7MakeWc('sync');
    await db!.insert(wcResource).values({ workCenterId: wcId, name: 'Chan', resourceType: 'sync' });

    const specA = t7SenderSpec('t7-sync-a');
    const specB = t7ReceiverSpec('t7-sync-b');
    const a = await t7SeedQueued(wcId, await t7MakeWorkflow(wcId, specA, 't7-sync-a'), specA, 't7-sync-a', 1);
    const b = await t7SeedQueued(wcId, await t7MakeWorkflow(wcId, specB, 't7-sync-b'), specB, 't7-sync-b', 2);

    const deps = testDeps();
    await pumpConcurrently(db!, deps, 2, async () => {
      const rows = await db!.select({ status: workflowInstance.status }).from(workflowInstance).where(inArray(workflowInstance.id, [a, b]));
      return rows.length === 2 && rows.every((r) => r.status === 'completed');
    });

    const [rowA] = await db!.select().from(workflowInstance).where(eq(workflowInstance.id, a));
    const [rowB] = await db!.select().from(workflowInstance).where(eq(workflowInstance.id, b));
    expect(rowA.status).toBe('completed');
    expect(rowB.status).toBe('completed');
    expect(rowB.propertyStore).toMatchObject({ 'Result.Received': 'payload-from-A' });
  }, 30_000);

  // ── Test 6: lock ordering (no deadlock) ─────────────────────────────────────────────────────
  //
  // Two recipes naming the same two resources in OPPOSITE command order (Acquire A then B, vs.
  // Acquire B then A) run concurrently and both complete — no deadlock. wc-resources.ts's
  // lockRegistry ALREADY locks every environment resource a recipe references in one query,
  // ordered by NAME ASCENDING (its own doc comment) — the recipe's COMMAND order never
  // determines the ROW lock order, which is what structurally prevents the classic "each holds
  // one, wants the other" deadlock. This test is the empirical check of that promise: many
  // genuinely concurrent AB/BA pairs, repeated across independent batches, all completing
  // without ever hanging or hitting a Postgres "deadlock detected" error.
  //
  // How many times: 5 independent batches of 6 concurrent AB/BA pairs each = 30 pair-trials (60
  // instances) total. A single pair gives only one interleaving; many CONCURRENT pairs sharing
  // the SAME two resource rows (6 per batch, pumped by 6 workers) multiply the number of
  // genuinely overlapping lock-acquisition attempts within one run, and repeating across 5 fresh
  // batches (fresh resources, fresh instances, fresh work center each time) adds independent
  // trials rather than reusing one already-warm scenario. 30 is small enough to run in well
  // under the suite's own budget but large enough that a genuine ordering bug — which would
  // manifest as SOME pair, in SOME batch, hanging past pumpConcurrently's own deadline or
  // tripping a real Postgres deadlock error — has many independent chances to show up.
  it('(T7-6) lock ordering: two recipes naming the SAME two resources in OPPOSITE command order run concurrently and both complete — no deadlock', async () => {
    const BATCHES = 5;
    const PAIRS_PER_BATCH = 6;
    for (let batch = 0; batch < BATCHES; batch++) {
      const wcId = await t7MakeWc(`order-${batch}`);
      await db!.insert(wcResource).values([
        { workCenterId: wcId, name: 'ResA', resourceType: 'binary exclusive use' },
        { workCenterId: wcId, name: 'ResB', resourceType: 'binary exclusive use' },
      ]);

      const ids: string[] = [];
      for (let p = 0; p < PAIRS_PER_BATCH; p++) {
        const specAB = t7AcquireOrderSpec(`t7-order-${batch}-${p}-ab`, 'ResA', 'ResB');
        const specBA = t7AcquireOrderSpec(`t7-order-${batch}-${p}-ba`, 'ResB', 'ResA');
        ids.push(await t7SeedQueued(wcId, await t7MakeWorkflow(wcId, specAB, `t7-order-ab-${batch}-${p}`), specAB, `t7-order-ab-${batch}-${p}`, p * 2 + 1));
        ids.push(await t7SeedQueued(wcId, await t7MakeWorkflow(wcId, specBA, `t7-order-ba-${batch}-${p}`), specBA, `t7-order-ba-${batch}-${p}`, p * 2 + 2));
      }

      await pumpConcurrently(db!, testDeps(), 6, async () => {
        const rows = await db!.select({ status: workflowInstance.status }).from(workflowInstance).where(inArray(workflowInstance.id, ids));
        return rows.length === ids.length && rows.every((r) => r.status === 'completed');
      }, 30_000);

      const rows = await db!.select().from(workflowInstance).where(inArray(workflowInstance.id, ids));
      for (const r of rows) {
        expect(r.status).toBe('completed');
        expect(r.finalState).toBe('completed');
      }
      expect((await t7Resource(wcId, 'ResA')).inUse).toBe(0);
      expect((await t7Resource(wcId, 'ResB')).inUse).toBe(0);
      expect(await t7Waiters(wcId, 'ResA')).toEqual([]);
      expect(await t7Waiters(wcId, 'ResB')).toEqual([]);
    }
  }, 180_000);

  // ── Test 7: auto-release under contention ───────────────────────────────────────────────────
  //
  // A holds, B waits, A is aborted, B is granted — proven through the ACTUAL cross-connection
  // mechanism Task 5 built for this (context.ts's `pg_notify(NOTIFY_GRANT_CHANNEL, ...)`,
  // production-wired to the worker loop's own wake in src/index.ts). This channel is real-PG
  // -only in a stronger sense than the other six tests: LISTEN/NOTIFY is a genuine multi-session
  // Postgres server feature with no meaningful single-connection analogue, so PGlite's existing
  // coverage of this SAME scenario (env-resources-writeback.test.ts's "auto-release re-grants")
  // can prove the DB rows end up correct, but can never prove the notification that is supposed
  // to wake a DIFFERENT engine replica actually fires and names the right instance. This test
  // LISTENs on a dedicated, separate connection (mirroring scenario (d)'s own proven idiom above)
  // and asserts the notification's payload is exactly B's instance id.
  it('(T7-7) auto-release under contention: A holds, B waits, A is aborted — B is granted via a REAL cross-connection pg_notify wake', async () => {
    const wcId = await t7MakeWc('abort-regrant');
    await db!.insert(wcResource).values({ workCenterId: wcId, name: 'Printer', resourceType: 'binary exclusive use' });

    const specA = t7ParkAcquireSpec('t7-abort-a');
    const a = await t7SeedQueued(wcId, await t7MakeWorkflow(wcId, specA, 't7-abort-a'), specA, 't7-abort-a', 1);
    await t7DrainOnce();
    expect(await t7StepState(a, 'ui')).toBe('WAITING_USER'); // A holds Printer, parked

    const specB = t7GrabPrinterSpec('t7-abort-b');
    const b = await t7SeedQueued(wcId, await t7MakeWorkflow(wcId, specB, 't7-abort-b'), specB, 't7-abort-b', 2);
    await t7DrainOnce();
    expect(await t7StepState(b, 'grab')).toBe('READY'); // B blocked behind A
    expect(await t7Waiters(wcId, 'Printer')).toHaveLength(1);

    const rand = Math.random().toString(36).slice(2, 8);
    const appName = `t7-grant-wake-${rand}`;
    const listenerUrl = `${url}${url!.includes('?') ? '&' : '?'}application_name=${appName}`;
    let notifications = 0;
    let lastPayload: string | undefined;
    const handle = createWakeListener(listenerUrl, (payload) => { notifications++; lastPayload = payload; }, NOTIFY_GRANT_CHANNEL);

    try {
      await waitFor(async () => {
        const res = await pool!.query(
          `select 1 from pg_stat_activity where application_name = $1 and query ilike 'listen%'`, [appName],
        );
        return (res.rowCount ?? 0) > 0;
      });

      await requestAbort(db!, a);
      const did = await runControlPass(db!, testDeps());
      expect(did).toBe(true);

      await waitFor(async () => notifications > 0);
      expect(lastPayload).toBe(b); // the notification names EXACTLY the instance that was granted
    } finally {
      handle.stop();
    }

    expect(await t7Status(a)).toBe('aborted');
    const grantedRows = await t7Waiters(wcId, 'Printer');
    expect(grantedRows).toHaveLength(1);
    expect(grantedRows[0]).toMatchObject({ instanceId: b, granted: true });

    // B consumes the grant on its own next claim (Task 5's Critical-1 resumeGrantedSteps flush)
    // and completes.
    for (let n = 0; n < 50 && (await t7Status(b)) !== 'completed'; n++) await runOnce(db!, testDeps());
    expect(await t7Status(b)).toBe('completed');
    expect(await t7Waiters(wcId, 'Printer')).toEqual([]);
    expect((await t7Resource(wcId, 'Printer')).inUse).toBe(0);
  }, 20_000);

  // ── Test 8: an operator verb racing a live transition ───────────────────────────────────────
  //
  // Phase 4a. A commander's `release-holder` and the holder's OWN Release (the parked
  // USER_INTERACTION completing, whose step declares both Acquire and Release) both try to free
  // the SAME binary-exclusive `Printer` at the same instant, on two REAL connections out of the
  // pool. PGlite can replay either ORDER by hand — env-resources-cancel.test.ts does exactly
  // that, with the operator's registry effect simulated by hand-written row edits — but being
  // single-connection it can never let the two transactions genuinely contend for the
  // `wc_resource` row lock, and that lock is the only thing that decides which of them is
  // second, and therefore which of the two legal outcomes a given run produces.
  //
  // BOTH outcomes are legal and BOTH are pinned by the same five facts below, because the
  // contender PARKS on the resource (t7ParkAcquireSpec) instead of grabbing and finishing:
  //   * operator first -> the holder's own Release is SKIPPED by the revoked-hold marker
  //     (openContext diffed this instance's persisted `envHolds` against a ledger that no longer
  //     carries the row and recorded `envHoldsRevoked`), so the freed unit stays with the
  //     contender the operator handed it to.
  //   * submit first   -> the holder's Release runs normally and grants the contender; the
  //     operator's verb then finds no holder row and rejects with HOLDER_NOT_FOUND.
  // A DOUBLE release — the wedge the marker exists to prevent — shows up as `in_use` 0 while the
  // contender is still parked holding Printer, so `in_use === 1` is the load-bearing assertion.
  // A grab-and-finish contender (t7GrabPrinterSpec) would not discriminate it at all: that final
  // state is `in_use` 0, no holders, no waiters whether or not the counter was decremented twice.
  //
  // This test is also what FOUND Ruling P9: the verb used to insert its operator trace inside
  // the registry transaction, and `trace_entry.workflow_instance_id`'s FK makes that an
  // instance-row lock (`FOR KEY SHARE`), held to commit — an ABBA cycle against every
  // transition, which locks the instance row first and the registry rows second. Postgres
  // reported `deadlock detected` here on 3/3 runs. The trace write now happens in its own
  // short transaction after the registry commit, so the ONLY residue is a brief FOR KEY SHARE
  // window that `claimInstanceById` (SKIP LOCKED) can land inside — one legal bounce, handled
  // below. A SECOND bounce, or any `deadlock detected` in the server log, is a defect.
  it('(T7-8) an operator release-holder racing the holder\'s OWN release: exactly one frees Printer, the contender keeps it, nothing wedges', async () => {
    const ACTOR = '99999999-9999-4999-8999-999999999999';
    const wcId = await t7MakeWc('verb-race');
    await db!.insert(wcResource).values({ workCenterId: wcId, name: 'Printer', resourceType: 'binary exclusive use' });

    const holderSpec = t7ParkAcquireReleaseSpec('t7-race-h');
    const holder = await t7SeedQueued(wcId, await t7MakeWorkflow(wcId, holderSpec, 't7-race-h'), holderSpec, 't7-race-h', 1);
    await t7DrainOnce();
    expect(await t7StepState(holder, 'ui')).toBe('WAITING_USER'); // holds Printer, parked
    const [h] = await t7Holders(holder);
    expect(h).toBeTruthy();

    const contenderSpec = t7ParkAcquireSpec('t7-race-c');
    const contender = await t7SeedQueued(wcId, await t7MakeWorkflow(wcId, contenderSpec, 't7-race-c'), contenderSpec, 't7-race-c', 2);
    await t7DrainOnce();
    expect(await t7StepState(contender, 'ui')).toBe('READY'); // blocked behind the holder
    expect(await t7Waiters(wcId, 'Printer')).toHaveLength(1);

    // The race itself: no ordering imposed, no delay injected — two transactions, two
    // connections, one `wc_resource` row lock between them.
    const [opOutcome, submitOutcome] = await Promise.allSettled([
      runWorkCenterResourceVerb(db!, testDeps(), null, {
        verb: 'release-holder', name: 'Printer', holderId: h.id, workCenterId: wcId, actorUserId: ACTOR,
      }),
      submitUserAction(db!, holder, { step_oid: 'ui', action: 'submit' }, 0, testDeps()),
    ]);
    // Which ordering THIS run discovered — reported, never steered. Both are expected over a
    // series of runs; the assertions below are identical either way.
    const opCode = opOutcome.status === 'rejected' ? String((opOutcome.reason as { code?: string }).code) : '-';
    const subErr = submitOutcome.status === 'rejected' ? `${String((submitOutcome.reason as { code?: string }).code)} — ${String((submitOutcome.reason as { message?: string }).message)}` : '-';
    console.log(`[T7-8] operator=${opOutcome.status}(${opCode}) submit=${submitOutcome.status} — ` +
      `${opOutcome.status === 'fulfilled' ? 'OPERATOR-FIRST (holder release skipped by the revoked marker)' : 'SUBMIT-FIRST (operator found no holder row)'} | submitErr=${subErr}`);
    if (opOutcome.status === 'rejected') {
      expect((opOutcome.reason as { code?: string }).code).toBe('HOLDER_NOT_FOUND'); // the submit was first
    }
    if (submitOutcome.status === 'rejected') {
      // The one legal bounce (Ruling P9): the deferred operator-trace transaction held this
      // instance's row under the trace FK's FOR KEY SHARE while `claimInstanceById` (SKIP
      // LOCKED) looked at it. Retry ONCE — that window is over by now, and the retry must
      // succeed. A second bounce means the verb is holding an instance row it should not be.
      expect((submitOutcome.reason as { code?: string }).code).toBe('NOT_RUNNING');
      await submitUserAction(db!, holder, { step_oid: 'ui', action: 'submit' }, 0, testDeps());
    }

    await t7DrainOnce(); // the contender consumes its grant and parks

    expect((await t7Resource(wcId, 'Printer')).inUse).toBe(1); // exactly ONE release landed
    const holders = await db!.select().from(wcResourceHolder).where(eq(wcResourceHolder.workCenterId, wcId));
    expect(holders.map((r) => [r.instanceId, r.stepOid])).toEqual([[contender, 'ui']]);
    expect(await t7Waiters(wcId, 'Printer')).toEqual([]);
    expect(await t7StepState(contender, 'ui')).toBe('WAITING_USER');
    expect(await t7Status(holder)).toBe('completed');
  }, 30_000);

  it('(FC-1) force complete racing the timer of a due timer gate: exactly one completion, the loser is refused', async () => {
    const spec = {
      local_id: 'wf', oid: 'fc-race', version: '1.0.0', last_modified_date: '2026-01-01', schemaVersion: '5.0',
      steps: [step('s', 'START'), step('g', 'GATE', { gate_config: { mode: 'timer', delay_seconds: 5 } }), step('e', 'END')],
      connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
    };
    const { wcId, wfId } = await makeWorkCenterAndWorkflow(spec, 'fc-race');
    let now = new Date('2026-01-01T00:00:00.000Z');
    const deps = testDeps({ now: () => now });
    const instanceId = await seedQueuedInstance(spec, 'fc-race', wcId, wfId, 1);
    await pumpUntilQuiet(db!, deps); // arms the gate (deadline = t0 + 5 s)
    const [g] = await db!.select().from(stepInstance).where(and(eq(stepInstance.workflowInstanceId, instanceId), eq(stepInstance.stepOid, 'g')));
    expect(g.state).toBe('WAITING_GATE');
    now = new Date(now.getTime() + 5000); // the timer is now due
    const actor = '99999999-9999-4999-8999-999999999999';
    const [forced] = await Promise.allSettled([
      forceCompleteStep(db!, deps, null, { instanceId, stepInstanceId: g.id, actorUserId: actor, reason: 'race', source: 'commander' }),
      runOnce(db!, deps),
    ]);
    // Whoever lost: INSTANCE_BUSY (the loop held the lock), ALREADY_COMPLETED or RUNTIME_INVALID_STATE.
    if (forced.status === 'rejected') {
      expect(['INSTANCE_BUSY', 'ALREADY_COMPLETED', 'RUNTIME_INVALID_STATE']).toContain((forced.reason as { code?: string }).code);
    }
    await pumpUntilQuiet(db!, deps); // whichever did not run, the timer path finishes the job
    const rows = await db!.select().from(stepInstance).where(and(eq(stepInstance.workflowInstanceId, instanceId), eq(stepInstance.stepOid, 'g')));
    expect(rows.map((r) => r.state)).toEqual(['COMPLETED']);
    const completed = await db!.select().from(traceEntry).where(and(
      eq(traceEntry.workflowInstanceId, instanceId), eq(traceEntry.stepOid, 'g'), eq(traceEntry.state, 'COMPLETED'),
    ));
    expect(completed).toHaveLength(1);
    expect((await db!.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId)))[0].status).toBe('completed');
  }, 30_000);

  it('(FC-2) a repeating script parks WAITING_SCRIPT in real Postgres (migration 0038) and a force completes it once', async () => {
    const spec = {
      local_id: 'wf', oid: 'fc-script', version: '1.0.0', last_modified_date: '2026-01-01', schemaVersion: '5.0',
      steps: [
        step('s', 'START'),
        step('g', 'SCRIPT', { script_config: { source: 'state.n = (state.n || 0) + 1; return false;', repeat: { cycle_seconds: 5 } } }),
        step('e', 'END'),
      ],
      connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
    };
    const { wcId, wfId } = await makeWorkCenterAndWorkflow(spec, 'fc-script');
    let now = new Date('2026-01-01T00:00:00.000Z');
    const deps = testDeps({ now: () => now });
    const instanceId = await seedQueuedInstance(spec, 'fc-script', wcId, wfId, 1);
    await pumpUntilQuiet(db!, deps);
    const [g] = await db!.select().from(stepInstance).where(and(eq(stepInstance.workflowInstanceId, instanceId), eq(stepInstance.stepOid, 'g')));
    expect(g.state).toBe('WAITING_SCRIPT');
    now = new Date(now.getTime() + 5000); // a run is now due
    const actor = '99999999-9999-4999-8999-999999999999';
    const [forced] = await Promise.allSettled([
      forceCompleteStep(db!, deps, null, { instanceId, stepInstanceId: g.id, actorUserId: actor, reason: 'race', source: 'commander' }),
      runOnce(db!, deps),
    ]);
    if (forced.status === 'rejected') {
      expect(['INSTANCE_BUSY']).toContain((forced.reason as { code?: string }).code);
      await forceCompleteStep(db!, deps, null, { instanceId, stepInstanceId: g.id, actorUserId: actor, reason: 'retry', source: 'commander' });
    }
    await pumpUntilQuiet(db!, deps);
    const completed = await db!.select().from(traceEntry).where(and(
      eq(traceEntry.workflowInstanceId, instanceId), eq(traceEntry.stepOid, 'g'), eq(traceEntry.state, 'COMPLETED'),
    ));
    expect(completed).toHaveLength(1);
    expect((await db!.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId)))[0].status).toBe('completed');
  }, 30_000);

  // ── (DS-1) data-safety spec 2026-10-21: a slow action server cannot stall the pool ──
  //
  // Every action-server request takes 2 s. Twenty terminals (SSE, with the poll as backstop) and
  // ten pause control passes then compete for the 10-connection pool from 10 worker slots. A
  // network call made while a pooled connection is held (inside a claim transaction) starves the
  // pool, and connect waits then fail after connectionTimeoutMillis with pg's "timeout exceeded
  // when trying to connect". Drizzle rewraps that as "Failed query: ...", so the test records it
  // at pool.connect itself, not from log text. The policy source is the production one (a cached
  // DB read), with the stub's origin added in memory so the shared system settings are never
  // changed.
  it('(DS-1) twenty concurrent terminals and control passes finish with a slow action server', async () => {
    const COUNT = 20;
    const PAUSED_COUNT = 10;
    const SLOTS = 10;
    const POOL_TIMEOUT = 'timeout exceeded when trying to connect';

    const stub = startStubActionServer(0, { responseDelayMs: 2000 });
    const origin = new URL(stub.uri).origin;
    const client = new ActionClient(
      cachedPolicySource(async () => {
        const policy = await getActionServerPolicy(db!);
        return { trust: policy.trust, allowlist: [...policy.allowlist, origin] };
      }),
      fetch,
      { timeoutMs: 10_000 },
    );
    const base = testDeps();
    const deps: EngineDeps = {
      ...base,
      invoker: httpActionInvoker(client, async () => stub.uri),
      config: {
        ...base.config, workerConcurrency: SLOTS, actionServerAllowlist: [origin],
        actionPollSecs: 3, invokeGraceSecs: 10, actionFetchTimeoutMs: 10_000,
      },
    };

    const logged: string[] = [];
    const record = (...args: unknown[]): void => { logged.push(args.map(String).join(' ')); };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(record);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(record);

    // Every failed checkout, from pool.query (callback form) and db.transaction (promise form).
    const connectErrors: string[] = [];
    const originalConnect = pool!.connect;
    const boundConnect = originalConnect.bind(pool!) as (cb?: (err: Error | undefined, ...rest: unknown[]) => void) => unknown;
    pool!.connect = ((cb?: (err: Error | undefined, ...rest: unknown[]) => void) => {
      if (typeof cb === 'function') {
        return boundConnect((err, ...rest) => {
          if (err) connectErrors.push(err.message);
          cb(err, ...rest);
        });
      }
      return (boundConnect() as Promise<unknown>).catch((err: Error) => {
        connectErrors.push(err.message);
        throw err;
      });
    }) as typeof originalConnect;

    /** SLOTS concurrent runOnce loops until `isDone`, failing at `capMs`. Unlike pumpConcurrently,
     *  completion is checked on its own timer, so steady poll work cannot hide that it is done.
     *  On failure the slots get a bounded grace to stop, so a wedged slot cannot stretch the cap. */
    async function pumpSlots(isDone: () => Promise<boolean>, capMs: number): Promise<void> {
      const deadline = Date.now() + capMs;
      let stop = false;
      const worker = async (): Promise<void> => {
        while (!stop) {
          const didWork = await runOnce(db!, deps);
          if (!didWork) await new Promise((r) => setTimeout(r, 5));
        }
      };
      const workers = Array.from({ length: SLOTS }, () => worker());
      try {
        while (!(await isDone())) {
          if (Date.now() >= deadline) throw new Error(`pumpSlots: not done after ${capMs} ms`);
          await new Promise((r) => setTimeout(r, 100));
        }
      } catch (err) {
        const failures = [...new Set(connectErrors)].join('; ') || 'none';
        throw new Error(`${err instanceof Error ? err.message : String(err)} (pool checkout failures: ${failures})`);
      } finally {
        stop = true;
        await Promise.race([Promise.all(workers), new Promise((r) => setTimeout(r, 15_000))]);
      }
    }

    try {
      const spec = {
        local_id: 'wf', oid: 'slow-server-ds1', version: '1.0.0', last_modified_date: '2026-01-01',
        environment_specifications: [{
          local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
          included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
        }],
        steps: [
          step('start', 'START'),
          step('act', 'ACTION PROXY', {
            action_proxy_config: { action_oid: 'act-1', environment_oid: 'env-1' },
            output_parameter_specifications: [{ id: 'Result', target: 'MyResult' }],
          }),
          step('end', 'END'),
        ],
        connections: [
          { from_step_id: 'start', to_step_id: 'act' },
          { from_step_id: 'act', to_step_id: 'end' },
        ],
      };
      const { wcId, wfId } = await makeWorkCenterAndWorkflow(spec, 'scenario-ds1');
      const ids: string[] = [];
      for (let i = 0; i < COUNT; i++) ids.push(await seedQueuedInstance(spec, 'slow-server-ds1', wcId, wfId, i + 1));
      const actRows = () => db!.select().from(stepInstance)
        .where(and(inArray(stepInstance.workflowInstanceId, ids), eq(stepInstance.stepOid, 'act')));

      // Phase 1: every instance invokes its action and parks waiting for it.
      await pumpSlots(async () => {
        const rows = await actRows();
        return rows.length === COUNT && rows.every((r) => r.state === 'WAITING_ACTION' && r.actionInstanceId);
      }, 30_000);
      const acts = await actRows();
      for (const a of acts) stub.control.advance(a.actionInstanceId!, 'RUNNING');

      // Phase 2: pause half while they wait, then complete all twenty on the server while the
      // slots run the pause passes and the terminals.
      const pausedIds = new Set(ids.slice(0, PAUSED_COUNT));
      for (const id of pausedIds) await requestPause(db!, id);
      const pump = pumpSlots(async () => {
        const rows = await db!.select({ id: workflowInstance.id, status: workflowInstance.status })
          .from(workflowInstance).where(inArray(workflowInstance.id, ids));
        const actState = new Map((await actRows()).map((r) => [r.workflowInstanceId, r.state]));
        return rows.length === COUNT && rows.every((r) => (pausedIds.has(r.id)
          ? r.status === 'paused' && actState.get(r.id) === 'COMPLETED'
          : r.status === 'completed'));
      }, 60_000);
      for (const a of acts) stub.control.advance(a.actionInstanceId!, 'COMPLETED', [{ name: 'Result', value: '42' }]);
      await pump;

      // A paused instance records its action's result but routes nothing until it resumes.
      const finals = await db!.select().from(workflowInstance).where(inArray(workflowInstance.id, ids));
      for (const r of finals) {
        expect(r.status).toBe(pausedIds.has(r.id) ? 'paused' : 'completed');
        expect(r.propertyStore).toMatchObject({ MyResult: '42' });
      }
      for (const a of await actRows()) {
        expect(a.state).toBe('COMPLETED');
        expect(a.error ?? '').not.toContain(POOL_TIMEOUT);
      }
      expect(logged.filter((m) => m.includes(POOL_TIMEOUT))).toEqual([]);
      expect(connectErrors.filter((m) => m.includes(POOL_TIMEOUT))).toEqual([]);
    } finally {
      pool!.connect = originalConnect;
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      // After a failure an SSE stream can still be open, and server.close waits for it.
      await Promise.race([stub.close(), new Promise((r) => setTimeout(r, 5000))]);
    }
  }, 120_000);

  // ── (DS-2) data-safety spec 2026-10-22: a STOP survives an unreachable action server ──
  it('(DS-2) a stop with the action server unreachable at first sends STOP exactly once when it returns', async () => {
    const stub = startStubActionServer(0);
    const origin = new URL(stub.uri).origin;
    const client = new ActionClient(
      cachedPolicySource(async () => {
        const policy = await getActionServerPolicy(db!);
        return { trust: policy.trust, allowlist: [...policy.allowlist, origin] };
      }),
      fetch,
      { timeoutMs: 10_000 },
    );
    const base = testDeps();
    const deps: EngineDeps = {
      ...base,
      invoker: httpActionInvoker(client, async () => stub.uri),
      config: {
        ...base.config, actionServerAllowlist: [origin],
        actionPollSecs: 3, invokeGraceSecs: 10, actionFetchTimeoutMs: 10_000,
      },
    };
    const sendSpy = vi.spyOn(client, 'sendCommand');
    try {
      const spec = {
        local_id: 'wf', oid: 'stop-unreachable-ds2', version: '1.0.0', last_modified_date: '2026-01-01',
        environment_specifications: [{
          local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
          included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
        }],
        steps: [
          step('start', 'START'),
          step('act', 'ACTION PROXY', {
            action_proxy_config: { action_oid: 'act-1', environment_oid: 'env-1' },
            output_parameter_specifications: [{ id: 'Result', target: 'MyResult' }],
          }),
          step('end', 'END'),
        ],
        connections: [
          { from_step_id: 'start', to_step_id: 'act' },
          { from_step_id: 'act', to_step_id: 'end' },
        ],
      };
      const { wcId, wfId } = await makeWorkCenterAndWorkflow(spec, 'scenario-ds2');
      const id = await seedQueuedInstance(spec, 'stop-unreachable-ds2', wcId, wfId, 1);
      const actRow = async () => (await db!.select().from(stepInstance)
        .where(and(eq(stepInstance.workflowInstanceId, id), eq(stepInstance.stepOid, 'act'))))[0];
      const status = async () => (await db!.select().from(workflowInstance).where(eq(workflowInstance.id, id)))[0].status;

      for (let i = 0; i < 50; i++) {
        await runOnce(db!, deps);
        const a = await actRow();
        if (a && a.state === 'WAITING_ACTION' && a.actionInstanceId) break;
      }
      const a0 = await actRow();
      expect(a0?.state).toBe('WAITING_ACTION');
      stub.control.advance(a0.actionInstanceId!, 'RUNNING');

      // The server drops off and the engine's capabilities cache is cold (as after an engine restart).
      stub.control.setCapabilitiesAvailable(false);
      client.invalidateCapabilities(stub.uri);
      await requestStop(db!, id);
      for (let i = 0; i < 5; i++) await runOnce(db!, deps);
      const stopCalls = () => sendSpy.mock.calls.filter((c) => c[2] === 'STOP');
      expect(stopCalls()).toHaveLength(0);
      expect(await status()).toBe('stopping');

      stub.control.setCapabilitiesAvailable(true);
      await client.capabilities(stub.uri);
      for (let i = 0; i < 50 && (await status()) !== 'stopped'; i++) await runOnce(db!, deps);

      expect(stopCalls()).toHaveLength(1);
      expect(await status()).toBe('stopped');
    } finally {
      sendSpy.mockRestore();
      await Promise.race([stub.close(), new Promise((r) => setTimeout(r, 5000))]);
    }
  }, 60_000);

  // ── (DS-3) data-safety spec 2026-10-22 round 3: a STOP whose send fails is retried ──
  async function ds3Setup(oid: string, scenario: string) {
    const stub = startStubActionServer(0);
    const origin = new URL(stub.uri).origin;
    const client = new ActionClient(
      cachedPolicySource(async () => {
        const policy = await getActionServerPolicy(db!);
        return { trust: policy.trust, allowlist: [...policy.allowlist, origin] };
      }),
      fetch,
      { timeoutMs: 10_000 },
    );
    const base = testDeps();
    const deps: EngineDeps = {
      ...base,
      invoker: httpActionInvoker(client, async () => stub.uri),
      config: {
        ...base.config, actionServerAllowlist: [origin],
        actionPollSecs: 3, invokeGraceSecs: 10, actionFetchTimeoutMs: 10_000,
      },
    };
    const spec = {
      local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
      environment_specifications: [{
        local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
        included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
      }],
      steps: [
        step('start', 'START'),
        step('act', 'ACTION PROXY', {
          action_proxy_config: { action_oid: 'act-1', environment_oid: 'env-1' },
          output_parameter_specifications: [{ id: 'Result', target: 'MyResult' }],
        }),
        step('end', 'END'),
      ],
      connections: [
        { from_step_id: 'start', to_step_id: 'act' },
        { from_step_id: 'act', to_step_id: 'end' },
      ],
    };
    const { wcId, wfId } = await makeWorkCenterAndWorkflow(spec, scenario);
    const id = await seedQueuedInstance(spec, oid, wcId, wfId, 1);
    const actRow = async () => (await db!.select().from(stepInstance)
      .where(and(eq(stepInstance.workflowInstanceId, id), eq(stepInstance.stepOid, 'act'))))[0];
    const status = async () => (await db!.select().from(workflowInstance).where(eq(workflowInstance.id, id)))[0].status;
    for (let i = 0; i < 50; i++) {
      await runOnce(db!, deps);
      const a = await actRow();
      if (a && a.state === 'WAITING_ACTION' && a.actionInstanceId) break;
    }
    const a0 = await actRow();
    expect(a0?.state).toBe('WAITING_ACTION');
    stub.control.advance(a0.actionInstanceId!, 'RUNNING');
    await client.capabilities(stub.uri); // warm cache, so the first STOP is really sent
    return { stub, client, deps, id, status };
  }

  it('(DS-3) a STOP whose first send fails as unreachable is delivered exactly once when the server returns', async () => {
    const { stub, client, deps, id, status } = await ds3Setup('stop-unreachable-ds3', 'scenario-ds3');
    const sendSpy = vi.spyOn(client, 'sendCommand');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const stopCalls = () => sendSpy.mock.calls.filter((c) => c[2] === 'STOP');
      stub.control.setCommandResponse(503);
      await requestStop(db!, id);
      for (let i = 0; i < 20 && stopCalls().length < 1; i++) await runOnce(db!, deps);
      for (let i = 0; i < 5; i++) await runOnce(db!, deps);
      expect(stopCalls()).toHaveLength(1);
      expect(await status()).toBe('stopping');

      stub.control.setCommandResponse(200);
      await client.capabilities(stub.uri);
      for (let i = 0; i < 50 && (await status()) !== 'stopped'; i++) await runOnce(db!, deps);

      expect(stopCalls()).toHaveLength(2);
      await expect(sendSpy.mock.results[sendSpy.mock.calls.indexOf(stopCalls()[1])].value).resolves.not.toThrow(); // the second STOP succeeded
      await expect(sendSpy.mock.results[sendSpy.mock.calls.indexOf(stopCalls()[0])].value).rejects.toThrow(); // the first failed
      expect(await status()).toBe('stopped');
    } finally {
      sendSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      await Promise.race([stub.close(), new Promise((r) => setTimeout(r, 5000))]);
    }
  }, 60_000);

  it('(DS-3b) an undo that finds the instance row locked is queued and applied once the lock is released', async () => {
    const { stub, client, deps, id, status } = await ds3Setup('stop-busy-ds3b', 'scenario-ds3b');
    const orig = client.sendCommand.bind(client);
    let holder: import('pg').PoolClient | undefined;
    let held = false;
    const sendSpy = vi.spyOn(client, 'sendCommand').mockImplementation(async (...args) => {
      if (args[2] === 'STOP' && !holder) {
        // The send is post-commit; hold the row lock from here so the undo's SKIP LOCKED claim is busy.
        holder = await pool!.connect();
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM workflow_instance WHERE id = $1 FOR UPDATE', [id]);
        held = true;
      }
      return orig(...args);
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const stopCalls = () => sendSpy.mock.calls.filter((c) => c[2] === 'STOP');
      stub.control.setCommandResponse(503);
      await requestStop(db!, id);
      for (let i = 0; i < 20 && stopCalls().length < 1; i++) await runOnce(db!, deps);
      expect(stopCalls()).toHaveLength(1);
      expect(holder).toBeDefined();
      // The undo found the row locked and queued. A plain SELECT is not blocked by FOR UPDATE:
      // the step is still recorded as stopped (not undone) and no further STOP goes out.
      const stopped = async () => {
        const r = await pool!.query('SELECT engine_state FROM workflow_instance WHERE id = $1', [id]);
        return (r.rows[0].engine_state?.stoppedActions ?? []) as string[];
      };
      for (let i = 0; i < 3; i++) await runOnce(db!, deps);
      expect(await stopped()).toContain('act');
      expect(stopCalls()).toHaveLength(1);

      await holder!.query('COMMIT');
      holder!.release();
      held = false;
      // Server still failing and capabilities still cold: the queued undo applies, and nothing re-sends yet.
      for (let i = 0; i < 10 && (await stopped()).includes('act'); i++) await runOnce(db!, deps);
      expect(await stopped()).not.toContain('act');
      expect(stopCalls()).toHaveLength(1);

      stub.control.setCommandResponse(200);
      await client.capabilities(stub.uri);
      for (let i = 0; i < 50 && (await status()) !== 'stopped'; i++) await runOnce(db!, deps);

      expect(stopCalls()).toHaveLength(2);
      expect(await status()).toBe('stopped');
    } finally {
      if (holder && held) {
        try { await holder.query('ROLLBACK'); holder.release(); } catch { holder.release(true); }
      }
      sendSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      await Promise.race([stub.close(), new Promise((r) => setTimeout(r, 5000))]);
    }
  }, 60_000);

  it('two engines sweeping at once delete each row once', async () => {
    const { wcId, wfId } = await makeWorkCenterAndWorkflow(SIMPLE_SPEC_FOR_SWEEP, 'sweep');
    try {
      await db!.update(workCenter).set({ finishedRetentionSecs: 60 }).where(eq(workCenter.id, wcId));
      await db!.execute(sql`
        insert into workflow_instance (
          workflow_id, work_center_id, triggered_by, status, queued_at, completed_at, spec_jsonb,
          runtime_number, runtime_label, master_name, master_oid, master_version, master_state
        )
        select ${wfId}::uuid, ${wcId}::uuid, 'manual', 'completed', now(), now() - interval '2 hours',
          '{}'::jsonb, n, 'RW-' || n, 'm', 'm', '1.0.0', 'Approved'
        from generate_series(1, 1500) as n
      `);
      // Both sweeps are scoped to this test's own work center, so no other e2e row is touched.
      const expected = 1500;
      const opts = { batchSize: 100, maxBatches: expected / 100 + 2, workCenterIds: [wcId] };

      const clock = () => new Date();
      const [a, b] = await Promise.all([runSweep(db!, clock, opts), runSweep(db!, clock, opts)]);
      // Each batch claims with SKIP LOCKED, so the two engines never delete (or count) a row twice.
      const left = await db!.execute(sql`select count(*)::int as n from workflow_instance where work_center_id = ${wcId}`);
      expect((left.rows[0] as { n: number }).n).toBe(0);
      expect(a + b).toBe(expected);
    } finally {
      // The 1500 raw-SQL rows are not tracked by id; remove only this work center's rows.
      await db!.execute(sql`delete from workflow_instance where work_center_id = ${wcId}`);
    }
  }, 60_000);
});
