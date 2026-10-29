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
import { isAllowedFilename, sniffMime, ALLOWED_IMAGE_MIMES } from '../../imageMime'

describe('isAllowedFilename (§2.6)', () => {
  it.each(['a.png', 'IMG_0001.JPEG', 'cover-v2.webp', 'diagram_1.gif', 'foo.bar.baz.png'])('accepts %s', (n) => {
    expect(isAllowedFilename(n)).toBe(true)
  })
  it.each(['', '.hidden.png', '../escape.png', 'path/file.png', '\u0000null.png', 'a'.repeat(256)])(
    'rejects %s',
    (n) => {
      expect(isAllowedFilename(n)).toBe(false)
    },
  )
})

describe('sniffMime (§2.6)', () => {
  it('detects PNG', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(sniffMime(bytes)).toBe('image/png')
  })
  it('detects JPEG', () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    expect(sniffMime(bytes)).toBe('image/jpeg')
  })
  it('detects GIF87a', () => {
    expect(sniffMime(Buffer.from('GIF87a'))).toBe('image/gif')
  })
  it('detects GIF89a', () => {
    expect(sniffMime(Buffer.from('GIF89a'))).toBe('image/gif')
  })
  it('detects WebP', () => {
    // RIFF....WEBP
    const bytes = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')])
    expect(sniffMime(bytes)).toBe('image/webp')
  })
  it('returns null for unknown formats (BMP)', () => {
    expect(sniffMime(Buffer.from('BM'))).toBeNull()
  })
  it('returns null for too-short input', () => {
    expect(sniffMime(Buffer.from([0xff]))).toBeNull()
  })
})

describe('ALLOWED_IMAGE_MIMES', () => {
  it('contains exactly png/jpeg/webp/gif', () => {
    expect([...ALLOWED_IMAGE_MIMES].sort()).toEqual(['image/gif', 'image/jpeg', 'image/png', 'image/webp'])
  })
})
