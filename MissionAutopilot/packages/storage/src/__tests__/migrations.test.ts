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
import { runMigrations } from '../migrations/runner.js'
import { migration as initialMigration } from '../migrations/001-initial-schema.js'
import { migrations } from '../migrations/index.js'
import { createTestDb, type TestDb } from '../testing.js'

const EXPECTED_TABLES = [
  'environments',
  'actions',
  'code_versions',
  'instances',
  'execution_log',
  'settings',
  '_migrations',
]

const EXPECTED_INDEXES = [
  'idx_actions_environment',
  'idx_code_versions_action_state',
  'idx_code_versions_active',
  'idx_instances_state',
  'idx_instances_action',
  'idx_instances_workflow',
  'idx_instances_cleanup',
  'idx_log_action',
  'idx_log_environment',
  'idx_log_status',
  'idx_log_completed',
  // idx_log_oldest is intentionally NOT expected here: 001-initial-schema.ts
  // deliberately drops it (see the comment there) because the execution_log
  // primary-key btree on `id` already serves oldest-first scans, making the
  // sqlite-era standalone index redundant on Postgres.
]

// api_key is included here (the old sqlite-era migrations.test.ts expected
// only 4 keys because api_key was seeded by a separate 004-api-key-setting
// migration this test file never imported). Task 3 folded the old 001-004
// sqlite migrations into one net 001-initial-schema.ts, so the single
// initialMigration used below now seeds all 5 settings including api_key —
// matching core-pg.test.ts's own oracle for the same migration.
const DEFAULT_SETTING_KEYS = [
  'log_max_size',
  'python_pool_size',
  'execution_timeout_ms',
  'instance_retention_hours',
  'api_key',
]

/** A bare PGlite instance wrapped as a Queryable, with no migrations run yet. */
function rawPGliteDb(): { q: Queryable; pglite: PGlite } {
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

async function getTableNames(q: Queryable): Promise<string[]> {
  const res = await q.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
  )
  return (res.rows as { table_name: string }[]).map((r) => r.table_name)
}

