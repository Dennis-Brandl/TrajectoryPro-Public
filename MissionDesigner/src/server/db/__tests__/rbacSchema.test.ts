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
import { rawQuery, bootstrapDatabase, checkDatabaseSchema } from '../../lib/db'

beforeAll(async () => {
  await bootstrapDatabase()
})

const NEW_TABLES = ['team', 'user_team', 'role', 'role_right', 'user_team_role', 'app_setting']

describe('RBAC schema (Phase 1, additive)', () => {
  it('creates the six new tables', async () => {
    for (const t of NEW_TABLES) {
      const rows = await rawQuery(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
        [t],
      )
      expect(rows.length, `${t} should exist`).toBeGreaterThan(0)
    }
  })

  it('adds teamId + createdByUserId to library and effectiveFrom to specification', async () => {
    const libCols = await rawQuery<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'library'`,
    )
    const lib = libCols.map((x) => x.column_name)
    expect(lib).toContain('teamId')
    expect(lib).toContain('createdByUserId')
    const specCols = await rawQuery<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'specification'`,
    )
    const spec = specCols.map((x) => x.column_name)
    expect(spec).toContain('effectiveFrom')
  })

  it('reports a clean schema (no missing/unexpected tables or columns)', async () => {
    const bad = (await checkDatabaseSchema(false)).filter((r) => r.status !== 'ok')
    expect(bad, JSON.stringify(bad, null, 2)).toHaveLength(0)
  })
})
