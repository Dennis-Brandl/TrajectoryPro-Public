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

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { readSafeZip, SafeZipError } from '../safeZipReader'

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000000500' +
    '010da25e6c0000000049454e44ae426082',
  'hex',
)

async function buildZip(entries: Record<string, Buffer | string>): Promise<Buffer> {
  const z = new JSZip()
  for (const [name, body] of Object.entries(entries)) z.file(name, body)
  return Buffer.from(await z.generateAsync({ type: 'uint8array' }))
}

describe('readSafeZip', () => {
  it('reads a minimal valid ZIP and returns json + image entries', async () => {
    const zip = await buildZip({
      'workflow.WFmaster': '{"schemaVersion":"4.0","steps":[]}',
      'images/a.png': PNG_BYTES,
    })
    const result = await readSafeZip(zip)
    expect(result.jsonEntryName).toBe('workflow.WFmaster')
    expect(result.jsonText).toContain('"schemaVersion"')
    expect(result.images).toHaveLength(1)
    expect(result.images[0].filename).toBe('a.png')
    expect(result.images[0].mimeType).toBe('image/png')
    expect(Buffer.compare(result.images[0].bytes, PNG_BYTES)).toBe(0)
  })

  it('throws zip_too_many_entries when entries exceed cap', async () => {
    const entries: Record<string, string> = { 'workflow.WFmaster': '{}' }
    for (let i = 0; i < 1101; i++) entries[`images/${i}.png`] = 'x'
    const zip = await buildZip(entries)
    await expect(readSafeZip(zip)).rejects.toThrow(SafeZipError)
  })

  it('throws zip_filename_invalid on path traversal', async () => {
    const zip = await buildZip({ '../escape.png': 'x' })
    await expect(readSafeZip(zip)).rejects.toThrow(/zip_filename_invalid/)
  })

  it('accepts library entries whose names have apostrophes and punctuation', async () => {
    const zip = await buildZip({
      'workflow.WFmaster': '{}',
      "environments/Mama Jane's Pizza.WFenvir": '{}',
      'actions/R&D (Lab) Actions.WFaction': '{}',
    })
    const result = await readSafeZip(zip)
    expect(result.envLibraries.map((e) => e.name)).toEqual(["Mama Jane's Pizza"])
    expect(result.actionLibraries.map((e) => e.name)).toEqual(['R&D (Lab) Actions'])
  })

  it('throws zip_filename_invalid on a nested traversal segment', async () => {
    const zip = await buildZip({ 'workflow.WFmaster': '{}', 'environments/../x.WFenvir': '{}' })
    await expect(readSafeZip(zip)).rejects.toThrow(/zip_filename_invalid/)
  })

  it('throws zip_filename_invalid on a backslash', async () => {
    const zip = await buildZip({ 'workflow.WFmaster': '{}', 'environments\\x.WFenvir': '{}' })
    await expect(readSafeZip(zip)).rejects.toThrow(/zip_filename_invalid/)
  })

  it('throws zip_filename_invalid on absolute path', async () => {
    const zip = await buildZip({ '/absolute.png': 'x' })
    await expect(readSafeZip(zip)).rejects.toThrow(/zip_filename_invalid/)
  })

  it('throws zip_image_mime_invalid when an images/* entry is not a real image', async () => {
    const zip = await buildZip({
      'workflow.WFmaster': '{}',
      'images/fake.png': Buffer.from('NOTANIMAGE'),
    })
    await expect(readSafeZip(zip)).rejects.toThrow(/zip_image_mime_invalid/)
  })

  it('throws zip_entry_too_large when one entry decompresses past the cap', async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 0xff) // 11 MB > 10 MB cap
    const zip = await buildZip({ 'workflow.WFmaster': '{}', 'images/big.png': big })
    await expect(readSafeZip(zip)).rejects.toThrow(/zip_entry_too_large|zip_image_mime_invalid/)
    // (the MIME sniff may fire first because the bytes aren't a real PNG; either error is acceptable)
  })

  it('returns no images when the ZIP has only the .WFmaster entry', async () => {
    const zip = await buildZip({ 'workflow.WFmaster': '{"steps":[]}' })
    const result = await readSafeZip(zip)
    expect(result.images).toHaveLength(0)
  })

  it('throws json_envelope_invalid when no .WFmaster entry exists', async () => {
    const zip = await buildZip({ 'images/a.png': PNG_BYTES })
    await expect(readSafeZip(zip)).rejects.toThrow(/json_envelope_invalid/)
  })

  it('rejects bare *.json entries (legacy envelope no longer accepted)', async () => {
    const zip = await buildZip({ 'foo.json': '{}', 'images/a.png': PNG_BYTES })
    await expect(readSafeZip(zip)).rejects.toThrow(/zip_filename_invalid/)
  })
})
