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

// Phase 35 §2.10: safe ZIP reader for /api/v2/packages/import.
//
// Defense layers (in order):
//   1. JSZip.loadAsync — parses central directory only, fast, low memory
//   2. Entry count cap — rejects "lots of small entries" zip bombs
//   3. Per-entry filename allowlist — rejects path traversal / absolute / NUL
//   4. Byte-budgeted inflation per entry — inflation stops the moment an entry passes its cap,
//      so a content bomb is never fully inflated
//   5. Running total cap — rejects multi-entry bombs
//   6. MIME magic-byte sniff for every images/* entry — rejects MIME spoof
//
// The single envelope entry MUST be named *.WFmaster — the legacy bare *.json
// envelope was removed when the import side moved fully onto the v7.0 runtime
// contract.

import JSZip from 'jszip'
import { sniffMime, isAllowedFilename, ALLOWED_IMAGE_MIMES } from '../imageMime'
import {
  MAX_IMPORT_ENTRIES,
  MAX_IMPORT_PER_ENTRY_BYTES,
  MAX_IMPORT_TOTAL_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_IMPORT,
} from '../limits'

export class SafeZipError extends Error {
  constructor(
    public code: string,
    public extra?: Record<string, unknown>,
  ) {
    super(code)
    this.name = 'SafeZipError'
  }
}

/**
 * Inflates one entry, giving up the moment it passes `limit` bytes. JSZip inflates in chunks, and a
 * stream nobody reads stalls its worker, so an oversized entry is abandoned after a few chunks
 * instead of being inflated whole.
 */
function inflateWithinLimit(file: JSZip.JSZipObject, limit: number): Promise<Buffer | 'over'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const stream = file.nodeStream('nodebuffer')
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        stream.removeAllListeners('data')
        stream.pause()
        resolve('over')
        return
      }
      chunks.push(chunk)
    })
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', () => reject(new SafeZipError('json_envelope_invalid', { reason: 'corrupt ZIP entry' })))
  })
}

/**
 * Inflates `file` within `entryLimit` and the `remainingTotal` still unspent of the archive's
 * total, throwing the matching SafeZipError when either is passed.
 */
async function inflateEntry(
  file: JSZip.JSZipObject,
  name: string,
  entryLimit: number,
  remainingTotal: number,
  totalLimit: number,
): Promise<Buffer> {
  const bytes = await inflateWithinLimit(file, Math.min(entryLimit, remainingTotal))
  if (bytes !== 'over') return bytes
  if (entryLimit <= remainingTotal) throw new SafeZipError('zip_entry_too_large', { name, limit: entryLimit })
  throw new SafeZipError('zip_total_too_large', { limit: totalLimit })
}

export interface ZipBudget {
  /** Most entries (directories included) the archive may hold. */
  entries: number
  /** Most bytes all entries may inflate to, together. */
  totalBytes: number
  /** Most bytes the named entry may inflate to. */
  entryBytes: (name: string) => number
}

/**
 * Opens an archive within `budget`. Every entry is inflated under its byte budget, so an archive
 * that lies about its sizes is stopped partway rather than inflated whole. Returns a fresh JSZip
 * holding the inflated entries (directories dropped), ready for cheap reads.
 */
export async function readBudgetedZip(buffer: Uint8Array, budget: ZipBudget): Promise<JSZip> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new SafeZipError('json_envelope_invalid', { reason: 'not a valid ZIP' })
  }
  const names = Object.keys(zip.files)
  if (names.length > budget.entries) {
    throw new SafeZipError('zip_too_many_entries', { count: names.length, limit: budget.entries })
  }
  const out = new JSZip()
  let total = 0
  for (const name of names) {
    const file = zip.files[name]
    if (file.dir) continue
    const bytes = await inflateEntry(file, name, budget.entryBytes(name), budget.totalBytes - total, budget.totalBytes)
    total += bytes.length
    out.file(name, bytes, { createFolders: false })
  }
  return out
}

/** Opens a `.WFlibX` workflow-library archive within the import limits; entry names are not restricted. */
export function readSafeLibraryZip(buffer: Buffer): Promise<JSZip> {
  return readBudgetedZip(buffer, {
    entries: MAX_IMPORT_ENTRIES,
    totalBytes: MAX_IMPORT_TOTAL_BYTES,
    entryBytes: (name) => (name.startsWith('images/') ? MAX_IMAGE_BYTES : MAX_IMPORT_PER_ENTRY_BYTES),
  })
}

export interface SafeZipImage {
  /** Filename as it appears in the ZIP (after the `images/` prefix is stripped). */
  filename: string
  /** Sniffed MIME type (one of ALLOWED_IMAGE_MIMES). */
  mimeType: string
  /** Decompressed bytes. */
  bytes: Buffer
}

export interface SafeZipSiblingJson {
  /** Library name as it appears in the ZIP filename (without the extension). */
  name: string
  /** Decompressed JSON text. */
  jsonText: string
}

export interface SafeZipResult {
  /** Name of the .WFmaster entry treated as the workflow envelope. */
  jsonEntryName: string
  /** Decompressed envelope contents as text. */
  jsonText: string
  /** All entries under `images/`, MIME-sniffed and size-validated. */
  images: SafeZipImage[]
  /** v7.0 environment library JSONs found under `environments/`. */
  envLibraries: SafeZipSiblingJson[]
  /** v7.0 action library JSONs found under `actions/`. */
  actionLibraries: SafeZipSiblingJson[]
  /** v7.0 `manifest.json` text, if present. Advisory only — runtime ignores it. */
  manifestJsonText: string | null
}

