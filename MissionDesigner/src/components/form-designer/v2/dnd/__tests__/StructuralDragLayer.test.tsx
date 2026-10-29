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
import { render, fireEvent, act } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { DndContext } from '@dnd-kit/core'
import type { Block, FormDocument, GridSpan } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { StructuralDragLayer, gapStyleTop, isRowRevealed, rowIdAtY } from '../StructuralDragLayer'

// The layer reads geometry from the host's rendered data-* elements via useRectMap's mount-time
// measurement (buildRectMap runs once in the layout effect). We render fake section/row/block
// elements inside the host; jsdom gives them zero rects, but the layer keys its handles/zones on
// the ids, so id-presence assertions work without stubbing getBoundingClientRect or mocking.
function Harness({ children }: { children?: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null)
  return (
    <DndContext>
      <div ref={hostRef} style={{ position: 'relative' }}>
        {children}
        <StructuralDragLayer hostRef={hostRef} />
      </div>
    </DndContext>
  )
}

// Seeds the store with a single row of `ids.length` equal-span blocks and mounts matching
// section/row/block DOM (so the rect-map's ids line up with the document's block ids), then
// renders the layer. Modeled on the inline render() calls above; factored out because the seam
// tests below need the document's blocks (for span resolution), not just bare DOM ids.
function renderLayerWithRow(ids: string[]) {
  const span = Math.floor(12 / ids.length) as GridSpan
  const blocks: Block[] = ids.map((id) => ({ id, type: 'text', content: '', layout: { span: { base: span } } }))
  const doc: FormDocument = { version: 2, sections: [{ id: 's', role: 'content', rows: [{ id: 'r1', blocks }] }] }
  useFormDocumentStore.getState().openForNode('n', doc)
  return render(
    <Harness>
      <section data-section-id="s" data-section-role="content">
        <div data-row-id="r1">
          {ids.map((id) => (
            <div key={id} data-block-id={id}>
              {id}
            </div>
          ))}
        </div>
      </section>
    </Harness>,
  )
}

describe('isRowRevealed', () => {
  it('reveals a row iff it is hovered, focused, or actively resizing', () => {
    expect(isRowRevealed('r1', { hoveredRowId: 'r1', focusedRowId: null, resizingRowId: null })).toBe(true)
    expect(isRowRevealed('r1', { hoveredRowId: null, focusedRowId: 'r1', resizingRowId: null })).toBe(true)
    expect(isRowRevealed('r1', { hoveredRowId: null, focusedRowId: null, resizingRowId: 'r1' })).toBe(true)
    expect(isRowRevealed('r1', { hoveredRowId: 'r2', focusedRowId: null, resizingRowId: null })).toBe(false)
  })
})

describe('rowIdAtY', () => {
  // `y` is HOST-RELATIVE (same system as the rect-map). The hover effect must convert the pointer's
  // viewport clientY into this space first — the bug the manual browser verify caught was passing
  // viewport clientY straight in, so no row ever matched and grips/seams never revealed.
  const rows = [
    { id: 'r1', rect: { left: 0, top: 0, width: 100, height: 50 } },
    { id: 'r2', rect: { left: 0, top: 60, width: 100, height: 50 } },
  ]
  it('returns the row whose host-relative vertical band contains y, else null', () => {
    expect(rowIdAtY(rows, 25)).toBe('r1') // inside r1
    expect(rowIdAtY(rows, 0)).toBe('r1') // top boundary inclusive
    expect(rowIdAtY(rows, 85)).toBe('r2') // inside r2
    expect(rowIdAtY(rows, 55)).toBe(null) // in the gap between rows
    expect(rowIdAtY(rows, 200)).toBe(null) // below all rows
  })
})

describe('gapStyleTop', () => {
  const section = { rect: { left: 10, top: 200, width: 500, height: 48 } }
  it('covers the whole band of an empty section, so a drop anywhere on the empty bottom bar lands', () => {
    expect(gapStyleTop(section)).toEqual({ left: 10, width: 500, top: 200, height: 48 })
  })
  it('straddles the first row top when the section has rows', () => {
    const style = gapStyleTop(section, { rect: { left: 10, top: 210, width: 500, height: 40 } })
    expect(style.top).toBeLessThan(210)
    expect(Number(style.top) + Number(style.height)).toBeGreaterThan(210)
    expect(style.height).toBeLessThan(40)
  })
})

