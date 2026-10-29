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

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import {
  initializeDatabase,
  EnvironmentRepository,
  CodeVersionRepository,
  createTransactionHelper,
  runMigrations,
  initialMigration,
  migrations,
  type Migration,
} from '@mission/autopilot-storage'
import { importSqlite, readSqliteSnapshot } from '../../../../scripts/import-sqlite.js'
import { buildFixtureSqlite } from '../../../../scripts/sqlite-fixture.js'
import { assertSmokeDatabaseUrl } from '../testing.js'

const URL_ENV = process.env.PG_SMOKE_DATABASE_URL
// Fail LOUDLY (collection error, not a skip) before any connection if the
// target is not a *_smoke throwaway — this suite DROPs the public schema.
if (URL_ENV) assertSmokeDatabaseUrl(URL_ENV)

describe.skipIf(!URL_ENV)('real-Postgres smoke', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    // DESTRUCTIVE on the target database: full schema reset. Point
    // PG_SMOKE_DATABASE_URL at a throwaway database only.
    const admin = new pg.Client({ connectionString: URL_ENV })
    await admin.connect()
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await admin.end()
    pool = await initializeDatabase(URL_ENV!)
  }, 60000)

  afterAll(async () => {
    if (pool) await pool.end()
  })

  it('migrations applied and schema verified', async () => {
    const res = await pool.query('SELECT COUNT(*)::int AS cnt FROM _migrations')
    expect(res.rows[0].cnt).toBe(migrations.length)
  })

  it('second initializeDatabase run is a no-op (advisory lock + applied-set)', async () => {
    const pool2 = await initializeDatabase(URL_ENV!)
    await pool2.end()
  })

  it('withAtomic-backed activate flips exactly one active version', async () => {
    const envs = new EnvironmentRepository(pool)
    await envs.create({
      oid: 'smoke-env',
      local_id: 'SmokeEnv',
      version: '1',
      last_modified_date: 'd',
      schema_version: '4.0',
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      source_filename: 'f',
    })
    await pool.query(
      `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
       VALUES ('smoke-act','smoke-env','A','1','d','opaque')`
    )
    const cvs = new CodeVersionRepository(pool)
    const v1 = await cvs.save({ action_oid: 'smoke-act', state: 'EXECUTING', source_code: 'a' })
    const v2 = await cvs.save({ action_oid: 'smoke-act', state: 'EXECUTING', source_code: 'b' })
    expect([v1.version_number, v2.version_number]).toEqual([1, 2])
    await cvs.activate(v1.id)
    await cvs.activate(v2.id)
    const active = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM code_versions WHERE action_oid = 'smoke-act' AND is_active`
    )
    expect(active.rows[0].cnt).toBe(1)
  })

  it('transaction helper rolls back on throw', async () => {
    const tx = createTransactionHelper(pool)
    await expect(
      tx.inTransaction(async ({ repos }) => {
        await repos.environments.create({
          oid: 'rollback-env',
          local_id: 'x',
          version: '1',
          last_modified_date: 'd',
          schema_version: '4.0',
          action_property_specifications: [],
          value_property_specifications: [],
          resource_property_specifications: [],
          source_filename: 'f',
        })
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    const gone = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM environments WHERE oid = 'rollback-env'`
    )
    expect(gone.rows[0].cnt).toBe(0)
  })

  it('import CLI end-to-end against real PG', async () => {
    const admin = new pg.Client({ connectionString: URL_ENV })
    await admin.connect()
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await admin.end()
    const fresh = await initializeDatabase(URL_ENV!)
    const sqlite = buildFixtureSqlite()
    const counts = await importSqlite(readSqliteSnapshot(sqlite), fresh)
    expect(counts.environments).toBe(1)
    await fresh.end()
    pool = await initializeDatabase(URL_ENV!) // restore for afterAll symmetry
  }, 60000)

  // Deferred item from an earlier review: prove runMigrations' per-migration
  // transaction semantics against REAL Postgres (PGlite's txn behavior is not
  // guaranteed identical). A synthetic two-migration list where the SECOND
  // migration throws mid-way — after it has already issued DDL — must leave
  // the first migration applied and the second migration's DDL rolled back
  // in full, not just its `_migrations` bookkeeping row. Runs last and owns
  // a full schema reset so it cannot pollute (or be polluted by) the shared
  // `pool` state the tests above depend on.
  it('runMigrations rolls back a failing migration in full, leaving prior migrations applied', async () => {
    const admin = new pg.Client({ connectionString: URL_ENV })
    await admin.connect()
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await admin.end()

    const syntheticProbe: Migration = {
      name: '002-smoke-probe',
      async up(q) {
        await q.query('CREATE TABLE smoke_probe (id integer PRIMARY KEY)')
        // Deliberately invalid SQL, thrown AFTER the DDL above, to prove the
        // whole migration (DDL included) rolls back as one unit.
        await q.query('SELECT * FROM does_not_exist_at_all')
      },
    }

    const client = await pool.connect()
    try {
      await expect(runMigrations(client, [initialMigration, syntheticProbe])).rejects.toThrow()

      const applied = await client.query('SELECT name FROM _migrations')
      expect(applied.rows.map((r) => r.name)).toEqual(['001-initial-schema'])

      const probeTable = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'smoke_probe'`
      )
      expect(probeTable.rows[0].cnt).toBe(0)
    } finally {
      client.release()
    }
  }, 60000)
})

if (!URL_ENV) {
  console.warn('[real-pg smoke] PG_SMOKE_DATABASE_URL not set — suite skipped.')
}
