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

import JSZip from 'jszip'

export interface ZipLimits {
  maxEntries: number
  maxTotalBytes: number
  maxEntryBytes: number
}

// Generous defaults — real packages are tiny; these only stop zip-bombs.
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 5_000,
  maxTotalBytes: 200 * 1024 * 1024, // 200 MB total uncompressed
  maxEntryBytes: 50 * 1024 * 1024, // 50 MB per entry
}

export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipLimitError'
  }
}

/**
 * Guard against zip-bombs: enforce entry-count and *uncompressed*-size caps
 * using JSZip's per-entry metadata (the declared uncompressed size from the
 * archive's central directory), so we reject before decompressing anything.
 */
export function assertZipWithinLimits(zip: JSZip, limits: ZipLimits = DEFAULT_ZIP_LIMITS): void {
  const entries = Object.values(zip.files).filter((f) => !f.dir)
  if (entries.length > limits.maxEntries) {
    throw new ZipLimitError(
      `Archive has too many entries (${entries.length} > ${limits.maxEntries})`
    )
  }
  let total = 0
  for (const entry of entries) {
    const size =
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
    if (size > limits.maxEntryBytes) {
      throw new ZipLimitError(
        `Archive entry "${entry.name}" is too large (${size} > ${limits.maxEntryBytes} bytes)`
      )
    }
    total += size
    if (total > limits.maxTotalBytes) {
      throw new ZipLimitError(
        `Archive decompresses to too much data (> ${limits.maxTotalBytes} bytes)`
      )
    }
  }
}

/**
 * Load a zip from a buffer and reject zip-bombs before any entry is read.
 * Drop-in replacement for `JSZip.loadAsync(buffer)`; throws ZipLimitError when
 * the archive exceeds the limits.
 */
export async function loadZipSafely(
  buffer: Buffer,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS
): Promise<JSZip> {
  const zip = await JSZip.loadAsync(buffer)
  assertZipWithinLimits(zip, limits)
  return zip
}
