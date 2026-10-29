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
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { createRef, act } from 'react'
import { SelectionOverlay, innermostBlockIdAt } from '../SelectionOverlay'
import { useFormDocumentStore } from '@/stores/formDocumentStore'

// jsdom has no ResizeObserver; SelectionOverlay's measure effect creates one, so stub it or
// render throws. The hit-test uses getBoundingClientRect (NOT elementsFromPoint — inert blocks
// are excluded from real-browser hit-testing), which jsdom CAN exercise via a per-element
// getBoundingClientRect override.
global.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => useFormDocumentStore.getState().close())

describe('innermostBlockIdAt (geometry — inert-proof)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })
  const addBlock = (id: string, r: { left: number; top: number; right: number; bottom: number }) => {
    const el = document.createElement('div')
    el.setAttribute('data-block-id', id)
    el.getBoundingClientRect = () =>
      ({
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.right - r.left,
        height: r.bottom - r.top,
        x: r.left,
        y: r.top,
        toJSON: () => ({}),
      }) as DOMRect
    document.body.appendChild(el)
  }
  it('returns the block whose rect contains the point', () => {
    addBlock('a', { left: 0, top: 0, right: 100, bottom: 50 })
    addBlock('b', { left: 100, top: 0, right: 200, bottom: 50 })
    expect(innermostBlockIdAt(150, 25)).toBe('b')
    expect(innermostBlockIdAt(50, 25)).toBe('a')
  })
  it('returns null when no block contains the point', () => {
    addBlock('a', { left: 0, top: 0, right: 100, bottom: 50 })
    expect(innermostBlockIdAt(500, 500)).toBeNull()
  })
  it('picks the smallest-area (innermost) block when rects overlap', () => {
    addBlock('big', { left: 0, top: 0, right: 300, bottom: 300 })
    addBlock('small', { left: 50, top: 50, right: 100, bottom: 100 })
    expect(innermostBlockIdAt(75, 75)).toBe('small')
  })
})

describe('SelectionOverlay', () => {
  it('renders an outline element only when a block is selected', () => {
    // Stand-in for the block the real @mission/form-renderer would draw in the
    // viewport (it stamps [data-block-id] on rendered blocks — see
    // form-designer/v2/__tests__/formkit-integration.test.tsx). SelectionOverlay only
    // measures; it does not render form content itself, so this unit test supplies
    // the element it queries for rather than mounting the full renderer.
    const ref = createRef<HTMLDivElement>()
    const { rerender, container } = render(
      <div ref={ref}>
        <section data-section-id="s">
          <div data-row-id="r">
            <div data-block-id="b" />
          </div>
        </section>
        <SelectionOverlay viewportRef={ref} />
      </div>,
    )
    expect(container.querySelector('[data-testid="selection-outline"]')).toBeNull()
    act(() => {
      useFormDocumentStore.getState().openForNode('n', {
        version: 2,
        sections: [
          { id: 's', role: 'content', rows: [{ id: 'r', blocks: [{ id: 'b', type: 'text', content: 'x' }] }] },
        ],
      })
      useFormDocumentStore.getState().selectBlock('b')
    })
    rerender(
      <div ref={ref}>
        <section data-section-id="s">
          <div data-row-id="r">
            <div data-block-id="b" />
          </div>
        </section>
        <SelectionOverlay viewportRef={ref} />
      </div>,
    )
    expect(container.querySelector('[data-testid="selection-outline"]')).not.toBeNull()
  })

  it('shows a delete button on the selection and removes the block when clicked', () => {
    const ref = createRef<HTMLDivElement>()
    const view = (
      <div ref={ref}>
        <section data-section-id="s">
          <div data-row-id="r">
            <div data-block-id="b" />
          </div>
        </section>
        <SelectionOverlay viewportRef={ref} />
      </div>
    )
    const { rerender, container } = render(view)
    act(() => {
      useFormDocumentStore.getState().openForNode('n', {
        version: 2,
        sections: [
          { id: 's', role: 'content', rows: [{ id: 'r', blocks: [{ id: 'b', type: 'text', content: 'x' }] }] },
        ],
      })
      useFormDocumentStore.getState().selectBlock('b')
    })
    rerender(view)
    const btn = container.querySelector('[data-testid="delete-block-button"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.getAttribute('aria-label')).toBe('Delete block')
    act(() => {
      fireEvent.click(btn)
    })
    expect(useFormDocumentStore.getState().document.sections[0].rows).toHaveLength(0)
  })
})
