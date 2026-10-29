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
import { ActionRepository } from '../repositories/action.repository.js'
import type { ActionInput, EnvironmentInput } from '../types.js'

const TEST_ENV_INPUT: EnvironmentInput = {
  oid: 'env-parent-001',
  local_id: 'ParentEnv',
  version: '1.0.0',
  last_modified_date: '2026-01-01T00:00:00Z',
  description: 'Test parent environment',
  schema_version: '4.0',
  action_property_specifications: [],
  value_property_specifications: [],
  resource_property_specifications: [],
  source_filename: 'ParentEnv.WFenvir',
}

function makeActionInput(overrides: Partial<ActionInput> = {}): ActionInput {
  return {
    oid: 'act-test-001',
    environment_oid: 'env-parent-001',
    local_id: 'MixIngredients',
    version: '1.0.0',
    last_modified_date: '2026-01-15T10:00:00Z',
    description: 'Mixes kitchen ingredients',
    action_visibility: 'opaque',
    input_parameter_specifications: [{ id: 'input1', name: 'ingredient' }],
    output_parameter_specifications: [{ id: 'output1', name: 'mixture' }],
    property_specifications: [{ id: 'prop1', name: 'speed' }],
    ...overrides,
  }
}

describe('ActionRepository', () => {
  let db: TestDb
  let envRepo: EnvironmentRepository
  let repo: ActionRepository

  beforeEach(async () => {
    db = await createTestDb()
    envRepo = new EnvironmentRepository(db)
    repo = new ActionRepository(db)

    // Create the parent environment that actions will be linked to
    await envRepo.create(TEST_ENV_INPUT)
  })

  afterEach(async () => {
    await db.close()
  })

  describe('create', () => {
    it('creates action linked to env, OID preserved, JSON fields parsed', async () => {
      const input = makeActionInput()
      const action = await repo.create(input)

      expect(action.oid).toBe('act-test-001')
      expect(action.environment_oid).toBe('env-parent-001')
      expect(action.local_id).toBe('MixIngredients')
      expect(action.version).toBe('1.0.0')
      expect(action.action_visibility).toBe('opaque')
      // JSON arrays should be deserialized
      expect(Array.isArray(action.input_parameter_specifications)).toBe(true)
      expect(Array.isArray(action.output_parameter_specifications)).toBe(true)
      expect(Array.isArray(action.property_specifications)).toBe(true)
      expect(action.input_parameter_specifications).toEqual([{ id: 'input1', name: 'ingredient' }])
    })

    it('preserves OID exactly as provided', async () => {
      const action = await repo.create(makeActionInput({ oid: 'SNOWFLAKE-OID-99999' }))
      expect(action.oid).toBe('SNOWFLAKE-OID-99999')
    })

    it('handles null description', async () => {
      const action = await repo.create(makeActionInput({ description: null }))
      expect(action.description).toBeNull()
    })

    it('handles empty JSON arrays', async () => {
      const action = await repo.create(
        makeActionInput({
          input_parameter_specifications: [],
          output_parameter_specifications: [],
          property_specifications: [],
        })
      )
      expect(action.input_parameter_specifications).toEqual([])
      expect(action.output_parameter_specifications).toEqual([])
      expect(action.property_specifications).toEqual([])
    })

    it('supports observable action_visibility', async () => {
      const action = await repo.create(
        makeActionInput({ oid: 'act-obs', action_visibility: 'observable' })
      )
      expect(action.action_visibility).toBe('observable')
    })
  })

  describe('lifecycle state', () => {
    it('persists and returns the lifecycle state', async () => {
      await repo.create(makeActionInput({ oid: 'act-state-1', state: 'Approved' }))
      const row = (await repo.findByOid('act-state-1'))!
      expect(row.state).toBe('Approved')
    })

    it('defaults state to Draft when not provided', async () => {
      await repo.create(makeActionInput({ oid: 'act-state-2' }))
      const row = (await repo.findByOid('act-state-2'))!
      expect(row.state).toBe('Draft')
    })

    it('updates lifecycle state via update()', async () => {
      await repo.create(makeActionInput({ oid: 'act-state-3', state: 'InTest' }))
      const updated = await repo.update('act-state-3', { state: 'InReview' })
      expect(updated!.state).toBe('InReview')
    })
  })

  describe('findByOid', () => {
    it('finds action, null for nonexistent', async () => {
      await repo.create(makeActionInput())

      const found = await repo.findByOid('act-test-001')
      expect(found).not.toBeNull()
      expect(found!.oid).toBe('act-test-001')

      const notFound = await repo.findByOid('nonexistent-oid')
      expect(notFound).toBeNull()
    })

    it('returns action with parsed JSON arrays', async () => {
      await repo.create(makeActionInput())
      const action = (await repo.findByOid('act-test-001'))!
      expect(Array.isArray(action.input_parameter_specifications)).toBe(true)
      expect(action.output_parameter_specifications).toEqual([{ id: 'output1', name: 'mixture' }])
    })
  })

  describe('findByEnvironment', () => {
    it('returns only actions for specified environment, sorted by local_id', async () => {
      // Create second environment
      await envRepo.create({
        ...TEST_ENV_INPUT,
        oid: 'env-other-002',
        local_id: 'OtherEnv',
        source_filename: 'Other.WFenvir',
      })

      await repo.create(
        makeActionInput({ oid: 'act-z', local_id: 'ZAction', environment_oid: 'env-parent-001' })
      )
      await repo.create(
        makeActionInput({ oid: 'act-a', local_id: 'AAction', environment_oid: 'env-parent-001' })
      )
      await repo.create(
        makeActionInput({
          oid: 'act-other',
          local_id: 'OtherAction',
          environment_oid: 'env-other-002',
        })
      )

      const envActions = await repo.findByEnvironment('env-parent-001')
      expect(envActions).toHaveLength(2)
      expect(envActions[0].local_id).toBe('AAction')
      expect(envActions[1].local_id).toBe('ZAction')
    })

    it('returns empty array when environment has no actions', async () => {
      await envRepo.create({
        ...TEST_ENV_INPUT,
        oid: 'env-empty',
        local_id: 'EmptyEnv',
        source_filename: 'Empty.WFenvir',
      })
      const actions = await repo.findByEnvironment('env-empty')
      expect(actions).toEqual([])
    })
  })

  describe('update', () => {
    it('updates description and action_visibility', async () => {
      await repo.create(makeActionInput())
      const updated = await repo.update('act-test-001', {
        description: 'Updated description',
        action_visibility: 'observable',
      })

      expect(updated).not.toBeNull()
      expect(updated!.description).toBe('Updated description')
      expect(updated!.action_visibility).toBe('observable')
      // Other fields unchanged
      expect(updated!.oid).toBe('act-test-001')
      expect(updated!.local_id).toBe('MixIngredients')
    })

    it('updates JSON spec fields with correct round-trip', async () => {
      await repo.create(makeActionInput())
      const newSpecs = [{ id: 'new1', name: 'NewParam' }]
      const updated = await repo.update('act-test-001', {
        input_parameter_specifications: newSpecs,
      })
      expect(updated!.input_parameter_specifications).toEqual(newSpecs)
    })

    it('returns null for nonexistent OID', async () => {
      const result = await repo.update('nonexistent', { description: 'test' })
      expect(result).toBeNull()
    })
  })

  describe('delete', () => {
    it('deletes action and returns true', async () => {
      await repo.create(makeActionInput())
      const result = await repo.delete('act-test-001')
      expect(result).toBe(true)
      expect(await repo.findByOid('act-test-001')).toBeNull()
    })

    it('returns false when OID not found', async () => {
      const result = await repo.delete('nonexistent-oid')
      expect(result).toBe(false)
    })
  })

  describe('cascade from environment delete', () => {
    it('delete parent environment removes action', async () => {
      await repo.create(makeActionInput())
      await envRepo.delete('env-parent-001')

      const found = await repo.findByOid('act-test-001')
      expect(found).toBeNull()
    })
  })

  describe('cascade to code_versions', () => {
    it('deleting action removes its code_versions', async () => {
      await repo.create(makeActionInput())
      // Insert code version directly
      await db.query(
        `INSERT INTO code_versions (id, action_oid, state, version_number, source_code, created_at)
         VALUES ('cv-cascade-001', 'act-test-001', 'EXECUTING', 1, 'pass', '2026-01-01T00:00:00Z')`
      )

      await repo.delete('act-test-001')

      const res = await db.query('SELECT COUNT(*)::int AS cnt FROM code_versions WHERE id = $1', [
        'cv-cascade-001',
      ])
      expect((res.rows[0] as { cnt: number }).cnt).toBe(0)
    })
  })

  describe('upsert', () => {
    it('creates action when OID does not exist', async () => {
      const { action, created } = await repo.upsert(makeActionInput())
      expect(created).toBe(true)
      expect(action.oid).toBe('act-test-001')
    })

    it('updates action when OID exists', async () => {
      await repo.create(makeActionInput())
      const { action, created } = await repo.upsert(
        makeActionInput({ description: 'Re-uploaded spec' })
      )
      expect(created).toBe(false)
      expect(action.description).toBe('Re-uploaded spec')
    })

    it('preserves action OID through upsert', async () => {
      const { action } = await repo.upsert(makeActionInput({ oid: 'STABLE-OID-XYZ' }))
      expect(action.oid).toBe('STABLE-OID-XYZ')
    })
  })

  describe('import flags', () => {
    const flag = {
      flagged_at: '2026-09-02T10:00:00.000Z',
      baseline_input_parameter_specifications: [{ id: 'count', value_type: 'integer' }],
      baseline_output_parameter_specifications: [],
      changes: ['input `count` removed'],
    }

    it('create defaults signature_change and orphaned_at to null', async () => {
      const action = await repo.create(makeActionInput())
      expect(action.signature_change).toBeNull()
      expect(action.orphaned_at).toBeNull()
      const found = await repo.findByOid('act-test-001')
      expect(found?.signature_change).toBeNull()
      expect(found?.orphaned_at).toBeNull()
    })

    it('update persists a signature_change flag and reads it back parsed', async () => {
      await repo.create(makeActionInput())
      const updated = await repo.update('act-test-001', { signature_change: flag })
      expect(updated?.signature_change).toEqual(flag)
      const found = await repo.findByOid('act-test-001')
      expect(found?.signature_change).toEqual(flag)
    })

    it('update clears signature_change with null', async () => {
      await repo.create(makeActionInput({ signature_change: flag }))
      expect((await repo.findByOid('act-test-001'))?.signature_change).toEqual(flag)
      await repo.update('act-test-001', { signature_change: null })
      expect((await repo.findByOid('act-test-001'))?.signature_change).toBeNull()
    })

    it('update sets and clears orphaned_at', async () => {
      await repo.create(makeActionInput())
      await repo.update('act-test-001', { orphaned_at: '2026-09-02T11:00:00.000Z' })
      expect((await repo.findByOid('act-test-001'))?.orphaned_at).toBe('2026-09-02T11:00:00.000Z')
      await repo.update('act-test-001', { orphaned_at: null })
      expect((await repo.findByOid('act-test-001'))?.orphaned_at).toBeNull()
    })

    it('an upsert that omits the flag keys leaves existing flags untouched', async () => {
      await repo.create(
        makeActionInput({ signature_change: flag, orphaned_at: '2026-09-02T11:00:00.000Z' })
      )
      await repo.upsert(makeActionInput({ description: 'Re-uploaded spec' }))
      const found = await repo.findByOid('act-test-001')
      expect(found?.signature_change).toEqual(flag)
      expect(found?.orphaned_at).toBe('2026-09-02T11:00:00.000Z')
    })
  })

  describe('reassignEnvironment', () => {
    it('moves every action of the old environment to the new one', async () => {
      await envRepo.create({
        ...TEST_ENV_INPUT,
        oid: 'env-parent-002',
        local_id: 'ParentEnv',
        source_filename: 'ParentEnv2.WFenvir',
      })
      await repo.create(makeActionInput({ oid: 'act-1', local_id: 'Act1' }))
      await repo.create(makeActionInput({ oid: 'act-2', local_id: 'Act2' }))

      const moved = await repo.reassignEnvironment('env-parent-001', 'env-parent-002')

      expect(moved).toBe(2)
      expect(await repo.findByEnvironment('env-parent-001')).toEqual([])
      expect((await repo.findByEnvironment('env-parent-002')).map((a) => a.oid)).toEqual([
        'act-1',
        'act-2',
      ])
    })

    it('returns 0 when the old environment has no actions', async () => {
      expect(await repo.reassignEnvironment('env-parent-001', 'env-parent-001')).toBe(0)
    })
  })

  describe('count and countByEnvironment', () => {
    it('count returns 0 when no actions', async () => {
      expect(await repo.count()).toBe(0)
    })

    it('count returns correct total', async () => {
      await envRepo.create({
        ...TEST_ENV_INPUT,
        oid: 'env-extra',
        local_id: 'ExtraEnv',
        source_filename: 'Extra.WFenvir',
      })
      await repo.create(makeActionInput({ oid: 'act-1', local_id: 'Act1' }))
      await repo.create(makeActionInput({ oid: 'act-2', local_id: 'Act2' }))
      await repo.create(
        makeActionInput({ oid: 'act-3', local_id: 'Act3', environment_oid: 'env-extra' })
      )
      expect(await repo.count()).toBe(3)
    })

    it('countByEnvironment returns count for specific environment', async () => {
      await envRepo.create({
        ...TEST_ENV_INPUT,
        oid: 'env-extra2',
        local_id: 'ExtraEnv2',
        source_filename: 'Extra2.WFenvir',
      })
      await repo.create(
        makeActionInput({ oid: 'act-e1', local_id: 'E1', environment_oid: 'env-parent-001' })
      )
      await repo.create(
        makeActionInput({ oid: 'act-e2', local_id: 'E2', environment_oid: 'env-parent-001' })
      )
      await repo.create(
        makeActionInput({ oid: 'act-e3', local_id: 'E3', environment_oid: 'env-extra2' })
      )

      expect(await repo.countByEnvironment('env-parent-001')).toBe(2)
      expect(await repo.countByEnvironment('env-extra2')).toBe(1)
      expect(await repo.countByEnvironment('nonexistent')).toBe(0)
    })
  })

  describe('deleteByEnvironment', () => {
    it('deletes all actions for an environment and returns count', async () => {
      await repo.create(makeActionInput({ oid: 'act-d1', local_id: 'D1' }))
      await repo.create(makeActionInput({ oid: 'act-d2', local_id: 'D2' }))
      const count = await repo.deleteByEnvironment('env-parent-001')
      expect(count).toBe(2)
      expect(await repo.countByEnvironment('env-parent-001')).toBe(0)
    })

    it('returns 0 when no actions for environment', async () => {
      const count = await repo.deleteByEnvironment('env-parent-001')
      expect(count).toBe(0)
    })
  })

  describe('findAll', () => {
    it('returns all actions sorted by local_id', async () => {
      await repo.create(makeActionInput({ oid: 'act-z2', local_id: 'ZetaAction' }))
      await repo.create(makeActionInput({ oid: 'act-a2', local_id: 'AlphaAction' }))

      const all = await repo.findAll()
      expect(all).toHaveLength(2)
      expect(all[0].local_id).toBe('AlphaAction')
      expect(all[1].local_id).toBe('ZetaAction')
    })
  })
})
