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
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { db, pglite } from '../lib/db';

// mission-control-db is a sibling package at the repo root.
const MIGRATIONS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../mission-control-db/drizzle',
);

/** Apply all mission-control-db migrations to the shared PGlite. Call once in beforeAll. */
export async function migrateTestDb(): Promise<void> {
  if (!pglite) throw new Error('migrateTestDb requires the PGlite (test) db');
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
}

// One TRUNCATE … CASCADE clears these base tables and everything that references
// them (session/account, workflow_* children, work_center_user_role, and the
// execution/scheduling tables). CASCADE is required: work_center has a self-referential onDelete:'restrict' FK
// that an ordered DELETE cannot satisfy. `verification` and `system_settings` have no FK to
// app_user, so they are listed explicitly.
//
// M6 dropped `library`, which used to be listed here as a parent of
// workflow/environment_spec. Naming a table that no longer exists makes TRUNCATE fail
// wholesale with 42P01, so every suite errors in beforeEach — it is not a silent no-op.
// work_center now reaches both artifact tables via their NOT NULL work_center_id.
export async function resetDb(): Promise<void> {
  await db.execute(
    sql.raw('TRUNCATE app_user, role, work_center, workflow, environment_spec, verification, system_settings, brand_asset CASCADE'),
  );
}
