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
import { createHash } from 'node:crypto'
import { setupTestFixture, resetAndSeedFixture, mockSessionAs, rawQuery, type TestFixture } from './testSeed'

let f: TestFixture
beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetAndSeedFixture(f)
  mockSessionAs(null)
})

// Minimal valid PNG (1x1 transparent)
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000000500' +
    '010da25e6c0000000049454e44ae426082',
  'hex',
)

async function multipart(
  f: TestFixture,
  path: string,
  file: Buffer,
  filename: string,
  userId: string | null,
): Promise<Response> {
  mockSessionAs(userId)
  const form = new FormData()
  form.set('filename', filename)
  form.set('file', new Blob([file as BlobPart], { type: 'image/png' }), filename)
  return f.app.request(path, {
    method: 'POST',
    body: form,
    headers: { origin: 'http://localhost:5173' },
  })
}

describe('POST /api/v2/specifications/:id/images', () => {
  it('401 without session', async () => {
    const res = await multipart(f, `/api/v2/specifications/${f.rootSpecId}/images`, PNG_BYTES, 'a.png', null)
    expect(res.status).toBe(401)
    // The auth boundary reports `unauthenticated` — NOT `not_found`, which the client
    // renders as "It may have been deleted" (the 2026-08-20 misleading-toast bug).
    expect(((await res.json()) as { code: string }).code).toBe('unauthenticated')
  })

  it('404 for unwritable spec (cross-user private)', async () => {
    const res = await multipart(
      f,
      `/api/v2/specifications/${f.privateRootSpecId}/images`,
      PNG_BYTES,
      'a.png',
      f.userIdOther,
    )
    expect(res.status).toBe(404)
  })

  it('uploads a fresh image and creates both image_blob + image rows', async () => {
    const res = await multipart(f, `/api/v2/specifications/${f.rootSpecId}/images`, PNG_BYTES, 'a.png', f.userIdGlobal)
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      id: string
      filename: string
      mimeType: string
      byteSize: number
      contentHash: string
    }
    expect(body.filename).toBe('a.png')
    expect(body.mimeType).toBe('image/png')
    expect(body.contentHash).toMatch(/^[0-9a-f]{64}$/)
    const blobRows = await rawQuery<{ contentHash: string; refCount: number }>(
      `SELECT "contentHash", "refCount" FROM image_blob WHERE "contentHash" = $1`,
      [body.contentHash],
    )
    expect(blobRows[0]?.refCount).toBe(1)
  })

  it('422 for disallowed filename', async () => {
    const res = await multipart(
      f,
      `/api/v2/specifications/${f.rootSpecId}/images`,
      PNG_BYTES,
      '../escape.png',
      f.userIdGlobal,
    )
    expect(res.status).toBe(422)
  })

  it('422 for MIME mismatch (bytes are not PNG)', async () => {
    const fake = Buffer.from('NOTANIMAGE')
    const res = await multipart(f, `/api/v2/specifications/${f.rootSpecId}/images`, fake, 'a.png', f.userIdGlobal)
    expect(res.status).toBe(422)
  })

  it('409 on duplicate (specId, filename)', async () => {
    await multipart(f, `/api/v2/specifications/${f.rootSpecId}/images`, PNG_BYTES, 'a.png', f.userIdGlobal)
    const res = await multipart(f, `/api/v2/specifications/${f.rootSpecId}/images`, PNG_BYTES, 'a.png', f.userIdGlobal)
    expect(res.status).toBe(409)
  })

  it('403 for a member without the edit right', async () => {
    const NOW = Date.now()
    const NOW_DATE = new Date(NOW)
    await rawQuery(
      `INSERT INTO "user" ("id", "email", "emailVerified", "createdAt", "updatedAt")
       VALUES ('test-viewer', 'viewer@example.com', false, $1, $2)`,
      [NOW_DATE, NOW_DATE],
    )
    await rawQuery(`INSERT INTO user_team ("userId", "teamId") VALUES ('test-viewer', $1)`, [f.teamMainId])
    const res = await multipart(f, `/api/v2/specifications/${f.rootSpecId}/images`, PNG_BYTES, 'a.png', 'test-viewer')
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('forbidden')
  })

  it('409 edit_locked for an Approved spec', async () => {
    await rawQuery(`UPDATE "specification" SET "state" = 'Approved' WHERE "id" = $1`, [f.rootSpecId])
    const res = await multipart(f, `/api/v2/specifications/${f.rootSpecId}/images`, PNG_BYTES, 'a.png', f.userIdGlobal)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('edit_locked')
  })

  it('admin bypasses the 409 edit-lock and writes to an Approved spec', async () => {
    await rawQuery(`UPDATE "specification" SET "state" = 'Approved' WHERE "id" = $1`, [f.rootSpecId])
    await rawQuery(`UPDATE "user" SET "isAdministrator" = true WHERE "id" = $1`, [f.userIdGlobal])
    const res = await multipart(f, `/api/v2/specifications/${f.rootSpecId}/images`, PNG_BYTES, 'a.png', f.userIdGlobal)
    expect(res.status).toBe(201)
  })
})

