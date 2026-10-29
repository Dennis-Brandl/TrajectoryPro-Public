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
import { databaseSchemaStatus, withAtomic } from '../database.js'
import { EnvironmentRepository } from '../repositories/environment.repository.js'
import { LogRepository } from '../repositories/log.repository.js'

let db: TestDb
afterEach(async () => {
  if (db) await db.close()
})

describe('PG storage core', () => {
  it('migration creates the full schema', async () => {
    db = await createTestDb()
    const { ok, missingTables } = await databaseSchemaStatus(db)
    expect(missingTables).toEqual([])
    expect(ok).toBe(true)
  })

  it('migration is idempotent (second run applies nothing)', async () => {
    db = await createTestDb()
    const { runMigrations } = await import('../migrations/runner.js')
    const { migration } = await import('../migrations/001-initial-schema.js')
    await expect(runMigrations(db, [migration])).resolves.toBeUndefined()
  })

  it('settings are seeded including api_key', async () => {
    db = await createTestDb()
    const res = await db.query('SELECT key FROM settings ORDER BY key')
    expect(res.rows.map((r) => r.key)).toEqual([
      'api_key',
      'execution_timeout_ms',
      'instance_retention_hours',
      'log_max_size',
      'python_pool_size',
    ])
  })

  it('environment repo round-trip', async () => {
    db = await createTestDb()
    const repo = new EnvironmentRepository(db)
    const created = await repo.create({
      oid: 'env-1',
      local_id: 'Env One',
      version: '1.0.0',
      last_modified_date: '2026-01-01T00:00:00.000Z',
      schema_version: '4.0',
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      source_filename: 'env.WFenvir',
    })
    expect(created.state).toBe('Draft')
    const found = await repo.findByOid('env-1')
    expect(found?.local_id).toBe('Env One')
    expect(await repo.count()).toBe(1)
  })

  it('log query actionName filter is case-insensitive (ILIKE, SQLite LIKE parity)', async () => {
    db = await createTestDb()
    const repo = new LogRepository(db)
    await repo.insert(
      {
        runtime_action_instance_id: 'ri-1',
        action_oid: 'act-1',
        action_name: 'KitchenAction',
        environment_oid: 'env-1',
        environment_name: 'Factory',
        workflow_instance_id: 'wf-1',
        step_oid: 'step-1',
        input_parameters: [],
        output_parameters: [],
        states_executed: [],
        code_versions_used: {},
        started_at: '2026-01-01T00:00:00.000Z',
        completed_at: '2026-01-01T00:00:01.000Z',
        duration_ms: 1000,
        final_status: 'COMPLETED',
      },
      10000
    )
    const { total } = await repo.query({ actionName: 'kitchen' })
    expect(total).toBe(1)
  })

  it('withAtomic over a non-pool queryable runs the callback directly', async () => {
    db = await createTestDb()
    const n = await withAtomic(db, async (tx) => {
      const r = await tx.query('SELECT 1::int AS one')
      return (r.rows[0] as { one: number }).one
    })
    expect(n).toBe(1)
  })
})
