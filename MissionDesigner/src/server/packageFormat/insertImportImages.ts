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

// Phase 35 §2.10: insert image_blob + image rows for an import.
// Runs inside a single withTransaction so any failure rolls back all inserts.
// Uses rawQuery helpers because image lifecycle doesn't go through a write DAO.

import { createHash, randomUUID } from 'node:crypto'
import { withTransaction } from '../lib/db'
import type { ImportImageInsert } from './buildImportBatch'
import type { SafeZipImage } from './safeZipReader'

/** Connection-scoped query function from an outer withTransaction. */
type Q = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>

export class ImportImageMissingError extends Error {
  constructor(
    public newSpecId: string,
    public filename: string,
  ) {
    super(`import_image_missing:${newSpecId}/${filename}`)
    this.name = 'ImportImageMissingError'
  }
}

/**
 * Insert image_blob + image rows for a workflow import.
 *
 * @param inserts     Image inserts computed by buildImportBatch.
 * @param safeImages  Validated image bytes from the ZIP.
 * @param externalQ   When provided the inserts run inside the caller's outer
 *                    transaction — DO NOT open another withTransaction. When
 *                    omitted a fresh transaction is opened (standalone callers).
 */
export async function insertImportImages(
  inserts: ImportImageInsert[],
  safeImages: SafeZipImage[],
  externalQ?: Q,
): Promise<void> {
  if (inserts.length === 0) return

  // Build a filename → SafeZipImage map for fast lookup.
  // ZIP entries can be named:
  //   - `{filename}` — client exports and v7 UI parameter images
  //   - `{specId}-{filename}` — legacy v3 server exports
  //   - `{imageOid}-{filename}` — v7 form-element images (imageOid is the form
  //     element's stable OID, not derivable from the spec)
  // For the third case we fall back to a suffix match on `-{filename}`.
  const byFilename = new Map<string, SafeZipImage>()
  for (const img of safeImages) byFilename.set(img.filename, img)
  const findBySuffix = (filename: string): SafeZipImage | undefined => {
    const suffix = `-${filename}`
    for (const img of safeImages) {
      if (img.filename.endsWith(suffix)) return img
    }
    return undefined
  }

  const now = Date.now()

  const doInserts = async (q: Q): Promise<void> => {
    for (const ins of inserts) {
      // Try bare filename first (client exports), then specId-prefixed (legacy v3 server),
      // then suffix-match for v7 form-element images keyed by imageOid.
      const safe =
        byFilename.get(ins.filename) ??
        byFilename.get(`${ins.sourceSpecId}-${ins.filename}`) ??
        findBySuffix(ins.filename)
      if (!safe) throw new ImportImageMissingError(ins.newSpecId, ins.filename)

      const contentHash = createHash('sha256').update(safe.bytes).digest('hex')
      const imageId = randomUUID()

      // Upsert blob (refCount stays 0 — the trigger bumps it on image insert).
      // M1: pass Buffer to ensure bytea is written correctly under both pg and PGlite.
      await q(
        `INSERT INTO image_blob ("contentHash", data, "mimeType", "byteSize", "createdAt", "refCount")
         VALUES ($1, $2, $3, $4, $5, 0)
         ON CONFLICT("contentHash") DO NOTHING`,
        [contentHash, Buffer.from(safe.bytes), safe.mimeType, safe.bytes.length, now],
      )

      // Insert image row
      await q(
        `INSERT INTO image (id, "specificationId", filename, "mimeType", "contentHash", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [imageId, ins.newSpecId, ins.filename, safe.mimeType, contentHash, now],
      )
    }
  }

  if (externalQ) {
    // Running inside the caller's outer transaction — use their q directly.
    await doInserts(externalQ)
  } else {
    // Standalone path: open a fresh transaction.
    await withTransaction(async (q) => doInserts(q))
  }
}