describe('StructuralDragLayer seam handles', () => {
  it('renders one seam handle between each adjacent pair (N-1 per row)', () => {
    // Single row of THREE blocks [A(4), B(4), C(4)] -> 2 seams. buildRectMap returns zero rects
    // under jsdom, but the handles still render (positions are 0 — geometry is verified in the
    // manual browser pass, per the P3.3a jsdom-zero-rect note).
    renderLayerWithRow(['A', 'B', 'C'])
    const seams = document.querySelectorAll('[data-seam-handle]')
    expect(seams.length).toBe(2)
    expect(seams[0].getAttribute('data-seam-handle')).toBe('seam:A:B')
    expect(seams[1].getAttribute('data-seam-handle')).toBe('seam:B:C')
  })

  it('renders no seam for a single-block row', () => {
    renderLayerWithRow(['Solo'])
    expect(document.querySelectorAll('[data-seam-handle]').length).toBe(0)
  })

  // @testing-library/user-event is not a dependency of this project (checked: absent from
  // package.json/package-lock.json/node_modules); fireEvent.keyDown is the established in-repo
  // substitute for simulating keyboard interaction (see FormDocumentDesignerModal.test.tsx), and
  // dispatches the same native `keydown` that React's onKeyDown listens for, so the assertions
  // below are unchanged from a userEvent-driven version of this test.
  it('arrow keys resize via the controller and update aria-valuenow', () => {
    renderLayerWithRow(['A', 'B']) // A(6) B(6)
    const seam = document.querySelector('[data-seam-handle="seam:A:B"]') as HTMLElement
    // seam.focus() now also fires the §14.4 onFocus reveal handler (a real setState), so it must
    // be wrapped like any other state-updating interaction in this test.
    act(() => seam.focus())
    fireEvent.keyDown(seam, { key: 'ArrowRight' })
    const aSpan = () => {
      const b = useFormDocumentStore.getState().document.sections[0].rows[0].blocks.find((x) => x.id === 'A')!
      return (b.layout!.span as { base: number }).base
    }
    expect(aSpan()).toBe(7)
    // re-query: the layer re-renders on the store change, so aria-valuenow reflects 7
    expect(document.querySelector('[data-seam-handle="seam:A:B"]')!.getAttribute('aria-valuenow')).toBe('7')
    fireEvent.keyDown(seam, { key: 'End' })
    expect(aSpan()).toBe(11) // End -> max (total-1)
  })

  it('hidden handles are not click-catchers (pointer-events none by default)', () => {
    renderLayerWithRow(['A', 'B']) // nothing hovered/focused in jsdom
    const seam = document.querySelector('[data-seam-handle="seam:A:B"]') as HTMLElement
    expect(seam.style.pointerEvents).toBe('none')
    expect(seam.style.opacity).toBe('0')
  })
})

describe('StructuralDragLayer handles', () => {
  it('renders a drag grip per block and per row from the rect map', () => {
    const { container } = render(
      <Harness>
        <section data-section-id="s" data-section-role="content">
          <div data-row-id="r1">
            <div data-block-id="b1">b1</div>
          </div>
        </section>
      </Harness>,
    )
    expect(container.querySelector('[data-drag-handle="block:b1"]')).not.toBeNull()
    expect(container.querySelector('[data-drag-handle="row:r1"]')).not.toBeNull()
  })
})

describe('StructuralDragLayer drop zones', () => {
  it('the bottom bar (footer section) gets a whole-band drop zone; content sections do not', () => {
    const { container } = render(
      <Harness>
        <section data-section-id="c" data-section-role="content">
          <div data-row-id="r1">
            <div data-block-id="b1">b1</div>
          </div>
        </section>
        <section data-section-id="f" data-section-role="footer">
          <div data-row-id="rf">
            <div data-block-id="y">y</div>
          </div>
        </section>
      </Harness>,
    )
    expect(container.querySelector('[data-drop-zone="bar:f"]')).not.toBeNull()
    expect(container.querySelector('[data-drop-zone="bar:c"]')).toBeNull()
  })
  it('renders a gap droppable per row boundary and a slot per block edge', () => {
    const { container } = render(
      <Harness>
        <section data-section-id="s" data-section-role="content">
          <div data-row-id="r1">
            <div data-block-id="b1">b1</div>
            <div data-block-id="b2">b2</div>
          </div>
        </section>
      </Harness>,
    )
    expect(container.querySelector('[data-drop-zone="gap:s:@top"]')).not.toBeNull() // above r1
    expect(container.querySelector('[data-drop-zone="gap:s:r1"]')).not.toBeNull() // after r1
    expect(container.querySelector('[data-drop-zone="slot:r1:b1"]')).not.toBeNull()
    expect(container.querySelector('[data-drop-zone="slot:r1:b2"]')).not.toBeNull()
    expect(container.querySelector('[data-drop-zone="slot:r1:@end"]')).not.toBeNull()
  })

  it('skips beside-slots for a row already at 12 blocks (gaps still offered)', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => <div key={i} data-block-id={`b${i}`} />)
    const { container } = render(
      <Harness>
        <section data-section-id="s" data-section-role="content">
          <div data-row-id="full">{twelve}</div>
        </section>
      </Harness>,
    )
    expect(container.querySelector('[data-drop-zone="slot:full:b0"]')).toBeNull() // no beside-join at 12
    expect(container.querySelector('[data-drop-zone="gap:s:full"]')).not.toBeNull() // gap still available
  })
})
