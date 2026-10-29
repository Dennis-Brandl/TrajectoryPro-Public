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
import Database from 'better-sqlite3'
import { createTestDb, type TestDb } from '@mission/autopilot-storage/testing'
import { importSqlite, readSqliteSnapshot } from '../import-sqlite.js'
import { buildFixtureSqlite } from '../sqlite-fixture.js'

let db: TestDb | undefined
afterEach(async () => {
  if (db) {
    await db.close()
    db = undefined
  }
})

describe('import-sqlite', () => {
  it('imports specs, code versions, and known settings values', async () => {
    db = await createTestDb()
    const snapshot = readSqliteSnapshot(buildFixtureSqlite())
    const counts = await importSqlite(snapshot, db)
    expect(counts).toEqual({ environments: 1, actions: 1, code_versions: 1, settings: 1 })
    const env = await db.query(`SELECT state FROM environments WHERE oid = 'e1'`)
    expect(env.rows[0].state).toBe('Effective')
    const cv = await db.query(`SELECT is_active, version_number FROM code_versions WHERE id = 'c1'`)
    expect(cv.rows[0].is_active).toBe(true)
    expect(cv.rows[0].version_number).toBe(1)
    const pool = await db.query(`SELECT value FROM settings WHERE key = 'python_pool_size'`)
    expect(pool.rows[0].value).toBe('8')
    const obsolete = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM settings WHERE key = 'obsolete_key'`
    )
    expect(obsolete.rows[0].cnt).toBe(0)
  })

  it('refuses a non-empty target', async () => {
    db = await createTestDb()
    await db.query(`INSERT INTO environments (oid, local_id, version, last_modified_date, schema_version, imported_at, source_filename)
                    VALUES ('pre','x','1','d','4.0','d','f')`)
    const snapshot = readSqliteSnapshot(buildFixtureSqlite())
    await expect(importSqlite(snapshot, db)).rejects.toThrow(/not empty/i)
  })

  it('refuses an unmigrated source', () => {
    const s = new Database(':memory:')
    s.exec(
      `CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)`
    )
    expect(() => readSqliteSnapshot(s)).toThrow(/migrat/i)
  })
})