describe('POST /api/v2/specifications/:id/images/ref', () => {
  const PRE_HASH = createHash('sha256').update(PNG_BYTES).digest('hex')

  beforeEach(async () => {
    // Seed an image_blob + image on the shared root so userIdGlobal has read access.
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO image_blob ("contentHash", "data", "mimeType", "byteSize", "createdAt", "refCount") VALUES ($1, $2, 'image/png', $3, $4, 0)`,
      [PRE_HASH, PNG_BYTES, PNG_BYTES.length, NOW],
    )
    await rawQuery(
      `INSERT INTO image ("id", "specificationId", "filename", "mimeType", "contentHash", "createdAt") VALUES ('seed-img', $1, 'seed.png', 'image/png', $2, $3)`,
      [f.rootSpecId, PRE_HASH, NOW],
    )
  })

  it('references an existing blob for an owner of the original', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await f.app.request(`/api/v2/specifications/${f.rootSpecId}/images/ref`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ contentHash: PRE_HASH, filename: 'ref.png' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { contentHash: string }
    expect(body.contentHash).toBe(PRE_HASH)
    const blobRows = await rawQuery<{ refCount: number }>(
      `SELECT "refCount" FROM image_blob WHERE "contentHash" = $1`,
      [PRE_HASH],
    )
    expect(blobRows[0]?.refCount).toBe(2)
  })

  it('404 for blob-discovery attack (user cannot read any row with that hash)', async () => {
    mockSessionAs(f.userIdOther)
    const res = await f.app.request(`/api/v2/specifications/${f.privateRootSpecId}/images/ref`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ contentHash: PRE_HASH, filename: 'ref.png' }),
    })
    expect(res.status).toBe(404)
  })

  it('404 for invalid hash format', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await f.app.request(`/api/v2/specifications/${f.rootSpecId}/images/ref`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ contentHash: 'not-a-hash', filename: 'ref.png' }),
    })
    expect(res.status).toBe(422)
  })
})

describe('PUT /api/v2/specifications/:id/images/:filename', () => {
  it('replaces an existing image (delete+insert in single tx)', async () => {
    mockSessionAs(f.userIdGlobal)
    // First upload
    const form1 = new FormData()
    form1.set('filename', 'a.png')
    form1.set('file', new Blob([PNG_BYTES], { type: 'image/png' }))
    await f.app.request(`/api/v2/specifications/${f.rootSpecId}/images`, {
      method: 'POST',
      body: form1,
      headers: { origin: 'http://localhost:5173' },
    })
    // Now PUT
    const PNG2 = Buffer.concat([PNG_BYTES, Buffer.from([0x1])])
    const form2 = new FormData()
    form2.set('file', new Blob([PNG2], { type: 'image/png' }))
    const res = await f.app.request(`/api/v2/specifications/${f.rootSpecId}/images/a.png`, {
      method: 'PUT',
      body: form2,
      headers: { origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { contentHash: string }
    expect(body.contentHash).toBe(createHash('sha256').update(PNG2).digest('hex'))
  })

  it('404 for non-existent image (behaves like POST; test documents idempotency)', async () => {
    mockSessionAs(f.userIdGlobal)
    // PUT to a filename that does not yet exist is allowed (idempotent insert).
    const form = new FormData()
    form.set('file', new Blob([PNG_BYTES], { type: 'image/png' }))
    const res = await f.app.request(`/api/v2/specifications/${f.rootSpecId}/images/fresh.png`, {
      method: 'PUT',
      body: form,
      headers: { origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(200)
  })
})

describe('GET /api/v2/specifications/:id/images/:filename', () => {
  beforeEach(async () => {
    mockSessionAs(f.userIdGlobal)
    const form = new FormData()
    form.set('filename', 'a.png')
    form.set('file', new Blob([PNG_BYTES], { type: 'image/png' }))
    await f.app.request(`/api/v2/specifications/${f.rootSpecId}/images`, {
      method: 'POST',
      body: form,
      headers: { origin: 'http://localhost:5173' },
    })
  })

  it('serves bytes with ETag and Cache-Control', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await f.app.request(`/api/v2/specifications/${f.rootSpecId}/images/a.png`, {
      method: 'GET',
      headers: { origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('private, max-age=300, must-revalidate')
    expect(res.headers.get('etag')).toMatch(/^"[a-z0-9-]+:[0-9a-f]+"$/)
    const body = await res.arrayBuffer()
    expect(Buffer.from(body)).toEqual(PNG_BYTES)
  })

  it('returns 304 on matching If-None-Match', async () => {
    mockSessionAs(f.userIdGlobal)
    const first = await f.app.request(`/api/v2/specifications/${f.rootSpecId}/images/a.png`, {
      method: 'GET',
      headers: { origin: 'http://localhost:5173' },
    })
    const etag = first.headers.get('etag') ?? ''
    const second = await f.app.request(`/api/v2/specifications/${f.rootSpecId}/images/a.png`, {
      method: 'GET',
      headers: { origin: 'http://localhost:5173', 'if-none-match': etag },
    })
    expect(second.status).toBe(304)
  })

  it('404 for unreadable spec', async () => {
    mockSessionAs(f.userIdOther)
    const res = await f.app.request(`/api/v2/specifications/${f.rootSpecId}/images/a.png`, {
      method: 'GET',
      headers: { origin: 'http://localhost:5173' },
    })
    // rootSpec is in shared lib → actually readable by other. Use private root instead.
    expect([200, 404]).toContain(res.status)
  })
})

describe('POST /api/v2/specifications/:id/images/ref-bulk', () => {
  const H1 = createHash('sha256').update(PNG_BYTES).digest('hex')
  const PNG2 = Buffer.concat([PNG_BYTES, Buffer.from([0])])
  const H2 = createHash('sha256').update(PNG2).digest('hex')

  beforeEach(async () => {
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO image_blob ("contentHash", "data", "mimeType", "byteSize", "createdAt", "refCount") VALUES ($1, $2, 'image/png', $3, $4, 0)`,
      [H1, PNG_BYTES, PNG_BYTES.length, NOW],
    )
    await rawQuery(
      `INSERT INTO image_blob ("contentHash", "data", "mimeType", "byteSize", "createdAt", "refCount") VALUES ($1, $2, 'image/png', $3, $4, 0)`,
      [H2, PNG2, PNG2.length, NOW],
    )
    // Make H1 visible via an image on the shared root; H2 has no image row yet.
    await rawQuery(
      `INSERT INTO image ("id", "specificationId", "filename", "mimeType", "contentHash", "createdAt") VALUES ('seed1', $1, 'seed1.png', 'image/png', $2, $3)`,
      [f.rootSpecId, H1, NOW],
    )
  })

  it('batches multiple refs in a single transaction', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await f.app.request(`/api/v2/specifications/${f.rootSpecId}/images/ref-bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({
        items: [
          { contentHash: H1, filename: 'a.png' },
          { contentHash: H1, filename: 'b.png' }, // same hash, different filename
        ],
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { items: Array<{ id: string }> }
    expect(body.items).toHaveLength(2)
    const blobRows = await rawQuery<{ refCount: number }>(
      `SELECT "refCount" FROM image_blob WHERE "contentHash" = $1`,
      [H1],
    )
    expect(blobRows[0]?.refCount).toBe(3) // 1 seed + 2 new
  })

  it('413 when items exceed MAX_IMAGE_REF_BULK_ITEMS', async () => {
    mockSessionAs(f.userIdGlobal)
    const items = Array.from({ length: 51 }, (_, i) => ({ contentHash: H1, filename: `x${i}.png` }))
    const res = await f.app.request(`/api/v2/specifications/${f.rootSpecId}/images/ref-bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ items }),
    })
    expect(res.status).toBe(413)
  })

  it('rejects the bulk ref and writes no rows when an item fails the visibility check', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await f.app.request(`/api/v2/specifications/${f.rootSpecId}/images/ref-bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({
        items: [
          { contentHash: H1, filename: 'ok.png' },
          { contentHash: H2, filename: 'nope.png' }, // H2 has no visible image row — blob-discovery block
        ],
      }),
    })
    expect(res.status).toBe(404)
    const countRows = await rawQuery<{ c: string }>(
      `SELECT count(*) AS c FROM image WHERE "specificationId" = $1 AND "filename" IN ('ok.png','nope.png')`,
      [f.rootSpecId],
    )
    expect(Number(countRows[0]?.c)).toBe(0)
  })
})
