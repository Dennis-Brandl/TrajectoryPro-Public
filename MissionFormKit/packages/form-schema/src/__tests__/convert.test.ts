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
import { convertFormLayouts } from '../convert/convert'
import { validateFormDocument } from '../validate'
import type { V1FormLayouts, V1Element } from '../convert/v1-types'

const el = (o: Partial<V1Element> & { id: string; type: string }): V1Element => ({ x: 0, y: 0, width: 100, height: 40, ...o })
const layouts = (desktop: V1Element[], phone: V1Element[] = desktop): V1FormLayouts => ({
  phone: { canvasWidth: 360, canvasHeight: 800, elements: phone },
  tablet: { canvasWidth: 1280, canvasHeight: 720, elements: [] },
  desktop: { canvasWidth: 1024, canvasHeight: 768, elements: desktop },
})

describe('convertFormLayouts', () => {
  it('produces a schema-valid document across every block type (exercises min-constrained fields)', () => {
    // Every variant with its schema-required fields populated, so validateFormDocument
    // actually checks fieldName/src/outputValue minLength and durationSeconds/rows minimum.
    const { document } = convertFormLayouts(layouts([
      el({ id: 'h', type: 'header', y: 0, content: 'Title', width: 900 }),
      el({ id: 'txt', type: 'text', y: 40, content: 'body', width: 900 }),
      el({ id: 'in', type: 'textInput', y: 80, fieldName: 'serial', label: 'Serial', required: true, width: 900 }),
      el({ id: 'ta', type: 'textarea', y: 120, fieldName: 'notes', rows: 4, width: 900, height: 200 }),
      el({ id: 'cb', type: 'checkbox', y: 340, fieldName: 'parts', options: [{ label: 'A', value: 'a' }], width: 440 }),
      el({ id: 'rd', type: 'radio', y: 340, x: 500, fieldName: 'grade', options: [{ label: 'P', value: 'p' }], width: 440 }),
      el({ id: 'img', type: 'image', y: 400, src: 'p.jpg', width: 440, height: 300 }),
      el({ id: 'vid', type: 'video', y: 400, x: 500, src: 'https://x/c.mp4', width: 440, height: 248 }),
      el({ id: 'dv', type: 'divider', y: 720, width: 900, height: 2 }),
      el({ id: 'tm', type: 'timer', y: 760, label: 'Cure', fieldName: 'cure', durationSeconds: 300, direction: 'countdown', width: 900 }),
      el({ id: 'save', type: 'button', y: 820, label: 'Save', outputValue: 'save', width: 120 }),
    ]))
    const result = validateFormDocument(document)
    expect(result.ok).toBe(true)
  })

  it('stacks a single column into one content section, rows top-to-bottom', () => {
    const { document } = convertFormLayouts(layouts([
      el({ id: 'a', type: 'text', y: 0, content: 'one', width: 900 }),
      el({ id: 'b', type: 'text', y: 80, content: 'two', width: 900 }),
    ]))
    expect(document.sections).toHaveLength(1)
    expect(document.sections[0]!.role).toBe('content')
    expect(document.sections[0]!.rows.map((r) => r.blocks.map((b) => b.id))).toEqual([['a'], ['b']])
  })

  it('places two side-by-side elements in one row with proportional spans', () => {
    const { document } = convertFormLayouts(layouts([
      el({ id: 'l', type: 'text', x: 0, y: 0, width: 600, height: 40, content: 'l' }),
      el({ id: 'r', type: 'text', x: 640, y: 0, width: 300, height: 40, content: 'r' }),
    ]))
    const row = document.sections[0]!.rows[0]!
    expect(row.blocks.map((b) => b.id)).toEqual(['l', 'r'])
    expect(row.blocks.map((b) => b.layout?.span?.base)).toEqual([8, 4])
  })

  it('drops a trailing default Continue button and emits no footer for it', () => {
    const { document, report } = convertFormLayouts(layouts([
      el({ id: 'i', type: 'textInput', y: 0, fieldName: 'f', width: 900 }),
      el({ id: 'c', type: 'button', y: 700, label: 'Continue', outputValue: 'continue', deletable: false, width: 120 }),
    ]))
    expect(document.sections.some((s) => s.role === 'footer')).toBe(false)
    expect(report.entries.some((e) => e.kind === 'droppedDefaultButton')).toBe(true)
  })

  it('moves custom action buttons into a footer section', () => {
    const { document } = convertFormLayouts(layouts([
      el({ id: 'i', type: 'textInput', y: 0, fieldName: 'f', width: 900 }),
      el({ id: 'save', type: 'button', y: 700, label: 'Save', outputValue: 'save', width: 120 }),
    ]))
    const footer = document.sections.find((s) => s.role === 'footer')
    expect(footer).toBeDefined()
    expect(footer!.rows[0]!.blocks[0]!.id).toBe('save')
  })

  it('flags phone/base order divergence without failing', () => {
    // desktop order a-then-b; phone (by y) b-then-a => divergence
    const { report } = convertFormLayouts(layouts(
      [el({ id: 'a', type: 'text', y: 0, content: 'a', width: 900 }), el({ id: 'b', type: 'text', y: 80, content: 'b', width: 900 })],
      [el({ id: 'b', type: 'text', y: 0, content: 'b', width: 300 }), el({ id: 'a', type: 'text', y: 80, content: 'a', width: 300 })],
    ))
    expect(report.entries.some((e) => e.kind === 'phoneOrderDivergence')).toBe(true)
  })

  it('is deterministic — same input yields identical output', () => {
    const input = layouts([el({ id: 'a', type: 'text', y: 0, content: 'a', width: 900 })])
    expect(convertFormLayouts(input)).toEqual(convertFormLayouts(input))
  })

  it('does not flag phone divergence when phone order matches the base row order', () => {
    const { report } = convertFormLayouts(layouts(
      [el({ id: 'a', type: 'text', y: 0, content: 'a', width: 900 }), el({ id: 'b', type: 'text', y: 80, content: 'b', width: 900 })],
      [el({ id: 'a', type: 'text', y: 0, content: 'a', width: 300 }), el({ id: 'b', type: 'text', y: 80, content: 'b', width: 300 })],
    ))
    expect(report.entries.some((e) => e.kind === 'phoneOrderDivergence')).toBe(false)
  })
})
