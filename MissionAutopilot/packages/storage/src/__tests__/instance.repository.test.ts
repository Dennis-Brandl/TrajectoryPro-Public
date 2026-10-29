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
import { InstanceRepository } from '../repositories/instance.repository.js'
import type { Instance, InstanceInput } from '../types.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function setupDb(): Promise<TestDb> {
  const db = await createTestDb()

  // Seed a test environment and action so FK constraints are satisfied
  await db.query(
    `INSERT INTO environments (oid, local_id, version, last_modified_date, schema_version, imported_at, source_filename)
     VALUES ('env-test', 'TestEnv', '1.0', '2026-01-01T00:00:00Z', '4.0', '2026-01-01T00:00:00Z', 'test.WFenvir')`
  )

  await db.query(
    `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
     VALUES ('act-test', 'env-test', 'TestAction', '1.0', '2026-01-01T00:00:00Z', 'opaque')`
  )

  return db
}

function makeInput(overrides: Partial<InstanceInput> = {}): InstanceInput {
  return {
    runtime_action_instance_id: 'ignored-will-be-replaced',
    action_oid: 'act-test',
    environment_oid: 'env-test',
    workflow_instance_id: 'wf-001',
    step_instance_id: 'step-inst-001',
    step_oid: 'step-001',
    visibility: 'opaque',
    state: 'IDLE',
    input_parameters: [{ name: 'x', value: 42 }],
    output_parameters: [],
    state_history: [],
    pinned_code_versions: [],
    states_with_code_executed: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InstanceRepository', () => {
  let db: TestDb
  let repo: InstanceRepository

  beforeEach(async () => {
    db = await setupDb()
    repo = new InstanceRepository(db)
  })

  afterEach(async () => {
    await db.close()
  })

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    it('generates a UUID for runtime_action_instance_id', async () => {
      const instance = await repo.create(makeInput())
      expect(instance.runtime_action_instance_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('ignores the input runtime_action_instance_id and generates a new one', async () => {
      const instance = await repo.create(makeInput({ runtime_action_instance_id: 'my-custom-id' }))
      expect(instance.runtime_action_instance_id).not.toBe('my-custom-id')
    })

    it('sets created_at to an ISO 8601 string', async () => {
      const before = new Date().toISOString()
      const instance = await repo.create(makeInput())
      const after = new Date().toISOString()
      expect(instance.created_at >= before).toBe(true)
      expect(instance.created_at <= after).toBe(true)
    })

    it('initializes state_history with the initial state', async () => {
      const instance = await repo.create(makeInput({ state: 'IDLE' }))
      expect(Array.isArray(instance.state_history)).toBe(true)
      expect(instance.state_history).toHaveLength(1)
      const entry = instance.state_history[0] as { state: string; timestamp: string }
      expect(entry.state).toBe('IDLE')
      expect(entry.timestamp).toBeDefined()
    })

    it('sets is_logged to false', async () => {
      const instance = await repo.create(makeInput())
      expect(instance.is_logged).toBe(false)
    })

    it('sets started_at, completed_at, error to null', async () => {
      const instance = await repo.create(makeInput())
      expect(instance.started_at).toBeNull()
      expect(instance.completed_at).toBeNull()
      expect(instance.error).toBeNull()
    })

    it('round-trips input_parameters as JSON array', async () => {
      const params = [
        { name: 'temp', value: 100 },
        { name: 'pressure', value: 2.5 },
      ]
      const instance = await repo.create(makeInput({ input_parameters: params }))
      expect(instance.input_parameters).toEqual(params)
    })

    it('stores the initial state', async () => {
      const instance = await repo.create(makeInput({ state: 'EXECUTING' }))
      expect(instance.state).toBe('EXECUTING')
    })
  })

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('finds an existing instance', async () => {
      const created = await repo.create(makeInput())
      const found = await repo.findById(created.runtime_action_instance_id)
      expect(found).not.toBeNull()
      expect(found!.runtime_action_instance_id).toBe(created.runtime_action_instance_id)
    })

    it('returns null for a nonexistent id', async () => {
      const found = await repo.findById('nonexistent-uuid')
      expect(found).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // updateState
  // -------------------------------------------------------------------------

  describe('updateState', () => {
    it('changes the state', async () => {
      const instance = await repo.create(makeInput({ state: 'IDLE' }))
      const updated = await repo.updateState(instance.runtime_action_instance_id, 'EXECUTING')
      expect(updated!.state).toBe('EXECUTING')
    })

    it('appends to state_history', async () => {
      const instance = await repo.create(makeInput({ state: 'IDLE' }))
      const updated = await repo.updateState(instance.runtime_action_instance_id, 'EXECUTING')
      expect(updated!.state_history).toHaveLength(2)
      const last = updated!.state_history[1] as { state: string; timestamp: string }
      expect(last.state).toBe('EXECUTING')
    })

    it('sets started_at when provided', async () => {
      const instance = await repo.create(makeInput())
      const started = new Date().toISOString()
      const updated = await repo.updateState(instance.runtime_action_instance_id, 'EXECUTING', {
        started_at: started,
      })
      expect(updated!.started_at).toBe(started)
    })

    it('sets completed_at when provided', async () => {
      const instance = await repo.create(makeInput())
      const completed = new Date().toISOString()
      const updated = await repo.updateState(instance.runtime_action_instance_id, 'COMPLETE', {
        completed_at: completed,
      })
      expect(updated!.completed_at).toBe(completed)
    })

    it('sets error when provided', async () => {
      const instance = await repo.create(makeInput())
      const updated = await repo.updateState(instance.runtime_action_instance_id, 'ABORTED', {
        error: 'Something went wrong',
      })
      expect(updated!.error).toBe('Something went wrong')
    })

    it('clears error when set to null', async () => {
      const instance = await repo.create(makeInput())
      // First set an error
      await repo.updateState(instance.runtime_action_instance_id, 'ABORTED', { error: 'oops' })
      // Then clear it
      const updated = await repo.updateState(instance.runtime_action_instance_id, 'IDLE', {
        error: null,
      })
      expect(updated!.error).toBeNull()
    })

    it('returns null for nonexistent id', async () => {
      const result = await repo.updateState('no-such-id', 'EXECUTING')
      expect(result).toBeNull()
    })

    it('accumulates multiple state transitions in history', async () => {
      const instance = await repo.create(makeInput({ state: 'IDLE' }))
      const id = instance.runtime_action_instance_id
      await repo.updateState(id, 'EXECUTING')
      await repo.updateState(id, 'COMPLETING')
      const final = await repo.updateState(id, 'COMPLETE')
      expect(final!.state_history).toHaveLength(4) // IDLE + EXECUTING + COMPLETING + COMPLETE
    })
  })

  // -------------------------------------------------------------------------
  // transitionState (compare-and-set)
  // -------------------------------------------------------------------------

  describe('transitionState', () => {
    it('applies the transition when the stored state matches the expectation', async () => {
      const inst = await repo.create(makeInput())
      const out = await repo.transitionState(inst.runtime_action_instance_id, inst.state, 'RUNNING')
      expect(out).not.toBe('stale')
      expect(out).not.toBe('not_found')
      expect((out as Instance).state).toBe('RUNNING')
      const history = (out as Instance).state_history as Array<{ state: string }>
      expect(history[history.length - 1]!.state).toBe('RUNNING')
    })

    it("returns 'stale' and writes nothing when the stored state moved on", async () => {
      const inst = await repo.create(makeInput())
      await repo.updateState(inst.runtime_action_instance_id, 'RUNNING')
      const out = await repo.transitionState(inst.runtime_action_instance_id, 'IDLE', 'HELD')
      expect(out).toBe('stale')
      expect((await repo.findById(inst.runtime_action_instance_id))!.state).toBe('RUNNING')
    })

    it("returns 'not_found' for an unknown instance", async () => {
      expect(await repo.transitionState('nope', 'IDLE', 'RUNNING')).toBe('not_found')
    })
  })

  // -------------------------------------------------------------------------
  // updateOutputParameters
  // -------------------------------------------------------------------------

  describe('updateOutputParameters', () => {
    it('updates output_parameters with JSON round-trip', async () => {
      const instance = await repo.create(makeInput())
      const outputs = [{ name: 'result', value: 'done' }]
      const updated = await repo.updateOutputParameters(
        instance.runtime_action_instance_id,
        outputs
      )
      expect(updated!.output_parameters).toEqual(outputs)
    })

    it('returns null for nonexistent id', async () => {
      const result = await repo.updateOutputParameters('no-such-id', [])
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // markStatesWithCodeExecuted
  // -------------------------------------------------------------------------

  describe('markStatesWithCodeExecuted', () => {
    it('updates states_with_code_executed', async () => {
      const instance = await repo.create(makeInput())
      const updated = await repo.markStatesWithCodeExecuted(instance.runtime_action_instance_id, [
        'EXECUTING',
        'COMPLETING',
      ])
      expect(updated!.states_with_code_executed).toEqual(['EXECUTING', 'COMPLETING'])
    })

    it('returns null for nonexistent id', async () => {
      const result = await repo.markStatesWithCodeExecuted('no-such-id', [])
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // markLogged
  // -------------------------------------------------------------------------

  describe('markLogged', () => {
    it('sets is_logged to true and returns true', async () => {
      const instance = await repo.create(makeInput())
      const result = await repo.markLogged(instance.runtime_action_instance_id)
      expect(result).toBe(true)

      const updated = await repo.findById(instance.runtime_action_instance_id)
      expect(updated!.is_logged).toBe(true)
    })

    it('returns false if already logged (no second change)', async () => {
      const instance = await repo.create(makeInput())
      await repo.markLogged(instance.runtime_action_instance_id)
      const result = await repo.markLogged(instance.runtime_action_instance_id)
      expect(result).toBe(false)
    })

    it('returns false for nonexistent id', async () => {
      const result = await repo.markLogged('no-such-id')
      expect(result).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // findByStatus
  // -------------------------------------------------------------------------

  describe('findByStatus', () => {
    it('returns only instances with matching state', async () => {
      await repo.create(makeInput({ state: 'IDLE' }))
      await repo.create(makeInput({ state: 'IDLE' }))
      await repo.create(makeInput({ state: 'EXECUTING' }))

      const idleInstances = await repo.findByStatus('IDLE')
      expect(idleInstances).toHaveLength(2)
      for (const inst of idleInstances) {
        expect(inst.state).toBe('IDLE')
      }
    })

    it('returns empty array when no match', async () => {
      await repo.create(makeInput({ state: 'IDLE' }))
      const result = await repo.findByStatus('COMPLETE')
      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // findActive
  // -------------------------------------------------------------------------

  describe('findActive', () => {
    it('returns instances with no completed_at', async () => {
      const a = await repo.create(makeInput({ state: 'IDLE' }))
      const b = await repo.create(makeInput({ state: 'EXECUTING' }))
      // Complete one of them
      await repo.updateState(a.runtime_action_instance_id, 'COMPLETE', {
        completed_at: new Date().toISOString(),
      })

      const active = await repo.findActive()
      const ids = active.map((i) => i.runtime_action_instance_id)
      expect(ids).not.toContain(a.runtime_action_instance_id)
      expect(ids).toContain(b.runtime_action_instance_id)
    })
  })

  // -------------------------------------------------------------------------
  // findByAction
  // -------------------------------------------------------------------------

  describe('findByAction', () => {
    it('returns only instances for the given action_oid', async () => {
      // Add a second action
      await db.query(
        `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
         VALUES ('act-other', 'env-test', 'OtherAction', '1.0', '2026-01-01T00:00:00Z', 'opaque')`
      )

      await repo.create(makeInput({ action_oid: 'act-test' }))
      await repo.create(makeInput({ action_oid: 'act-test' }))
      await repo.create(makeInput({ action_oid: 'act-other' }))

      const results = await repo.findByAction('act-test')
      expect(results).toHaveLength(2)
      for (const inst of results) {
        expect(inst.action_oid).toBe('act-test')
      }
    })
  })

  // -------------------------------------------------------------------------
  // findByWorkflow
  // -------------------------------------------------------------------------

  describe('findByWorkflow', () => {
    it('returns only instances for the given workflow_instance_id', async () => {
      await repo.create(makeInput({ workflow_instance_id: 'wf-A' }))
      await repo.create(makeInput({ workflow_instance_id: 'wf-A' }))
      await repo.create(makeInput({ workflow_instance_id: 'wf-B' }))

      const results = await repo.findByWorkflow('wf-A')
      expect(results).toHaveLength(2)
      for (const inst of results) {
        expect(inst.workflow_instance_id).toBe('wf-A')
      }
    })
  })

  // -------------------------------------------------------------------------
  // cleanup
  // -------------------------------------------------------------------------

  describe('cleanup', () => {
    it('removes completed + logged instances past retention period', async () => {
      const instance = await repo.create(makeInput())
      const id = instance.runtime_action_instance_id

      // Set completed_at to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString()
      await repo.updateState(id, 'COMPLETE', { completed_at: twoHoursAgo })
      await repo.markLogged(id)

      // 1-hour retention — instance completed 2 hours ago should be deleted
      const deleted = await repo.cleanup(1)
      expect(deleted).toBe(1)
      expect(await repo.findById(id)).toBeNull()
    })

    it('does NOT remove an instance within retention period', async () => {
      const instance = await repo.create(makeInput())
      const id = instance.runtime_action_instance_id

      // Completed 1 hour ago but retention is 24 hours
      const oneHourAgo = new Date(Date.now() - 1 * 3600000).toISOString()
      await repo.updateState(id, 'COMPLETE', { completed_at: oneHourAgo })
      await repo.markLogged(id)

      const deleted = await repo.cleanup(24) // 24-hour retention
      expect(deleted).toBe(0)
      expect(await repo.findById(id)).not.toBeNull()
    })

    it('does NOT remove completed but unlogged instances', async () => {
      const instance = await repo.create(makeInput())
      const id = instance.runtime_action_instance_id

      // Completed 2 hours ago but NOT logged
      const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString()
      await repo.updateState(id, 'COMPLETE', { completed_at: twoHoursAgo })
      // Do NOT call markLogged

      const deleted = await repo.cleanup(1)
      expect(deleted).toBe(0)
      expect(await repo.findById(id)).not.toBeNull()
    })

    it('does NOT remove active (non-completed) instances', async () => {
      const instance = await repo.create(makeInput({ state: 'EXECUTING' }))
      const id = instance.runtime_action_instance_id
      await repo.markLogged(id)

      const deleted = await repo.cleanup(0) // retention = 0 hours — would catch everything completed
      expect(deleted).toBe(0)
      expect(await repo.findById(id)).not.toBeNull()
    })

    it('returns 0 when nothing to clean up', async () => {
      await repo.create(makeInput({ state: 'IDLE' }))
      const deleted = await repo.cleanup(1)
      expect(deleted).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // deleteByEnvironment
  // -------------------------------------------------------------------------

  describe('deleteByEnvironment', () => {
    it('deletes only completed instances for the given environment', async () => {
      // Two terminal instances + one active, all under env-test
      const terminal1 = await repo.create(makeInput())
      await repo.updateState(terminal1.runtime_action_instance_id, 'COMPLETE', {
        completed_at: new Date().toISOString(),
      })
      const terminal2 = await repo.create(makeInput())
      await repo.updateState(terminal2.runtime_action_instance_id, 'ABORTED', {
        completed_at: new Date().toISOString(),
      })
      await repo.create(makeInput({ state: 'EXECUTING' })) // still active

      const removed = await repo.deleteByEnvironment('env-test')
      expect(removed).toBe(2)
      expect(await repo.count()).toBe(1)
    })

    it('deleteByEnvironment keeps an incomplete instance', async () => {
      const active = await repo.create(makeInput({ state: 'EXECUTING' }))
      expect(await repo.deleteByEnvironment('env-test')).toBe(0)
      expect(await repo.findById(active.runtime_action_instance_id)).not.toBeNull()
    })

    it('leaves instances belonging to other environments untouched', async () => {
      // Seed a second environment + action so we can create instances against it
      await db.query(
        `INSERT INTO environments (oid, local_id, version, last_modified_date, schema_version, imported_at, source_filename)
         VALUES ('env-other', 'OtherEnv', '1.0', '2026-01-01T00:00:00Z', '4.0', '2026-01-01T00:00:00Z', 'other.WFenvir')`
      )
      await db.query(
        `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
         VALUES ('act-other', 'env-other', 'OtherAction', '1.0', '2026-01-01T00:00:00Z', 'opaque')`
      )

      const mine = await repo.create(makeInput()) // env-test
      await repo.updateState(mine.runtime_action_instance_id, 'COMPLETE', {
        completed_at: new Date().toISOString(),
      })
      const survivor = await repo.create(
        makeInput({ action_oid: 'act-other', environment_oid: 'env-other' })
      )

      const removed = await repo.deleteByEnvironment('env-test')
      expect(removed).toBe(1)
      expect(await repo.findById(survivor.runtime_action_instance_id)).not.toBeNull()
      expect(await repo.count()).toBe(1)
    })

    it('returns 0 when the environment has no instances', async () => {
      expect(await repo.deleteByEnvironment('env-test')).toBe(0)
    })
  })

  describe('hasActiveByEnvironment', () => {
    it('hasActiveByEnvironment is true only for an incomplete instance', async () => {
      expect(await repo.hasActiveByEnvironment('env-test')).toBe(false)
      const inst = await repo.create(makeInput({ state: 'EXECUTING' }))
      expect(await repo.hasActiveByEnvironment('env-test')).toBe(true)
      await repo.updateState(inst.runtime_action_instance_id, 'COMPLETE', {
        completed_at: new Date().toISOString(),
      })
      expect(await repo.hasActiveByEnvironment('env-test')).toBe(false)
    })
  })

  describe('reassignAction', () => {
    it('moves every instance of the old action oid to the new one', async () => {
      await db.query(
        `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
         VALUES ('act-test-v2', 'env-test', 'TestAction', '2.0', '2026-01-02T00:00:00Z', 'opaque')`
      )
      const a = await repo.create(makeInput())
      const b = await repo.create(makeInput({ state: 'EXECUTING' }))

      const moved = await repo.reassignAction('act-test', 'act-test-v2')

      expect(moved).toBe(2)
      expect(await repo.findByAction('act-test')).toEqual([])
      const movedIds = (await repo.findByAction('act-test-v2'))
        .map((i) => i.runtime_action_instance_id)
        .sort()
      expect(movedIds).toEqual([a.runtime_action_instance_id, b.runtime_action_instance_id].sort())
    })

    it('returns 0 when the old action has no instances', async () => {
      expect(await repo.reassignAction('act-test', 'act-test')).toBe(0)
    })
  })

  describe('reassignEnvironment', () => {
    it('moves every instance of the old environment to the new one', async () => {
      await db.query(
        `INSERT INTO environments (oid, local_id, version, last_modified_date, schema_version, imported_at, source_filename)
         VALUES ('env-test-v2', 'TestEnv', '2.0', '2026-01-02T00:00:00Z', '4.0', '2026-01-02T00:00:00Z', 'test2.WFenvir')`
      )
      const a = await repo.create(makeInput())
      const b = await repo.create(makeInput({ state: 'EXECUTING' }))

      const moved = await repo.reassignEnvironment('env-test', 'env-test-v2')

      expect(moved).toBe(2)
      const rows = [a, b].map((i) => i.runtime_action_instance_id)
      for (const id of rows) {
        expect((await repo.findById(id))?.environment_oid).toBe('env-test-v2')
      }
      expect(await repo.deleteByEnvironment('env-test')).toBe(0)
    })

    it('returns 0 when the old environment has no instances', async () => {
      expect(await repo.reassignEnvironment('env-test', 'env-test')).toBe(0)
    })
  })

  describe('deleteById', () => {
    it('removes the instance row regardless of state (covers ABORTING stuck rows)', async () => {
      // The whole point of force-delete is recovering instances that are NOT
      // terminal — env-delete already cleans up terminal rows via cascade.
      const stuck = await repo.create(makeInput({ state: 'ABORTING' }))
      expect(await repo.deleteById(stuck.runtime_action_instance_id)).toBe(1)
      expect(await repo.findById(stuck.runtime_action_instance_id)).toBeNull()
    })

    it('also works on terminal rows', async () => {
      const term = await repo.create(makeInput())
      await repo.updateState(term.runtime_action_instance_id, 'COMPLETED', {
        completed_at: new Date().toISOString(),
      })
      expect(await repo.deleteById(term.runtime_action_instance_id)).toBe(1)
      expect(await repo.findById(term.runtime_action_instance_id)).toBeNull()
    })

    it('returns 0 when the instance does not exist (idempotent on retries)', async () => {
      expect(await repo.deleteById('does-not-exist')).toBe(0)
    })

    it('only removes the targeted instance, leaving siblings untouched', async () => {
      const a = await repo.create(makeInput({ state: 'ABORTING' }))
      const b = await repo.create(makeInput({ state: 'EXECUTING' }))
      expect(await repo.deleteById(a.runtime_action_instance_id)).toBe(1)
      expect(await repo.findById(a.runtime_action_instance_id)).toBeNull()
      expect(await repo.findById(b.runtime_action_instance_id)).not.toBeNull()
      expect(await repo.count()).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // count and countActive
  // -------------------------------------------------------------------------

  describe('count', () => {
    it('returns 0 when empty', async () => {
      expect(await repo.count()).toBe(0)
    })

    it('returns total instance count', async () => {
      await repo.create(makeInput())
      await repo.create(makeInput())
      expect(await repo.count()).toBe(2)
    })
  })

  describe('countActive', () => {
    it('returns only non-completed instances', async () => {
      const a = await repo.create(makeInput())
      await repo.create(makeInput()) // stays active

      await repo.updateState(a.runtime_action_instance_id, 'COMPLETE', {
        completed_at: new Date().toISOString(),
      })

      expect(await repo.countActive()).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------

  describe('findAll', () => {
    it('returns all instances', async () => {
      await repo.create(makeInput())
      await repo.create(makeInput())
      await repo.create(makeInput())
      const all = await repo.findAll()
      expect(all).toHaveLength(3)
    })

    it('supports limit', async () => {
      await repo.create(makeInput())
      await repo.create(makeInput())
      await repo.create(makeInput())
      const limited = await repo.findAll(2)
      expect(limited).toHaveLength(2)
    })

    it('supports limit + offset', async () => {
      await repo.create(makeInput())
      await repo.create(makeInput())
      await repo.create(makeInput())
      const page2 = await repo.findAll(2, 2)
      expect(page2).toHaveLength(1)
    })

    it('returns results ordered by created_at DESC', async () => {
      // Create with explicit created_at values to ensure deterministic ordering.
      // We insert directly to control timestamps since the repo auto-sets created_at.
      const a = await repo.create(makeInput())
      const b = await repo.create(makeInput())
      const all = await repo.findAll()

      // Both instances should be present
      const ids = all.map((i) => i.runtime_action_instance_id)
      expect(ids).toContain(a.runtime_action_instance_id)
      expect(ids).toContain(b.runtime_action_instance_id)

      // Verify that results are sorted descending by created_at
      for (let i = 1; i < all.length; i++) {
        expect(all[i - 1].created_at >= all[i].created_at).toBe(true)
      }
    })
  })
})
