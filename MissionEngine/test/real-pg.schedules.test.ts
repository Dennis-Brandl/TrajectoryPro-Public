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
// Workflow scheduling against real, multi-connection Postgres (spec 2026-11-08 §12 "Must prove").
// PGlite runs one transaction at a time, so nothing in mission-control-db's own tests can show what
// two engines, or an engine and a control, do at the same moment.
//
// Three kinds of test:
//   - Forced orders. A transaction is held open, or a workflow row held locked, until the other
//     side is seen waiting in pg_stat_activity, so each order is really exercised on every run.
//   - Repeated races, with a random delay. These cover the orders that cannot be forced.
//   - A trigger (sched_test_audit_start) that records what a transaction could see at the moment
//     it recorded a start. afterEach requires every start to have seen an active Runtime and an
//     enabled item, in every test: a control committed earlier would be visible there.
//
//   REAL_PG_TEST_URL=postgres://postgres:postgres@127.0.0.1:5432/mission_commander_e2e npm run test:real-pg
//
// runScheduleTick works across the whole database, so this file cancels any live Runtime Schedule
// and purges queued rows first (as real-pg.engine.test.ts does), and leaves none behind. Run it
// against a test database only, and not at the same time as real-pg.engine.test.ts.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  runtimeHistory, runtimeSchedule, runtimeScheduleItem, scheduleItemRun, scheduleOccurrence,
  workCenter, workflow, workflowInstance,
} from 'mission-control-db/src/db/schema/index';
import { deleteWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { replaceWorkflowEntry } from 'mission-control-db/src/ingest/replace-workflow-entry';
import { acquireQueuedRuntimeWorkflows } from 'mission-control-db/src/runtime/engine-access';
import { createMasterSchedule } from 'mission-control-db/src/scheduling/master-dao';
import { enableMasterSchedule, runMasterScheduleOnce } from 'mission-control-db/src/scheduling/enable';
import { fireOneSlot } from 'mission-control-db/src/scheduling/fire';
import { chainContext, startChainItem } from 'mission-control-db/src/scheduling/chain';
import {
  cancelRuntimeSchedule, getResumePreview, pauseRuntimeSchedule, resumeRuntimeSchedule, setRuntimeItemDisabled,
} from 'mission-control-db/src/scheduling/controls';
import { runScheduleTick } from 'mission-control-db/src/scheduling/tick';
import { createDb, type Db } from '../src/db.js';
import { startScheduleTimer } from '../src/schedule-tick.js';
import { testDeps } from './helpers/pump.js';

const url = process.env.REAL_PG_TEST_URL;

const ENABLED_AT = new Date('2026-11-08T12:00:00Z');
/** Hours after midnight on 2026-11-09, UTC. The n-th slot of HOURLY is hour(n). */
const hour = (n: number, minutes = 0) => new Date(Date.UTC(2026, 10, 9, n, minutes));
const HOURLY = { type: 'interval', every: 1, unit: 'hours', startAt: '2026-11-09T01:00' };
const actor = { kind: 'system' } as const;
const LONG = { timeout: 180_000 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shuffled = <T>(list: T[]) => list.map((v) => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

const specOf = (name: string, oid: string, revision = 0) => ({
  oid, local_id: name, version: '1.0.0', state: 'Draft', revision,
  starting_parameter_specifications: [{ id: 'BatchId', value_type: 'literal', default_value: '' }],
  output_parameter_specifications: [{ id: 'Yield' }],
  steps: [{ local_id: 'Only', oid: `s-${oid}`, step_type: 'START' }],
  connections: [],
});

/** Blend, chained to Move and Clean. */
const TREE = [{
  workflow: { name: 'Blend' },
  params: { BatchId: { from: 'occurrence.datetime' } },
  chain: [
    { workflow: { name: 'Move' }, triggerOn: ['completed'], params: { BatchId: { from: 'trigger.input', name: 'BatchId' } } },
    { workflow: { name: 'Clean' }, triggerOn: ['completed'], params: { BatchId: { from: 'trigger.input', name: 'BatchId' } } },
  ],
}];
const BLEND_ONLY = [{ workflow: { name: 'Blend' }, params: { BatchId: { from: 'occurrence.datetime' } } }];

type RunRow = {
  id: string; status: string; workflow_instance_id: string | null; detail: string | null;
  name: string; scheduled_at: Date; number: number; item_id: string;
};
type TickResult = Awaited<ReturnType<typeof runScheduleTick>>;

describe.skipIf(!url)('workflow scheduling: real Postgres', () => {
  const conn = url ? createDb(url) : null;
  const pool = conn?.pool as NonNullable<typeof conn>['pool'];
  const db = conn?.db as unknown as Db;
  const anyDb = db as any;
  const cleanups: Array<() => Promise<void>> = [];
  const workCenterIds: string[] = [];
  let names = 0;

  /**
   * Everything still live ends here: the tick is database-wide, so a later test must not fire it.
   * The instances end with no history, which no real run does, so their `started` rows end here too.
   * Left `started`, afterAll's work center delete would leave them with no instance and no history,
   * and a later run's scan would mark them lost.
   */
  async function neutralize(): Promise<void> {
    await pool.query(`UPDATE runtime_schedule SET status = 'cancelled', ended_at = now(), next_fire_at = NULL,
      missed_from = NULL, missed_to = NULL, catchup_mode = NULL, catchup_cursor = NULL, catchup_to = NULL
      WHERE status IN ('active', 'paused')`);
    await pool.query(`UPDATE schedule_item_run SET status = 'cancelled' WHERE status IN ('held', 'start_requested', 'started')`);
    await pool.query(`UPDATE workflow_instance SET status = 'completed'
      WHERE status = 'queued' OR (status = 'running' AND work_center_id = ANY($1::uuid[]))`, [workCenterIds]);
  }

  beforeAll(async () => {
    if (!conn) return;
    await migrate(db, { migrationsFolder: '../mission-control-db/drizzle' }); // idempotent
    await neutralize();
    await pool.query(`CREATE TABLE IF NOT EXISTS sched_test_start_audit (
      item_run_id uuid NOT NULL, runtime_status text NOT NULL, item_disabled boolean NOT NULL)`);
    await pool.query(`CREATE OR REPLACE FUNCTION sched_test_audit_start() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.status = 'started' AND (TG_OP = 'INSERT' OR OLD.status <> 'started') THEN
          INSERT INTO sched_test_start_audit
            SELECT NEW.id, rs.status, i.disabled
            FROM schedule_occurrence o
            JOIN runtime_schedule rs ON rs.id = o.runtime_schedule_id
            JOIN runtime_schedule_item i ON i.id = NEW.item_id
            WHERE o.id = NEW.occurrence_id;
        END IF;
        RETURN NEW;
      END $fn$`);
    await pool.query(`DROP TRIGGER IF EXISTS sched_test_audit_start ON schedule_item_run`);
    await pool.query(`CREATE TRIGGER sched_test_audit_start AFTER INSERT OR UPDATE ON schedule_item_run
      FOR EACH ROW EXECUTE FUNCTION sched_test_audit_start()`);
  });

  afterAll(async () => {
    if (!conn) return;
    try {
      await neutralize();
      await pool.query(`DROP TRIGGER IF EXISTS sched_test_audit_start ON schedule_item_run`);
      await pool.query(`DROP FUNCTION IF EXISTS sched_test_audit_start()`);
      await pool.query(`DROP TABLE IF EXISTS sched_test_start_audit`);
      for (const id of workCenterIds) await deleteWorkCenter(db as any, id, { confirmed: true });
    } finally {
      await pool.end();
    }
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE sched_test_start_audit`);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    while (cleanups.length) await cleanups.pop()!();
    const { rows } = await pool.query(`SELECT runtime_status, item_disabled FROM sched_test_start_audit
      WHERE runtime_status <> 'active' OR item_disabled`);
    await neutralize();
    expect(rows, 'a start was recorded after a control had committed').toEqual([]);
  });

  // ------------------------------------------------------------------------------------- fixtures

  async function scene(workflowNames: string[] = ['Blend', 'Move', 'Clean'], state = 'Effective') {
    const rand = Math.random().toString(36).slice(2, 10);
    const [wc] = await db.insert(workCenter).values({ name: `Sched-${rand}`, timeZone: 'UTC' }).returning();
    workCenterIds.push(wc!.id);
    const workflowIds: Record<string, string> = {};
    for (const name of workflowNames) {
      const oid = `wf-${name}-${rand}`;
      const [wf] = await db.insert(workflow).values({
        oid, name, workCenterId: wc!.id, version: '1.0.0', state, specJsonb: specOf(name, oid),
      }).returning();
      workflowIds[name] = wf!.id;
    }
    const enable = async (items: unknown[] = TREE, recurrence: unknown = HOURLY): Promise<string> => {
      const master = await createMasterSchedule(anyDb, wc!.id, { name: `Sched ${++names}`, recurrence, items }, actor);
      const { runtime } = await enableMasterSchedule(anyDb, master.id, actor, ENABLED_AT);
      return runtime.id;
    };
    return { wc: wc!, workflowIds, enable };
  }

  const tick = (now: Date, on: any = anyDb): Promise<TickResult> => runScheduleTick(on, now);
  const idle = (r: TickResult) => r.chains + r.catchup + r.fired + r.lost + r.finished === 0;

  /** Ticks until one finds nothing. Another loop may hold a row meanwhile, which a later drain picks up. */
  async function tickLoop(now: Date, on: any = anyDb): Promise<void> {
    for (let i = 0; i < 200; i++) if (idle(await tick(now, on))) return;
    throw new Error('A tick loop did not settle');
  }

  /**
   * Two tick loops that keep going through idle ticks until stop(), so whatever runs meanwhile really
   * does race an engine that is ticking. stop() lets each finish on an idle tick and rethrows a failure.
   */
  function startTickLoops(now: Date): { stop: () => Promise<void> } {
    let stopping = false;
    const loop = async () => {
      for (;;) {
        if (idle(await tick(now))) {
          if (stopping) return;
          await sleep(1);
        }
      }
    };
    const loops = Promise.allSettled([loop(), loop()]);
    cleanups.push(async () => { stopping = true; await loops; });
    return {
      stop: async () => {
        stopping = true;
        for (const result of await loops) if (result.status === 'rejected') throw result.reason;
      },
    };
  }

  const runsOf = async (runtimeId: string): Promise<RunRow[]> => (await pool.query(`
    SELECT r.id, r.status, r.workflow_instance_id, r.detail, r.item_id, i.master_name AS name, o.scheduled_at, o.number
    FROM schedule_item_run r
    JOIN schedule_occurrence o ON o.id = r.occurrence_id
    JOIN runtime_schedule_item i ON i.id = r.item_id
    WHERE o.runtime_schedule_id = $1
    ORDER BY o.scheduled_at, i.position, i.id`, [runtimeId])).rows;

  const statusByName = async (runtimeId: string, slot: number) => Object.fromEntries(
    (await runsOf(runtimeId)).filter((r) => r.number === slot).map((r) => [r.name, r.status]),
  );

  const slotsOf = async (runtimeId: string): Promise<number[]> => (await pool.query(
    `SELECT number FROM schedule_occurrence WHERE runtime_schedule_id = $1 ORDER BY scheduled_at`, [runtimeId],
  )).rows.map((r) => r.number);

  /** Runs this Runtime has really created, read from the instances themselves. */
  const startCount = async (runtimeId: string): Promise<number> => (await pool.query(`
    SELECT count(*)::int AS n FROM workflow_instance wi
    JOIN schedule_item_run r ON r.id = wi.schedule_item_run_id
    JOIN schedule_occurrence o ON o.id = r.occurrence_id
    WHERE o.runtime_schedule_id = $1`, [runtimeId])).rows[0].n;

  const rowOf = async (id: string) => (await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, id)))[0]!;

  /** What settleTerminal leaves behind: the run's final state, and history as the proof of it. */
  async function endStartedRuns(runtimeId: string, finishedAt: Date, finalState = 'completed'): Promise<number> {
    const started = (await runsOf(runtimeId)).filter((r) => r.status === 'started');
    for (const run of started) {
      const [i] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, run.workflow_instance_id!));
      const already = await db.select({ id: runtimeHistory.id }).from(runtimeHistory)
        .where(eq(runtimeHistory.workflowInstanceId, i!.id));
      if (already.length) continue;
      await db.update(workflowInstance).set({ status: finalState as 'completed' }).where(eq(workflowInstance.id, i!.id));
      await db.insert(runtimeHistory).values({
        workflowInstanceId: i!.id, workCenterId: i!.workCenterId, workCenterName: 'Line',
        runtimeNumber: i!.runtimeNumber, runtimeLabel: i!.runtimeLabel,
        masterName: i!.masterName, masterOid: i!.masterOid, masterVersion: i!.masterVersion, masterState: i!.masterState,
        finalState, finishedAt, startingParams: i!.startingParams, trace: [],
      });
    }
    return started.length;
  }

  /** One run per item per occurrence, and one instance per run, across the whole database. */
  async function expectExactlyOnce(): Promise<void> {
    const repeated = async (sql: string) => (await pool.query(sql)).rows;
    expect(await repeated(`SELECT runtime_schedule_id, scheduled_at, count(*) FROM schedule_occurrence
      GROUP BY 1, 2 HAVING count(*) > 1`), 'a slot fired twice').toEqual([]);
    expect(await repeated(`SELECT occurrence_id, item_id, count(*) FROM schedule_item_run
      GROUP BY 1, 2 HAVING count(*) > 1`), 'an item ran twice in one occurrence').toEqual([]);
    expect(await repeated(`SELECT schedule_item_run_id, count(*) FROM workflow_instance
      WHERE schedule_item_run_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1`), 'one item run has two instances').toEqual([]);
    // Only this run's work centers: a delete takes the instances, and `finished` rows outlive them.
    const { rows: noInstance } = await pool.query(`SELECT r.id FROM schedule_item_run r
      JOIN schedule_occurrence o ON o.id = r.occurrence_id
      JOIN runtime_schedule rs ON rs.id = o.runtime_schedule_id
      LEFT JOIN workflow_instance wi ON wi.id = r.workflow_instance_id
      WHERE rs.work_center_id = ANY($1::uuid[]) AND r.status IN ('started', 'finished') AND wi.id IS NULL`, [workCenterIds]);
    expect(noInstance, 'a started row has no instance').toEqual([]);
    expect(await repeated(`SELECT wi.id FROM workflow_instance wi
      LEFT JOIN schedule_item_run r ON r.id = wi.schedule_item_run_id
      WHERE wi.triggered_by = 'schedule' AND wi.schedule_item_run_id IS NOT NULL AND r.id IS NULL`),
    'an instance has no item run').toEqual([]);
  }

  /** Holds a row lock on a workflow from outside, so a start needing that workflow waits at that point. */
  async function holdWorkflow(workflowId: string): Promise<() => Promise<void>> {
    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT id FROM workflow WHERE id = $1 FOR UPDATE', [workflowId]);
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await client.query('COMMIT');
      client.release();
    };
    cleanups.push(release);
    return release;
  }

  /** Until at least `count` connections are waiting on a lock, so that side has reached its wait. */
  async function waitForBlocked(count = 1): Promise<void> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`);
      if (rows[0].n >= count) return;
      if (Date.now() > deadline) throw new Error(`Never saw ${count} connection(s) waiting on a lock`);
      await sleep(5);
    }
  }

  const errorOf = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e);

  const pause = (id: string, on: any = anyDb) => pauseRuntimeSchedule(on, id, actor, ENABLED_AT);
  const cancel = (id: string, on: any = anyDb) => cancelRuntimeSchedule(on, id, 'test', actor, ENABLED_AT);
  const CONTROLS = [
    { control: 'Pause', run: pause, waitingChild: 'held', status: 'paused' },
    { control: 'Cancel', run: cancel, waitingChild: 'cancelled', status: 'cancelled' },
  ] as const;

  /** A Runtime whose slot 1 has run and ended, so the next tick has its chain to start. */
  async function endedSlotOne(s: Awaited<ReturnType<typeof scene>>, items: unknown[] = TREE): Promise<string> {
    const id = await s.enable(items);
    await tick(hour(1));
    await endStartedRuns(id, hour(1, 30));
    return id;
  }

  // ---------------------------------------------------------------------------------- exactly once

  describe('Run Once', () => {
    it('eight copies of one request at the same moment make one Runtime and start once', async () => {
      const { wc } = await scene(['Blend']);
      const master = await createMasterSchedule(anyDb, wc.id, {
        name: `Alarm ${++names}`, recurrence: { type: 'manual' }, items: [{ workflow: { name: 'Blend' } }],
      }, actor);
      const now = new Date();
      const answers = await Promise.all(Array.from({ length: 8 }, async () => {
        await sleep(Math.random() * 20);
        return runMasterScheduleOnce(anyDb, master.id, actor, now, undefined, 'alarm-1');
      }));
      expect(new Set(answers.map((a) => a.runtime.id)).size).toBe(1);
      expect(answers.filter((a) => !a.repeated)).toHaveLength(1);

      const { rows } = await pool.query(`SELECT id FROM runtime_schedule WHERE master_schedule_id = $1`, [master.id]);
      expect(rows).toHaveLength(1);
      await runScheduleTick(anyDb, new Date(now.getTime() + 1000));
      const occurrences = await db.select().from(scheduleOccurrence).where(eq(scheduleOccurrence.runtimeScheduleId, rows[0].id));
      expect(occurrences).toHaveLength(1);
    }, LONG);

    it('separate requests overlap, each with its own Runtime', async () => {
      const { wc } = await scene(['Blend']);
      const master = await createMasterSchedule(anyDb, wc.id, {
        name: `Alarm ${++names}`, recurrence: { type: 'manual' }, items: [{ workflow: { name: 'Blend' } }],
      }, actor);
      const now = new Date();
      const answers = await Promise.all(['a', 'b', 'c', 'd'].map((id) => runMasterScheduleOnce(anyDb, master.id, actor, now, undefined, id)));
      expect(new Set(answers.map((a) => a.runtime.id)).size).toBe(4);
      expect(new Set(answers.map((a) => a.runtime.label)).size).toBe(4);
    }, LONG);
  });

  describe('exactly once', () => {
    it('two tick loops over 10 due Runtimes and 50 ended runs: one run per item per occurrence', LONG, async () => {
      const s = await scene();
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) ids.push(await s.enable());
      for (let h = 1; h <= 5; h++) expect((await tick(hour(h))).fired).toBe(10);
      let ended = 0;
      for (const id of ids) ended += await endStartedRuns(id, hour(5, 30));
      expect(ended).toBe(50);

      await Promise.all([tickLoop(hour(6)), tickLoop(hour(6))]);
      await tickLoop(hour(6));

      await expectExactlyOnce();
      for (const id of ids) {
        expect(await slotsOf(id)).toEqual([1, 2, 3, 4, 5, 6]);
        // Six starts of Blend and, for the five that ended, one each of Move and Clean.
        expect(await startCount(id)).toBe(6 + 5 * 2);
        const runs = await runsOf(id);
        expect(runs.filter((r) => r.status === 'finished').length).toBe(5);
        expect(runs.filter((r) => r.status === 'started').length).toBe(1 + 5 * 2);
        expect(runs.filter((r) => r.status === 'failed_to_start')).toEqual([]);
      }
    });

    it('two engines on their own timers and pools fire and chain exactly once', LONG, async () => {
      const s = await scene();
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) ids.push(await s.enable());
      const engines = [createDb(url!), createDb(url!)];
      const clock = { now: hour(1) };
      const base = testDeps({ now: () => clock.now });
      const deps = { ...base, config: { ...base.config, scheduleTickMs: 15 } };
      const stops = engines.map((e) => startScheduleTimer(e.db as unknown as Db, deps));
      const until = async (done: () => Promise<boolean>) => {
        const deadline = Date.now() + 30_000;
        while (!(await done())) {
          if (Date.now() > deadline) throw new Error('The timers did not get there');
          await sleep(20);
        }
      };
      try {
        await until(async () => (await Promise.all(ids.map(startCount))).every((n) => n >= 1));
        for (const id of ids) await endStartedRuns(id, hour(1, 30));
        await until(async () => (await Promise.all(ids.map(startCount))).every((n) => n >= 3));
        await sleep(200); // Long enough for a second start, if the timers were going to make one.
      } finally {
        stops.forEach((stop) => stop());
      }
      await sleep(100);
      await Promise.all(engines.map((e) => e.pool.end()));
      await expectExactlyOnce();
      for (const id of ids) {
        expect(await slotsOf(id)).toEqual([1]);
        expect(await startCount(id)).toBe(3);
      }
    });

    // What follows is the database's own guard. The row locks mean two ticks never normally reach
    // these indexes, so each test here gets past the locks in the only way that is possible: a
    // stale next_fire_at, or code that holds no Runtime lock.
    it('schedule_occurrence_slot_uq: a next_fire_at moved back onto a fired slot does not fire it again', LONG, async () => {
      const s = await scene();
      const id = await s.enable(BLEND_ONLY);
      await tick(hour(1));
      await db.update(runtimeSchedule).set({ nextFireAt: hour(1) }).where(eq(runtimeSchedule.id, id));

      await tick(hour(1));

      expect(await slotsOf(id)).toEqual([1]);
      expect(await startCount(id)).toBe(1);
      expect((await rowOf(id)).nextFireAt).toEqual(hour(2));
      await expectExactlyOnce();
    });

    it('schedule_occurrence_slot_uq: two transactions firing one slot with no row lock leave one', LONG, async () => {
      const s = await scene();
      const id = await s.enable(BLEND_ONLY);
      const row = await rowOf(id);
      const fire = () => db.transaction((tx) => fireOneSlot(tx as any, row, { at: hour(1), number: 1 }, 'on_time'));

      const results = await Promise.allSettled([fire(), fire()]);

      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(await slotsOf(id)).toEqual([1]);
      expect(await startCount(id)).toBe(1);
      await expectExactlyOnce();
    });

    it('schedule_item_run_occ_item_uq: two transactions starting one chain with no row lock leave one', LONG, async () => {
      const s = await scene();
      const id = await s.enable(TREE);
      await tick(hour(1));
      const [blend] = await db.select().from(scheduleItemRun)
        .where(eq(scheduleItemRun.id, (await runsOf(id))[0]!.id));
      const parent = { ...blend!, triggerValues: { inputs: { BatchId: 'B-1' }, outputs: {} } };
      const items = await db.select().from(runtimeScheduleItem).where(eq(runtimeScheduleItem.runtimeScheduleId, id));
      const child = items.find((i) => i.masterName === 'Move')!;
      const [occurrence] = await db.select().from(scheduleOccurrence)
        .where(eq(scheduleOccurrence.id, parent.occurrenceId));
      const runtime = await rowOf(id);
      const start = () => db.transaction((tx) => startChainItem(
        tx as any, parent, child, chainContext(parent, runtime, occurrence!),
      ));

      const results = await Promise.allSettled([start(), start()]);

      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect((await runsOf(id)).filter((r) => r.name === 'Move').map((r) => r.status)).toEqual(['started']);
      expect(await startCount(id)).toBe(2);
      await expectExactlyOnce();
    });

    it('start order follows the list, whatever the workflow ids, and the engine claims them in that order', LONG, async () => {
      const list = ['A', 'B', 'C', 'D', 'E', 'F'];
      const s = await scene(list);
      // Named so that list order and workflow id order differ: the list runs against the ids.
      const byIdDescending = Object.entries(s.workflowIds).sort(([, a], [, b]) => (a < b ? 1 : -1)).map(([name]) => name);
      const id = await s.enable(byIdDescending.map((name) => ({ workflow: { name }, params: { BatchId: { value: name } } })));

      await Promise.all([tickLoop(hour(1)), tickLoop(hour(1))]);

      const { rows } = await pool.query(`
        SELECT i.master_name AS name, to_char(wi.queued_at, 'YYYY-MM-DD HH24:MI:SS.US') AS queued
        FROM schedule_item_run r
        JOIN runtime_schedule_item i ON i.id = r.item_id
        JOIN workflow_instance wi ON wi.id = r.workflow_instance_id
        JOIN schedule_occurrence o ON o.id = r.occurrence_id
        WHERE o.runtime_schedule_id = $1
        ORDER BY i.position`, [id]);
      expect(rows.map((r) => r.name)).toEqual(byIdDescending);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].queued > rows[i - 1].queued, `${rows[i].name} is queued after ${rows[i - 1].name}`).toBe(true);
      }

      const claimed: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const [one] = await acquireQueuedRuntimeWorkflows(anyDb, 1);
        claimed.push(one!.masterName);
      }
      expect(claimed).toEqual(byIdDescending);
    });
  });

  // ---------------------------------------------------------------------------------- crash safety

  describe('crash safety', () => {
    it('a run that ended before its work center was deleted, on a cancelled Runtime, is finished and never lost', LONG, async () => {
      const s = await scene();
      const id = await s.enable();
      await tick(hour(1));
      await cancel(id);
      await endStartedRuns(id, hour(1, 10));
      await deleteWorkCenter(anyDb, s.wc.id, { confirmed: true });
      workCenterIds.splice(workCenterIds.indexOf(s.wc.id), 1);

      // From the real clock, since the lost-run scan compares this with the row's real created_at:
      // an hour on is past the age it looks for, and the two ticks are past its once-a-minute limit.
      const later = Date.now() + 3_600_000;
      await tick(new Date(later));
      await tick(new Date(later + 120_000));

      expect(await statusByName(id, 1)).toEqual({ Blend: 'finished', Move: 'cancelled', Clean: 'cancelled' });
      expect(await startCount(id)).toBe(0); // The delete took the instance; the record stays.
    });

    it('a chain transaction that throws at its commit leaves nothing; the next tick fires the chain once', LONG, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = await scene();
      const id = await endedSlotOne(s);
      await pool.query(`CREATE OR REPLACE FUNCTION sched_test_boom() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN RAISE EXCEPTION 'simulated crash in a chain transaction'; END $fn$`);
      await pool.query(`CREATE CONSTRAINT TRIGGER sched_test_boom AFTER INSERT ON schedule_item_run
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.parent_run_id IS NOT NULL)
        EXECUTE FUNCTION sched_test_boom()`);
      const removeBoom = async () => {
        await pool.query(`DROP TRIGGER IF EXISTS sched_test_boom ON schedule_item_run`);
        await pool.query(`DROP FUNCTION IF EXISTS sched_test_boom()`);
      };
      cleanups.push(removeBoom);

      // The children's runs have been created by the time the commit fails, and they go with it.
      expect((await tick(hour(1, 40))).chains).toBe(0);
      expect(await statusByName(id, 1)).toEqual({ Blend: 'started' });
      expect(await startCount(id)).toBe(1);

      await removeBoom();
      expect((await tick(hour(1, 41))).chains).toBe(1);
      expect(await statusByName(id, 1)).toEqual({ Blend: 'finished', Move: 'started', Clean: 'started' });
      expect(await startCount(id)).toBe(3);

      expect((await tick(hour(1, 42))).chains).toBe(0);
      expect(await startCount(id)).toBe(3);
      await expectExactlyOnce();
    });

    it('a connection killed in the middle of a chain transaction leaves nothing; the next tick fires it once', LONG, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = await scene();
      const id = await endedSlotOne(s);
      // A checked-out connection that dies emits 'error'. With no listener that is an uncaught
      // exception, which would stop an engine, and a restarted engine is what this test goes on to
      // be. The listener keeps vitest's process alive to see it.
      const engine = createDb(url!);
      engine.pool.on('connect', (client) => { client.on('error', () => {}); });
      const release = await holdWorkflow(s.workflowIds.Move!);
      const ticking = tick(hour(1, 40), engine.db);
      await waitForBlocked();

      const { rows } = await pool.query(`SELECT pg_terminate_backend(pid) AS killed FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`);
      expect(rows).toEqual([{ killed: true }]);
      await ticking;
      await release();
      await engine.pool.end();

      expect(await statusByName(id, 1)).toEqual({ Blend: 'started' });
      expect(await startCount(id)).toBe(1);

      expect((await tick(hour(1, 41))).chains).toBe(1);
      expect(await statusByName(id, 1)).toEqual({ Blend: 'finished', Move: 'started', Clean: 'started' });
      expect((await tick(hour(1, 42))).chains).toBe(0);
      expect(await startCount(id)).toBe(3);
      await expectExactlyOnce();
    });
  });

  // ------------------------------------------------------------------------- Pause and Cancel races

  describe.each(CONTROLS)('$control racing the tick', ({ run, waitingChild, status }) => {
    it('committed before a chain looks: the chain does not start', LONG, async () => {
      const s = await scene();
      const id = await endedSlotOne(s);
      let ticking!: Promise<TickResult>;
      await db.transaction(async (tx) => {
        await run(id, tx);
        ticking = tick(hour(1, 40));
        await waitForBlocked(); // The chain transaction is at its FOR SHARE on the Runtime.
      });
      await ticking;
      expect(await statusByName(id, 1)).toEqual({ Blend: 'finished', Move: waitingChild, Clean: waitingChild });
      expect(await startCount(id)).toBe(1);
      expect((await rowOf(id)).status).toBe(status);
    });

    it('arriving while a chain is starting: it waits, the chain stands, and nothing starts after', LONG, async () => {
      const s = await scene();
      const id = await endedSlotOne(s);
      const release = await holdWorkflow(s.workflowIds.Clean!);
      const ticking = tick(hour(1, 40));
      await waitForBlocked();
      const control = run(id);
      await waitForBlocked(2);

      await release();
      await control;
      const atCommit = await startCount(id);
      await ticking;

      expect(await statusByName(id, 1)).toEqual({ Blend: 'finished', Move: 'started', Clean: 'started' });
      expect(atCommit).toBe(3);
      await tick(hour(2));
      expect(await startCount(id)).toBe(3);
      expect((await rowOf(id)).status).toBe(status);
    });

    it('holding the Runtime when a slot is due: the tick passes over it and fires nothing', LONG, async () => {
      const s = await scene();
      const id = await s.enable();
      await db.transaction(async (tx) => {
        await run(id, tx);
        expect((await tick(hour(1))).fired).toBe(0);
      });
      expect((await tick(hour(1))).fired).toBe(0);
      expect(await slotsOf(id)).toEqual([]);
      expect(await startCount(id)).toBe(0);
    });

    it('arriving while a slot is firing: it waits, the slot stands, and nothing starts after', LONG, async () => {
      const s = await scene();
      const id = await s.enable();
      const release = await holdWorkflow(s.workflowIds.Blend!);
      const ticking = tick(hour(1));
      await waitForBlocked();
      const control = run(id);
      await waitForBlocked(2);

      await release();
      await control;
      const atCommit = await startCount(id);
      await ticking;

      expect(atCommit).toBe(1);
      expect(await slotsOf(id)).toEqual([1]);
      await tick(hour(2));
      expect(await slotsOf(id)).toEqual([1]);
      expect(await startCount(id)).toBe(1);
      expect((await rowOf(id)).status).toBe(status);
    });

    it('raced at random against two tick loops with a chain and a slot both waiting', LONG, async () => {
      const s = await scene();
      for (let round = 0; round < 20; round++) {
        const id = await endedSlotOne(s);
        const loops = startTickLoops(hour(2));
        await sleep(Math.random() * 12);
        await run(id);
        const atCommit = await startCount(id);
        await loops.stop();
        await tick(hour(3));

        expect(await startCount(id), `round ${round}`).toBe(atCommit);
        expect((await rowOf(id)).status).toBe(status);
        const children = (await runsOf(id)).filter((r) => r.number === 1 && r.name !== 'Blend').map((r) => r.status);
        for (const child of children) expect(['started', waitingChild]).toContain(child);
        await expectExactlyOnce();
        await neutralize();
      }
    });
  });

  // ---------------------------------------------------------------------------------- Resume races

  describe('Resume races', () => {
    /** Paused before its first slot, then resumed at 05:30: five slots missed. */
    const pausedWithMissedSlots = async (s: Awaited<ReturnType<typeof scene>>, items: unknown[] = BLEND_ONLY) => {
      const id = await s.enable(items);
      await pause(id);
      return id;
    };
    const RESUME_AT = hour(5, 30);
    const resume = (id: string, missed: 'all' | 'skip' = 'all', on: any = anyDb) =>
      resumeRuntimeSchedule(on, id, { missed }, actor, RESUME_AT);

    it('Resume and Resume, against two tick loops: one wins, the other is refused, each slot starts once', LONG, async () => {
      const s = await scene();
      for (let round = 0; round < 15; round++) {
        const id = await pausedWithMissedSlots(s);
        const loops = startTickLoops(RESUME_AT);
        const [first, second] = await Promise.allSettled([resume(id), resume(id)]);
        await loops.stop();
        expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
        const refused = [first, second].find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(refused.reason.code).toBe('RUNTIME_SCHEDULE_STATE');

        await tickLoop(RESUME_AT);
        expect(await slotsOf(id)).toEqual([1, 2, 3, 4, 5]);
        expect(await startCount(id)).toBe(5);
        await expectExactlyOnce();
        await neutralize();
      }
    });

    it('Start all and Skip at once: whichever commits first decides, and the other is refused', LONG, async () => {
      const s = await scene();
      for (let round = 0; round < 10; round++) {
        const id = await pausedWithMissedSlots(s);
        const results = await Promise.allSettled([resume(id, 'all'), resume(id, 'skip')]);
        expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
        await Promise.all([tickLoop(RESUME_AT), tickLoop(RESUME_AT)]);
        await tickLoop(RESUME_AT);
        expect(await slotsOf(id)).toEqual(results[0].status === 'fulfilled' ? [1, 2, 3, 4, 5] : []);
        await expectExactlyOnce();
        await neutralize();
      }
    });

    it('Resume committed, then Cancel: both succeed, it ends cancelled, and nothing started', LONG, async () => {
      const s = await scene();
      const id = await pausedWithMissedSlots(s);
      let cancelling!: Promise<void>;
      await db.transaction(async (tx) => {
        await resume(id, 'all', tx);
        cancelling = cancel(id);
        await waitForBlocked();
      });
      await cancelling;
      await tickLoop(RESUME_AT);
      expect(await rowOf(id)).toMatchObject({ status: 'cancelled', catchupMode: null });
      expect(await startCount(id)).toBe(0);
    });

    it('Cancel committed, then Resume: Resume is refused, it stays cancelled, and nothing starts', LONG, async () => {
      const s = await scene();
      const id = await pausedWithMissedSlots(s);
      let resuming!: Promise<unknown>;
      await db.transaction(async (tx) => {
        await cancel(id, tx);
        resuming = errorOf(resume(id));
        await waitForBlocked();
      });
      expect(await resuming).toMatchObject({ code: 'RUNTIME_SCHEDULE_STATE' });
      await tickLoop(RESUME_AT);
      expect((await rowOf(id)).status).toBe('cancelled');
      expect(await startCount(id)).toBe(0);
    });

    it('Resume and Cancel at random against two tick loops, with a held chain: no slot twice, nothing after the Cancel', LONG, async () => {
      const s = await scene();
      const outcomes = new Set<string>();
      for (let round = 0; round < 24; round++) {
        const id = await s.enable(TREE);
        await tick(hour(1));
        await endStartedRuns(id, hour(1, 10));
        await pause(id);
        await tick(hour(1, 20));
        expect(await statusByName(id, 1)).toEqual({ Blend: 'finished', Move: 'held', Clean: 'held' });

        // Half of the rounds send Cancel first, so that each order comes up.
        const loops = startTickLoops(RESUME_AT);
        let resuming: Promise<unknown>;
        let cancelling: Promise<void>;
        if (round % 2 === 0) {
          resuming = errorOf(resume(id));
          await sleep(Math.random() * 10);
          cancelling = cancel(id);
        } else {
          cancelling = cancel(id);
          resuming = errorOf(resume(id));
        }
        await cancelling;
        const atCommit = await startCount(id);
        const refused = await resuming;
        await loops.stop();
        await tick(hour(6));

        // Cancel always succeeds, since a Resume before it leaves the Runtime active.
        expect((await rowOf(id)).status).toBe('cancelled');
        expect(refused === null || (refused as { code?: string }).code === 'RUNTIME_SCHEDULE_STATE').toBe(true);
        outcomes.add(refused ? 'cancel first' : 'resume first');
        expect(await startCount(id), `round ${round}`).toBe(atCommit);
        for (const r of await runsOf(id)) {
          expect(['finished', 'started', 'cancelled']).toContain(r.status);
          if (r.status === 'cancelled') expect(r.workflow_instance_id).toBeNull();
        }
        const slots = await slotsOf(id);
        expect(new Set(slots).size).toBe(slots.length);
        await expectExactlyOnce();
        await neutralize();
      }
      expect([...outcomes].sort()).toEqual(['cancel first', 'resume first']);
    });
  });

  // ------------------------------------------------------------------------- Pause during a catch-up

  describe('Pause during a catch-up', () => {
    it('arriving while a catch-up slot is firing: it waits, and the rest go back to the window, each once', LONG, async () => {
      const s = await scene();
      const id = await s.enable(BLEND_ONLY);
      await pause(id);
      await resumeRuntimeSchedule(anyDb, id, { missed: 'all' }, actor, hour(5, 30));

      const release = await holdWorkflow(s.workflowIds.Blend!);
      const ticking = tick(hour(5, 30));
      await waitForBlocked();
      const pausing = pause(id);
      await waitForBlocked(2);
      await release();
      await pausing;
      const atCommit = await startCount(id);
      await ticking;

      // The Pause read the cursor the firing transaction left, not the one it saw before waiting.
      expect(atCommit).toBe(1);
      expect(await slotsOf(id)).toEqual([1]);
      expect(await rowOf(id)).toMatchObject({ status: 'paused', missedFrom: hour(2), catchupMode: null, catchupCursor: null });
      await tick(hour(6));
      expect(await startCount(id)).toBe(1);
      expect(await getResumePreview(anyDb, id, hour(5, 30))).toMatchObject({ missedCount: 4, missedFirst: hour(2) });

      await resumeRuntimeSchedule(anyDb, id, { missed: 'all' }, actor, hour(5, 30));
      await Promise.all([tickLoop(hour(5, 30)), tickLoop(hour(5, 30))]);
      expect(await slotsOf(id)).toEqual([1, 2, 3, 4, 5]);
      expect(await startCount(id)).toBe(5);
      await expectExactlyOnce();
    });

    it('at random against two tick loops, then Resume: nothing after the Pause, and every slot once', LONG, async () => {
      const s = await scene();
      const firstWindowEnd = 60;
      for (let round = 0; round < 6; round++) {
        const id = await s.enable(BLEND_ONLY);
        await pause(id);
        await resumeRuntimeSchedule(anyDb, id, { missed: 'all' }, actor, hour(firstWindowEnd, 30));

        const loops = startTickLoops(hour(firstWindowEnd, 30));
        await sleep(20 + Math.random() * 150);
        await pause(id);
        const atCommit = await startCount(id);
        await loops.stop();
        await tick(hour(firstWindowEnd + 1));
        expect(await startCount(id), `round ${round}`).toBe(atCommit);

        const resumeAt = hour(firstWindowEnd + 1, 30);
        await resumeRuntimeSchedule(anyDb, id, { missed: 'all' }, actor, resumeAt);
        await Promise.all([tickLoop(resumeAt), tickLoop(resumeAt)]);
        await tickLoop(resumeAt);

        const expected = Array.from({ length: firstWindowEnd + 1 }, (_, i) => i + 1);
        expect(await slotsOf(id), `round ${round}`).toEqual(expected);
        expect(await startCount(id)).toBe(expected.length);
        await expectExactlyOnce();
        await neutralize();
      }
    });
  });

  // ----------------------------------------------------------------------------------------- Disable

  describe('Disable racing a start', () => {
    const itemNamed = async (id: string, name: string) => (await db.select().from(runtimeScheduleItem)
      .where(eq(runtimeScheduleItem.runtimeScheduleId, id))).find((i) => i.masterName === name)!;
    const disable = (itemId: string, on: any = anyDb) => setRuntimeItemDisabled(on, itemId, true, actor, ENABLED_AT);

    it('committed before a chain looks: that child is skipped, its sibling starts', LONG, async () => {
      const s = await scene();
      const id = await endedSlotOne(s);
      const move = await itemNamed(id, 'Move');
      let ticking!: Promise<TickResult>;
      await db.transaction(async (tx) => {
        await disable(move.id, tx);
        ticking = tick(hour(1, 40));
        await waitForBlocked();
      });
      await ticking;
      expect(await statusByName(id, 1)).toEqual({ Blend: 'finished', Move: 'skipped_disabled', Clean: 'started' });
      expect(await startCount(id)).toBe(2);
    });

    it('arriving while a chain is starting: it waits, that run stands, and the next chain is skipped', LONG, async () => {
      const s = await scene();
      const id = await endedSlotOne(s);
      const move = await itemNamed(id, 'Move');
      const release = await holdWorkflow(s.workflowIds.Clean!);
      const ticking = tick(hour(1, 40));
      await waitForBlocked();
      const disabling = disable(move.id);
      await waitForBlocked(2);
      await release();
      await Promise.all([disabling, ticking]);
      expect(await statusByName(id, 1)).toEqual({ Blend: 'finished', Move: 'started', Clean: 'started' });

      await tick(hour(2));
      await endStartedRuns(id, hour(2, 10));
      await tick(hour(2, 20));
      expect(await statusByName(id, 2)).toEqual({ Blend: 'finished', Move: 'skipped_disabled', Clean: 'started' });
    });

    it('holding the Runtime while a Resume\'s held chain waits: the tick passes over it, and the next tick records it as skipped', LONG, async () => {
      const s = await scene();
      const id = await s.enable(TREE);
      await tick(hour(1));
      await endStartedRuns(id, hour(1, 10));
      await pause(id);
      await tick(hour(1, 20));
      await resumeRuntimeSchedule(anyDb, id, { heldChains: 'start' }, actor, hour(1, 30));
      const move = await itemNamed(id, 'Move');

      await db.transaction(async (tx) => {
        await disable(move.id, tx);
        // Holding the Runtime makes the tick pass over the Runtime's chains altogether.
        expect((await tick(hour(1, 30))).catchup).toBe(0);
      });
      await tick(hour(1, 30));

      expect(await statusByName(id, 1)).toEqual({ Blend: 'finished', Move: 'skipped_disabled', Clean: 'started' });
    });

    it('arriving while a Resume\'s held chain is starting: it waits, and that run stands', LONG, async () => {
      const s = await scene();
      const id = await s.enable(TREE);
      await tick(hour(1));
      await endStartedRuns(id, hour(1, 10));
      await pause(id);
      await tick(hour(1, 20));
      await resumeRuntimeSchedule(anyDb, id, { heldChains: 'start' }, actor, hour(1, 30));
      const move = await itemNamed(id, 'Move');

      const release = await holdWorkflow(s.workflowIds.Move!);
      const ticking = tick(hour(1, 30));
      await waitForBlocked();
      const disabling = disable(move.id);
      await waitForBlocked(2);
      await release();
      await Promise.all([disabling, ticking]);
      await tick(hour(1, 30));

      expect((await statusByName(id, 1)).Move).toBe('started');
      expect(await startCount(id)).toBe(3);
    });

    it('committed during a catch-up: the following missed slots record the item as skipped', LONG, async () => {
      const s = await scene();
      const items = [
        { workflow: { name: 'Blend' }, params: { BatchId: { value: 'x' } } },
        { workflow: { name: 'Move' }, params: { BatchId: { value: 'x' } } },
      ];
      const id = await s.enable(items);
      await pause(id);
      await resumeRuntimeSchedule(anyDb, id, { missed: 'all' }, actor, hour(3, 30));
      const move = await itemNamed(id, 'Move');

      const release = await holdWorkflow(s.workflowIds.Move!);
      const ticking = tick(hour(3, 30));
      await waitForBlocked();
      const disabling = disable(move.id);
      await waitForBlocked(2);
      await release();
      await Promise.all([disabling, ticking]);
      await tickLoop(hour(3, 30));

      expect(await slotsOf(id)).toEqual([1, 2, 3]);
      expect(await statusByName(id, 1)).toEqual({ Blend: 'started', Move: 'started' });
      expect(await statusByName(id, 2)).toEqual({ Blend: 'started', Move: 'skipped_disabled' });
      expect(await statusByName(id, 3)).toEqual({ Blend: 'started', Move: 'skipped_disabled' });
      await expectExactlyOnce();
    });
  });

  // --------------------------------------------------------------------------------------- deadlocks

  describe('deadlocks', () => {
    it('ticks with Draft reloads and an attempted work center delete: no 40P01, no failed_to_start', LONG, async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const names = ['W1', 'W2', 'W3', 'W4', 'W5'];
      const s = await scene(names, 'Draft');
      // The list runs against the ids: taking workflow locks in list order would then cross a
      // deleteWorkCenter taking them in id order.
      const list = Object.entries(s.workflowIds).sort(([, a], [, b]) => (a < b ? 1 : -1)).map(([name]) => name);
      const leaf = (name: string) => ({ workflow: { name }, params: { BatchId: { value: name } } });
      const items = [
        { ...leaf(list[0]!), chain: list.slice(1).map((name) => ({ ...leaf(name), triggerOn: ['completed'] })) },
        ...list.slice(1).map(leaf),
      ];
      const ids = [await s.enable(items), await s.enable(items), await s.enable(items)];

      const deadlocks = async () => (await pool.query(
        `SELECT deadlocks::int AS n FROM pg_stat_database WHERE datname = current_database()`,
      )).rows[0].n as number;
      const before = await deadlocks();

      // A pool of its own, so that closing it makes its connections report their statistics.
      const engine = createDb(url!);
      const on = engine.db as any;
      const refused = new Set<string>();
      for (let h = 1; h <= 30; h++) {
        const reloads = shuffled(names).map((name) => on.transaction((tx: any) => replaceWorkflowEntry(
          tx, s.workflowIds[name]!, specOf(name, `reload-${name}-${s.wc.id}`, h), { sourceFilename: `${name}.WFmasterX` } as any,
        )));
        const deletes = [
          errorOf(deleteWorkCenter(on, s.wc.id, { confirmed: true })),
          errorOf(deleteWorkCenter(on, s.wc.id, { confirmed: true })),
        ];
        const results = await Promise.allSettled([
          tick(hour(h), on), ...reloads.slice(0, 3), ...deletes, tick(hour(h), on), ...reloads.slice(3),
        ]);
        for (const r of results) {
          if (r.status === 'rejected') throw r.reason;
        }
        for (const err of await Promise.all(deletes)) {
          const refusal = err as { code?: string; cause?: { code?: string } } | null;
          refused.add(String(refusal?.cause?.code ?? refusal?.code)); // drizzle wraps the driver's error
        }
        await tickLoop(hour(h), on);
        for (const id of ids) await endStartedRuns(id, hour(h, 30));
      }
      await engine.pool.end();

      expect(logged.mock.calls.map((c) => String(c[0])).filter((m) => /deadlock/i.test(m))).toEqual([]);
      expect([...refused]).toEqual(['WORK_CENTER_HAS_ACTIVE_RUNTIME']);
      for (const id of ids) {
        const runs = await runsOf(id);
        expect(runs.filter((r) => r.status === 'failed_to_start')).toEqual([]);
        expect(runs.length).toBeGreaterThan(30);
      }
      await expectExactlyOnce();

      await sleep(500); // A closing connection reports its statistics as it exits.
      expect(await deadlocks()).toBe(before);
    });
  });
});
