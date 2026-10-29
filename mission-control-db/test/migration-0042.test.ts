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
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

test('migration 0042 creates the three delete-path indexes', async () => {
  const client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  const res = await client.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE indexname IN
       ('workflow_instance_finished_idx', 'schedule_run_instance_idx', 'wc_resource_waiter_instance_idx')
     ORDER BY indexname`,
  );
  expect(res.rows.map((r) => r.indexname)).toEqual([
    'schedule_run_instance_idx', 'wc_resource_waiter_instance_idx', 'workflow_instance_finished_idx',
  ]);
  const finished = res.rows.find((r) => r.indexname === 'workflow_instance_finished_idx')!;
  expect(finished.indexdef).toContain('(work_center_id, completed_at)');
  expect(finished.indexdef).toContain("'completed'");
  await client.close();
});
