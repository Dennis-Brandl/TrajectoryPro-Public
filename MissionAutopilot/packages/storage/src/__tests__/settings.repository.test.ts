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
import { SettingsRepository } from '../repositories/settings.repository.js'
import { NotFoundError, ValidationError } from '../errors.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsRepository', () => {
  let db: TestDb
  let repo: SettingsRepository

  beforeEach(async () => {
    // createTestDb() runs the single collapsed 001-initial-schema migration,
    // which seeds all 5 settings including api_key (formerly a separate
    // 004-api-key-setting migration in the old sqlite schema — see Task 3).
    db = await createTestDb()
    repo = new SettingsRepository(db)
  })

  afterEach(async () => {
    await db.close()
  })

  // -------------------------------------------------------------------------
  // getAll
  // -------------------------------------------------------------------------

  describe('getAll', () => {
    it('returns all 5 default settings', async () => {
      const settings = await repo.getAll()
      expect(settings).toHaveLength(5)
    })

    it('returns settings ordered by key ASC', async () => {
      const settings = await repo.getAll()
      const keys = settings.map((s) => s.key)
      expect(keys).toEqual([...keys].sort())
    })

    it('includes all expected keys', async () => {
      const settings = await repo.getAll()
      const keys = settings.map((s) => s.key)
      expect(keys).toContain('log_max_size')
      expect(keys).toContain('python_pool_size')
      expect(keys).toContain('execution_timeout_ms')
      expect(keys).toContain('instance_retention_hours')
      expect(keys).toContain('api_key')
    })
  })

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe('get', () => {
    it('returns a specific setting by key', async () => {
      const setting = await repo.get('log_max_size')
      expect(setting).not.toBeNull()
      expect(setting!.key).toBe('log_max_size')
      expect(setting!.value).toBe('10000')
      expect(setting!.default_value).toBe('10000')
    })

    it('returns null for an unknown key', async () => {
      const setting = await repo.get('nonexistent_key')
      expect(setting).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getValue
  // -------------------------------------------------------------------------

  describe('getValue', () => {
    it('returns just the value string', async () => {
      const value = await repo.getValue('python_pool_size')
      expect(value).toBe('4')
    })

    it('returns null for unknown key', async () => {
      const value = await repo.getValue('no_such_key')
      expect(value).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getNumericValue
  // -------------------------------------------------------------------------

  describe('getNumericValue', () => {
    it('returns a parsed number', async () => {
      const value = await repo.getNumericValue('execution_timeout_ms')
      expect(value).toBe(60000)
      expect(typeof value).toBe('number')
    })

    it('returns null for unknown key', async () => {
      const value = await repo.getNumericValue('no_such_key')
      expect(value).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('changes the value and returns the updated setting', async () => {
      const updated = await repo.update('log_max_size', '5000')
      expect(updated.value).toBe('5000')
      expect(updated.key).toBe('log_max_size')
    })

    it('persists the change (subsequent get returns updated value)', async () => {
      await repo.update('log_max_size', '7500')
      const setting = await repo.get('log_max_size')
      expect(setting!.value).toBe('7500')
    })

    it('does not change default_value', async () => {
      await repo.update('log_max_size', '5000')
      const setting = await repo.get('log_max_size')
      expect(setting!.default_value).toBe('10000')
    })

    // --- python_pool_size validation ---
    describe('python_pool_size validation', () => {
      it('rejects 0', async () => {
        await expect(repo.update('python_pool_size', '0')).rejects.toThrow(ValidationError)
      })

      it('rejects -1', async () => {
        await expect(repo.update('python_pool_size', '-1')).rejects.toThrow(ValidationError)
      })

      it('rejects non-numeric value', async () => {
        await expect(repo.update('python_pool_size', 'abc')).rejects.toThrow(ValidationError)
      })

      it('rejects fractional number', async () => {
        await expect(repo.update('python_pool_size', '1.5')).rejects.toThrow(ValidationError)
      })

      it('accepts 1', async () => {
        await expect(repo.update('python_pool_size', '1')).resolves.not.toThrow()
        expect(await repo.getValue('python_pool_size')).toBe('1')
      })

      it('accepts 100', async () => {
        await expect(repo.update('python_pool_size', '100')).resolves.not.toThrow()
        expect(await repo.getValue('python_pool_size')).toBe('100')
      })
    })

    // --- execution_timeout_ms validation ---
    describe('execution_timeout_ms validation', () => {
      it('rejects 999', async () => {
        await expect(repo.update('execution_timeout_ms', '999')).rejects.toThrow(ValidationError)
      })

      it('accepts 0 (disabled)', async () => {
        await expect(repo.update('execution_timeout_ms', '0')).resolves.not.toThrow()
        expect(await repo.getValue('execution_timeout_ms')).toBe('0')
      })

      it('rejects fractional', async () => {
        await expect(repo.update('execution_timeout_ms', '1000.5')).rejects.toThrow(ValidationError)
      })

      it('accepts 1000', async () => {
        await expect(repo.update('execution_timeout_ms', '1000')).resolves.not.toThrow()
        expect(await repo.getValue('execution_timeout_ms')).toBe('1000')
      })

      it('accepts 60000', async () => {
        await expect(repo.update('execution_timeout_ms', '60000')).resolves.not.toThrow()
      })
    })

    // --- instance_retention_hours validation ---
    describe('instance_retention_hours validation', () => {
      it('accepts 0 (disabled)', async () => {
        await expect(repo.update('instance_retention_hours', '0')).resolves.not.toThrow()
        expect(await repo.getValue('instance_retention_hours')).toBe('0')
      })

      it('rejects -1', async () => {
        await expect(repo.update('instance_retention_hours', '-1')).rejects.toThrow(ValidationError)
      })

      it('accepts 1', async () => {
        await expect(repo.update('instance_retention_hours', '1')).resolves.not.toThrow()
      })

      it('accepts 0.5 (fractional hours)', async () => {
        await expect(repo.update('instance_retention_hours', '0.5')).resolves.not.toThrow()
        expect(await repo.getValue('instance_retention_hours')).toBe('0.5')
      })
    })

    // --- log_max_size validation ---
    describe('log_max_size validation', () => {
      it('rejects 0', async () => {
        await expect(repo.update('log_max_size', '0')).rejects.toThrow(ValidationError)
      })

      it('rejects -1', async () => {
        await expect(repo.update('log_max_size', '-1')).rejects.toThrow(ValidationError)
      })

      it('rejects fractional', async () => {
        await expect(repo.update('log_max_size', '100.5')).rejects.toThrow(ValidationError)
      })

      it('accepts 1', async () => {
        await expect(repo.update('log_max_size', '1')).resolves.not.toThrow()
      })

      it('accepts 100000', async () => {
        await expect(repo.update('log_max_size', '100000')).resolves.not.toThrow()
      })
    })

    // --- unknown key ---
    describe('unknown key', () => {
      it('throws NotFoundError', async () => {
        await expect(repo.update('no_such_key', '42')).rejects.toThrow(NotFoundError)
      })
    })
  })

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe('reset', () => {
    it('resets value to default_value', async () => {
      await repo.update('log_max_size', '5000')
      const reset = await repo.reset('log_max_size')
      expect(reset.value).toBe('10000') // back to default
    })

    it('throws NotFoundError for unknown key', async () => {
      await expect(repo.reset('no_such_key')).rejects.toThrow(NotFoundError)
    })
  })

  // -------------------------------------------------------------------------
  // resetAll
  // -------------------------------------------------------------------------

  describe('resetAll', () => {
    it('resets all 5 settings to their default values', async () => {
      // Change a few settings
      await repo.update('log_max_size', '5000')
      await repo.update('python_pool_size', '8')

      const allReset = await repo.resetAll()
      expect(allReset).toHaveLength(5)

      for (const setting of allReset) {
        expect(setting.value).toBe(setting.default_value)
      }
    })
  })

  // -------------------------------------------------------------------------
  // api_key (string setting; empty = open access)
  // -------------------------------------------------------------------------

  describe('api_key', () => {
    it('is seeded empty by default', async () => {
      expect(await repo.getValue('api_key')).toBe('')
    })

    it('can be set to a secret and read back', async () => {
      await repo.update('api_key', 'super-secret-key')
      expect(await repo.getValue('api_key')).toBe('super-secret-key')
    })

    it('can be cleared back to empty (open access)', async () => {
      await repo.update('api_key', 'k')
      await repo.update('api_key', '')
      expect(await repo.getValue('api_key')).toBe('')
    })

    it('is a string-typed setting', async () => {
      const setting = await repo.get('api_key')
      expect(setting).not.toBeNull()
      expect(setting!.value_type).toBe('string')
    })
  })
})
