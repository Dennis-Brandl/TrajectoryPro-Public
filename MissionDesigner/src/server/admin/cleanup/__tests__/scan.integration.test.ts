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
import type { ScanEvent } from '../types'

let scanAll: typeof import('../scan').scanAll

beforeAll(async () => {
  await bootstrapDatabase()
  ;({ scanAll } = await import('../scan'))
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

const seedSpec = async (
  id: string,
  data: object,
  opts: { parent?: string | null; root?: string | null; name?: string } = {},
) => {
  await rawQuery(
    `INSERT INTO specification (id, "libraryId", name, data, "parentSpecificationId", "rootSpecificationId", "createdAt", "updatedAt", "dataSchemaVersion")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, 'lib', opts.name ?? id, JSON.stringify(data), opts.parent ?? null, opts.root ?? id, Date.now(), Date.now(), 3],
  )
}

const collect = async (): Promise<ScanEvent[]> => {
  const events: ScanEvent[] = []
  for await (const evt of scanAll()) events.push(evt)
  return events
}

describe('scanAll', () => {
  it('emits start → progress → result for a clean library', async () => {
    await seedSpec('root', { nodes: [] })
    const events = await collect()
    expect(events[0].type).toBe('start')
    expect(events[events.length - 1].type).toBe('result')
    const result = events[events.length - 1]
    if (result.type !== 'result') throw new Error('typeguard')
    expect(result.findings).toEqual([])
  })

  it('finds a D1 orphan embedded child', async () => {
    await seedSpec('root', { nodes: [] })
    await seedSpec('orphan', { nodes: [] }, { parent: 'root', root: 'root' })
    const events = await collect()
    const result = events[events.length - 1]
    if (result.type !== 'result') throw new Error('typeguard')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].driftType).toBe('D1')
  })

  it('finds a D3 stale proxy_reference row', async () => {
    await seedSpec('root', { nodes: [] })
    await seedSpec('step', { nodes: [] }, { parent: 'root', root: 'root' })
    await rawQuery(
      'INSERT INTO "proxy_reference" ("parentSpecificationId", "nodeId", "targetSpecificationId") VALUES ($1, $2, $3)',
      ['root', 'gone-node', 'step'],
    )
    const events = await collect()
    const result = events[events.length - 1]
    if (result.type !== 'result') throw new Error('typeguard')
    expect(result.findings.some((f) => f.driftType === 'D3')).toBe(true)
  })
})
