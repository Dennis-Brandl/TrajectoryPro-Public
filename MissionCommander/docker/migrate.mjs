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
// Applies mission-control-db's generated migrations to the configured Postgres, then
// exits. Run by docker-entrypoint.sh before the server starts, so the schema is current
// on every container boot (including the first, against an empty database).
//
// Uses drizzle-orm's PROGRAMMATIC migrator rather than `drizzle-kit migrate`: drizzle-kit
// is a build-time devDependency and pulling it into the runtime image just to replay SQL
// would drag its whole toolchain along. The migrator only needs the drizzle/ folder,
// which the image copies to ./drizzle.
//
// Safe to re-run: drizzle records applied migrations in its own journal table and skips
// them, so a restart against an already-migrated database is a no-op.
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('FATAL: DATABASE_URL is not set — cannot migrate.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

try {
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  console.log('Migrations applied.');
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
} finally {
  await pool.end();
}
