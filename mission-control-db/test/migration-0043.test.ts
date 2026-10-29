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

const STEP = '22222222-2222-2222-2222-222222222222';
const CALLER = '11111111-1111-1111-1111-111111111111';

test('migration 0043: old rows keep a null step_started_at; a duplicate activation is rejected', async () => {
  const { db, close } = await makeTestDbUpTo(42);
  try {
    // Two pre-0043 rows for the same step (an old duplicate invoke) must both survive.
    for (let i = 0; i < 2; i++) {
      await db.execute(sql`INSERT INTO broker_action_instance (action_key, workflow_instance_id, step_instance_id, state)
        VALUES ('wait', ${CALLER}, ${STEP}, 'COMPLETED')`);
    }
    await applyMigrationFile(db, '0043_broker_activation_key');
    const old = await db.execute(sql`SELECT step_started_at FROM broker_action_instance`);
    expect(old.rows).toEqual([{ step_started_at: null }, { step_started_at: null }]);
    const insert = () => db.execute(sql`INSERT INTO broker_action_instance (action_key, workflow_instance_id, step_instance_id, step_started_at)
      VALUES ('create', ${CALLER}, ${STEP}, '2026-10-23T10:00:00.123Z')`);
    await insert();
    await expect(insert()).rejects.toThrow();
    const idx = await db.execute(sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'broker_action_instance_activation_uq'`);
    const def = (idx.rows[0] as { indexdef: string }).indexdef;
    expect(def).toContain('UNIQUE');
    expect(def).toContain('(step_instance_id, step_started_at)');
    expect(def).toContain('step_started_at IS NOT NULL');
  } finally { await close(); }
});
