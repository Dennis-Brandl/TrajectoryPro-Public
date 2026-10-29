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
import { quantizeSpans } from '../convert/spans'
import type { V1Element } from '../convert/v1-types'
import type { ConversionEntry } from '../convert/report'

const el = (id: string, w: number): V1Element => ({ id, type: 'text', x: 0, y: 0, width: w, height: 40 })

describe('quantizeSpans', () => {
  it('gives a lone wide element the full 12 columns', () => {
    const entries: ConversionEntry[] = []
    expect(quantizeSpans([el('a', 900)], entries)).toEqual([12])
    expect(entries).toEqual([])
  })

  it('rounds a lone narrow element to the nearest of {3,4,6,8}', () => {
    const entries: ConversionEntry[] = []
    // 300/947 = 0.317 => below 55%; nearest column count to 0.317*12=3.8 among {3,4,6,8} is 4
    expect(quantizeSpans([el('a', 300)], entries)).toEqual([4])
    expect(entries.some((e) => e.kind === 'spanRounding')).toBe(true)
  })

  it('splits a two-element row proportionally, summing to 12', () => {
    const entries: ConversionEntry[] = []
    // widths 640/320 => raw 8/4 exactly
    expect(quantizeSpans([el('a', 640), el('b', 320)], entries)).toEqual([8, 4])
  })

  it('never sums above 12 and never drops below 1 per element', () => {
    const entries: ConversionEntry[] = []
    const spans = quantizeSpans([el('a', 10), el('b', 10), el('c', 10), el('d', 900)], entries)
    expect(spans.every((s) => s >= 1)).toBe(true)
    expect(spans.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(12)
  })

  it('reports rounding when the proportional split is not integer', () => {
    const entries: ConversionEntry[] = []
    // 500/447 => raw ~6.34 / ~5.66 => rounds to 6/6
    quantizeSpans([el('a', 500), el('b', 447)], entries)
    expect(entries.filter((e) => e.kind === 'spanRounding')).toHaveLength(1)
  })

  it('does not corrupt the array for a row of more than 12 elements', () => {
    const entries: ConversionEntry[] = []
    // 13 equal elements: every span floors to 1, sum 13, nothing reducible below the floor.
    // The overflow loop must STOP (not write spans[-1]); each block spans 1 and the grid wraps.
    const spans = quantizeSpans(Array.from({ length: 13 }, (_, i) => el(`e${i}`, 70)), entries)
    expect(spans).toHaveLength(13)
    expect(spans.every((s) => s === 1)).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(spans, '-1')).toBe(false) // no phantom NaN index
  })

  it('does not report rounding for a lone element already near a grid boundary', () => {
    const entries: ConversionEntry[] = []
    // 316/947*12 = 4.004 => nearest 4, diff 0.004 < 0.01 => NO spanRounding entry
    expect(quantizeSpans([el('a', 316)], entries)).toEqual([4])
    expect(entries.filter((e) => e.kind === 'spanRounding')).toHaveLength(0)
  })
})
