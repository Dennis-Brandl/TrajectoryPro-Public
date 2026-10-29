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
import { mapBlock } from '../convert/blocks'
import type { V1Element } from '../convert/v1-types'
import type { ConversionEntry } from '../convert/report'

const base = { x: 0, y: 0, width: 100, height: 40 }
const conv = (el: V1Element) => {
  const entries: ConversionEntry[] = []
  return { block: mapBlock(el, entries), entries }
}

describe('mapBlock — content mapping', () => {
  it('maps a text element, converting fontSize px to a size token and reporting it', () => {
    const { block, entries } = conv({ id: 't', type: 'text', ...base, content: 'hi', fontSize: 18, align: 'center' })
    expect(block).toMatchObject({ id: 't', type: 'text', content: 'hi', size: 'lg', align: 'center' })
    expect(entries.filter((e) => e.kind === 'fontSizeLost')).toHaveLength(1)
  })

  it('maps a required text input with all its data props', () => {
    const { block } = conv({ id: 'i', type: 'textInput', ...base, fieldName: 'serial', label: 'Serial', required: true, inputMode: 'number', placeholder: 'SN' })
    expect(block).toMatchObject({ id: 'i', type: 'textInput', fieldName: 'serial', label: 'Serial', required: true, inputMode: 'number', placeholder: 'SN' })
  })

  it('maps checkbox/radio options through unchanged', () => {
    const opts = [{ label: 'A', value: 'a' }]
    expect(conv({ id: 'c', type: 'checkbox', ...base, fieldName: 'f', options: opts }).block).toMatchObject({ type: 'checkbox', options: opts })
    expect(conv({ id: 'r', type: 'radio', ...base, fieldName: 'g', options: opts }).block).toMatchObject({ type: 'radio', options: opts })
  })

  it('maps divider thickness to a weight token', () => {
    expect(conv({ id: 'd', type: 'divider', ...base, thickness: 4 }).block).toMatchObject({ type: 'divider', weight: 'thick' })
    expect(conv({ id: 'd', type: 'divider', ...base, thickness: 1 }).block).toMatchObject({ type: 'divider', weight: 'hairline' })
  })

  it('gives image and video an aspectRatio from v1 geometry', () => {
    const img = conv({ id: 'm', type: 'image', x: 0, y: 0, width: 400, height: 300, src: 'p.jpg' }).block
    expect(img).toMatchObject({ type: 'image', src: 'p.jpg', layout: { aspectRatio: '400/300' } })
    const vid = conv({ id: 'v', type: 'video', x: 0, y: 0, width: 320, height: 180, src: 'https://x/c.mp4' }).block
    expect(vid).toMatchObject({ type: 'video', layout: { aspectRatio: '320/180' } })
  })

  it('adds minHeight only for a tall textarea', () => {
    const tall = conv({ id: 'a', type: 'textarea', x: 0, y: 0, width: 200, height: 200, fieldName: 'notes', rows: 4 }).block
    expect(tall.layout?.minHeight).toEqual({ rem: 12.5 })
    const short = conv({ id: 'b', type: 'textarea', x: 0, y: 0, width: 200, height: 60, fieldName: 'notes', rows: 4 }).block
    expect(short.layout?.minHeight).toBeUndefined()
  })

  it('maps a timer with all runtime fields', () => {
    const t = conv({ id: 'z', type: 'timer', ...base, label: 'Cure', fieldName: 'cure', durationSeconds: 300, direction: 'countdown', blockDone: true }).block
    expect(t).toMatchObject({ type: 'timer', label: 'Cure', fieldName: 'cure', durationSeconds: 300, direction: 'countdown', blockDone: true })
  })

  it('maps a button keeping outputValue and deletable', () => {
    expect(conv({ id: 'b', type: 'button', ...base, label: 'Go', outputValue: 'go', deletable: false }).block)
      .toMatchObject({ type: 'button', label: 'Go', outputValue: 'go', deletable: false })
  })

  it('reports an oversized image whose width exceeds the usable canvas', () => {
    const { entries } = conv({ id: 'big', type: 'image', x: 0, y: 0, width: 1200, height: 300, src: 'p.jpg' })
    expect(entries.filter((e) => e.kind === 'oversizedImage')).toHaveLength(1)
  })

  it('throws on an unknown element type', () => {
    expect(() => mapBlock({ id: 'x', type: 'wat', ...base }, [])).toThrow(/unknown v1 element type/)
  })

  it('maps fontSize to size for checkbox and radio (they have a v2 size field)', () => {
    const cb = conv({ id: 'c', type: 'checkbox', ...base, fieldName: 'f', options: [{ label: 'A', value: 'a' }], fontSize: 18 })
    expect(cb.block).toMatchObject({ type: 'checkbox', size: 'lg' })
    expect(cb.entries.filter((e) => e.kind === 'fontSizeLost')).toHaveLength(1)
    const rb = conv({ id: 'r', type: 'radio', ...base, fieldName: 'g', options: [{ label: 'A', value: 'a' }], fontSize: 13 })
    expect(rb.block).toMatchObject({ type: 'radio', size: 'sm' })
    expect(rb.entries.filter((e) => e.kind === 'fontSizeLost')).toHaveLength(1)
  })

  it('reports a dropped button fontSize (v2 buttons have no size target)', () => {
    const { block, entries } = conv({ id: 'b', type: 'button', ...base, label: 'Go', outputValue: 'go', fontSize: 14 })
    expect('size' in block).toBe(false)
    expect(entries.filter((e) => e.kind === 'fontSizeLost')).toHaveLength(1)
  })

  it('rounds image aspectRatio sides to integers (v2 schema is integer-only)', () => {
    const { block } = conv({ id: 'm', type: 'image', x: 0, y: 0, width: 400.7, height: 300.2, src: 'p.jpg' })
    expect(block).toMatchObject({ type: 'image', layout: { aspectRatio: '401/300' } })
  })

  it('falls back to 16/9 rather than emitting a schema-invalid 0/N ratio for sub-pixel media', () => {
    const { block } = conv({ id: 'm', type: 'image', x: 0, y: 0, width: 0.3, height: 300, src: 'p.jpg' })
    expect(block).toMatchObject({ type: 'image', layout: { aspectRatio: '16/9' } })
  })
})
