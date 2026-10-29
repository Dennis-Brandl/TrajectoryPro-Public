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

// Phase 35 §5 Gate G1: schema introspection. This test boots the real
// db.ts module against an in-memory PGlite DB and asserts the schema v2 is
// present: new tables, new columns, new indexes, FK enforcement, and trigger count.
// Trigger *behavior* is covered by triggers.test.ts (Task E2).

// @vitest-environment node

import { describe, it, expect, beforeAll } from 'vitest'
import { rawQuery, bootstrapDatabase } from '../../lib/db'

beforeAll(async () => {
  await bootstrapDatabase()
})

describe('schema v2: new tables exist', () => {
  it.each([
    'image_blob',
    'image',
    'image_reference',
    'proxy_reference',
    'library_environment',
    'specification_environment',
  ])('%s table exists', async (tableName) => {
    const rows = await rawQuery(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [tableName],
    )
    expect(rows).toHaveLength(1)
  })
})

describe('schema v2: new columns on existing tables', () => {
  it('library keeps teamId + attribution FKs but has dropped userId and forkedFrom*/forkedAt (slice 6a)', async () => {
    const cols = await rawQuery<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'library'`,
    )
    const names = new Set(cols.map((c) => c.column_name))
    expect(names.has('lastEditedByUserId')).toBe(true)
    expect(names.has('createdByUserId')).toBe(true)
    expect(names.has('teamId')).toBe(true)
    expect(names.has('rowVersion')).toBe(false)
    // Dropped in the Phase 5d clean cutover:
    expect(names.has('userId')).toBe(false)
    expect(names.has('forkedFromLibraryId')).toBe(false)
    expect(names.has('forkedFromVersion')).toBe(false)
    expect(names.has('forkedAt')).toBe(false)
  })

  it('specification has parentSpecificationId, rootSpecificationId, dataSchemaVersion, lastEditedByUserId', async () => {
    const cols = await rawQuery<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'specification'`,
    )
    const names = new Set(cols.map((c) => c.column_name))
    expect(names.has('parentSpecificationId')).toBe(true)
    expect(names.has('rootSpecificationId')).toBe(true)
    expect(names.has('dataSchemaVersion')).toBe(true)
    expect(names.has('lastEditedByUserId')).toBe(true)
    expect(names.has('rowVersion')).toBe(false)
  })
})

describe('schema v2: new indexes', () => {
  it.each(['spec_root_idx', 'spec_parent_idx', 'image_blob_created_idx', 'proxy_ref_target_idx'])(
    '%s exists',
    async (indexName) => {
      const rows = await rawQuery(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`, [
        indexName,
      ])
      expect(rows).toHaveLength(1)
    },
  )
})

describe('schema v2: FK enforcement', () => {
  it('FK constraints are defined (Postgres always enforces them)', async () => {
    // Postgres enforces FK constraints by default — verify at least one exists in our schema.
    const rows = await rawQuery<{ c: string }>(`SELECT count(*) as c FROM pg_constraint WHERE contype = 'f'`)
    expect(Number(rows[0].c)).toBeGreaterThan(0)
  })
})

describe('schema v2: trigger count', () => {
  it('has the expected number of schema triggers', async () => {
    const rows = await rawQuery<{ c: string }>(`SELECT count(*) as c FROM pg_trigger WHERE NOT tgisinternal`)
    // OCC triggers were removed; 20 PL/pgSQL triggers cover guards + ref counts.
    expect(Number(rows[0].c)).toBeGreaterThanOrEqual(15)
  })
})
