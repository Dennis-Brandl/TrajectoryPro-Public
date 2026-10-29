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

import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from 'mission-control-db/src/db/schema/index';

export async function makeTestDb(): Promise<{
  db: PgliteDatabase<typeof schema>;
  // Additive (Task 11's NOTIFY-payload pin): the raw PGlite instance, exposed so a test can
  // call its own `.listen(channel, cb)` — PGlite DOES support LISTEN/NOTIFY at this JS-API
  // level (unlike a raw `LISTEN` SQL statement over a pooled connection, which is what
  // wake.ts's production dedicated pg.Client needs real Postgres for).
  client: PGlite;
  close: () => Promise<void>;
}> {
  const client = new PGlite(); // in-memory
  const db = drizzle(client, { schema });
  // Applies every generated migration in mission-control-db's ./drizzle folder — this
  // package has no migrations of its own; it shares mission-control-db's schema.
  await migrate(db, { migrationsFolder: '../mission-control-db/drizzle' });
  return { db, client, close: () => client.close() };
}
