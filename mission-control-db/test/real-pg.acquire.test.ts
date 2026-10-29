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
import { eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../src/db/schema/index.js';
import { workCenter, workflow, workflowInstance } from '../src/db/schema/index.js';
import { createRuntimeWorkflow, requestStart } from '../src/dao/runtime-workflows.js';
import { acquireQueuedRuntimeWorkflows } from '../src/runtime/engine-access.js';

// Runs ONLY when REAL_PG_TEST_URL points at a disposable Postgres, e.g. the e2e container:
//   REAL_PG_TEST_URL=postgres://postgres:postgres@127.0.0.1:5432/mission_commander_e2e npm test -- test/real-pg.acquire.test.ts
// PGlite is single-connection, so the FOR UPDATE SKIP LOCKED race in acquireQueuedRuntimeWorkflows
// is provable only here: two concurrent claimers (limits 2 and 1) over the same 3 queued rows must never
// double-claim — their claim sets must be disjoint and union to exactly the 3 seeded ids.
const url = process.env.REAL_PG_TEST_URL;
const SPEC = {
  local_id: 'WF', oid: 'wf-1', version: '1.2.0', state: 'Effective',
  starting_parameter_specifications: [],
  steps: [{ local_id: 'Start', oid: 's-1', step_type: 'START' }],
  connections: [],
};

describe.skipIf(!url)('acquireQueuedRuntimeWorkflows under real concurrency', () => {
  const pool = url ? new Pool({ connectionString: url, max: 4 }) : null;
  const db = pool ? drizzle(pool, { schema }) : null;
  const rand = Math.random().toString(36).slice(2, 8);
  const wcName = `Acquire-Race-WC-${Date.now()}-${rand}`;
  let wcId: string | undefined;
  let instanceIds: string[] = [];

  afterAll(async () => {
    try {
      if (db) {
        if (instanceIds.length) {
          await db.delete(workflowInstance).where(inArray(workflowInstance.id, instanceIds));
        }
        if (wcId) {
          await db.delete(workflow).where(eq(workflow.workCenterId, wcId));
          await db.delete(workCenter).where(eq(workCenter.id, wcId));
        }
      }
    } finally {
      await pool?.end();
    }
  });

  it('concurrent acquire(2) and acquire(1) over 3 queued rows never double-claim: disjoint sets, union = all 3, all running', async () => {
    await migrate(db!, { migrationsFolder: './drizzle' }); // idempotent

    const [wc] = await db!.insert(workCenter).values({ name: wcName }).returning();
    wcId = wc.id;
    const [wf] = await db!.insert(workflow).values({
      oid: 'wf-race-1', name: 'WF Race', workCenterId: wc.id, version: '1.2.0', state: 'Effective', specJsonb: SPEC,
    }).returning();

    const created = await Promise.all([
      createRuntimeWorkflow(db!, { workflowId: wf.id, params: {}, userId: null }),
      createRuntimeWorkflow(db!, { workflowId: wf.id, params: {}, userId: null }),
      createRuntimeWorkflow(db!, { workflowId: wf.id, params: {}, userId: null }),
    ]);
    instanceIds = created.map((c) => c.id);
    for (const c of created) {
      await requestStart(db!, c.id, null);
    }

    // acquireQueuedRuntimeWorkflows claims ANY 'queued' row db-wide, oldest queued_at first, and
    // this test runs against the shared e2e Postgres, where the Playwright suite deliberately
    // leaves RW-1 'queued'. Rather than touching rows this test did not create, give the 3 rows
    // seeded here queued_at values far older than any real row so they are always the 3 oldest.
    for (let i = 0; i < created.length; i++) {
      await db!.execute(sql`
        update workflow_instance set queued_at = timestamptz '2000-01-01 00:00:00+00' + make_interval(secs => ${i})
        where id = ${created[i].id}
      `);
    }

    const [claimA, claimB] = await Promise.all([
      acquireQueuedRuntimeWorkflows(db!, 2),
      acquireQueuedRuntimeWorkflows(db!, 1),
    ]);

    const idsA = claimA.map((r) => r.id);
    const idsB = claimB.map((r) => r.id);

    // Disjoint claim sets — no instance appears in both.
    const overlap = idsA.filter((id) => idsB.includes(id));
    expect(overlap).toEqual([]);

    // Union is exactly the 3 seeded instances, compared by their runtime_number (an int) —
    // NOT the default Array.sort(), which stringifies before comparing and would silently
    // mis-order double-digit values (e.g. [1, 10, 2]).
    const byNumber = (a: number, b: number) => a - b;
    const claimedNumbers = [...claimA, ...claimB].map((r) => r.runtimeNumber).sort(byNumber);
    const seededNumbers = created.map((c) => c.runtimeNumber).sort(byNumber);
    expect(claimedNumbers).toEqual(seededNumbers);

    // Every claimed row is now running.
    const rows = await db!.select({ id: workflowInstance.id, status: workflowInstance.status })
      .from(workflowInstance).where(inArray(workflowInstance.id, instanceIds));
    expect(rows.every((r) => r.status === 'running')).toBe(true);
  });
});