async function getIndexNames(q: Queryable): Promise<string[]> {
  const res = await q.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`
  )
  return (res.rows as { indexname: string }[]).map((r) => r.indexname)
}

describe('runMigrations', () => {
  let pglite: PGlite | null = null
  let testDb: TestDb | null = null

  afterEach(async () => {
    if (pglite) {
      await pglite.close()
      pglite = null
    }
    if (testDb) {
      await testDb.close()
      testDb = null
    }
  })

  it('creates the _migrations meta-table', async () => {
    const raw = rawPGliteDb()
    pglite = raw.pglite
    await runMigrations(raw.q, [])
    const tables = await getTableNames(raw.q)
    expect(tables).toContain('_migrations')
  })

  it('creates all 6 application tables after running initial migration', async () => {
    const raw = rawPGliteDb()
    pglite = raw.pglite
    await runMigrations(raw.q, [initialMigration])
    const tables = await getTableNames(raw.q)
    for (const table of EXPECTED_TABLES) {
      expect(tables, `Expected table "${table}" to exist`).toContain(table)
    }
  })

  it('creates all expected indexes', async () => {
    const raw = rawPGliteDb()
    pglite = raw.pglite
    await runMigrations(raw.q, [initialMigration])
    const indexes = await getIndexNames(raw.q)
    for (const idx of EXPECTED_INDEXES) {
      expect(indexes, `Expected index "${idx}" to exist`).toContain(idx)
    }
  })

  it('002 adds the nullable import-flag columns to actions', async () => {
    const raw = rawPGliteDb()
    pglite = raw.pglite
    await runMigrations(raw.q, migrations)
    const res = await raw.q.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'actions' AND column_name IN ('signature_change', 'orphaned_at')
       ORDER BY column_name`
    )
    expect(res.rows).toEqual([
      { column_name: 'orphaned_at', is_nullable: 'YES' },
      { column_name: 'signature_change', is_nullable: 'YES' },
    ])
  })

  it('the exported migration list is ordered and starts with the initial schema', () => {
    expect(migrations.map((m) => m.name)).toEqual(['001-initial-schema', '002-action-import-flags'])
  })

  it('seeds 5 default settings with correct keys', async () => {
    const raw = rawPGliteDb()
    pglite = raw.pglite
    await runMigrations(raw.q, [initialMigration])
    const res = await raw.q.query('SELECT key FROM settings ORDER BY key')
    const keys = (res.rows as { key: string }[]).map((s) => s.key)
    expect(keys).toHaveLength(5)
    for (const key of DEFAULT_SETTING_KEYS) {
      expect(keys, `Expected setting key "${key}"`).toContain(key)
    }
  })

  it('seeds settings with correct default values', async () => {
    const raw = rawPGliteDb()
    pglite = raw.pglite
    await runMigrations(raw.q, [initialMigration])
    const res = await raw.q.query('SELECT value, default_value FROM settings WHERE key = $1', [
      'log_max_size',
    ])
    const row = res.rows[0] as { value: string; default_value: string }
    expect(row.value).toBe('10000')
    expect(row.default_value).toBe('10000')
  })

  it('is idempotent — running migrations twice does not duplicate settings or throw', async () => {
    const raw = rawPGliteDb()
    pglite = raw.pglite
    await runMigrations(raw.q, [initialMigration])
    await runMigrations(raw.q, [initialMigration]) // second run
    const res = await raw.q.query('SELECT COUNT(*)::int AS cnt FROM settings')
    expect((res.rows[0] as { cnt: number }).cnt).toBe(5)
  })

  it('records migration in _migrations table with correct name', async () => {
    const raw = rawPGliteDb()
    pglite = raw.pglite
    await runMigrations(raw.q, [initialMigration])
    const res = await raw.q.query('SELECT name FROM _migrations')
    expect(res.rows).toHaveLength(1)
    expect((res.rows[0] as { name: string }).name).toBe('001-initial-schema')
  })

  it('does not insert a second _migrations row on second run', async () => {
    const raw = rawPGliteDb()
    pglite = raw.pglite
    await runMigrations(raw.q, [initialMigration])
    await runMigrations(raw.q, [initialMigration])
    const res = await raw.q.query('SELECT COUNT(*)::int AS cnt FROM _migrations')
    expect((res.rows[0] as { cnt: number }).cnt).toBe(1)
  })

  it('cascades deletes: deleting an environment removes its actions and code_versions', async () => {
    testDb = await createTestDb()

    await testDb.query(
      `INSERT INTO environments (oid, local_id, version, last_modified_date, schema_version, imported_at, source_filename)
       VALUES ('env-1', 'TestEnv', '1.0', '2026-01-01T00:00:00Z', '4.0', '2026-01-01T00:00:00Z', 'test.WFenvir')`
    )

    await testDb.query(
      `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
       VALUES ('act-1', 'env-1', 'TestAction', '1.0', '2026-01-01T00:00:00Z', 'opaque')`
    )

    await testDb.query(
      `INSERT INTO code_versions (id, action_oid, state, version_number, source_code, created_at)
       VALUES ('cv-1', 'act-1', 'EXECUTING', 1, 'pass', '2026-01-01T00:00:00Z')`
    )

    // Delete the environment
    await testDb.query(`DELETE FROM environments WHERE oid = 'env-1'`)

    // Action should be gone (CASCADE from environment -> actions)
    const actionRes = await testDb.query(
      'SELECT COUNT(*)::int AS cnt FROM actions WHERE oid = $1',
      ['act-1']
    )
    expect((actionRes.rows[0] as { cnt: number }).cnt).toBe(0)

    // Code version should be gone (CASCADE from actions -> code_versions)
    const cvRes = await testDb.query(
      'SELECT COUNT(*)::int AS cnt FROM code_versions WHERE id = $1',
      ['cv-1']
    )
    expect((cvRes.rows[0] as { cnt: number }).cnt).toBe(0)
  })

  it('does NOT cascade delete instances when environment is deleted', async () => {
    testDb = await createTestDb()

    await testDb.query(
      `INSERT INTO environments (oid, local_id, version, last_modified_date, schema_version, imported_at, source_filename)
       VALUES ('env-2', 'TestEnv2', '1.0', '2026-01-01T00:00:00Z', '4.0', '2026-01-01T00:00:00Z', 'test.WFenvir')`
    )

    await testDb.query(
      `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
       VALUES ('act-2', 'env-2', 'TestAction2', '1.0', '2026-01-01T00:00:00Z', 'opaque')`
    )

    await testDb.query(
      `INSERT INTO instances (runtime_action_instance_id, action_oid, environment_oid, workflow_instance_id, step_instance_id, step_oid, visibility, state, created_at)
       VALUES ('inst-1', 'act-2', 'env-2', 'wf-1', 'step-inst-1', 'step-1', 'opaque', 'IDLE', '2026-01-01T00:00:00Z')`
    )

    // Postgres enforces FK referential integrity unconditionally — there is no
    // per-session toggle like SQLite's `foreign_keys` pragma. To prove the
    // schema DESIGN decision (instances has no ON DELETE CASCADE from
    // environments or actions) the same way the old test did, temporarily
    // disable environments' constraint-enforcement triggers — this disables
    // BOTH its CASCADE-to-actions trigger and its RESTRICT-check-against-
    // instances trigger, exactly mirroring SQLite's `foreign_keys = OFF`
    // (which also suspends cascading, not just restrict-checks): the actions
    // row is untouched and the instances row survives the environment delete.
    await testDb.query('ALTER TABLE environments DISABLE TRIGGER ALL')
    await testDb.query(`DELETE FROM environments WHERE oid = 'env-2'`)
    await testDb.query('ALTER TABLE environments ENABLE TRIGGER ALL')

    // Instance should still exist (no cascade)
    const res = await testDb.query(
      'SELECT COUNT(*)::int AS cnt FROM instances WHERE runtime_action_instance_id = $1',
      ['inst-1']
    )
    expect((res.rows[0] as { cnt: number }).cnt).toBe(1)
  })
})
