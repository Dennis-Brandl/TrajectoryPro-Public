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

// Phase 35 §2.10: load image bytes for a set of spec ids. Used by the export
// endpoint to embed binary images in the streamed ZIP.
//
// This is the ONLY Plan 2b file that reads image_blob.data directly. The
// read DAO intentionally does not expose blob bytes (its manifest stops at
// filename + mimeType + byteSize). The export endpoint needs the raw bytes;
// loading them here keeps that boundary explicit.

import { rawQuery } from '../lib/db'

export interface LoadedImage {
  filename: string
  mimeType: string
  bytes: Buffer
}

export async function loadImageBytesForSpecs(specIds: string[]): Promise<Map<string, LoadedImage[]>> {
  const out = new Map<string, LoadedImage[]>()
  if (specIds.length === 0) return out

  // Build positional placeholders: $1, $2, ...
  const placeholders = specIds.map((_, i) => `$${i + 1}`).join(', ')
  const rows = await rawQuery<{
    specificationId: string
    filename: string
    mimeType: string
    data: Buffer | Uint8Array
  }>(
    `SELECT i."specificationId", i.filename, i."mimeType", ib.data
       FROM image i JOIN image_blob ib ON ib."contentHash" = i."contentHash"
      WHERE i."specificationId" IN (${placeholders})
      ORDER BY i."specificationId", i.filename`,
    specIds,
  )

  for (const row of rows) {
    const list = out.get(row.specificationId) ?? []
    // M1: normalize bytea — pg returns Buffer, PGlite returns Uint8Array.
    list.push({ filename: row.filename, mimeType: row.mimeType, bytes: Buffer.from(row.data) })
    out.set(row.specificationId, list)
  }
  return out
}
