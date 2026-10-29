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

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { bootstrapDatabase, rawQuery } from '../../../lib/db'
import type { ScanReport } from '../types'

let applyFindings: typeof import('../apply').applyFindings

beforeAll(async () => {
  await bootstrapDatabase()
  ;({ applyFindings } = await import('../apply'))
})

beforeEach(async () => {
  await rawQuery('DELETE FROM "image_reference"')
  await rawQuery('DELETE FROM "image"')
  await rawQuery('DELETE FROM "image_blob"')
  await rawQuery('DELETE FROM "proxy_reference"')
  await rawQuery('DELETE FROM "specification_environment"')
  await rawQuery('DELETE FROM "library_environment"')
  await rawQuery('DELETE FROM specification')
  await rawQuery('DELETE FROM library')
  await rawQuery('DELETE FROM "user"')

  const NOW = Date.now()
  await rawQuery(
    'INSERT INTO "user" (id, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, false, $3, $4)',
    ['u1', 'u1@x.com', NOW, NOW],
  )
  await rawQuery(
    'INSERT INTO team (id, name, description, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
    ['team-default', 'Default Team', '', NOW, NOW],
  )
  await rawQuery(
    'INSERT INTO library (id, "teamId", name, "entityType", version, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7)',
    ['lib', 'team-default', 'L', 'workflow', '1.0.0', NOW, NOW],
  )
})

