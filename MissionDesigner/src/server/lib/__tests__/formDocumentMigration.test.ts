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

// P4.1 Task 8: integration test for the boot-time formLayouts -> formDocument
// bulk migration. Module-scoped bootstrap (mirrors
// src/server/db/__tests__/triggers.test.ts) — one PGlite instance for the
// whole file, no beforeEach reset, so the four seeded specs and the migration
// run once and every `it` inspects the same post-migration state. The
// team/library/specification insert shapes mirror the self-referencing root
// pattern (rootSpecificationId = own id, parentSpecificationId = NULL) used
// throughout src/server/__tests__/import-export-roundtrip.test.ts (via
// testSeed.ts) and src/server/db/__tests__/triggers.test.ts.

import { beforeAll, describe, expect, it } from 'vitest'
import { rawQuery, bootstrapDatabase } from '../db'
import { migrateFormDocuments } from '../formDocumentMigration'
import { CURRENT_DATA_SCHEMA_VERSION } from '@/lib/data-schema-version'
import fixtureData from '../../../../e2e/fixtures/pre-p4-form-spec.data.json'

const NOW = 1000 // fixed seed timestamp — the updatedAt-untouched assertion needs an exact value

describe('migrateFormDocuments', () => {
  beforeAll(async () => {
    await bootstrapDatabase()

    await rawQuery(`INSERT INTO "team" (id, name, description, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5)`, [
      'team-migration',
      'Migration Test Team',
      '',
      NOW,
      NOW,
    ])
    await rawQuery(
      `INSERT INTO "library" (id, "teamId", name, "entityType", version, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['lib-migration', 'team-migration', 'Migration Test Library', 'workflow', '1.0.0', NOW, NOW],
    )

    async function seedSpec(id: string, state: string, data: string): Promise<void> {
      // Self-referencing root spec (rootSpecificationId = id, parentSpecificationId = NULL)
      // bypasses spec_root_consistency_insert (WHEN parentSpecificationId IS NOT NULL).
      await rawQuery(
        `INSERT INTO "specification"
           (id, "libraryId", name, version, state, data,
            "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, 'lib-migration', id, '1.0.0', state, data, id, null, 3, NOW, NOW],
      )
    }

    await seedSpec('SPEC_DRAFT', 'Draft', JSON.stringify(fixtureData))
    await seedSpec('SPEC_EFFECTIVE', 'Effective', JSON.stringify(fixtureData))
    await seedSpec('SPEC_FORMLESS', 'Draft', JSON.stringify({ nodes: [], edges: [] }))
    // Corrupt row: the raw invalid-JSON string goes in verbatim (not JSON.stringify'd).
    await seedSpec('SPEC_CORRUPT', 'Draft', '{not json')

    await migrateFormDocuments()
  })

  it('mints formDocument on form-bearing specs in ALL states and stamps v4', async () => {
    for (const id of ['SPEC_DRAFT', 'SPEC_EFFECTIVE']) {
      const [row] = await rawQuery<{ data: string; dataSchemaVersion: number }>(
        'SELECT data, "dataSchemaVersion" FROM "specification" WHERE id = $1',
        [id],
      )
      expect(row.dataSchemaVersion).toBe(CURRENT_DATA_SCHEMA_VERSION)
      const parsed = JSON.parse(row.data)
      const nodeData = parsed.nodes[0].data
      expect(nodeData.formDocument?.version).toBe(2)
      // v1 stays byte-identical inside the payload
      expect(nodeData.formLayouts).toEqual(
        (fixtureData as { nodes: Array<{ data: { formLayouts: unknown } }> }).nodes[0].data.formLayouts,
      )
      // preserved form labels won into uiParameters
      expect(nodeData.uiParameters.find((p: { type: string }) => p.type === 'YesNoButtons')).toMatchObject({
        value: 'Proceed',
        value2: 'Abort',
      })
    }
  })

  it('stamps formless specs without inventing a document', async () => {
    const [row] = await rawQuery<{ data: string; dataSchemaVersion: number }>(
      'SELECT data, "dataSchemaVersion" FROM "specification" WHERE id = $1',
      ['SPEC_FORMLESS'],
    )
    expect(row.dataSchemaVersion).toBe(CURRENT_DATA_SCHEMA_VERSION)
    expect(row.data).not.toContain('formDocument')
  })

  it('skips a corrupt row loudly: stays below v4 so a fixed build re-attempts', async () => {
    const [row] = await rawQuery<{ dataSchemaVersion: number }>(
      'SELECT "dataSchemaVersion" FROM "specification" WHERE id = $1',
      ['SPEC_CORRUPT'],
    )
    expect(row.dataSchemaVersion).toBe(3)
  })

  it('records the run in app_setting and is idempotent (re-run scans nothing, record survives)', async () => {
    const [setting] = await rawQuery<{ value: string }>(
      `SELECT value FROM "app_setting" WHERE key = 'formDocumentMigrationV4'`,
    )
    const record = JSON.parse(setting.value)
    expect(record).toMatchObject({ specs: 3, failed: 1 })
    expect(record.steps).toBeGreaterThanOrEqual(2)
    expect(record.advisories).toBeGreaterThanOrEqual(2)

    await migrateFormDocuments() // second run: WHERE dataSchemaVersion < 4 finds only the corrupt row again

    const [after] = await rawQuery<{ value: string }>(
      `SELECT value FROM "app_setting" WHERE key = 'formDocumentMigrationV4'`,
    )
    expect(JSON.parse(after.value).failed).toBe(1)
  })

  it('does not touch updatedAt (vendor derivation, not a user edit)', async () => {
    const [row] = await rawQuery<{ updatedAt: string | number }>(
      'SELECT "updatedAt" FROM "specification" WHERE id = $1',
      ['SPEC_DRAFT'],
    )
    expect(Number(row.updatedAt)).toBe(1000) // the seeded value
  })
})
