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

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../testing.js'
import { EnvironmentRepository } from '../repositories/environment.repository.js'
import type { EnvironmentInput } from '../types.js'

function makeEnvInput(overrides: Partial<EnvironmentInput> = {}): EnvironmentInput {
  return {
    oid: 'env-test-001',
    local_id: 'KitchenEnv',
    version: '1.0.0',
    last_modified_date: '2026-01-15T10:00:00Z',
    description: 'A test kitchen environment',
    schema_version: '4.0',
    action_property_specifications: [{ id: 'prop1', name: 'Temperature' }],
    value_property_specifications: [{ id: 'val1', name: 'SetPoint' }],
    resource_property_specifications: [{ id: 'res1', name: 'Oven' }],
    source_filename: 'KitchenEnv.WFenvir',
    ...overrides,
  }
}

describe('EnvironmentRepository', () => {
  let db: TestDb
  let repo: EnvironmentRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new EnvironmentRepository(db)
  })

  afterEach(async () => {
    await db.close()
  })

  describe('create', () => {
    it('creates environment and returns it with parsed JSON arrays', async () => {
      const input = makeEnvInput()
      const env = await repo.create(input)

      expect(env.oid).toBe('env-test-001')
      expect(env.local_id).toBe('KitchenEnv')
      expect(env.version).toBe('1.0.0')
      expect(env.description).toBe('A test kitchen environment')
      expect(env.schema_version).toBe('4.0')
      expect(env.source_filename).toBe('KitchenEnv.WFenvir')
      // JSON arrays should be deserialized
      expect(Array.isArray(env.action_property_specifications)).toBe(true)
      expect(Array.isArray(env.value_property_specifications)).toBe(true)
      expect(Array.isArray(env.resource_property_specifications)).toBe(true)
      expect(env.action_property_specifications).toEqual([{ id: 'prop1', name: 'Temperature' }])
    })

    it('preserves OID exactly as provided', async () => {
      const input = makeEnvInput({ oid: 'EXACT-OID-12345' })
      const env = await repo.create(input)
      expect(env.oid).toBe('EXACT-OID-12345')
    })

    it('sets imported_at automatically as ISO 8601 string', async () => {
      const before = new Date().toISOString()
      const env = await repo.create(makeEnvInput())
      const after = new Date().toISOString()
      expect(env.imported_at >= before).toBe(true)
      expect(env.imported_at <= after).toBe(true)
    })

    it('handles null description', async () => {
      const env = await repo.create(makeEnvInput({ description: null }))
      expect(env.description).toBeNull()
    })

    it('handles empty arrays for property specifications', async () => {
      const env = await repo.create(
        makeEnvInput({
          action_property_specifications: [],
          value_property_specifications: [],
          resource_property_specifications: [],
        })
      )
      expect(env.action_property_specifications).toEqual([])
      expect(env.value_property_specifications).toEqual([])
      expect(env.resource_property_specifications).toEqual([])
    })
  })

  describe('lifecycle state', () => {
    it('persists and returns the lifecycle state', async () => {
      await repo.create(
        makeEnvInput({ oid: 'env-state-1', local_id: 'StateEnv1', state: 'Approved' })
      )
      const env = (await repo.findByOid('env-state-1'))!
      expect(env.state).toBe('Approved')
    })

    it('defaults state to Draft when not provided', async () => {
      await repo.create(makeEnvInput({ oid: 'env-state-2', local_id: 'StateEnv2' }))
      const env = (await repo.findByOid('env-state-2'))!
      expect(env.state).toBe('Draft')
    })

    it('updates lifecycle state via update()', async () => {
      await repo.create(
        makeEnvInput({ oid: 'env-state-3', local_id: 'StateEnv3', state: 'InTest' })
      )
      const updated = await repo.update('env-state-3', { state: 'Effective' })
      expect(updated!.state).toBe('Effective')
    })
  })

  describe('findByOid', () => {
    it('returns created environment', async () => {
      await repo.create(makeEnvInput())
      const env = await repo.findByOid('env-test-001')
      expect(env).not.toBeNull()
      expect(env!.oid).toBe('env-test-001')
    })

    it('returns null for nonexistent OID', async () => {
      const env = await repo.findByOid('nonexistent-oid')
      expect(env).toBeNull()
    })

    it('returns environment with parsed JSON arrays', async () => {
      await repo.create(makeEnvInput())
      const env = (await repo.findByOid('env-test-001'))!
      expect(Array.isArray(env.action_property_specifications)).toBe(true)
      expect(env.action_property_specifications).toEqual([{ id: 'prop1', name: 'Temperature' }])
    })
  })

  describe('findAll', () => {
    it('returns empty array when no environments', async () => {
      expect(await repo.findAll()).toEqual([])
    })

    it('returns all environments sorted by local_id ASC', async () => {
      await repo.create(makeEnvInput({ oid: 'env-z', local_id: 'ZFactory' }))
      await repo.create(makeEnvInput({ oid: 'env-a', local_id: 'AKitchen' }))
      await repo.create(makeEnvInput({ oid: 'env-m', local_id: 'MWarehouse' }))

      const all = await repo.findAll()
      expect(all).toHaveLength(3)
      expect(all[0].local_id).toBe('AKitchen')
      expect(all[1].local_id).toBe('MWarehouse')
      expect(all[2].local_id).toBe('ZFactory')
    })
  })

  describe('lockName', () => {
    it('takes a transaction-scoped advisory lock keyed on the environment name and resolves', async () => {
      await expect(repo.lockName('Kitchen')).resolves.toBeUndefined()
      // Re-entrant within the same session: a second call must not block.
      await expect(repo.lockName('Kitchen')).resolves.toBeUndefined()
    })
  })

  describe('update', () => {
    it('updates description and verifies other fields unchanged', async () => {
      await repo.create(makeEnvInput())
      const updated = await repo.update('env-test-001', { description: 'Updated description' })

      expect(updated).not.toBeNull()
      expect(updated!.description).toBe('Updated description')
      // Other fields unchanged
      expect(updated!.oid).toBe('env-test-001')
      expect(updated!.local_id).toBe('KitchenEnv')
      expect(updated!.version).toBe('1.0.0')
    })

    it('updates JSON fields with correct round-trip', async () => {
      await repo.create(makeEnvInput())
      const newSpecs = [
        { id: 'newProp', name: 'Humidity' },
        { id: 'newProp2', name: 'Pressure' },
      ]
      const updated = await repo.update('env-test-001', {
        action_property_specifications: newSpecs,
      })

      expect(updated!.action_property_specifications).toEqual(newSpecs)
      // Other JSON fields unchanged
      expect(updated!.value_property_specifications).toEqual([{ id: 'val1', name: 'SetPoint' }])
    })

    it('returns null for nonexistent OID', async () => {
      const result = await repo.update('nonexistent', { description: 'test' })
      expect(result).toBeNull()
    })

    it('returns current env when no fields provided', async () => {
      await repo.create(makeEnvInput())
      const updated = await repo.update('env-test-001', {})
      expect(updated).not.toBeNull()
      expect(updated!.oid).toBe('env-test-001')
    })
  })

  describe('delete', () => {
    it('deletes environment and returns true', async () => {
      await repo.create(makeEnvInput())
      const result = await repo.delete('env-test-001')
      expect(result).toBe(true)
      expect(await repo.findByOid('env-test-001')).toBeNull()
    })

    it('returns false when OID not found', async () => {
      const result = await repo.delete('nonexistent-oid')
      expect(result).toBe(false)
    })
  })

  describe('cascade delete', () => {
    it('deleting environment cascade-deletes its actions', async () => {
      await repo.create(makeEnvInput())
      // Insert action directly via SQL to avoid needing ActionRepository
      await db.query(
        `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
         VALUES ('act-001', 'env-test-001', 'TestAction', '1.0', '2026-01-01T00:00:00Z', 'opaque')`
      )

      await repo.delete('env-test-001')

      const res = await db.query('SELECT COUNT(*)::int AS cnt FROM actions WHERE oid = $1', [
        'act-001',
      ])
      expect((res.rows[0] as { cnt: number }).cnt).toBe(0)
    })

    it('deleting environment cascade-deletes actions AND their code_versions', async () => {
      await repo.create(makeEnvInput())
      await db.query(
        `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
         VALUES ('act-002', 'env-test-001', 'AnotherAction', '1.0', '2026-01-01T00:00:00Z', 'opaque')`
      )
      await db.query(
        `INSERT INTO code_versions (id, action_oid, state, version_number, source_code, created_at)
         VALUES ('cv-001', 'act-002', 'EXECUTING', 1, 'pass', '2026-01-01T00:00:00Z')`
      )

      await repo.delete('env-test-001')

      const res = await db.query('SELECT COUNT(*)::int AS cnt FROM code_versions WHERE id = $1', [
        'cv-001',
      ])
      expect((res.rows[0] as { cnt: number }).cnt).toBe(0)
    })
  })

  describe('upsert', () => {
    it('creates a new record when OID does not exist', async () => {
      const { environment, created } = await repo.upsert(makeEnvInput())
      expect(created).toBe(true)
      expect(environment.oid).toBe('env-test-001')
    })

    it('updates existing record when OID exists', async () => {
      await repo.create(makeEnvInput())
      const { environment, created } = await repo.upsert(
        makeEnvInput({ description: 'Re-uploaded' })
      )
      expect(created).toBe(false)
      expect(environment.description).toBe('Re-uploaded')
    })

    it('returns the updated environment after re-upload', async () => {
      await repo.create(makeEnvInput({ version: '1.0.0' }))
      const { environment } = await repo.upsert(makeEnvInput({ version: '2.0.0' }))
      expect(environment.version).toBe('2.0.0')
    })
  })

  describe('count', () => {
    it('returns 0 when no environments', async () => {
      expect(await repo.count()).toBe(0)
    })

    it('returns correct count after creates', async () => {
      await repo.create(makeEnvInput({ oid: 'env-1', local_id: 'Env1' }))
      await repo.create(makeEnvInput({ oid: 'env-2', local_id: 'Env2' }))
      await repo.create(makeEnvInput({ oid: 'env-3', local_id: 'Env3' }))
      expect(await repo.count()).toBe(3)
    })

    it('decrements after delete', async () => {
      await repo.create(makeEnvInput())
      expect(await repo.count()).toBe(1)
      await repo.delete('env-test-001')
      expect(await repo.count()).toBe(0)
    })
  })

  describe('findByLocalId', () => {
    it('finds environment by local_id', async () => {
      await repo.create(makeEnvInput())
      const env = await repo.findByLocalId('KitchenEnv')
      expect(env).not.toBeNull()
      expect(env!.oid).toBe('env-test-001')
    })

    it('returns null for nonexistent local_id', async () => {
      const env = await repo.findByLocalId('NonExistentEnv')
      expect(env).toBeNull()
    })
  })
})
