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

import type { Queryable } from '../database.js'
import type { Setting, SettingRow } from '../types.js'
import { NotFoundError, ValidationError } from '../errors.js'

const KNOWN_KEYS = new Set([
  'python_pool_size',
  'execution_timeout_ms',
  'instance_retention_hours',
  'log_max_size',
  'api_key',
])

function validateValue(key: string, value: string): void {
  const num = Number(value)

  switch (key) {
    case 'python_pool_size':
      if (!Number.isInteger(num) || num < 1) {
        throw new ValidationError(key, 'must be an integer >= 1')
      }
      break

    case 'execution_timeout_ms':
      if (!Number.isInteger(num) || (num !== 0 && num < 1000)) {
        throw new ValidationError(key, 'must be 0 (disabled) or an integer >= 1000')
      }
      break

    case 'instance_retention_hours':
      if (isNaN(num) || num < 0) {
        throw new ValidationError(key, 'must be zero (disabled) or a positive number')
      }
      break

    case 'log_max_size':
      if (!Number.isInteger(num) || num < 1) {
        throw new ValidationError(key, 'must be a positive integer')
      }
      break

    case 'api_key':
      // Any string is accepted; empty string means "open access" (no auth required).
      break

    default:
      throw new NotFoundError('Setting', key)
  }
}

export class SettingsRepository {
  constructor(private readonly q: Queryable) {}

  private fromRow(row: SettingRow): Setting {
    return {
      key: row.key,
      value: row.value,
      default_value: row.default_value,
      description: row.description,
      value_type: row.value_type,
    }
  }

  async get(key: string): Promise<Setting | null> {
    const res = await this.q.query('SELECT * FROM settings WHERE key = $1', [key])
    const row = res.rows[0] as SettingRow | undefined
    return row ? this.fromRow(row) : null
  }

  async getAll(): Promise<Setting[]> {
    const res = await this.q.query('SELECT * FROM settings ORDER BY key ASC')
    return (res.rows as SettingRow[]).map((r) => this.fromRow(r))
  }

  async getValue(key: string): Promise<string | null> {
    const res = await this.q.query('SELECT * FROM settings WHERE key = $1', [key])
    const row = res.rows[0] as SettingRow | undefined
    return row ? row.value : null
  }

  async getNumericValue(key: string): Promise<number | null> {
    const res = await this.q.query('SELECT * FROM settings WHERE key = $1', [key])
    const row = res.rows[0] as SettingRow | undefined
    if (!row) return null
    const num = Number(row.value)
    return isNaN(num) ? null : num
  }

  async update(key: string, value: string): Promise<Setting> {
    // Check if key exists (also handles unknown keys via validation)
    if (!KNOWN_KEYS.has(key)) {
      throw new NotFoundError('Setting', key)
    }

    // Validate the value for known keys
    validateValue(key, value)

    const res = await this.q.query('UPDATE settings SET value = $1 WHERE key = $2', [value, key])
    if ((res.rowCount ?? 0) === 0) {
      throw new NotFoundError('Setting', key)
    }

    const found = await this.q.query('SELECT * FROM settings WHERE key = $1', [key])
    return this.fromRow(found.rows[0] as SettingRow)
  }

  async reset(key: string): Promise<Setting> {
    const existingRes = await this.q.query('SELECT * FROM settings WHERE key = $1', [key])
    const existing = existingRes.rows[0] as SettingRow | undefined
    if (!existing) {
      throw new NotFoundError('Setting', key)
    }

    await this.q.query('UPDATE settings SET value = default_value WHERE key = $1', [key])
    const found = await this.q.query('SELECT * FROM settings WHERE key = $1', [key])
    return this.fromRow(found.rows[0] as SettingRow)
  }

  async resetAll(): Promise<Setting[]> {
    await this.q.query('UPDATE settings SET value = default_value')
    const res = await this.q.query('SELECT * FROM settings ORDER BY key ASC')
    return (res.rows as SettingRow[]).map((r) => this.fromRow(r))
  }
}
