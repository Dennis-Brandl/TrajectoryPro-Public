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
import { createTestDb, type TestDb } from '../testing.js'
import { databaseSchemaStatus } from '../database.js'
import { EnvironmentRepository } from '../repositories/environment.repository.js'

// The old suite tested `openDatabase(':memory:')` — a synchronous better-sqlite3
// API configuring WAL journal mode / foreign_keys / synchronous pragmas. None of
// that has a Postgres equivalent (Postgres always enforces FK integrity, has no
// per-connection journal-mode pragma, and PGlite's `createTestDb()` takes no
// path argument at all). Per the port brief, this file now tests `createTestDb`
// + `databaseSchemaStatus` instead, with a plain "query works" connectivity
// assertion standing in for the dropped WAL/pragma checks.

describe('createTestDb', () => {
  let db: TestDb | null = null

  afterEach(async () => {
    if (db) await db.close()
    db = null
  })

  it('returns a working TestDb instance', async () => {
    db = await createTestDb()
    expect(db).toBeDefined()
    expect(typeof db.query).toBe('function')
    expect(typeof db.close).toBe('function')
    expect(db.raw).toBeDefined()
  })

  it('a basic query works (connectivity check)', async () => {
    db = await createTestDb()
    const res = await db.query('SELECT 1::int AS one')
    expect(res.rows).toEqual([{ one: 1 }])
  })

  it('schema is fully created after createTestDb (databaseSchemaStatus reports ok)', async () => {
    db = await createTestDb()
    const status = await databaseSchemaStatus(db)
    expect(status.ok).toBe(true)
    expect(status.missingTables).toEqual([])
  })

  it('each createTestDb() call is an independent, isolated in-memory instance', async () => {
    db = await createTestDb()
    const repo = new EnvironmentRepository(db)
    await repo.create({
      oid: 'isolated-env',
      local_id: 'IsolatedEnv',
      version: '1.0.0',
      last_modified_date: '2026-01-01T00:00:00Z',
      schema_version: '4.0',
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      source_filename: 'isolated.WFenvir',
    })

    const otherDb = await createTestDb()
    try {
      const otherRepo = new EnvironmentRepository(otherDb)
      expect(await otherRepo.findByOid('isolated-env')).toBeNull()
    } finally {
      await otherDb.close()
    }
  })
})
