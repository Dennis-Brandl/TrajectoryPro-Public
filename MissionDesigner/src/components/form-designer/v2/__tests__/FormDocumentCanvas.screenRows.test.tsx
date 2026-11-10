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
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { FormDocument, Section } from '@mission/form-schema'
import { FormDocumentCanvas } from '../FormDocumentCanvas'
import { ImageSection } from '../inspector/sections/ImageSection'
import { createDefaultBlock } from '@/lib/form-document/create-block'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { createSpanDragController } from '../dnd/useSpanDrag'

const content = (rowsAt?: Section['rowsAt']): FormDocument => ({
  version: 2,
  sections: [
    {
      id: 's',
      role: 'content',
      rows: [
        { id: 'r1', blocks: [{ id: 'a', type: 'text', content: 'a' }] },
        { id: 'r2', blocks: [{ id: 'b', type: 'text', content: 'b' }] },
      ],
      ...(rowsAt ? { rowsAt } : {}),
    },
  ],
})

/** Block ids per rendered row, top to bottom. */
function renderedRows(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-section-id="s"] [data-row-id]')).map((r) =>
    Array.from(r.querySelectorAll('[data-block-id]'))
      .map((b) => b.getAttribute('data-block-id'))
      .join(''),
  )
}

const status = () => screen.queryByRole('status', { name: 'Rows on this screen' })

beforeEach(() => {
  useFormDocumentStore.getState().close()
})

describe('FormDocumentCanvas per-screen rows', () => {
  it("draws the active tab's rows", () => {
    useFormDocumentStore.getState().openForNode('n', content({ tablet: [{ id: 't', blockIds: ['b', 'a'] }] }))
    const { container } = render(<FormDocumentCanvas />)
    expect(renderedRows(container)).toEqual(['a', 'b'])
    act(() => useFormDocumentStore.getState().setActiveBreakpoint('tablet'))
    expect(renderedRows(container)).toEqual(['ba'])
    act(() => useFormDocumentStore.getState().setActiveBreakpoint('phone'))
    expect(renderedRows(container)).toEqual(['ba']) // Phone inherits Tablet
  })

  it('shows nothing about rows on Desktop', () => {
    useFormDocumentStore.getState().openForNode('n', content())
    render(<FormDocumentCanvas />)
    expect(status()).toBeNull()
  })

  it('says where the rows come from, and offers the reset only when the screen has its own', () => {
    useFormDocumentStore.getState().openForNode('n', content())
    useFormDocumentStore.getState().setActiveBreakpoint('tablet')
    render(<FormDocumentCanvas />)
    expect(status()?.textContent).toContain('Rows: same as Desktop')
    expect(screen.queryByRole('button', { name: /use desktop rows/i })).toBeNull()

    act(() => useFormDocumentStore.getState().moveIntoRowAbove('b'))
    expect(status()?.textContent).toContain("Rows: this screen's own")
    expect(useFormDocumentStore.getState().document.sections[0].rows).toHaveLength(2) // desktop unchanged

    act(() => useFormDocumentStore.getState().setActiveBreakpoint('phone'))
    expect(status()?.textContent).toContain('Rows: same as Tablet')

    act(() => useFormDocumentStore.getState().setActiveBreakpoint('tablet'))
    fireEvent.click(screen.getByRole('button', { name: 'Use Desktop rows' }))
    expect(status()?.textContent).toContain('Rows: same as Desktop')
    expect(useFormDocumentStore.getState().document.sections[0].rowsAt).toBeUndefined()
  })

  it('on Phone the reset says Tablet when Tablet has rows of its own, else Desktop', () => {
    useFormDocumentStore
      .getState()
      .openForNode(
        'n',
        content({ tablet: [{ id: 't', blockIds: ['b', 'a'] }], phone: [{ id: 'p', blockIds: ['a', 'b'] }] }),
      )
    useFormDocumentStore.getState().setActiveBreakpoint('phone')
    const { unmount } = render(<FormDocumentCanvas />)
    expect(status()?.textContent).toContain("Rows: this screen's own")
    fireEvent.click(screen.getByRole('button', { name: 'Use Tablet rows' }))
    expect(useFormDocumentStore.getState().document.sections[0].rowsAt).toEqual({
      tablet: [{ id: 't', blockIds: ['b', 'a'] }],
    })
    unmount()

    useFormDocumentStore.getState().openForNode('n', content({ phone: [{ id: 'p', blockIds: ['b', 'a'] }] }))
    useFormDocumentStore.getState().setActiveBreakpoint('phone')
    render(<FormDocumentCanvas />)
    expect(screen.getByRole('button', { name: 'Use Desktop rows' })).toBeTruthy()
  })
})

describe('Inspector labels name the screen being edited', () => {
  it('image Scale says the tab', () => {
    useFormDocumentStore.getState().setActiveBreakpoint('phone')
    render(<ImageSection block={createDefaultBlock('image')} onUpdate={() => {}} />)
    expect(screen.getByLabelText('Scale (%) (Phone)')).toBeTruthy()
  })
})

describe('span drag on the Tablet tab', () => {
  it('resizes neighbours in the Tablet rows and writes tablet spans', () => {
    useFormDocumentStore.getState().openForNode('n', content({ tablet: [{ id: 't', blockIds: ['a', 'b'] }] }))
    useFormDocumentStore.getState().setActiveBreakpoint('tablet')
    // give the pair tablet spans of 6 + 6 first (one tracked change)
    useFormDocumentStore.getState().arrangeColumns('a', 2)
    const c = createSpanDragController()
    c.begin({ rowId: 't', leftId: 'a', rightId: 'b', startX: 100, colWidthPx: 40, leftSpan: 6, rightSpan: 6 })
    c.move(180) // +2 columns
    c.end()
    const blocks = useFormDocumentStore.getState().document.sections[0].rows.flatMap((r) => r.blocks)
    expect(blocks.map((b) => b.layout?.span?.tablet)).toEqual([8, 4])
    expect(blocks.map((b) => b.layout?.span?.base)).toEqual([12, 12])
  })
})
