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

import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from './database.js'
import { runMigrations } from './migrations/runner.js'
import { migrations } from './migrations/index.js'

export interface TestDb extends Queryable {
  close(): Promise<void>
  raw: PGlite
}

/** In-memory Postgres (PGlite) with every real migration applied. */
export async function createTestDb(): Promise<TestDb> {
  const pglite = new PGlite()
  const db: TestDb = {
    async query(text: string, params?: unknown[]) {
      const res = await pglite.query(text, params as unknown[] | undefined)
      const rows = (res.rows as Record<string, unknown>[]).map((row) => {
        for (const k of Object.keys(row)) {
          if (typeof row[k] === 'bigint') row[k] = Number(row[k]) // int64 rule
        }
        return row
      })
      return { rows, rowCount: (res as { affectedRows?: number }).affectedRows ?? rows.length }
    },
    close: () => pglite.close(),
    raw: pglite,
  }
  await runMigrations(db, migrations)
  return db
}

export { createTestTransactionHelper } from './transaction.js'

/**
 * Safety gate for the real-Postgres smoke suite: its beforeAll runs
 * `DROP SCHEMA public CASCADE` against whatever PG_SMOKE_DATABASE_URL points
 * at, and this Postgres may hold the only copy of the user's handlers. The
 * target database NAME must therefore be suffixed `_smoke` — anything else
 * (including an unparseable URL or a URL with no database path) throws before
 * a single connection is made.
 */
export function assertSmokeDatabaseUrl(url: string): void {
  let dbName: string
  try {
    dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
  } catch {
    throw new Error(`PG_SMOKE_DATABASE_URL is not a parseable URL: ${url}`)
  }
  if (!dbName.endsWith('_smoke') || dbName === '_smoke') {
    throw new Error(
      `Refusing to run the destructive real-PG smoke suite against database "${dbName}" — ` +
        'the smoke suite DROPs the public schema, so PG_SMOKE_DATABASE_URL must point at a ' +
        'throwaway database whose name ends in "_smoke" (e.g. trajectory_smoke).'
    )
  }
}
