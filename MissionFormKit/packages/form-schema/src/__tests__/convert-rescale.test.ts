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
import { rescaleLegacyDesktop } from '../convert/rescale'
import type { V1Element } from '../convert/v1-types'
import type { ConversionEntry } from '../convert/report'

const el = (o: Partial<V1Element>): V1Element => ({ id: 'e', type: 'text', x: 0, y: 0, width: 100, height: 20, ...o })

describe('rescaleLegacyDesktop', () => {
  it('leaves in-bounds desktop layouts untouched and reports nothing', () => {
    const entries: ConversionEntry[] = []
    const input = [el({ id: 'a', x: 10, y: 10, width: 200, height: 40 })]
    const out = rescaleLegacyDesktop(input, entries)
    expect(out).toEqual(input)
    expect(out).not.toBe(input) // new array, no mutation
    expect(entries).toEqual([])
  })

  it('rescales ALL elements from tablet space when any overflows 1024', () => {
    const entries: ConversionEntry[] = []
    // second element overflows (1200+100 > 1024) => whole layout treated as tablet-authored
    const input = [el({ id: 'a', x: 0, y: 0, width: 640, height: 360 }), el({ id: 'b', x: 1200, y: 360, width: 100, height: 40 })]
    const out = rescaleLegacyDesktop(input, entries)
    // sx = 1024/1280 = 0.8, sy = 768/720 = 1.0666..
    expect(out[0]).toMatchObject({ id: 'a', x: 0, y: 0, width: 512, height: 384 })
    expect(out[1]!.x).toBe(960) // round(1200*0.8)
    expect(entries.filter((e) => e.kind === 'legacyRescale')).toHaveLength(2)
  })

  it('never lets a rescaled element fall below the 20x16 floor', () => {
    const entries: ConversionEntry[] = []
    const input = [el({ id: 'a', x: 1100, y: 0, width: 5, height: 2 })]
    const out = rescaleLegacyDesktop(input, entries)
    expect(out[0]!.width).toBe(20)
    expect(out[0]!.height).toBe(16)
  })

  it('does not rescale when an element right edge is exactly 1024 (boundary)', () => {
    const entries: ConversionEntry[] = []
    const input = [el({ id: 'a', x: 924, y: 10, width: 100, height: 40 })] // x+width === 1024 exactly
    const out = rescaleLegacyDesktop(input, entries)
    expect(out).toEqual(input)
    expect(entries).toEqual([])
  })
})
