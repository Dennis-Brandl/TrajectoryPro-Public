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

const BEFORE = 48; // 0048_runtime_schedule_removed
const TAG = '0049_drop_schedule_prototype';
const tables = async (db: Awaited<ReturnType<typeof makeTestDbUpTo>>['db']) =>
  ((await db.execute(sql`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('schedule', 'schedule_run', 'trigger_condition') ORDER BY 1`)).rows)
    .map((r) => (r as { table_name: string }).table_name);
const scheduleIdColumn = async (db: Awaited<ReturnType<typeof makeTestDbUpTo>>['db']) =>
  (await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'workflow_instance' AND column_name = 'schedule_id'`)).rows.length;

test('with the prototype tables empty, 0049 drops them and workflow_instance.schedule_id', async () => {
  const { db, close } = await makeTestDbUpTo(BEFORE);
  try {
    expect(await tables(db)).toEqual(['schedule', 'schedule_run', 'trigger_condition']);
    await applyMigrationFile(db, TAG);
    expect(await tables(db)).toEqual([]);
    expect(await scheduleIdColumn(db)).toBe(0);
  } finally { await close(); }
});

test('with a prototype row present, 0049 refuses and changes nothing', async () => {
  const { db, close } = await makeTestDbUpTo(BEFORE);
  try {
    await db.execute(sql`INSERT INTO work_center (id, name) VALUES ('00000000-0000-4000-8000-000000000001', 'WC')`);
    await db.execute(sql`INSERT INTO workflow (id, oid, name, work_center_id, spec_jsonb)
      VALUES ('00000000-0000-4000-8000-000000000002', 'o', 'WF', '00000000-0000-4000-8000-000000000001', '{}')`);
    await db.execute(sql`INSERT INTO schedule (work_center_id, workflow_id, name, kind)
      VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Nightly', 'recurring')`);
    await expect(applyMigrationFile(db, TAG)).rejects.toThrow(/manual inspection required before 0049/);
    expect(await tables(db)).toEqual(['schedule', 'schedule_run', 'trigger_condition']);
    expect(await scheduleIdColumn(db)).toBe(1);
  } finally { await close(); }
});
