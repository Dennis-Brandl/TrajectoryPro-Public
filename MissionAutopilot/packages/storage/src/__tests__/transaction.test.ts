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
import { createTestDb, createTestTransactionHelper, type TestDb } from '../testing.js'
import { EnvironmentRepository } from '../repositories/environment.repository.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// The old suite tested two helper methods — `transaction(fn)` (no args passed
// to fn) and `inTransaction(fn)` (passes `{ db }`). Task 3's Postgres port
// (transaction.ts) collapsed this to a single `inTransaction(fn)` that passes
// `{ q, repos }`; there is no bare `.transaction()` anymore. Both describe
// blocks below exercise that one surviving method to preserve the old suite's
// full 8-case coverage: direct-SQL commit/rollback/return-value/multi-op, then
// the same shapes again via `tx.repos`.

describe('createTestTransactionHelper', () => {
  let db: TestDb

  beforeEach(async () => {
    db = await createTestDb()
  })

  afterEach(async () => {
    await db.close()
  })

  describe('inTransaction() — direct SQL via tx.q', () => {
    it('commits changes when fn succeeds', async () => {
      const helper = createTestTransactionHelper(db)

      await helper.inTransaction(async ({ q }) => {
        await q.query(`UPDATE settings SET value = '9999' WHERE key = 'log_max_size'`)
      })

      const res = await db.query(`SELECT value FROM settings WHERE key = 'log_max_size'`)
      expect((res.rows[0] as { value: string }).value).toBe('9999')
    })

    it('rolls back all changes if fn throws', async () => {
      const helper = createTestTransactionHelper(db)

      await expect(
        helper.inTransaction(async ({ q }) => {
          await q.query(`UPDATE settings SET value = '1234' WHERE key = 'log_max_size'`)
          await q.query(`UPDATE settings SET value = '5678' WHERE key = 'python_pool_size'`)
          throw new Error('intentional failure')
        })
      ).rejects.toThrow('intentional failure')

      // Both changes should be rolled back
      const maxSize = await db.query(`SELECT value FROM settings WHERE key = 'log_max_size'`)
      const poolSize = await db.query(`SELECT value FROM settings WHERE key = 'python_pool_size'`)

      expect((maxSize.rows[0] as { value: string }).value).toBe('10000') // default unchanged
      expect((poolSize.rows[0] as { value: string }).value).toBe('4') // default unchanged
    })

    it('returns the value returned by fn', async () => {
      const helper = createTestTransactionHelper(db)
      const result = await helper.inTransaction(async () => 42)
      expect(result).toBe(42)
    })

    it('supports multiple operations in one transaction', async () => {
      const helper = createTestTransactionHelper(db)

      await helper.inTransaction(async ({ q }) => {
        await q.query(`UPDATE settings SET value = '500' WHERE key = 'log_max_size'`)
        await q.query(`UPDATE settings SET value = '2' WHERE key = 'python_pool_size'`)
        await q.query(`UPDATE settings SET value = '5000' WHERE key = 'execution_timeout_ms'`)
      })

      const res = await db.query(`SELECT key, value FROM settings ORDER BY key`)
      const map = Object.fromEntries(
        (res.rows as { key: string; value: string }[]).map((s) => [s.key, s.value])
      )

      expect(map['log_max_size']).toBe('500')
      expect(map['python_pool_size']).toBe('2')
      expect(map['execution_timeout_ms']).toBe('5000')
    })
  })

  describe('inTransaction() — via tx.repos', () => {
    it('passes q and repos to the callback', async () => {
      const helper = createTestTransactionHelper(db)
      let receivedQ: unknown
      let receivedRepos: unknown

      await helper.inTransaction(async ({ q, repos }) => {
        receivedQ = q
        receivedRepos = repos
      })

      expect(receivedQ).toBeDefined()
      expect(typeof (receivedQ as { query: unknown }).query).toBe('function')
      expect(receivedRepos).toBeDefined()
      expect((receivedRepos as { environments: unknown }).environments).toBeInstanceOf(
        EnvironmentRepository
      )
    })

    it('commits changes made via tx.repos (not just tx.q)', async () => {
      const helper = createTestTransactionHelper(db)

      await helper.inTransaction(async ({ repos }) => {
        await repos.environments.create({
          oid: 'env-tx-1',
          local_id: 'TxEnv',
          version: '1.0.0',
          last_modified_date: '2026-01-01T00:00:00Z',
          schema_version: '4.0',
          action_property_specifications: [],
          value_property_specifications: [],
          resource_property_specifications: [],
          source_filename: 'tx.WFenvir',
        })
      })

      const repo = new EnvironmentRepository(db)
      const found = await repo.findByOid('env-tx-1')
      expect(found).not.toBeNull()
      expect(found!.local_id).toBe('TxEnv')
    })

    it('insert inside inTransaction that throws leaves the row absent (rollback)', async () => {
      const helper = createTestTransactionHelper(db)

      await expect(
        helper.inTransaction(async ({ repos }) => {
          await repos.environments.create({
            oid: 'env-tx-rollback',
            local_id: 'RollbackEnv',
            version: '1.0.0',
            last_modified_date: '2026-01-01T00:00:00Z',
            schema_version: '4.0',
            action_property_specifications: [],
            value_property_specifications: [],
            resource_property_specifications: [],
            source_filename: 'rollback.WFenvir',
          })
          throw new Error('rollback me')
        })
      ).rejects.toThrow('rollback me')

      const repo = new EnvironmentRepository(db)
      const found = await repo.findByOid('env-tx-rollback')
      expect(found).toBeNull()
    })

    it('returns the value returned by fn', async () => {
      const helper = createTestTransactionHelper(db)
      const result = await helper.inTransaction(async () => 'hello')
      expect(result).toBe('hello')
    })
  })
})
