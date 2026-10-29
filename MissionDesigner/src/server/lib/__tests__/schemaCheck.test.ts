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

// @vitest-environment node

import { describe, it, expect, beforeAll } from 'vitest'
import { bootstrapDatabase, checkDatabaseSchema, EXPECTED_SCHEMA, rawQuery } from '../db'

describe('checkDatabaseSchema', () => {
  beforeAll(async () => {
    await bootstrapDatabase()
  })

  it('does not flag _trigger_audit (or any _-prefixed table) as unexpected_table', async () => {
    const results = await checkDatabaseSchema(false)
    const unexpected = results.filter((r) => r.status === 'unexpected_table').map((r) => r.table)
    for (const t of unexpected) {
      expect(t.startsWith('_')).toBe(false)
    }
  })

  it('still reports every EXPECTED_SCHEMA table as ok', async () => {
    const results = await checkDatabaseSchema(false)
    for (const name of Object.keys(EXPECTED_SCHEMA)) {
      const r = results.find((x) => x.table === name)
      expect(r, `expected row for ${name}`).toBeDefined()
      expect(r!.status).toBe('ok')
    }
  })

  it('boot adds specification."typeName" to a table that lacks it', async () => {
    await rawQuery('ALTER TABLE "specification" DROP COLUMN IF EXISTS "typeName"')
    await bootstrapDatabase()
    const cols = await rawQuery<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'specification' AND column_name = 'typeName'`,
    )
    expect(cols).toEqual([{ column_name: 'typeName', data_type: 'text', is_nullable: 'YES' }])
  })
})
