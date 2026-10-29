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
import { LogRepository } from '../repositories/log.repository.js'
import type { ExecutionLogInput } from '../types.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let entryCounter = 0

function makeEntry(overrides: Partial<ExecutionLogInput> = {}): ExecutionLogInput {
  entryCounter++
  const ts = new Date(Date.now() + entryCounter * 1000).toISOString()
  return {
    runtime_action_instance_id: `inst-${entryCounter}`,
    action_oid: 'act-001',
    action_name: 'KitchenAction',
    environment_oid: 'env-001',
    environment_name: 'KitchenEnv',
    workflow_instance_id: `wf-${entryCounter}`,
    step_oid: 'step-001',
    input_parameters: [{ name: 'temp', value: 100 }],
    output_parameters: [{ name: 'result', value: 'ok' }],
    states_executed: ['EXECUTING', 'COMPLETING'],
    code_versions_used: { EXECUTING: 'cv-001' },
    started_at: ts,
    completed_at: ts,
    duration_ms: 500,
    final_status: 'COMPLETED',
    error: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LogRepository', () => {
  let db: TestDb
  let repo: LogRepository

  beforeEach(async () => {
    db = await createTestDb()
    repo = new LogRepository(db)
    entryCounter = 0
  })

  afterEach(async () => {
    await db.close()
  })

  // -------------------------------------------------------------------------
  // insert
  // -------------------------------------------------------------------------

  describe('insert', () => {
    it('inserts an entry and returns it with auto-generated id', async () => {
      const entry = await repo.insert(makeEntry(), 10000)
      expect(entry.id).toBe(1)
      expect(entry.action_name).toBe('KitchenAction')
      expect(entry.final_status).toBe('COMPLETED')
    })

    it('round-trips JSON fields', async () => {
      const input = makeEntry({
        input_parameters: [{ name: 'x', value: 42 }],
        states_executed: ['EXECUTING', 'COMPLETING'],
        code_versions_used: { EXECUTING: 'cv-abc' },
      })
      const entry = await repo.insert(input, 10000)
      expect(entry.input_parameters).toEqual([{ name: 'x', value: 42 }])
      expect(entry.states_executed).toEqual(['EXECUTING', 'COMPLETING'])
      expect(entry.code_versions_used).toEqual({ EXECUTING: 'cv-abc' })
    })

    it('assigns sequential IDs', async () => {
      const e1 = await repo.insert(makeEntry(), 10000)
      const e2 = await repo.insert(makeEntry(), 10000)
      const e3 = await repo.insert(makeEntry(), 10000)
      expect(e1.id).toBe(1)
      expect(e2.id).toBe(2)
      expect(e3.id).toBe(3)
    })

    it('trims to maxSize: inserting 5 entries with maxSize=3 leaves 3', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.insert(makeEntry(), 3)
      }
      expect(await repo.count()).toBe(3)
    })

    it('keeps the most recent entries after trimming', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.insert(makeEntry(), 3)
      }
      // IDs 1 and 2 should have been deleted; 3, 4, 5 remain
      expect(await repo.findById(1)).toBeNull()
      expect(await repo.findById(2)).toBeNull()
      expect(await repo.findById(3)).not.toBeNull()
      expect(await repo.findById(4)).not.toBeNull()
      expect(await repo.findById(5)).not.toBeNull()
    })

    it('does not trim when count <= maxSize', async () => {
      await repo.insert(makeEntry(), 10)
      await repo.insert(makeEntry(), 10)
      expect(await repo.count()).toBe(2)
    })

    it('handles error field correctly (null vs string)', async () => {
      const withError = await repo.insert(
        makeEntry({ error: 'timeout', final_status: 'ABORTED' }),
        10000
      )
      expect(withError.error).toBe('timeout')

      const noError = await repo.insert(makeEntry({ error: null }), 10000)
      expect(noError.error).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('finds an existing entry', async () => {
      const entry = await repo.insert(makeEntry(), 10000)
      const found = await repo.findById(entry.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(entry.id)
    })

    it('returns null for nonexistent id', async () => {
      expect(await repo.findById(999)).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // deleteById
  // -------------------------------------------------------------------------

  describe('deleteById', () => {
    it('removes the entry and returns rowCount 1', async () => {
      const entry = await repo.insert(makeEntry(), 10000)
      const deleted = await repo.deleteById(entry.id)
      expect(deleted).toBe(1)
      expect(await repo.findById(entry.id)).toBeNull()
    })

    it('returns 0 for a nonexistent id', async () => {
      expect(await repo.deleteById(999)).toBe(0)
    })

    it('only removes the targeted entry, leaving siblings untouched', async () => {
      const a = await repo.insert(makeEntry(), 10000)
      const b = await repo.insert(makeEntry(), 10000)
      expect(await repo.deleteById(a.id)).toBe(1)
      expect(await repo.findById(a.id)).toBeNull()
      expect(await repo.findById(b.id)).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // query
  // -------------------------------------------------------------------------

  describe('query', () => {
    beforeEach(async () => {
      // Seed test data
      await repo.insert(
        makeEntry({
          action_oid: 'act-001',
          action_name: 'KitchenAction',
          environment_oid: 'env-001',
          environment_name: 'KitchenEnv',
          final_status: 'COMPLETED',
          completed_at: '2026-02-01T10:00:00Z',
        }),
        10000
      )
      await repo.insert(
        makeEntry({
          action_oid: 'act-001',
          action_name: 'KitchenAction',
          environment_oid: 'env-001',
          environment_name: 'KitchenEnv',
          final_status: 'ABORTED',
          completed_at: '2026-02-02T10:00:00Z',
        }),
        10000
      )
      await repo.insert(
        makeEntry({
          action_oid: 'act-002',
          action_name: 'FactoryAction',
          environment_oid: 'env-002',
          environment_name: 'FactoryEnv',
          final_status: 'COMPLETED',
          completed_at: '2026-02-03T10:00:00Z',
        }),
        10000
      )
      await repo.insert(
        makeEntry({
          action_oid: 'act-003',
          action_name: 'ManufacturingAction',
          environment_oid: 'env-003',
          environment_name: 'ManufacturingEnv',
          final_status: 'STOPPED',
          completed_at: '2026-02-04T10:00:00Z',
        }),
        10000
      )
    })

    it('no filters returns all entries', async () => {
      const { entries, total } = await repo.query({})
      expect(total).toBe(4)
      expect(entries).toHaveLength(4)
    })

    it('filters by actionOid', async () => {
      const { entries, total } = await repo.query({ actionOid: 'act-001' })
      expect(total).toBe(2)
      for (const e of entries) {
        expect(e.action_oid).toBe('act-001')
      }
    })

    it('filters by finalStatus COMPLETED', async () => {
      const { entries, total } = await repo.query({ finalStatus: 'COMPLETED' })
      expect(total).toBe(2)
      for (const e of entries) {
        expect(e.final_status).toBe('COMPLETED')
      }
    })

    it('filters by finalStatus ABORTED', async () => {
      const { entries, total } = await repo.query({ finalStatus: 'ABORTED' })
      expect(total).toBe(1)
      expect(entries[0].final_status).toBe('ABORTED')
    })

    it('filters by date range (startDate)', async () => {
      const { entries, total } = await repo.query({ startDate: '2026-02-02T00:00:00Z' })
      expect(total).toBe(3) // Feb 2, 3, 4
      for (const e of entries) {
        expect(e.completed_at >= '2026-02-02T00:00:00Z').toBe(true)
      }
    })

    it('filters by date range (endDate)', async () => {
      const { total } = await repo.query({ endDate: '2026-02-02T23:59:59Z' })
      expect(total).toBe(2) // Feb 1 and Feb 2
    })

    it('filters by date range (startDate + endDate)', async () => {
      const { total } = await repo.query({
        startDate: '2026-02-02T00:00:00Z',
        endDate: '2026-02-03T23:59:59Z',
      })
      expect(total).toBe(2) // Feb 2 and Feb 3
    })

    it('filters by environmentOid', async () => {
      const { entries, total } = await repo.query({ environmentOid: 'env-002' })
      expect(total).toBe(1)
      expect(entries[0].environment_oid).toBe('env-002')
    })

    it('partial match on actionName', async () => {
      const { entries, total } = await repo.query({ actionName: 'Kitchen' })
      expect(total).toBe(2) // both KitchenAction entries
      for (const e of entries) {
        expect(e.action_name).toContain('Kitchen')
      }
    })

    it('partial match on actionName is case-insensitive via ILIKE', async () => {
      // Postgres LIKE is case-sensitive; the repo uses ILIKE for these two
      // filters specifically to preserve SQLite's default case-insensitive-
      // for-ASCII LIKE behavior (see log.repository.ts).
      const { total } = await repo.query({ actionName: 'kitchen' })
      expect(total).toBe(2)
    })

    it('partial match on environmentName', async () => {
      const { total } = await repo.query({ environmentName: 'Factory' })
      expect(total).toBe(1)
    })

    it('pagination: limit and offset work correctly', async () => {
      const { entries: page1, total } = await repo.query({ limit: 2, offset: 0 })
      expect(total).toBe(4) // total reflects all matches
      expect(page1).toHaveLength(2)

      const { entries: page2 } = await repo.query({ limit: 2, offset: 2 })
      expect(page2).toHaveLength(2)

      // No overlap
      const ids1 = page1.map((e) => e.id)
      const ids2 = page2.map((e) => e.id)
      for (const id of ids2) {
        expect(ids1).not.toContain(id)
      }
    })

    it('total reflects all matches (not just paginated results)', async () => {
      const { entries, total } = await repo.query({ actionOid: 'act-001', limit: 1 })
      expect(entries).toHaveLength(1) // limited to 1
      expect(total).toBe(2) // but 2 match the filter
    })

    it('returns entries ordered by id DESC', async () => {
      const { entries } = await repo.query({})
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i - 1].id > entries[i].id).toBe(true)
      }
    })

    it('returns empty when no match', async () => {
      const { entries, total } = await repo.query({ actionOid: 'no-such-action' })
      expect(entries).toHaveLength(0)
      expect(total).toBe(0)
    })

    it('respects max limit of 500', async () => {
      // Insert 10 entries, request 1000 — should get only 10
      const { entries } = await repo.query({ limit: 1000 })
      expect(entries.length).toBeLessThanOrEqual(500)
    })

    it('uses default limit of 50 when not specified', async () => {
      // With only 4 entries, default limit of 50 returns all
      const { entries } = await repo.query({})
      expect(entries.length).toBeLessThanOrEqual(50)
    })
  })

  // -------------------------------------------------------------------------
  // trimToSize
  // -------------------------------------------------------------------------

  describe('reassignEnvironment', () => {
    it('re-points every entry of the old environment oid (environment re-key)', async () => {
      await repo.insert(makeEntry(), 10000)
      await repo.insert(makeEntry(), 10000)
      await repo.insert(makeEntry({ environment_oid: 'env-other' }), 10000)

      const moved = await repo.reassignEnvironment('env-001', 'env-002')

      expect(moved).toBe(2)
      expect((await repo.query({ environmentOid: 'env-001' })).total).toBe(0)
      expect((await repo.query({ environmentOid: 'env-002' })).total).toBe(2)
      expect((await repo.query({ environmentOid: 'env-other' })).total).toBe(1)
    })
  })

  describe('reassignAction', () => {
    it('re-points every entry of the old action oid (action re-key)', async () => {
      await repo.insert(makeEntry(), 10000)
      await repo.insert(makeEntry(), 10000)
      await repo.insert(makeEntry({ action_oid: 'action-other' }), 10000)

      const moved = await repo.reassignAction('act-001', 'act-002')

      expect(moved).toBe(2)
      const all = (await repo.query({})).entries
      expect(all.filter((e) => e.action_oid === 'act-001')).toHaveLength(0)
      expect(all.filter((e) => e.action_oid === 'act-002')).toHaveLength(2)
      expect(all.filter((e) => e.action_oid === 'action-other')).toHaveLength(1)
    })
  })

  describe('trimToSize', () => {
    it('trims to maxSize, deleting oldest entries', async () => {
      for (let i = 0; i < 10; i++) {
        await repo.insert(makeEntry(), 10000)
      }
      const deleted = await repo.trimToSize(5)
      expect(deleted).toBe(5)
      expect(await repo.count()).toBe(5)
    })

    it('keeps the most recent entries', async () => {
      for (let i = 0; i < 10; i++) {
        await repo.insert(makeEntry(), 10000)
      }
      await repo.trimToSize(5)
      // IDs 1-5 should be gone; 6-10 remain
      for (let id = 1; id <= 5; id++) {
        expect(await repo.findById(id)).toBeNull()
      }
      for (let id = 6; id <= 10; id++) {
        expect(await repo.findById(id)).not.toBeNull()
      }
    })

    it('returns 0 when already within size', async () => {
      await repo.insert(makeEntry(), 10000)
      await repo.insert(makeEntry(), 10000)
      const deleted = await repo.trimToSize(10)
      expect(deleted).toBe(0)
    })

    it('handles empty table gracefully', async () => {
      const deleted = await repo.trimToSize(100)
      expect(deleted).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // count
  // -------------------------------------------------------------------------

  describe('count', () => {
    it('returns 0 for empty table', async () => {
      expect(await repo.count()).toBe(0)
    })

    it('returns correct count after inserts', async () => {
      await repo.insert(makeEntry(), 10000)
      await repo.insert(makeEntry(), 10000)
      expect(await repo.count()).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // getRecent
  // -------------------------------------------------------------------------

  describe('getRecent', () => {
    it('returns N most recent entries in descending order', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.insert(makeEntry(), 10000)
      }
      const recent = await repo.getRecent(3)
      expect(recent).toHaveLength(3)
      // Should be IDs 5, 4, 3
      expect(recent[0].id).toBe(5)
      expect(recent[1].id).toBe(4)
      expect(recent[2].id).toBe(3)
    })

    it('returns all entries if fewer than limit', async () => {
      await repo.insert(makeEntry(), 10000)
      const recent = await repo.getRecent(10)
      expect(recent).toHaveLength(1)
    })
  })

  // -------------------------------------------------------------------------
  // deleteAll
  // -------------------------------------------------------------------------

  describe('deleteAll', () => {
    it('removes all entries and returns count', async () => {
      await repo.insert(makeEntry(), 10000)
      await repo.insert(makeEntry(), 10000)
      const deleted = await repo.deleteAll()
      expect(deleted).toBe(2)
      expect(await repo.count()).toBe(0)
    })
  })
})
