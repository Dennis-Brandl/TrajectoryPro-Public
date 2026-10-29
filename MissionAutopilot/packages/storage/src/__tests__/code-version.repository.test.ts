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
import { CodeVersionRepository } from '../repositories/code-version.repository.js'
import type { CodeVersionInput, EnvironmentInput, ActionInput } from '../types.js'

const TEST_ENV: EnvironmentInput = {
  oid: 'env-cv-test-001',
  local_id: 'CVTestEnv',
  version: '1.0.0',
  last_modified_date: '2026-01-01T00:00:00Z',
  description: null,
  schema_version: '4.0',
  action_property_specifications: [],
  value_property_specifications: [],
  resource_property_specifications: [],
  source_filename: 'CVTestEnv.WFenvir',
}

const TEST_ACTION: ActionInput = {
  oid: 'act-cv-test-001',
  environment_oid: 'env-cv-test-001',
  local_id: 'CVTestAction',
  version: '1.0.0',
  last_modified_date: '2026-01-01T00:00:00Z',
  description: null,
  action_visibility: 'opaque',
  input_parameter_specifications: [],
  output_parameter_specifications: [],
  property_specifications: [],
}

function makeCVInput(overrides: Partial<CodeVersionInput> = {}): CodeVersionInput {
  return {
    action_oid: 'act-cv-test-001',
    state: 'EXECUTING',
    source_code: 'def execute(context):\n    pass',
    created_by: 'test-user',
    description: 'Test version',
    ...overrides,
  }
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('CodeVersionRepository', () => {
  let db: TestDb
  let repo: CodeVersionRepository

  beforeEach(async () => {
    db = await createTestDb()

    const envRepo = new EnvironmentRepository(db)
    const actionRepo = new ActionRepository(db)
    await envRepo.create(TEST_ENV)
    await actionRepo.create(TEST_ACTION)

    repo = new CodeVersionRepository(db)
  })

  afterEach(async () => {
    await db.close()
  })

  describe('save', () => {
    it('creates version with auto-incrementing version_number starting at 1', async () => {
      const cv = await repo.save(makeCVInput())
      expect(cv.version_number).toBe(1)
      expect(cv.action_oid).toBe('act-cv-test-001')
      expect(cv.state).toBe('EXECUTING')
      expect(cv.source_code).toBe('def execute(context):\n    pass')
      expect(cv.is_active).toBe(false)
      expect(cv.created_by).toBe('test-user')
      expect(cv.description).toBe('Test version')
    })

    it('second save increments version_number to 2 for same action+state', async () => {
      await repo.save(makeCVInput())
      const cv2 = await repo.save(
        makeCVInput({ source_code: 'def execute(context):\n    return {}' })
      )
      expect(cv2.version_number).toBe(2)
    })

    it('third save increments version_number to 3', async () => {
      await repo.save(makeCVInput())
      await repo.save(makeCVInput())
      const cv3 = await repo.save(makeCVInput())
      expect(cv3.version_number).toBe(3)
    })

    it('version_number starts at 1 for new state of same action', async () => {
      await repo.save(makeCVInput({ state: 'EXECUTING' }))
      await repo.save(makeCVInput({ state: 'EXECUTING' }))
      const completingCv = await repo.save(makeCVInput({ state: 'COMPLETING' }))
      expect(completingCv.version_number).toBe(1)
    })

    it('sets created_at as ISO 8601 string', async () => {
      const before = new Date().toISOString()
      const cv = await repo.save(makeCVInput())
      const after = new Date().toISOString()
      expect(cv.created_at >= before).toBe(true)
      expect(cv.created_at <= after).toBe(true)
    })

    it('generates UUID format id', async () => {
      const cv = await repo.save(makeCVInput())
      expect(cv.id).toMatch(UUID_V4_PATTERN)
    })

    it('handles null created_by and description', async () => {
      const cv = await repo.save(makeCVInput({ created_by: null, description: null }))
      expect(cv.created_by).toBeNull()
      expect(cv.description).toBeNull()
    })
  })

  describe('activate', () => {
    it('activates a code version, is_active becomes true', async () => {
      const cv = await repo.save(makeCVInput())
      expect(cv.is_active).toBe(false)

      const activated = await repo.activate(cv.id)
      expect(activated).not.toBeNull()
      expect(activated!.is_active).toBe(true)
      expect(activated!.id).toBe(cv.id)
    })

    it('activating one deactivates all others for same action+state', async () => {
      const cv1 = await repo.save(makeCVInput())
      const cv2 = await repo.save(makeCVInput())
      const cv3 = await repo.save(makeCVInput())

      // Activate version 1 first
      await repo.activate(cv1.id)

      // Now activate version 2 — version 1 should be deactivated
      await repo.activate(cv2.id)

      expect((await repo.findById(cv1.id))!.is_active).toBe(false)
      expect((await repo.findById(cv2.id))!.is_active).toBe(true)
      expect((await repo.findById(cv3.id))!.is_active).toBe(false)
    })

    it('returns null for nonexistent id', async () => {
      const result = await repo.activate('nonexistent-id')
      expect(result).toBeNull()
    })

    it('activation is exclusive: activating v3 deactivates v1 and v2', async () => {
      const cv1 = await repo.save(makeCVInput())
      const cv2 = await repo.save(makeCVInput())
      const cv3 = await repo.save(makeCVInput())

      // Activate all three in sequence, final state should be only cv3 active
      await repo.activate(cv1.id)
      await repo.activate(cv2.id)
      await repo.activate(cv3.id)

      expect((await repo.findById(cv1.id))!.is_active).toBe(false)
      expect((await repo.findById(cv2.id))!.is_active).toBe(false)
      expect((await repo.findById(cv3.id))!.is_active).toBe(true)
    })

    it('activating version for one state does not affect other states', async () => {
      const execCv = await repo.save(makeCVInput({ state: 'EXECUTING' }))
      const compCv = await repo.save(makeCVInput({ state: 'COMPLETING' }))

      await repo.activate(execCv.id)
      // Should not affect COMPLETING state
      expect((await repo.findById(compCv.id))!.is_active).toBe(false)
    })
  })

  describe('deactivate', () => {
    it('deactivates an active version', async () => {
      const cv = await repo.save(makeCVInput())
      await repo.activate(cv.id)
      expect((await repo.findById(cv.id))!.is_active).toBe(true)

      const deactivated = await repo.deactivate(cv.id)
      expect(deactivated).not.toBeNull()
      expect(deactivated!.is_active).toBe(false)
    })

    it('returns null for nonexistent id', async () => {
      const result = await repo.deactivate('nonexistent-id')
      expect(result).toBeNull()
    })

    it('deactivating already-inactive version returns it with is_active false', async () => {
      const cv = await repo.save(makeCVInput())
      const result = await repo.deactivate(cv.id)
      expect(result).not.toBeNull()
      expect(result!.is_active).toBe(false)
    })
  })

  describe('getActive', () => {
    it('returns null when no active version', async () => {
      await repo.save(makeCVInput())
      const active = await repo.getActive('act-cv-test-001', 'EXECUTING')
      expect(active).toBeNull()
    })

    it('returns the active version after activation', async () => {
      const cv = await repo.save(makeCVInput())
      await repo.activate(cv.id)

      const active = await repo.getActive('act-cv-test-001', 'EXECUTING')
      expect(active).not.toBeNull()
      expect(active!.id).toBe(cv.id)
      expect(active!.is_active).toBe(true)
    })

    it('returns null for different state even if other state is active', async () => {
      const cv = await repo.save(makeCVInput({ state: 'EXECUTING' }))
      await repo.activate(cv.id)

      const active = await repo.getActive('act-cv-test-001', 'COMPLETING')
      expect(active).toBeNull()
    })

    it('returns null after deactivation', async () => {
      const cv = await repo.save(makeCVInput())
      await repo.activate(cv.id)
      await repo.deactivate(cv.id)

      const active = await repo.getActive('act-cv-test-001', 'EXECUTING')
      expect(active).toBeNull()
    })
  })

  describe('getVersionHistory', () => {
    it('returns all versions for action+state in descending version_number order', async () => {
      await repo.save(makeCVInput({ source_code: 'v1' }))
      await repo.save(makeCVInput({ source_code: 'v2' }))
      await repo.save(makeCVInput({ source_code: 'v3' }))

      const history = await repo.getVersionHistory('act-cv-test-001', 'EXECUTING')
      expect(history).toHaveLength(3)
      expect(history[0].version_number).toBe(3)
      expect(history[1].version_number).toBe(2)
      expect(history[2].version_number).toBe(1)
    })

    it('returns empty array when no versions for state', async () => {
      const history = await repo.getVersionHistory('act-cv-test-001', 'COMPLETING')
      expect(history).toEqual([])
    })

    it('only returns versions for the specified state', async () => {
      await repo.save(makeCVInput({ state: 'EXECUTING' }))
      await repo.save(makeCVInput({ state: 'COMPLETING' }))

      const execHistory = await repo.getVersionHistory('act-cv-test-001', 'EXECUTING')
      expect(execHistory).toHaveLength(1)
      expect(execHistory[0].state).toBe('EXECUTING')
    })
  })

  describe('findById', () => {
    it('returns code version by id', async () => {
      const cv = await repo.save(makeCVInput())
      const found = await repo.findById(cv.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(cv.id)
    })

    it('returns null for nonexistent id', async () => {
      const result = await repo.findById('nonexistent-id')
      expect(result).toBeNull()
    })
  })

  describe('findByAction', () => {
    it('returns versions across all states ordered by state ASC, version_number DESC', async () => {
      await repo.save(makeCVInput({ state: 'EXECUTING', source_code: 'exec-v1' }))
      await repo.save(makeCVInput({ state: 'EXECUTING', source_code: 'exec-v2' }))
      await repo.save(makeCVInput({ state: 'COMPLETING', source_code: 'comp-v1' }))

      const versions = await repo.findByAction('act-cv-test-001')
      expect(versions).toHaveLength(3)
      // Ordered by state ASC, then version_number DESC within each state
      expect(versions[0].state).toBe('COMPLETING')
      expect(versions[1].state).toBe('EXECUTING')
      expect(versions[1].version_number).toBe(2)
      expect(versions[2].state).toBe('EXECUTING')
      expect(versions[2].version_number).toBe(1)
    })

    it('returns empty array when no versions for action', async () => {
      const versions = await repo.findByAction('nonexistent-action')
      expect(versions).toEqual([])
    })
  })

  describe('saveAndActivate', () => {
    it('saves and activates in one call', async () => {
      const cv = await repo.saveAndActivate(makeCVInput())
      expect(cv.is_active).toBe(true)
      expect(cv.version_number).toBe(1)
    })

    it('saveAndActivate deactivates previous active version', async () => {
      const cv1 = await repo.saveAndActivate(makeCVInput({ source_code: 'v1' }))
      const cv2 = await repo.saveAndActivate(makeCVInput({ source_code: 'v2' }))

      expect((await repo.findById(cv1.id))!.is_active).toBe(false)
      expect((await repo.findById(cv2.id))!.is_active).toBe(true)
    })

    it('saveAndActivate auto-increments version_number', async () => {
      const cv1 = await repo.saveAndActivate(makeCVInput())
      const cv2 = await repo.saveAndActivate(makeCVInput())
      expect(cv1.version_number).toBe(1)
      expect(cv2.version_number).toBe(2)
    })

    it('getActive returns the saveAndActivate result', async () => {
      const cv = await repo.saveAndActivate(makeCVInput())
      const active = await repo.getActive('act-cv-test-001', 'EXECUTING')
      expect(active).not.toBeNull()
      expect(active!.id).toBe(cv.id)
    })
  })

  describe('getAllActiveVersions', () => {
    it('returns empty array when no active versions', async () => {
      await repo.save(makeCVInput({ state: 'EXECUTING' }))
      const actives = await repo.getAllActiveVersions('act-cv-test-001')
      expect(actives).toEqual([])
    })

    it('returns active versions for all states of an action', async () => {
      const execCv = await repo.saveAndActivate(makeCVInput({ state: 'EXECUTING' }))
      const compCv = await repo.saveAndActivate(makeCVInput({ state: 'COMPLETING' }))

      const actives = await repo.getAllActiveVersions('act-cv-test-001')
      expect(actives).toHaveLength(2)
      const ids = actives.map((cv) => cv.id)
      expect(ids).toContain(execCv.id)
      expect(ids).toContain(compCv.id)
    })

    it('returns only active version per state', async () => {
      // Save 2 versions for EXECUTING, activate only the second
      const exec1 = await repo.save(makeCVInput({ state: 'EXECUTING' }))
      const exec2 = await repo.save(makeCVInput({ state: 'EXECUTING' }))
      await repo.activate(exec2.id)

      const actives = await repo.getAllActiveVersions('act-cv-test-001')
      expect(actives).toHaveLength(1)
      expect(actives[0].id).toBe(exec2.id)
      expect(actives.some((cv) => cv.id === exec1.id)).toBe(false)
    })
  })

  describe('getLatestVersion', () => {
    it('returns the version with highest version_number', async () => {
      await repo.save(makeCVInput({ source_code: 'v1' }))
      await repo.save(makeCVInput({ source_code: 'v2' }))
      await repo.save(makeCVInput({ source_code: 'v3' }))

      const latest = await repo.getLatestVersion('act-cv-test-001', 'EXECUTING')
      expect(latest).not.toBeNull()
      expect(latest!.version_number).toBe(3)
      expect(latest!.source_code).toBe('v3')
    })

    it('returns null when no versions for action+state', async () => {
      const latest = await repo.getLatestVersion('act-cv-test-001', 'COMPLETING')
      expect(latest).toBeNull()
    })
  })

  describe('cascade delete', () => {
    it('deleting parent action removes all code_versions', async () => {
      await repo.save(makeCVInput({ state: 'EXECUTING' }))
      await repo.save(makeCVInput({ state: 'COMPLETING' }))
      expect(await repo.countByAction('act-cv-test-001')).toBe(2)

      await db.query('DELETE FROM actions WHERE oid = $1', ['act-cv-test-001'])

      expect(await repo.countByAction('act-cv-test-001')).toBe(0)
      expect(await repo.count()).toBe(0)
    })
  })

  describe('deleteByAction', () => {
    it('deletes all code versions for an action and returns count', async () => {
      await repo.save(makeCVInput({ state: 'EXECUTING' }))
      await repo.save(makeCVInput({ state: 'COMPLETING' }))
      const count = await repo.deleteByAction('act-cv-test-001')
      expect(count).toBe(2)
      expect(await repo.countByAction('act-cv-test-001')).toBe(0)
    })

    it('returns 0 when no versions for action', async () => {
      const count = await repo.deleteByAction('nonexistent-action')
      expect(count).toBe(0)
    })
  })

  describe('reassignAction', () => {
    it('moves every version (active flags intact) to the new action oid', async () => {
      await db.query(
        `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
         VALUES ('act-cv-test-002', 'env-cv-test-001', 'CVTestAction', '2.0.0', '2026-01-02T00:00:00Z', 'opaque')`
      )
      await repo.save(makeCVInput({ state: 'EXECUTING', source_code: 'v1' }))
      const active = await repo.saveAndActivate(
        makeCVInput({ state: 'EXECUTING', source_code: 'v2' })
      )
      await repo.saveAndActivate(makeCVInput({ state: 'COMPLETING', source_code: 'c1' }))

      const moved = await repo.reassignAction('act-cv-test-001', 'act-cv-test-002')

      expect(moved).toBe(3)
      expect(await repo.countByAction('act-cv-test-001')).toBe(0)
      expect(await repo.countByAction('act-cv-test-002')).toBe(3)
      const history = await repo.getVersionHistory('act-cv-test-002', 'EXECUTING')
      expect(history.map((v) => v.version_number)).toEqual([2, 1]) // newest first
      expect((await repo.getActive('act-cv-test-002', 'EXECUTING'))?.id).toBe(active.id)
    })

    it('returns 0 when the source action has no versions', async () => {
      expect(await repo.reassignAction('nonexistent-action', 'act-cv-test-001')).toBe(0)
    })
  })

  describe('count and countByAction', () => {
    it('count returns 0 when no code versions', async () => {
      expect(await repo.count()).toBe(0)
    })

    it('count returns total across all actions and states', async () => {
      await repo.save(makeCVInput({ state: 'EXECUTING' }))
      await repo.save(makeCVInput({ state: 'EXECUTING' }))
      await repo.save(makeCVInput({ state: 'COMPLETING' }))
      expect(await repo.count()).toBe(3)
    })

    it('countByAction returns count for specific action', async () => {
      await repo.save(makeCVInput({ state: 'EXECUTING' }))
      await repo.save(makeCVInput({ state: 'COMPLETING' }))
      expect(await repo.countByAction('act-cv-test-001')).toBe(2)
      expect(await repo.countByAction('nonexistent')).toBe(0)
    })
  })

  describe('UUID format', () => {
    it('saved version.id matches UUID v4 pattern', async () => {
      const cv = await repo.save(makeCVInput())
      expect(cv.id).toMatch(UUID_V4_PATTERN)
    })

    it('each saved version gets a unique UUID', async () => {
      const cv1 = await repo.save(makeCVInput())
      const cv2 = await repo.save(makeCVInput())
      const cv3 = await repo.save(makeCVInput())
      const ids = new Set([cv1.id, cv2.id, cv3.id])
      expect(ids.size).toBe(3)
    })
  })
})