const FILENAME_ALLOW_RE = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,254}$/

function validateZipFilename(name: string): void {
  if (!name) throw new SafeZipError('zip_filename_invalid', { reason: 'empty' })
  if (name.length > 255) throw new SafeZipError('zip_filename_invalid', { reason: 'too long', name })
  if (name.startsWith('/')) throw new SafeZipError('zip_filename_invalid', { reason: 'absolute', name })
  if (name.includes('..')) throw new SafeZipError('zip_filename_invalid', { reason: 'traversal', name })
  if (name.includes('\u0000')) throw new SafeZipError('zip_filename_invalid', { reason: 'nul', name })
  if (!FILENAME_ALLOW_RE.test(name)) throw new SafeZipError('zip_filename_invalid', { reason: 'charset', name })
}

export async function readSafeZip(buffer: Buffer): Promise<SafeZipResult> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new SafeZipError('json_envelope_invalid', { reason: 'not a valid ZIP' })
  }

  // Step 2: entry count cap (counts directories too — they're cheap but still budget)
  const entryNames = Object.keys(zip.files)
  if (entryNames.length > MAX_IMPORT_ENTRIES) {
    throw new SafeZipError('zip_too_many_entries', { count: entryNames.length, limit: MAX_IMPORT_ENTRIES })
  }

  // Step 3: filename validation pass (cheap, before any decompression)
  for (const name of entryNames) {
    if (zip.files[name].dir) continue
    validateZipFilename(name)
  }

  // Step 4-6: walk entries, decompress + validate sizes, sniff images.
  let jsonEntryName: string | null = null
  let jsonText: string | null = null
  const images: SafeZipImage[] = []
  const envLibraries: SafeZipSiblingJson[] = []
  const actionLibraries: SafeZipSiblingJson[] = []
  let manifestJsonText: string | null = null
  let totalDecompressed = 0

  for (const name of entryNames) {
    const file = zip.files[name]
    if (file.dir) continue

    // The .WFmaster JSON is the workflow envelope — exactly one expected.
    // manifest.json is advisory metadata (v7.0); we skip it on import per the
    // runtime spec which says manifest is optional and not authoritative.
    // environments/*.WFenvir and actions/*.WFaction are sibling library JSONs
    // included by v7.0 single-workflow packages. images/* are processed below.
    const isWorkflowEnvelope = name.endsWith('.WFmaster')
    const isManifest = name === 'manifest.json'
    const isEnvLib = name.startsWith('environments/') && name.endsWith('.WFenvir')
    const isActionLib = name.startsWith('actions/') && name.endsWith('.WFaction')
    const isImage = name.startsWith('images/') && !name.endsWith('/')

    if (!isWorkflowEnvelope && !isManifest && !isEnvLib && !isActionLib && !isImage) {
      // Unknown top-level junk. Reject — the format only allows the entries above.
      throw new SafeZipError('zip_filename_invalid', { reason: 'unknown entry type', name })
    }

    const bytes = await inflateEntry(
      file,
      name,
      isImage ? MAX_IMAGE_BYTES : MAX_IMPORT_PER_ENTRY_BYTES,
      MAX_IMPORT_TOTAL_BYTES - totalDecompressed,
      MAX_IMPORT_TOTAL_BYTES,
    )
    totalDecompressed += bytes.length

    if (isManifest) {
      manifestJsonText = bytes.toString('utf8')
      continue
    }
    if (isEnvLib) {
      // Capture the env library JSON for the import handler to auto-create or
      // merge with the user's existing libraries (Phase 2). The library name
      // is the filename without the `environments/` prefix and `.WFenvir` suffix.
      const stripped = name.slice('environments/'.length, -'.WFenvir'.length)
      envLibraries.push({ name: stripped, jsonText: bytes.toString('utf8') })
      continue
    }
    if (isActionLib) {
      const stripped = name.slice('actions/'.length, -'.WFaction'.length)
      actionLibraries.push({ name: stripped, jsonText: bytes.toString('utf8') })
      continue
    }

    if (isWorkflowEnvelope) {
      // Exactly one .WFmaster is expected. Keep the first one found and
      // ignore subsequent duplicates rather than failing — the import will
      // either parse or reject downstream.
      if (jsonEntryName !== null) continue
      jsonEntryName = name
      jsonText = bytes.toString('utf8')
      continue
    }

    // Image entry: the per-image byte cap was applied while inflating; MIME sniff, allowlist
    const sniffed = sniffMime(bytes)
    if (!sniffed || !ALLOWED_IMAGE_MIMES.has(sniffed)) {
      throw new SafeZipError('zip_image_mime_invalid', { name })
    }
    const stripped = name.slice('images/'.length)
    if (!isAllowedFilename(stripped)) {
      throw new SafeZipError('zip_filename_invalid', { reason: 'image filename charset', name: stripped })
    }
    images.push({ filename: stripped, mimeType: sniffed, bytes })
    if (images.length > MAX_IMAGES_PER_IMPORT) {
      throw new SafeZipError('too_many_images', { count: images.length, limit: MAX_IMAGES_PER_IMPORT })
    }
  }

  if (jsonEntryName === null || jsonText === null) {
    throw new SafeZipError('json_envelope_invalid', { reason: 'no JSON entry found' })
  }

  return { jsonEntryName, jsonText, images, envLibraries, actionLibraries, manifestJsonText }
}
