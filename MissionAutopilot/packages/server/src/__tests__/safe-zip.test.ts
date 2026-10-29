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

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { assertZipWithinLimits, ZipLimitError } from '../lib/safe-zip.js'

// Build a real zip then load it back, so per-entry uncompressed sizes are
// populated from the archive's central directory (as in production).
async function loadZip(build: (z: JSZip) => void) {
  const zip = new JSZip()
  build(zip)
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  return JSZip.loadAsync(buf)
}

describe('assertZipWithinLimits', () => {
  it('passes for a small archive', async () => {
    const zip = await loadZip((z) => z.file('a.txt', 'hello'))
    expect(() =>
      assertZipWithinLimits(zip, { maxEntries: 10, maxTotalBytes: 1000, maxEntryBytes: 1000 })
    ).not.toThrow()
  })

  it('rejects an entry larger than maxEntryBytes', async () => {
    const zip = await loadZip((z) => z.file('big.txt', 'x'.repeat(2000)))
    expect(() =>
      assertZipWithinLimits(zip, { maxEntries: 10, maxTotalBytes: 100_000, maxEntryBytes: 1000 })
    ).toThrow(ZipLimitError)
  })

  it('rejects too many entries', async () => {
    const zip = await loadZip((z) => {
      for (let i = 0; i < 5; i++) z.file(`f${i}.txt`, 'x')
    })
    expect(() =>
      assertZipWithinLimits(zip, { maxEntries: 3, maxTotalBytes: 100_000, maxEntryBytes: 1000 })
    ).toThrow(ZipLimitError)
  })

  it('rejects total decompressed size over the cap', async () => {
    const zip = await loadZip((z) => {
      z.file('a.txt', 'x'.repeat(600))
      z.file('b.txt', 'x'.repeat(600))
    })
    expect(() =>
      assertZipWithinLimits(zip, { maxEntries: 10, maxTotalBytes: 1000, maxEntryBytes: 1000 })
    ).toThrow(ZipLimitError)
  })
})
