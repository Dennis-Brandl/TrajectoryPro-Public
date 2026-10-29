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

// Phase 35 §2.6: image endpoints.

import { Hono } from 'hono'
import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { rawQuery, withTransaction } from '../../lib/db'
import { specReadDao } from '../../dao/specReadDao'
import { v2RequireMultipartOrigin } from '../../middleware/v2/permissions'
import type { V2Session } from '../../middleware/v2/permissions'
import { assertCanWriteSpec, gateErrorCode, userCanSeeContentHash } from './_specGate'
import { v2ErrorBody } from '../../errors/v2'
import { ALLOWED_IMAGE_MIMES, isAllowedFilename, sniffMime } from '../../imageMime'
import { MAX_IMAGE_BYTES, MAX_IMAGE_UPLOAD_MULTIPART_BYTES, MAX_IMAGE_REF_BULK_ITEMS } from '../../limits'

type Variables = { v2Session: V2Session }

export const imagesV2 = new Hono<{ Variables: Variables }>()

imagesV2.post('/specifications/:id/images', v2RequireMultipartOrigin, async (c) => {
  const session = c.get('v2Session')
  const specId = c.req.param('id')

  const gate = await assertCanWriteSpec(session, specId)
  if (!gate.ok) return c.json(v2ErrorBody(gateErrorCode(gate.status)), gate.status)

  // Parse multipart
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  const filenameRaw = String(form.get('filename') ?? '')
  const fileVal = form.get('file')
  if (!(fileVal instanceof File)) return c.json(v2ErrorBody('schema_mismatch'), 422)

  if (!isAllowedFilename(filenameRaw)) return c.json(v2ErrorBody('schema_mismatch', { field: 'filename' }), 422)

  // Size check BEFORE buffering
  if (fileVal.size > MAX_IMAGE_UPLOAD_MULTIPART_BYTES) {
    return c.json(v2ErrorBody('payload_too_large', { limit: MAX_IMAGE_UPLOAD_MULTIPART_BYTES }), 413)
  }

  const bytes = Buffer.from(await fileVal.arrayBuffer())
  if (bytes.length > MAX_IMAGE_BYTES) {
    return c.json(v2ErrorBody('payload_too_large', { limit: MAX_IMAGE_BYTES }), 413)
  }

  const mime = sniffMime(bytes)
  if (!mime || !ALLOWED_IMAGE_MIMES.has(mime)) return c.json(v2ErrorBody('image_mime_invalid'), 422)

  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const now = Date.now()
  const imageId = randomUUID()

  try {
    await withTransaction(async (q) => {
      await q(
        `INSERT INTO image_blob ("contentHash", "data", "mimeType", "byteSize", "createdAt", "refCount")
         VALUES ($1, $2, $3, $4, $5, 0)
         ON CONFLICT("contentHash") DO NOTHING`,
        [contentHash, bytes, mime, bytes.length, now],
      )
      await q(
        `INSERT INTO image ("id", "specificationId", "filename", "mimeType", "contentHash", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [imageId, specId, filenameRaw, mime, contentHash, now],
      )
    })
  } catch (err) {
    const code = (err as { code?: string }).code
    const msg = err instanceof Error ? err.message : String(err)
    if (code === '23505' || /duplicate key/i.test(msg)) {
      return c.json(
        v2ErrorBody('conflict', { conflictType: 'unique', table: 'image', constraint: 'image_spec_filename_unique' }),
        409,
      )
    }
    throw err
  }

  return c.json(
    {
      id: imageId,
      filename: filenameRaw,
      mimeType: mime,
      byteSize: bytes.length,
      contentHash,
    },
    201,
  )
})

imagesV2.put('/specifications/:id/images/:filename', v2RequireMultipartOrigin, async (c) => {
  const session = c.get('v2Session')
  const specId = c.req.param('id')
  const filename = c.req.param('filename')
  if (!isAllowedFilename(filename)) return c.json(v2ErrorBody('schema_mismatch', { field: 'filename' }), 422)

  // canWrite gate (same as POST)
  const gate = await assertCanWriteSpec(session, specId)
  if (!gate.ok) return c.json(v2ErrorBody(gateErrorCode(gate.status)), gate.status)

  // Parse file
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  const fileVal = form.get('file')
  if (!(fileVal instanceof File)) return c.json(v2ErrorBody('schema_mismatch'), 422)
  if (fileVal.size > MAX_IMAGE_UPLOAD_MULTIPART_BYTES) {
    return c.json(v2ErrorBody('payload_too_large', { limit: MAX_IMAGE_UPLOAD_MULTIPART_BYTES }), 413)
  }
  const bytes = Buffer.from(await fileVal.arrayBuffer())
  if (bytes.length > MAX_IMAGE_BYTES) return c.json(v2ErrorBody('payload_too_large', { limit: MAX_IMAGE_BYTES }), 413)
  const mime = sniffMime(bytes)
  if (!mime || !ALLOWED_IMAGE_MIMES.has(mime)) return c.json(v2ErrorBody('image_mime_invalid'), 422)

  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const now = Date.now()
  const newImageId = randomUUID()

  await withTransaction(async (q) => {
    await q(`DELETE FROM image WHERE "specificationId" = $1 AND "filename" = $2`, [specId, filename])
    await q(
      `INSERT INTO image_blob ("contentHash", "data", "mimeType", "byteSize", "createdAt", "refCount")
       VALUES ($1, $2, $3, $4, $5, 0)
       ON CONFLICT("contentHash") DO NOTHING`,
      [contentHash, bytes, mime, bytes.length, now],
    )
    await q(
      `INSERT INTO image ("id", "specificationId", "filename", "mimeType", "contentHash", "createdAt") VALUES ($1, $2, $3, $4, $5, $6)`,
      [newImageId, specId, filename, mime, contentHash, now],
    )
  })

  return c.json(
    {
      id: newImageId,
      filename,
      mimeType: mime,
      byteSize: bytes.length,
      contentHash,
    },
    200,
  )
})

imagesV2.get('/specifications/:id/images/:filename', async (c) => {
  const session = c.get('v2Session')
  const specId = c.req.param('id')
  const filename = c.req.param('filename')
  if (!isAllowedFilename(filename)) return c.json(v2ErrorBody('not_found'), 404)

  // canRead gate
  const spec = await specReadDao.getSpec({ sessionUserId: session.userId }, specId)
  if (!spec) return c.json(v2ErrorBody('not_found'), 404)

  const rows = await rawQuery<{ id: string; mimeType: string; data: Buffer | Uint8Array; contentHash: string }>(
    `SELECT i."id", i."mimeType", ib."data", i."contentHash"
       FROM image i
       JOIN image_blob ib ON ib."contentHash" = i."contentHash"
      WHERE i."specificationId" = $1 AND i."filename" = $2`,
    [specId, filename],
  )
  const row = rows[0]
  if (!row) return c.json(v2ErrorBody('not_found'), 404)

  const etag = `"${row.id}:${row.contentHash}"`
  if (c.req.header('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, 'cache-control': 'private, max-age=300, must-revalidate' },
    })
  }

  // M1: bytea comes back as Buffer (pg) or Uint8Array (PGlite) — normalise so
  // response body bytes, length, and content-type are correct in both runtimes.
  const data = Buffer.from(row.data)
  return new Response(data, {
    status: 200,
    headers: {
      'content-type': row.mimeType,
      'cache-control': 'private, max-age=300, must-revalidate',
      etag,
    },
  })
})

const RefBody = z.strictObject({
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  filename: z.string(),
})

imagesV2.post('/specifications/:id/images/ref', async (c) => {
  const session = c.get('v2Session')
  const specId = c.req.param('id')

  let body: z.infer<typeof RefBody>
  try {
    body = RefBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  if (!isAllowedFilename(body.filename)) return c.json(v2ErrorBody('schema_mismatch', { field: 'filename' }), 422)

  // canWrite on target spec
  const gate = await assertCanWriteSpec(session, specId)
  if (!gate.ok) return c.json(v2ErrorBody(gateErrorCode(gate.status)), gate.status)

  // Permission-boundary EXISTS check (§2.6): the user must already be able
  // to read AT LEAST ONE image row with this contentHash.
  if (!(await userCanSeeContentHash(body.contentHash, session.userId))) return c.json(v2ErrorBody('not_found'), 404)

  // Verify blob exists and its mime
  const blobRows = await rawQuery<{ mimeType: string }>(`SELECT "mimeType" FROM image_blob WHERE "contentHash" = $1`, [
    body.contentHash,
  ])
  const blob = blobRows[0]
  if (!blob) return c.json(v2ErrorBody('image_blob_not_found'), 404)

  const imageId = randomUUID()
  const now = Date.now()
  try {
    await rawQuery(
      `INSERT INTO image ("id", "specificationId", "filename", "mimeType", "contentHash", "createdAt") VALUES ($1, $2, $3, $4, $5, $6)`,
      [imageId, specId, body.filename, blob.mimeType, body.contentHash, now],
    )
  } catch (err) {
    const code = (err as { code?: string }).code
    const msg = err instanceof Error ? err.message : String(err)
    if (code === '23505' || /duplicate key/i.test(msg)) {
      return c.json(v2ErrorBody('conflict', { conflictType: 'unique', table: 'image' }), 409)
    }
    throw err
  }

  return c.json(
    {
      id: imageId,
      filename: body.filename,
      mimeType: blob.mimeType,
      contentHash: body.contentHash,
    },
    201,
  )
})

const RefBulkBody = z.strictObject({
  items: z
    .array(
      z.strictObject({
        contentHash: z.string().regex(/^[0-9a-f]{64}$/),
        filename: z.string(),
      }),
    )
    .min(1),
})

imagesV2.post('/specifications/:id/images/ref-bulk', async (c) => {
  const session = c.get('v2Session')
  const specId = c.req.param('id')

  let body: z.infer<typeof RefBulkBody>
  try {
    body = RefBulkBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  if (body.items.length > MAX_IMAGE_REF_BULK_ITEMS) {
    return c.json(v2ErrorBody('payload_too_large', { limit: MAX_IMAGE_REF_BULK_ITEMS, actual: body.items.length }), 413)
  }
  for (const item of body.items) {
    if (!isAllowedFilename(item.filename)) return c.json(v2ErrorBody('schema_mismatch', { field: 'filename' }), 422)
  }

  // Permission gate (same as single-ref)
  const gate = await assertCanWriteSpec(session, specId)
  if (!gate.ok) return c.json(v2ErrorBody(gateErrorCode(gate.status)), gate.status)

  // Pre-validate all items outside the transaction: visibility check + blob
  // lookup. If any item fails we return before touching any image rows, giving
  // the same all-or-nothing guarantee without nesting rawQuery calls inside
  // withTransaction (which would deadlock PGlite via its processing lock).
  const resolved: Array<{ item: (typeof body.items)[0]; mimeType: string }> = []
  for (const item of body.items) {
    if (!(await userCanSeeContentHash(item.contentHash, session.userId))) {
      return c.json(v2ErrorBody('not_found'), 404)
    }
    const blobRows = await rawQuery<{ mimeType: string }>(
      `SELECT "mimeType" FROM image_blob WHERE "contentHash" = $1`,
      [item.contentHash],
    )
    if (!blobRows[0]) return c.json(v2ErrorBody('image_blob_not_found'), 404)
    resolved.push({ item, mimeType: blobRows[0].mimeType })
  }

  // Insert all atomically — only image rows go in the transaction so `q` is
  // the sole DB handle inside (no nesting).
  const inserted: Array<{ id: string; filename: string; mimeType: string; contentHash: string }> = []
  try {
    await withTransaction(async (q) => {
      for (const { item, mimeType } of resolved) {
        const imageId = randomUUID()
        await q(
          `INSERT INTO image ("id", "specificationId", "filename", "mimeType", "contentHash", "createdAt") VALUES ($1, $2, $3, $4, $5, $6)`,
          [imageId, specId, item.filename, mimeType, item.contentHash, Date.now()],
        )
        inserted.push({ id: imageId, filename: item.filename, mimeType, contentHash: item.contentHash })
      }
    })
  } catch (err) {
    const code = (err as { code?: string }).code
    const msg = err instanceof Error ? err.message : String(err)
    if (code === '23505' || /duplicate key/i.test(msg)) {
      return c.json(v2ErrorBody('conflict', { conflictType: 'unique', table: 'image' }), 409)
    }
    throw err
  }

  return c.json({ items: inserted }, 201)
})
