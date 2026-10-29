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

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from 'mission-control-db/src/db/schema/index';
export type EngineDb = ReturnType<typeof createDb>['db'];
/** Generic driver-agnostic handle (node-postgres in production, PGlite in tests) — the same
 *  `PgDatabase<any, Schema>` pattern mission-control-db's own DAOs use, so engine functions
 *  can accept either a top-level `db` or a `tx` from `db.transaction(...)` (PgTransaction
 *  extends PgDatabase) with one type. */
export type Db = PgDatabase<any, typeof schema>;
export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000 });
  // An idle client can error (database restart); without a listener that is an uncaught exception.
  pool.on('error', (err) => { console.error(`[mission-engine] idle database client error: ${err.message}`); });
  return { pool, db: drizzle(pool, { schema }) };
}
