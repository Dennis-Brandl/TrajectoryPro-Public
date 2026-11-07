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
import { sql } from 'drizzle-orm';
import { applyMigrationFile, makeTestDbUpTo } from './helpers/partial-migrate.js';
import { runtimeCols } from './helpers/instances.js';

const UNKNOWN = '22222222-2222-4222-8222-222222222222';

test('migration 0045: stopping rows survive; cleanup statuses and cleanup_skip CHECKs; event table has no instance FK', async () => {
  const { db, close } = await makeTestDbUpTo(44);
  try {
    const wc = (await db.execute(sql`INSERT INTO work_center (name) VALUES ('WC') RETURNING id`)).rows[0]!.id as string;
    const wf = (await db.execute(sql`INSERT INTO workflow (oid, name, work_center_id, version, state, spec_jsonb)
      VALUES ('wf-1', 'WF', ${wc}, '1.0.0', 'Effective', '{}'::jsonb) RETURNING id`)).rows[0]!.id as string;

    const ins = (status: string, skip: string | null = null) => { const c = runtimeCols(); return db.execute(sql`INSERT INTO workflow_instance
      (workflow_id, work_center_id, triggered_by, status, cleanup_skip, runtime_number, runtime_label, master_name, master_oid, master_version, master_state, spec_jsonb)
      VALUES (${wf}, ${wc}, 'manual', ${status}, ${skip}, ${c.runtimeNumber}, ${c.runtimeLabel}, ${c.masterName}, ${c.masterOid}, ${c.masterVersion}, ${c.masterState}, '{}'::jsonb)`); };
    // Pre-migration the column does not exist, so seed without it.
    const c = runtimeCols();
    await db.execute(sql`INSERT INTO workflow_instance
      (workflow_id, work_center_id, triggered_by, status, runtime_number, runtime_label, master_name, master_oid, master_version, master_state, spec_jsonb)
      VALUES (${wf}, ${wc}, 'manual', 'stopping', ${c.runtimeNumber}, ${c.runtimeLabel}, ${c.masterName}, ${c.masterOid}, ${c.masterVersion}, ${c.masterState}, '{}'::jsonb)`);
    await applyMigrationFile(db, '0045_runtime_control_event');
    expect((await db.execute(sql`SELECT status FROM workflow_instance`)).rows).toEqual([{ status: 'stopping' }]);

    await ins('stopping_cleanup');
    await ins('aborting_cleanup', 'abort');
    await expect(ins('running', 'x')).rejects.toThrow();

    await db.execute(sql`INSERT INTO runtime_control_event (workflow_instance_id, verb, effect, from_status, to_status, actor_kind, actor_label)
      VALUES (${UNKNOWN}, 'stop', 'request', 'running', 'stopping', 'system', 'test')`);
    expect((await db.execute(sql`SELECT workflow_instance_id FROM runtime_control_event`)).rows).toEqual([{ workflow_instance_id: UNKNOWN }]);
    // The remote source runtime is a soft link too (no FK).
    await db.execute(sql`INSERT INTO runtime_control_event (workflow_instance_id, verb, effect, from_status, to_status, actor_kind, actor_label, actor_instance_id)
      VALUES (${UNKNOWN}, 'abort', 'request', 'running', 'aborting', 'remote', 'WC/RW-1', ${UNKNOWN})`);
    expect((await db.execute(sql`SELECT actor_instance_id FROM runtime_control_event WHERE verb = 'abort'`)).rows).toEqual([{ actor_instance_id: UNKNOWN }]);
  } finally { await close(); }
});
