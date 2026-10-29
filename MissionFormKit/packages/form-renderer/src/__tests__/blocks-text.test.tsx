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

function docWith(blocks: FormDocument['sections'][0]['rows'][0]['blocks']): FormDocument {
  return { version: 2, sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }] }
}

describe('text and header blocks', () => {
  it('renders sanitized HTML: formatting kept, scripts and event handlers stripped', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([
          { id: 'b1', type: 'text', content: '<p>Keep <b>bold</b></p><img src="x" onerror="alert(1)"><script>evil()</script>' },
        ])}
      />,
    )
    const block = container.querySelector('[data-block-id="b1"]')!
    expect(block.querySelector('b')).not.toBeNull()
    expect(block.querySelector('script')).toBeNull()
    const img = block.querySelector('img')
    expect(img?.getAttribute('onerror') ?? null).toBeNull()
  })

  it('applies size, weight, align classes and color style', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([
          { id: 'b1', type: 'text', content: 'x', size: 'lg', fontWeight: 'bold', align: 'center', color: '#ff0000' },
        ])}
      />,
    )
    const el = container.querySelector('[data-block-id="b1"] .tfk-text')!
    expect(el.className).toContain('tfk-size-lg')
    expect(el.className).toContain('tfk-bold')
    expect(el.className).toContain('tfk-text-center')
    expect((el as HTMLElement).style.color).toBe('rgb(255, 0, 0)')
  })

  it('header renders an h2 with heading class, default size xl and bold', () => {
    const { container } = render(
      <FormDocumentView document={docWith([{ id: 'b1', type: 'header', content: 'Title' }])} />,
    )
    const h2 = container.querySelector('[data-block-id="b1"] h2')!
    expect(h2).not.toBeNull()
    expect(h2.className).toContain('tfk-heading')
    expect(h2.className).toContain('tfk-size-xl')
    expect(h2.className).toContain('tfk-bold')
    expect(h2.textContent).toBe('Title')
  })
})

describe('per-device size classes', () => {
  it('radio with sizeAt.phone gets base and phone classes only', () => {
    const doc: FormDocument = {
      version: 2,
      sections: [{ id: 's', role: 'content', rows: [{ id: 'r', blocks: [
        { id: 'q', type: 'radio', label: 'Q', fieldName: 'q', options: [{ value: 'a', label: 'A' }], size: 'lg', sizeAt: { phone: 'sm' } } as never,
      ] }] }],
    }
    const { container } = render(<FormDocumentView document={doc} />)
    const fs = container.querySelector('fieldset')!
    expect(fs.classList.contains('tfk-size-lg')).toBe(true)
    expect(fs.classList.contains('tfk-size-phone-sm')).toBe(true)
    expect(fs.className).not.toMatch(/tfk-size-tablet/)
  })
})
