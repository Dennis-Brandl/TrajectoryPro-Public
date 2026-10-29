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

const INSTANCE = '11111111-1111-4111-8111-111111111111';

test('migration 0044: old history rows keep null starter columns; step_run exists with node_path defaulting to []', async () => {
  const { db, close } = await makeTestDbUpTo(43);
  try {
    await db.execute(sql`INSERT INTO runtime_history (workflow_instance_id, runtime_number, runtime_label, work_center_name, master_name, master_oid, master_version, master_state, final_state, finished_at, trace)
      VALUES (${INSTANCE}, 1, 'RW-1', 'Line 1', 'M', 'oid', '1', 'Released', 'completed', now(), '[]'::jsonb)`);
    await applyMigrationFile(db, '0044_step_run');
    const old = await db.execute(sql`SELECT started_by_user_id, started_by_login_name FROM runtime_history`);
    expect(old.rows).toEqual([{ started_by_user_id: null, started_by_login_name: null }]);
    await db.execute(sql`INSERT INTO step_run (workflow_instance_id, runtime_label, step_oid, step_name, step_type, run_number, finished_at, result, performed_by_kind)
      VALUES (${INSTANCE}, 'RW-1', 's', 'S', 'USER', 1, now(), 'completed', 'user')`);
    const r = await db.execute(sql`SELECT node_path FROM step_run`);
    expect(r.rows).toEqual([{ node_path: [] }]);
    // One index serves the per-instance reads and the per-step run counts.
    const idx = await db.execute(sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'step_run_instance_idx'`);
    expect(String(idx.rows[0]?.indexdef)).toContain('(workflow_instance_id, step_oid, started_at)');
  } finally { await close(); }
});
