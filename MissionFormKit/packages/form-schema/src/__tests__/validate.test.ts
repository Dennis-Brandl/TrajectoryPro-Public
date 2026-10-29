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
import { validateFormDocument } from '../validate'
import type { FormDocument } from '../types'
import { kitchenSinkDocument } from '../fixtures/kitchen-sink'

/** Minimal valid document used as the mutation base in negative tests. */
function validDoc(): FormDocument {
  return {
    version: 2,
    sections: [
      {
        id: 's1',
        role: 'content',
        rows: [
          {
            id: 'r1',
            blocks: [
              { id: 'b1', type: 'header', content: 'Pump inspection' },
              {
                id: 'b2',
                type: 'textInput',
                fieldName: 'serial',
                required: true,
                layout: { span: { base: 6, phone: 12 } },
              },
              {
                id: 'b3',
                type: 'image',
                src: 'pump.jpg',
                objectFit: 'cover',
                layout: { span: { base: 6 }, aspectRatio: '4/3' },
              },
            ],
          },
        ],
      },
      {
        id: 's2',
        role: 'footer',
        rows: [
          {
            id: 'r2',
            blocks: [{ id: 'b4', type: 'button', label: 'Retry scan', outputValue: 'retry', emphasis: 'secondary' }],
          },
        ],
      },
    ],
  }
}

describe('validateFormDocument', () => {
  it('accepts a valid document', () => {
    const result = validateFormDocument(validDoc())
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('rejects version !== 2', () => {
    const doc = { ...validDoc(), version: 1 }
    expect(validateFormDocument(doc).ok).toBe(false)
  })

  it('rejects v1 geometry properties (x/y/width/height are gone in v2)', () => {
    const doc = validDoc()
    ;(doc.sections[0]!.rows[0]!.blocks[0] as unknown as Record<string, unknown>).x = 40
    const result = validateFormDocument(doc)
    expect(result.ok).toBe(false)
  })

  it('rejects unknown block types', () => {
    const doc = validDoc()
    ;(doc.sections[0]!.rows[0]!.blocks[0] as unknown as Record<string, unknown>).type = 'carousel'
    expect(validateFormDocument(doc).ok).toBe(false)
  })

  it('rejects an image block without layout.aspectRatio', () => {
    const doc = validDoc()
    const img = doc.sections[0]!.rows[0]!.blocks[2] as unknown as Record<string, unknown>
    ;(img.layout as Record<string, unknown>).aspectRatio = undefined
    delete (img.layout as Record<string, unknown>).aspectRatio
    expect(validateFormDocument(doc).ok).toBe(false)
  })

  it('rejects span values outside 1..12', () => {
    const doc = validDoc()
    ;(doc.sections[0]!.rows[0]!.blocks[1]!.layout as Record<string, unknown>).span = { base: 13 }
    expect(validateFormDocument(doc).ok).toBe(false)
  })

  it('rejects a PerBreakpoint value missing base', () => {
    const doc = validDoc()
    ;(doc.sections[0]!.rows[0]!.blocks[1]!.layout as Record<string, unknown>).span = { phone: 12 }
    expect(validateFormDocument(doc).ok).toBe(false)
  })

  it('rejects a section with an invalid role', () => {
    const doc = validDoc()
    ;(doc.sections[1] as unknown as Record<string, unknown>).role = 'sidebar'
    expect(validateFormDocument(doc).ok).toBe(false)
  })

  it('reports readable error strings (instancePath + message)', () => {
    const doc = { version: 2, sections: 'nope' }
    const result = validateFormDocument(doc)
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('/sections')
  })

  it('accepts the kitchen-sink fixture (every block variant)', () => {
    const result = validateFormDocument(kitchenSinkDocument)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('accepts scalePercent within 10..300 on image blocks; rejects out-of-range and fractional', () => {
    const doc = validDoc()
    const img = doc.sections[0]!.rows[0]!.blocks[2] as unknown as Record<string, unknown>
    for (const ok of [10, 25, 100, 150, 300]) {
      img.scalePercent = ok
      expect(validateFormDocument(doc).ok, `scalePercent ${ok}`).toBe(true)
    }
    for (const bad of [0, 5, 301, 50.5, '50']) {
      img.scalePercent = bad
      expect(validateFormDocument(doc).ok, `scalePercent ${bad}`).toBe(false)
    }
  })

  it('rejects a zero aspect ratio like "0/0"', () => {
    const doc = validDoc()
    ;(doc.sections[0]!.rows[0]!.blocks[2]!.layout as Record<string, unknown>).aspectRatio = '0/0'
    expect(validateFormDocument(doc).ok).toBe(false)
  })

  it('rejects duplicate ids across the document', () => {
    const doc = validDoc()
    ;(doc.sections[0]!.rows[0]!.blocks[1] as unknown as Record<string, unknown>).id = 'b1' // collides with blocks[0]
    const result = validateFormDocument(doc)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('duplicate id: b1'))).toBe(true)
  })

  it('still accepts unique ids (uniqueness check has no false positives)', () => {
    expect(validateFormDocument(validDoc()).ok).toBe(true)
  })
})

describe('button job and per-device size', () => {
  it('accepts job, size and sizeAt on blocks', () => {
    const doc = validDoc()
    doc.sections[0]!.rows[0]!.blocks.push(
      { id: 'b5', type: 'button', job: 'yes', label: '', outputValue: 'true', size: 'lg', sizeAt: { phone: 'sm' } },
      { id: 'b6', type: 'radio', fieldName: 'pick', options: [{ label: 'A', value: 'a' }], sizeAt: { tablet: 'md' } },
    )
    const result = validateFormDocument(doc)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('rejects an unknown job', () => {
    const doc = validDoc()
    doc.sections[0]!.rows[0]!.blocks.push({ id: 'b5', type: 'button', label: '', outputValue: 'x', job: 'maybe' } as never)
    expect(validateFormDocument(doc).ok).toBe(false)
  })

  it('rejects an unknown sizeAt key', () => {
    const doc = validDoc()
    doc.sections[0]!.rows[0]!.blocks.push({ id: 'b5', type: 'button', label: '', outputValue: 'x', sizeAt: { desktop: 'lg' } } as never)
    expect(validateFormDocument(doc).ok).toBe(false)
  })
})
