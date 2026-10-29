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
import type { Block } from '@mission/form-schema'
import { computeEvenSpans, apportionRowSpans } from '../span-apportion'

const text = (id: string, layout?: Block['layout']): Block => ({ id, type: 'text', content: 'x', layout })

describe('computeEvenSpans', () => {
  it('splits 12 columns evenly, remainder to leading blocks', () => {
    expect(computeEvenSpans(1)).toEqual([12])
    expect(computeEvenSpans(2)).toEqual([6, 6])
    expect(computeEvenSpans(3)).toEqual([4, 4, 4])
    expect(computeEvenSpans(5)).toEqual([3, 3, 2, 2, 2])
    expect(computeEvenSpans(12)).toEqual(Array(12).fill(1))
  })
  it('returns [] for n<=0', () => {
    expect(computeEvenSpans(0)).toEqual([])
  })
  it('never emits a span outside 1..12, even for the degenerate >12 case', () => {
    const spans = computeEvenSpans(13)
    expect(spans).toHaveLength(13)
    expect(spans.every((s) => s >= 1 && s <= 12)).toBe(true)
    expect(spans).toEqual(Array(13).fill(1))
  })
})

describe('apportionRowSpans', () => {
  it('sets span.base to the even split for every block', () => {
    const out = apportionRowSpans([text('a'), text('b')])
    expect(out[0].layout?.span?.base).toBe(6)
    expect(out[1].layout?.span?.base).toBe(6)
  })
  it('a single block becomes full width (12)', () => {
    expect(apportionRowSpans([text('a')])[0].layout?.span?.base).toBe(12)
  })
  it('preserves tablet/phone span overrides and other layout fields', () => {
    const b = text('a', { span: { base: 4, tablet: 2, phone: 12 }, aspectRatio: '16/9', align: 'center' })
    const out = apportionRowSpans([b, text('b')])
    expect(out[0].layout?.span).toEqual({ base: 6, tablet: 2, phone: 12 })
    expect(out[0].layout?.aspectRatio).toBe('16/9')
    expect(out[0].layout?.align).toBe('center')
  })
  it('does not mutate the input blocks', () => {
    const b = text('a', { span: { base: 4 } })
    apportionRowSpans([b, text('b')])
    expect(b.layout?.span?.base).toBe(4)
  })
})
