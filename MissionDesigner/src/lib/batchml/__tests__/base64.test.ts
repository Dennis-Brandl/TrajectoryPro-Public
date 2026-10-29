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
import { toBase64Utf8, fromBase64Utf8 } from '../base64'

describe('base64 utf-8 round-trip', () => {
  it('round-trips ascii', () => {
    const s = '{"a":1,"b":"x"}'
    expect(fromBase64Utf8(toBase64Utf8(s))).toBe(s)
  })

  it('round-trips unicode and xml-hostile chars', () => {
    const s = '<tag>café & "quotes" — 温度</tag>'
    expect(fromBase64Utf8(toBase64Utf8(s))).toBe(s)
  })

  it('round-trips a large string', () => {
    const s = 'x'.repeat(200_000)
    expect(fromBase64Utf8(toBase64Utf8(s))).toBe(s)
  })
})
