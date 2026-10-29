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

import { describe, it, expect, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '../database.js'
import { databaseSchemaStatus, EXPECTED_TABLES } from '../database.js'
import { createTestDb, type TestDb } from '../testing.js'

// Verifies the permanent rule: a distributed app must guarantee its database has
// every required table on startup. databaseSchemaStatus() backs both the
// initializeDatabase() fail-fast check and the server's /health endpoint.

/**
 * A bare PGlite instance wrapped as a Queryable, with NO migrations run — used
 * only for the "empty database" case below. `createTestDb()` always runs the
 * initial migration, so it can't exercise the missing-tables path; this mirrors
 * the tiny adapter in testing.ts but deliberately skips `runMigrations`.
 */
function rawUnmigratedDb(): { q: Queryable; pglite: PGlite } {
  const pglite = new PGlite()
  const q: Queryable = {
    async query(text: string, params?: unknown[]) {
      const res = await pglite.query(text, params as unknown[] | undefined)
      const rows = (res.rows as Record<string, unknown>[]).map((row) => {
        for (const k of Object.keys(row)) {
          if (typeof row[k] === 'bigint') row[k] = Number(row[k])
        }
        return row
      })
      return { rows, rowCount: (res as { affectedRows?: number }).affectedRows ?? rows.length }
    },
  }
  return { q, pglite }
}

describe('databaseSchemaStatus', () => {
  let db: TestDb | null = null
  let pglite: PGlite | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
    if (pglite) {
      await pglite.close()
      pglite = null
    }
  })

  it('reports ok with no missing tables after migrations', async () => {
    db = await createTestDb()
    const status = await databaseSchemaStatus(db)
    expect(status.ok).toBe(true)
    expect(status.missingTables).toEqual([])
  })

  it('lists every expected table when the database is empty', async () => {
    const raw = rawUnmigratedDb()
    pglite = raw.pglite
    const status = await databaseSchemaStatus(raw.q)
    expect(status.ok).toBe(false)
    expect(status.missingTables.sort()).toEqual([...EXPECTED_TABLES].sort())
  })

  it('detects a single dropped table', async () => {
    db = await createTestDb()
    await db.query('DROP TABLE settings')
    const status = await databaseSchemaStatus(db)
    expect(status.ok).toBe(false)
    expect(status.missingTables).toContain('settings')
  })
})

// NOTE — deliberately NOT ported: the old suite also had a
// `describe('initializeDatabase', ...)` block testing
// `initializeDatabase(':memory:')`, a synchronous, file-path-based API that no
// longer exists. The Postgres `initializeDatabase(databaseUrl)` (index.ts)
// requires a real network Postgres connection and takes a session advisory
// lock (`pg_advisory_lock`) via `pg.Pool` — neither is satisfiable by PGlite,
// which is a single in-process connection, not a `pg.Pool`. This is consistent
// with Task 3's own report, which explicitly defers "pool-only paths (23505
// retry, instanceof branch, advisory lock, int8 parser)" to Task 8's
// real-Postgres smoke suite. Task 8 owns proving `initializeDatabase` end to
// end against a real Postgres server.
