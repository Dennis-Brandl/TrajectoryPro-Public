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

import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../src/db/schema/index.js';
import { workCenter, workflow, workflowInstance } from '../src/db/schema/index.js';
import { createRuntimeWorkflow } from '../src/dao/runtime-workflows.js';
import { deleteWorkCenter } from '../src/dao/work-centers.js';

// Runs ONLY when REAL_PG_TEST_URL points at a disposable Postgres, e.g. the e2e container:
//   REAL_PG_TEST_URL=postgres://postgres:postgres@127.0.0.1:5432/mission_commander_e2e npx vitest run test/real-pg.delete-work-center.test.ts
// PGlite is single-connection, so the race between deleteWorkCenter and a runtime that is created
// or started at the same moment is provable only here. Connection 1 holds its transaction open
// (uncommitted); connection 2 deletes; connection 1 then commits. The delete must wait for the
// locks and then see the committed, active runtime.
const url = process.env.REAL_PG_TEST_URL;
const SPEC = {
  local_id: 'WF', oid: 'wf-1', version: '1.2.0', state: 'Effective',
  starting_parameter_specifications: [],
  steps: [{ local_id: 'Start', oid: 's-1', step_type: 'START' }],
  connections: [],
};

describe.skipIf(!url)('deleteWorkCenter under real concurrency', () => {
  const pool = url ? new Pool({ connectionString: url, max: 4 }) : null;
  const db = pool ? drizzle(pool, { schema }) : null;
  const rand = Math.random().toString(36).slice(2, 8);
  const wcIds: string[] = [];

  afterAll(async () => {
    try {
      if (db) {
        for (const id of wcIds) {
          await db.delete(workflowInstance).where(eq(workflowInstance.workCenterId, id));
          await db.delete(workflow).where(eq(workflow.workCenterId, id));
          await db.delete(workCenter).where(eq(workCenter.id, id));
        }
      }
    } finally {
      await pool?.end();
    }
  });

  async function seed(tag: string) {
    await migrate(db!, { migrationsFolder: './drizzle' }); // idempotent
    const [wc] = await db!.insert(workCenter).values({ name: `Delete-Race-${tag}-${Date.now()}-${rand}` }).returning();
    wcIds.push(wc.id);
    const [wf] = await db!.insert(workflow).values({
      oid: `wf-del-${tag}-${rand}`, name: 'WF Del', workCenterId: wc.id, version: '1.2.0', state: 'Effective', specJsonb: SPEC,
    }).returning();
    return { wc, wf };
  }

  // Run `hold` inside an open transaction on one connection, start the delete on another WITHOUT
  // awaiting it, give it time to reach (and wait on) its locks, then let the holder commit.
  async function raceDelete(wcId: string, hold: (tx: any) => Promise<void>) {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let held!: () => void;
    const holding = new Promise<void>((r) => { held = r; });
    const holder = db!.transaction(async (tx) => {
      await hold(tx);
      held();
      await gate;
    });
    await holding;
    const outcome = deleteWorkCenter(db!, wcId, { confirmed: true }).then(
      () => ({ ok: true as const }), (err: any) => ({ ok: false as const, err }),
    );
    // Wait for the delete's backend to be blocked on a lock (bounded: today's code may not block).
    for (let i = 0; i < 30; i++) {
      const r = await db!.execute(sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query ilike '%for update%'`);
      if ((r.rows[0] as any).n > 0) break;
      await new Promise((res) => setTimeout(res, 50));
    }
    await new Promise((res) => setTimeout(res, 100));
    release();
    await holder;
    return await outcome;
  }

  it('a runtime created concurrently survives the delete', async () => {
    const { wc, wf } = await seed('create');
    let createdId = '';
    const outcome = await raceDelete(wc.id, async (tx) => {
      const c = await createRuntimeWorkflow(tx as any, { workflowId: wf.id, params: {}, userId: null, start: true });
      createdId = c.id;
    });
    expect(outcome.ok).toBe(false);
    expect((outcome as any).err?.code).toBe('WORK_CENTER_HAS_ACTIVE_RUNTIME');
    const rows = await db!.select().from(workflowInstance).where(eq(workflowInstance.id, createdId));
    expect(rows).toHaveLength(1);
  });

  it('a pending runtime started concurrently survives the delete', async () => {
    const { wc, wf } = await seed('start');
    const c = await createRuntimeWorkflow(db!, { workflowId: wf.id, params: {}, userId: null });
    const outcome = await raceDelete(wc.id, async (tx) => {
      await tx.select({ id: workflowInstance.id }).from(workflowInstance).where(eq(workflowInstance.id, c.id)).for('update');
      await tx.update(workflowInstance)
        .set({ status: 'queued', queuedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(workflowInstance.id, c.id));
    });
    expect(outcome.ok).toBe(false);
    expect((outcome as any).err?.code).toBe('WORK_CENTER_HAS_ACTIVE_RUNTIME');
    const rows = await db!.select().from(workflowInstance).where(eq(workflowInstance.id, c.id));
    expect(rows).toHaveLength(1);
  });

  it('a creator that holds the workflow lock before the work center lock never deadlocks with the delete', async () => {
    const { wc, wf } = await seed('order');
    let createdId = '';
    let proceed!: () => void;
    const go = new Promise<void>((r) => { proceed = r; });
    let locked!: () => void;
    const hasShare = new Promise<void>((r) => { locked = r; });
    // Connection 1: createRuntimeWorkflow's first lock (workflow FOR SHARE), then pause before
    // the work_center lock (raw SQL reproduces that sequence), then the real create.
    const creator = db!.transaction(async (tx) => {
      await tx.select().from(workflow).where(eq(workflow.id, wf.id)).for('share');
      locked();
      await go;
      const c = await createRuntimeWorkflow(tx as any, { workflowId: wf.id, params: {}, userId: null, start: true });
      createdId = c.id;
    }).then(() => ({ ok: true as const }), (err: any) => ({ ok: false as const, err }));
    await hasShare;
    const del = deleteWorkCenter(db!, wc.id, { confirmed: true }).then(
      () => ({ ok: true as const }), (err: any) => ({ ok: false as const, err }),
    );
    await new Promise((res) => setTimeout(res, 500));
    proceed();
    const [c, d] = await Promise.all([creator, del]);
    for (const o of [c, d]) {
      if (!o.ok) expect((o as any).err?.code ?? (o as any).err?.cause?.code).not.toBe('40P01');
    }
    if (c.ok) {
      expect(d.ok).toBe(false);
      expect((d as any).err?.code).toBe('WORK_CENTER_HAS_ACTIVE_RUNTIME');
      expect(await db!.select().from(workflowInstance).where(eq(workflowInstance.id, createdId))).toHaveLength(1);
    } else {
      expect(d.ok).toBe(true);
      expect((c as any).err?.code).toBe('WORK_CENTER_NOT_FOUND');
    }
  });
});
