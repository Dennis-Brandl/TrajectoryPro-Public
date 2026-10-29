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
import type { FormDocument, GridSpan } from '@mission/form-schema'
import { resizeSpan, snapSpanDelta } from '@/lib/form-document/span-resize'

const doc = (leftSpan: GridSpan, rightSpan: GridSpan): FormDocument => ({
  version: 2,
  sections: [
    {
      id: 'sec',
      role: 'content',
      rows: [
        {
          id: 'row',
          blocks: [
            { id: 'L', type: 'text', content: '', layout: { span: { base: leftSpan } } },
            { id: 'R', type: 'text', content: '', layout: { span: { base: rightSpan } } },
          ],
        },
      ],
    },
  ],
})
const spanOf = (d: FormDocument, id: string) =>
  (d.sections[0].rows[0].blocks.find((b) => b.id === id)!.layout!.span as { base: number }).base

describe('resizeSpan', () => {
  it('redistributes columns conserving the pair total (base)', () => {
    const out = resizeSpan(doc(6, 6), 'L', 'R', 2, 'base')
    expect(spanOf(out, 'L')).toBe(8)
    expect(spanOf(out, 'R')).toBe(4)
  })

  it('clamps so neither block drops below 1', () => {
    const out = resizeSpan(doc(6, 6), 'L', 'R', 99, 'base')
    expect(spanOf(out, 'L')).toBe(11)
    expect(spanOf(out, 'R')).toBe(1)
  })

  it('writes a per-breakpoint override, leaving base untouched', () => {
    const out = resizeSpan(doc(6, 6), 'L', 'R', 2, 'tablet')
    const l = out.sections[0].rows[0].blocks.find((b) => b.id === 'L')!.layout!.span as {
      base: number
      tablet?: number
    }
    expect(l.base).toBe(6)
    expect(l.tablet).toBe(8)
  })

  it('returns the same reference on a no-op (net-zero delta)', () => {
    const d = doc(6, 6)
    expect(resizeSpan(d, 'L', 'R', 0, 'base')).toBe(d)
  })

  it('returns the same reference when the blocks are not an adjacent pair', () => {
    const d = doc(6, 6)
    expect(resizeSpan(d, 'R', 'L', 2, 'base')).toBe(d) // wrong order = not adjacent
    expect(resizeSpan(d, 'L', 'missing', 2, 'base')).toBe(d)
  })

  it('never emits a span above 12 when the pair already sums past 12 (reachable via the inspector)', () => {
    const d = doc(12 as GridSpan, 6)
    // left=12, right=6 → total 18; each block individually a valid GridSpan
    const shrunk = resizeSpan(d, 'L', 'R', -1, 'base')
    expect(spanOf(shrunk, 'L')).toBe(11)
    expect(spanOf(shrunk, 'R')).toBe(7)
    // cannot grow L past 12 → no-op, same ref
    expect(resizeSpan(d, 'L', 'R', 1, 'base')).toBe(d)
  })
})

describe('snapSpanDelta', () => {
  it('snaps a pixel delta to the nearest whole column', () => {
    expect(snapSpanDelta(95, 40, 6, 6)).toBe(2) // 95/40 ≈ 2.4 → 2
    expect(snapSpanDelta(-38, 40, 6, 6)).toBe(-1)
  })
  it('clamps so neither side goes below 1', () => {
    expect(snapSpanDelta(1000, 40, 6, 6)).toBe(5) // right can only give up 5 (6→1)
    expect(snapSpanDelta(-1000, 40, 6, 6)).toBe(-5) // left can only give up 5
  })
  it('returns 0 when column width is non-positive', () => {
    expect(snapSpanDelta(50, 0, 6, 6)).toBe(0)
  })

  it('respects the 12-column ceiling when the pair sums past 12', () => {
    // left already at 12 → cannot grow
    expect(snapSpanDelta(1000, 40, 12, 6)).toBe(0)
    // right capped at 12 → left floor = total-12 = 6
    expect(snapSpanDelta(-1000, 40, 12, 6)).toBe(-6)
  })
})
