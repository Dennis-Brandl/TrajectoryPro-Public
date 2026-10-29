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
import {
  EXPORT_WARNINGS_HEADER,
  EXPORT_WARNINGS_MAX_ENCODED_LENGTH,
  encodeExportWarnings,
  decodeExportWarnings,
} from '../export-warnings-header'

describe('export warnings header (GATE follow-up item 5, server round-trip)', () => {
  it('names a lowercase custom header', () => {
    expect(EXPORT_WARNINGS_HEADER).toBe('x-export-warnings')
  })

  it('encodes nothing when there are no warnings — the header is simply absent', () => {
    expect(encodeExportWarnings([])).toBeUndefined()
  })

  it('round-trips ASCII and non-ASCII warnings through a header-safe ASCII value', () => {
    const warnings = [
      'Image "logo.png" not exported: spec.data.images value is not a base64 data URI',
      'Action Property group "Sensor" is declared by 2 environments — bound to «Alpha» (naïve)',
    ]
    const encoded = encodeExportWarnings(warnings)
    expect(encoded).toBeDefined()
    // Header field values must be ASCII with no control characters or spaces.
    expect(encoded).toMatch(/^[\x21-\x7e]+$/)
    expect(decodeExportWarnings(encoded!)).toEqual(warnings)
  })

  it('decodes an absent header to an empty list', () => {
    expect(decodeExportWarnings(null)).toEqual([])
    expect(decodeExportWarnings(undefined)).toEqual([])
    expect(decodeExportWarnings('')).toEqual([])
  })

  it('decodes a malformed header to an empty list rather than throwing', () => {
    expect(decodeExportWarnings('not-json')).toEqual([])
    expect(decodeExportWarnings('%E0%A4%A')).toEqual([]) // truncated percent-escape → URIError inside
    expect(decodeExportWarnings(encodeURIComponent('{"a":1}'))).toEqual([]) // JSON, but not a string array
    expect(decodeExportWarnings(encodeURIComponent('[1, "x", null]'))).toEqual([]) // mixed array
  })

  it('caps a huge warning list by keeping whole entries and adding one "+N more" entry', () => {
    const warnings = Array.from({ length: 400 }, (_, i) => `warning ${i} ${'x'.repeat(90)}`)
    const encoded = encodeExportWarnings(warnings)!
    expect(encoded.length).toBeLessThanOrEqual(EXPORT_WARNINGS_MAX_ENCODED_LENGTH)
    const decoded = decodeExportWarnings(encoded)
    expect(decoded.length).toBeGreaterThan(1)
    expect(decoded.length).toBeLessThan(warnings.length)
    const kept = decoded.slice(0, -1)
    expect(kept).toEqual(warnings.slice(0, kept.length))
    expect(decoded[decoded.length - 1]).toBe(`+${warnings.length - kept.length} more, see the server log`)
  })

  it('a single entry that alone exceeds the cap collapses to just the "+1 more" entry', () => {
    const encoded = encodeExportWarnings(['y'.repeat(20_000)])!
    expect(encoded.length).toBeLessThanOrEqual(EXPORT_WARNINGS_MAX_ENCODED_LENGTH)
    expect(decodeExportWarnings(encoded)).toEqual(['+1 more, see the server log'])
  })

  it('does not cap a list that fits', () => {
    const warnings = Array.from({ length: 5 }, (_, i) => `w${i}`)
    expect(decodeExportWarnings(encodeExportWarnings(warnings)!)).toEqual(warnings)
  })
})