const seedSpec = async (id: string, data: object, parent: string | null = null, root: string | null = null) => {
  await rawQuery(
    `INSERT INTO specification (id, "libraryId", name, data, "parentSpecificationId", "rootSpecificationId", "createdAt", "updatedAt", "dataSchemaVersion")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, 'lib', id, JSON.stringify(data), parent, root ?? parent ?? id, Date.now(), Date.now(), 3],
  )
}

const mkReport = (findings: ScanReport['findings']): ScanReport => ({
  scanId: 'scan-1',
  createdAt: Date.now(),
  findings,
  summary: { byType: { D1: 0, D2: 0, D3: 0, D4: 0, D5: 0, D6: 0 }, totalReportOnly: 0 },
})

describe('applyFindings', () => {
  it('D3: deletes the stale proxy_reference row', async () => {
    await seedSpec('root', { nodes: [] })
    await seedSpec('step', { nodes: [] }, 'root', 'root')
    await rawQuery(
      'INSERT INTO "proxy_reference" ("parentSpecificationId", "nodeId", "targetSpecificationId") VALUES ($1, $2, $3)',
      ['root', 'gone', 'step'],
    )
    const results = await applyFindings(
      mkReport([
        {
          id: 'f1',
          driftType: 'D3',
          libraryId: 'lib',
          libraryName: 'L',
          userEmail: 'u1@x.com',
          parentSpecId: 'root',
          nodeId: 'gone',
          targetSpecId: 'step',
        },
      ]),
      ['f1'],
    )
    expect(results).toEqual([{ findingId: 'f1', result: 'applied' }])
    const rows = await rawQuery('SELECT * FROM "proxy_reference"')
    expect(rows).toHaveLength(0)
  })

  it('D3: skips when the row no longer exists (resolved-before-apply)', async () => {
    await seedSpec('root', { nodes: [] })
    await seedSpec('step', { nodes: [] }, 'root', 'root')
    const [result] = await applyFindings(
      mkReport([
        {
          id: 'f1',
          driftType: 'D3',
          libraryId: 'lib',
          libraryName: 'L',
          userEmail: 'u1@x.com',
          parentSpecId: 'root',
          nodeId: 'gone',
          targetSpecId: 'step',
        },
      ]),
      ['f1'],
    )
    expect(result.result).toBe('skipped')
  })

  it('D4: inserts the missing proxy_reference row', async () => {
    await seedSpec('root', {
      nodes: [
        { id: 'n1', type: 'workflowProxy', data: { subWorkflowMode: 'reference', referencedStepSpecId: 'step' } },
      ],
    })
    await seedSpec('step', { nodes: [] }, 'root', 'root')
    const [result] = await applyFindings(
      mkReport([
        {
          id: 'f1',
          driftType: 'D4',
          libraryId: 'lib',
          libraryName: 'L',
          userEmail: 'u1@x.com',
          parentSpecId: 'root',
          nodeId: 'n1',
          targetSpecId: 'step',
        },
      ]),
      ['f1'],
    )
    expect(result.result).toBe('applied')
    const rows = await rawQuery('SELECT * FROM "proxy_reference"')
    expect(rows).toHaveLength(1)
  })

  it('D2: re-parents the child spec', async () => {
    await seedSpec('P', {
      nodes: [{ id: 'n1', type: 'workflowProxy', data: { subWorkflowMode: 'embedded', embeddedWorkflowSpecId: 'C' } }],
    })
    await seedSpec('OTHER', { nodes: [] })
    await seedSpec('C', { nodes: [] }, 'OTHER', 'OTHER')
    const [result] = await applyFindings(
      mkReport([
        {
          id: 'f1',
          driftType: 'D2',
          libraryId: 'lib',
          libraryName: 'L',
          userEmail: 'u1@x.com',
          childSpecId: 'C',
          childSpecName: 'C',
          diagramParentId: 'P',
          dbParentId: 'OTHER',
        },
      ]),
      ['f1'],
    )
    expect(result.result).toBe('applied')
    const [row] = await rawQuery<{ parentSpecificationId: string; rootSpecificationId: string }>(
      'SELECT "parentSpecificationId", "rootSpecificationId" FROM specification WHERE id = $1',
      ['C'],
    )
    expect(row.parentSpecificationId).toBe('P')
    expect(row.rootSpecificationId).toBe('P') // P has no parent → P is its own root
  })

  it('D1: deletes the orphan child, cascading descendants', async () => {
    await seedSpec('root', { nodes: [] })
    await seedSpec('orphan', { nodes: [] }, 'root', 'root')
    await seedSpec('grandchild', { nodes: [] }, 'orphan', 'root')
    const [result] = await applyFindings(
      mkReport([
        {
          id: 'f1',
          driftType: 'D1',
          libraryId: 'lib',
          libraryName: 'L',
          userEmail: 'u1@x.com',
          orphanSpecId: 'orphan',
          orphanSpecName: 'orphan',
          dbParentId: 'root',
          descendantCount: 1,
        },
      ]),
      ['f1'],
    )
    expect(result.result).toBe('applied')
    const rows = await rawQuery<{ id: string }>('SELECT id FROM specification')
    expect(rows.map((r) => r.id).sort()).toEqual(['root'])
  })

  it('D2: re-parents the child AND its descendants, preserving them', async () => {
    await seedSpec('P', {
      nodes: [{ id: 'n1', type: 'workflowProxy', data: { subWorkflowMode: 'embedded', embeddedWorkflowSpecId: 'C' } }],
    })
    await seedSpec('OTHER', { nodes: [] })
    await seedSpec('C', { nodes: [] }, 'OTHER', 'OTHER')
    await seedSpec('grandC', { nodes: [] }, 'C', 'OTHER')
    // Also insert a proxy_reference originating within the subtree, to ensure outbound refs survive.
    await rawQuery(
      'INSERT INTO "proxy_reference" ("parentSpecificationId", "nodeId", "targetSpecificationId") VALUES ($1, $2, $3)',
      ['C', 'nRef', 'grandC'],
    )
    const [result] = await applyFindings(
      mkReport([
        {
          id: 'f1',
          driftType: 'D2',
          libraryId: 'lib',
          libraryName: 'L',
          userEmail: 'u1@x.com',
          childSpecId: 'C',
          childSpecName: 'C',
          diagramParentId: 'P',
          dbParentId: 'OTHER',
        },
      ]),
      ['f1'],
    )
    expect(result.result).toBe('applied')
    // C moved under P with P as root.
    const [cRow] = await rawQuery<{ parentSpecificationId: string; rootSpecificationId: string }>(
      'SELECT "parentSpecificationId", "rootSpecificationId" FROM specification WHERE id = $1',
      ['C'],
    )
    expect(cRow.parentSpecificationId).toBe('P')
    expect(cRow.rootSpecificationId).toBe('P')
    // grandC still exists, still parented under C, but its root updated to P.
    const [gRow] = await rawQuery<{ parentSpecificationId: string; rootSpecificationId: string }>(
      'SELECT "parentSpecificationId", "rootSpecificationId" FROM specification WHERE id = $1',
      ['grandC'],
    )
    expect(gRow.parentSpecificationId).toBe('C')
    expect(gRow.rootSpecificationId).toBe('P')
    // Outbound proxy_reference from C → grandC preserved.
    const refs = await rawQuery<{ parentSpecificationId: string; nodeId: string; targetSpecificationId: string }>(
      'SELECT "parentSpecificationId", "nodeId", "targetSpecificationId" FROM "proxy_reference"',
    )
    expect(refs).toEqual([{ parentSpecificationId: 'C', nodeId: 'nRef', targetSpecificationId: 'grandC' }])
  })

  it('ignores findingIds not in the report', async () => {
    expect(await applyFindings(mkReport([]), ['ghost'])).toEqual([])
  })
})
