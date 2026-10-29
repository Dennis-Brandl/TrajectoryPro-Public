// @vitest-environment jsdom
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
import { render } from '@testing-library/react'
import { FormDocumentView } from '../FormDocumentView'
import type { FormDocument } from '@mission/form-schema'
import { kitchenSinkDocument } from '@mission/form-schema'

const doc: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's1',
      role: 'content',
      rows: [
        {
          id: 'r1',
          gap: 'lg',
          blocks: [
            { id: 'b1', type: 'header', content: 'Pump inspection' },
            {
              id: 'b2',
              type: 'textInput',
              fieldName: 'serial',
              label: 'Serial',
              layout: { span: { base: 6, phone: 12 } },
            },
          ],
        },
      ],
    },
    {
      id: 's2',
      role: 'footer',
      rows: [{ id: 'r2', blocks: [{ id: 'b3', type: 'button', label: 'Retry', outputValue: 'retry' }] }],
    },
  ],
}

describe('FormDocumentView (P0 structural scaffold)', () => {
  it('renders viewport > scroll(content sections) + footer sections', () => {
    const { container } = render(<FormDocumentView document={doc} />)
    const viewport = container.querySelector('.tfk-viewport')!
    expect(viewport).not.toBeNull()
    expect(viewport.querySelector('.tfk-scroll [data-section-id="s1"]')).not.toBeNull()
    expect(viewport.querySelector('.tfk-footer [data-section-id="s2"]')).not.toBeNull()
    expect(viewport.querySelector('.tfk-scroll [data-section-id="s2"]')).toBeNull()
  })

  it('renders rows as grids with gap class and blocks with data attributes', () => {
    const { container } = render(<FormDocumentView document={doc} />)
    const row = container.querySelector('[data-row-id="r1"]')!
    expect(row.className).toContain('tfk-row')
    expect(row.className).toContain('tfk-gap-lg')
    const block = container.querySelector('[data-block-id="b2"]')!
    expect(block.getAttribute('data-block-type')).toBe('textInput')
    expect(block.className).toContain('tfk-span-base-6')
    expect(block.className).toContain('tfk-span-phone-12')
  })

  it('text content is sanitized HTML — injection payloads are neutralized', () => {
    const evil: FormDocument = {
      version: 2,
      sections: [
        {
          id: 's1',
          role: 'content',
          rows: [{ id: 'r1', blocks: [{ id: 'b1', type: 'text', content: '<img src=x onerror=alert(1)>' }] }],
        },
      ],
    }
    const { container } = render(<FormDocumentView document={evil} />)
    const img = container.querySelector('[data-block-id="b1"] img')
    expect(img?.getAttribute('onerror') ?? null).toBeNull()
  })

  it('sets data-mode from the mode prop (default run)', () => {
    const { container, rerender } = render(<FormDocumentView document={doc} />)
    expect(container.querySelector('.tfk-viewport')!.getAttribute('data-mode')).toBe('run')
    rerender(<FormDocumentView document={doc} mode="edit" />)
    expect(container.querySelector('.tfk-viewport')!.getAttribute('data-mode')).toBe('edit')
  })

  it('renders deterministically (two renders produce identical HTML)', () => {
    const a = render(<FormDocumentView document={doc} />).container.innerHTML
    const b = render(<FormDocumentView document={doc} />).container.innerHTML
    expect(a).toBe(b)
  })

  it('renders every block variant from the kitchen-sink fixture', () => {
    const { container } = render(<FormDocumentView document={kitchenSinkDocument} />)
    const allBlocks = kitchenSinkDocument.sections.flatMap((s) => s.rows.flatMap((r) => r.blocks))
    expect(allBlocks).toHaveLength(12)
    for (const block of allBlocks) {
      const el = container.querySelector(`[data-block-id="${block.id}"]`)
      expect(el, `block ${block.id}`).not.toBeNull()
      expect(el!.getAttribute('data-block-type')).toBe(block.type)
    }
  })

  it('edit mode sets inert on every block wrapper; run mode does not', () => {
    const { container, rerender } = render(<FormDocumentView document={doc} mode="edit" />)
    const wrappers = [...container.querySelectorAll('[data-block-id]')]
    expect(wrappers.length).toBeGreaterThan(0)
    for (const w of wrappers) expect(w.hasAttribute('inert')).toBe(true)
    rerender(<FormDocumentView document={doc} mode="run" />)
    for (const w of [...container.querySelectorAll('[data-block-id]')]) {
      expect(w.hasAttribute('inert')).toBe(false)
    }
  })
})
