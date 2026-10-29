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
import { bootstrapDatabase, rawQuery } from '../../lib/db'
import type { loadImageBytesForSpecs as loadImageBytesForSpecsT } from '../loadImageBytes'

let loadImageBytesForSpecs: typeof loadImageBytesForSpecsT

beforeAll(async () => {
  await bootstrapDatabase()
  ;({ loadImageBytesForSpecs } = await import('../loadImageBytes'))
})

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

beforeEach(async () => {
  // Clean content tables in FK-safe order.
  await rawQuery(`TRUNCATE image_reference, image, image_blob CASCADE`)
  await rawQuery(`TRUNCATE specification, library CASCADE`)
  await rawQuery(`TRUNCATE "user_team_role", "user_team", "user", team CASCADE`)

  const NOW = Date.now()
  await rawQuery(`INSERT INTO "user" (id, email, "isAdministrator") VALUES ($1, $2, $3)`, ['u', 'x@x.com', false])
  await rawQuery(`INSERT INTO team (id, name, description, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5)`, [
    'team-default',
    'Default Team',
    '',
    NOW,
    NOW,
  ])
  await rawQuery(
    `INSERT INTO library (id, "teamId", name, "entityType", version, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    ['lib', 'team-default', 'L', 'workflow', '1.0.0', NOW, NOW],
  )
  await rawQuery(
    `INSERT INTO specification
       (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId",
        "dataSchemaVersion", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    ['s1', 'lib', 'S1', '1.0.0', 'Draft', '{"nodes":[]}', 's1', null, 3, NOW, NOW],
  )
  // Insert image_blob with refCount=0 (trigger bumps on image insert).
  // M1: PNG is a Buffer — passed directly as bytea.
  await rawQuery(
    `INSERT INTO image_blob ("contentHash", data, "mimeType", "byteSize", "createdAt", "refCount")
     VALUES ($1, $2, $3, $4, $5, 0)`,
    ['h1', PNG, 'image/png', PNG.length, NOW],
  )
  await rawQuery(
    `INSERT INTO image (id, "specificationId", filename, "mimeType", "contentHash", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['i1', 's1', 'a.png', 'image/png', 'h1', NOW],
  )
})

describe('loadImageBytesForSpecs', () => {
  it('returns the bytes for a single image', async () => {
    const result = await loadImageBytesForSpecs(['s1'])
    expect(result.get('s1')).toHaveLength(1)
    const entry = result.get('s1')![0]
    expect(entry.filename).toBe('a.png')
    expect(entry.mimeType).toBe('image/png')
    expect(Buffer.compare(entry.bytes, PNG)).toBe(0)
  })

  it('returns an empty map for unknown spec ids', async () => {
    const result = await loadImageBytesForSpecs(['nope'])
    expect(result.size).toBe(0)
  })

  it('returns empty for an empty input', async () => {
    expect(await loadImageBytesForSpecs([])).toEqual(new Map())
  })
})
