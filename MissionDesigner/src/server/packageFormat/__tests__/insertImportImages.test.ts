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
import type {
  insertImportImages as insertImportImagesT,
  ImportImageMissingError as ImportImageMissingErrorT,
} from '../insertImportImages'

let insertImportImages: typeof insertImportImagesT
let ImportImageMissingError: typeof ImportImageMissingErrorT

beforeAll(async () => {
  await bootstrapDatabase()
  const mod = await import('../insertImportImages')
  insertImportImages = mod.insertImportImages
  ImportImageMissingError = mod.ImportImageMissingError
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
    ['news', 'lib', 'New', '1.0.0', 'Draft', '{"nodes":[]}', 'news', null, 3, NOW, NOW],
  )
})

describe('insertImportImages', () => {
  it('inserts an image_blob and an image row for one image', async () => {
    await insertImportImages(
      [{ newSpecId: 'news', filename: 'cover.png', sourceSpecId: 'src-r1' }],
      [{ filename: 'cover.png', mimeType: 'image/png', bytes: PNG }],
    )
    const [blob] = await rawQuery<{ contentHash: string; refCount: number }>(
      'SELECT "contentHash", "refCount" FROM image_blob',
    )
    expect(blob.refCount).toBe(1) // bumped by trigger
    const [image] = await rawQuery<{ specificationId: string; filename: string; contentHash: string }>(
      `SELECT "specificationId", filename, "contentHash" FROM image`,
    )
    expect(image.specificationId).toBe('news')
    expect(image.filename).toBe('cover.png')
    expect(image.contentHash).toBe(blob.contentHash)
  })

  it('dedupes image_blob when two images share the same bytes', async () => {
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO specification
         (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId",
          "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      ['news2', 'lib', 'N2', '1.0.0', 'Draft', '{"nodes":[]}', 'news2', null, 3, NOW, NOW],
    )
    await insertImportImages(
      [
        { newSpecId: 'news', filename: 'a.png', sourceSpecId: 'src-r1' },
        { newSpecId: 'news2', filename: 'b.png', sourceSpecId: 'src-r2' },
      ],
      [
        { filename: 'a.png', mimeType: 'image/png', bytes: PNG },
        { filename: 'b.png', mimeType: 'image/png', bytes: PNG },
      ],
    )
    const [blobCount] = await rawQuery<{ c: string }>('SELECT count(*) AS c FROM image_blob')
    expect(Number(blobCount.c)).toBe(1) // single blob
    const [refRow] = await rawQuery<{ refCount: number }>('SELECT "refCount" FROM image_blob')
    expect(refRow.refCount).toBe(2) // two image rows referencing the same blob
  })

  it('throws ImportImageMissingError when the JSON references an image not in the ZIP', async () => {
    await expect(
      insertImportImages([{ newSpecId: 'news', filename: 'missing.png', sourceSpecId: 'src-r1' }], []),
    ).rejects.toBeInstanceOf(ImportImageMissingError)
  })

  it('is a no-op when both inputs are empty', async () => {
    await expect(insertImportImages([], [])).resolves.not.toThrow()
    const [row] = await rawQuery<{ c: string }>('SELECT count(*) AS c FROM image')
    expect(Number(row.c)).toBe(0)
  })
})
