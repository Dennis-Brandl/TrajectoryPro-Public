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
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { FormDocument } from '@mission/form-schema'
import FormDocumentDesignerModal from '../FormDocumentDesignerModal'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { useFlowStore } from '@/stores/flowStore'
import { createDefaultBlock } from '@/lib/form-document/create-block'

// jsdom has no ResizeObserver; SelectionOverlay's measure effect (nested inside
// FormDocumentCanvas, mounted by this modal) creates one once a selection is non-null — see
// SelectionOverlay.test.tsx for the same stub.
global.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const V1 = {
  phone: { canvasWidth: 360, canvasHeight: 800, elements: [] },
  tablet: { canvasWidth: 1280, canvasHeight: 720, elements: [] },
  desktop: { canvasWidth: 1024, canvasHeight: 768, elements: [] },
}

// Real, non-empty v2 content for the node under test — distinct from the empty placeholder
// handed to `openForNode` before render in the tests below. That gap is deliberate: the
// modal's mount effect (FormDocumentDesignerModal.tsx:17-24) re-seeds the store from the
// NODE the instant it mounts, so assertions below can only pass if that effect genuinely
// pulls this content from `useFlowStore`, not merely that some valid v2 doc ended up in
// the store.
const NODE_DOCUMENT: FormDocument = {
  version: 2,
  sections: [{ id: 's', role: 'content', rows: [{ id: 'r', blocks: [{ id: 'b', type: 'text', content: 'x' }] }] }],
}

beforeEach(() => {
  useFormDocumentStore.getState().close()
  useFlowStore.setState({
    nodes: [
      {
        id: 'n1',
        type: 'userInteractionStep',
        position: { x: 0, y: 0 },
        data: { formLayouts: V1, formDocument: NODE_DOCUMENT },
      },
    ] as never,
  })
})

describe('FormDocumentDesignerModal bridge', () => {
  it('seeds the store from the node on open', () => {
    // Pre-render open with an empty placeholder — NOT the node's real document — so this
    // only passes if the mount effect overwrites it with the node's actual formDocument.
    useFormDocumentStore.getState().openForNode('n1', { version: 2, sections: [] })
    render(<FormDocumentDesignerModal />)
    expect(useFormDocumentStore.getState().openNodeId).toBe('n1')
    const block = useFormDocumentStore.getState().document.sections[0].rows[0].blocks[0]
    expect(block.id).toBe('b')
    expect((block as { content: string }).content).toBe('x')
  })

  it('falls back to the v1→v2 converter when the node has no formDocument', () => {
    useFlowStore.setState({
      nodes: [{ id: 'n1', type: 'userInteractionStep', position: { x: 0, y: 0 }, data: { formLayouts: V1 } }] as never,
    })
    useFormDocumentStore.getState().openForNode('n1', { version: 2, sections: [] })
    render(<FormDocumentDesignerModal />)
    expect(useFormDocumentStore.getState().document.version).toBe(2)
  })

  it('saves formDocument and leaves formLayouts untouched', () => {
    const updateNodeData = vi.spyOn(useFlowStore.getState(), 'updateNodeData')
    useFormDocumentStore.getState().openForNode('n1', { version: 2, sections: [] })
    render(<FormDocumentDesignerModal />)
    // Edit the block the mount effect seeded FROM THE NODE (not a hand-crafted document),
    // so the save assertion below pins genuine seed→edit→save fidelity. The store update
    // re-renders subscribed components (FormDocumentCanvas), so it must be wrapped in act().
    act(() => {
      useFormDocumentStore.getState().updateBlock('b', { content: 'edited' } as never)
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(updateNodeData).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ formDocument: expect.objectContaining({ version: 2 }) }),
    )
    const payload = updateNodeData.mock.lastCall![1]
    const savedDocument = payload.formDocument as FormDocument
    const savedBlock = savedDocument.sections[0].rows[0].blocks[0]
    expect(savedBlock.id).toBe('b')
    expect((savedBlock as { content: string }).content).toBe('edited')
    // the payload must NOT include formLayouts
    expect('formLayouts' in payload).toBe(false)
  })

  it('Save drops a bottom bar that was emptied (handleSave prunes empty footers)', () => {
    const withBar: FormDocument = {
      version: 2,
      sections: [
        ...NODE_DOCUMENT.sections,
        {
          id: 'foot',
          role: 'footer',
          rows: [{ id: 'fr', blocks: [{ id: 'fb', type: 'button', label: 'Go', outputValue: 'continue' }] }],
        },
      ],
    } as never
    useFlowStore.setState({
      nodes: [
        { id: 'n1', type: 'userInteractionStep', position: { x: 0, y: 0 }, data: { formDocument: withBar } },
      ] as never,
    })
    const updateNodeData = vi.spyOn(useFlowStore.getState(), 'updateNodeData')
    useFormDocumentStore.getState().openForNode('n1', { version: 2, sections: [] })
    render(<FormDocumentDesignerModal />)
    expect(useFormDocumentStore.getState().document.sections.some((s) => s.role === 'footer')).toBe(true)
    act(() => {
      useFormDocumentStore.getState().deleteBlock('fb')
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    const saved = updateNodeData.mock.lastCall![1].formDocument as FormDocument
    expect(saved.sections.some((s) => s.role === 'footer')).toBe(false)
  })

  it('commits an edited Continue label to the node uiParameters on Save', () => {
    const updateNodeData = vi.spyOn(useFlowStore.getState(), 'updateNodeData')
    useFormDocumentStore.getState().openForNode('n1', { version: 2, sections: [] })
    render(<FormDocumentDesignerModal />)
    fireEvent.change(screen.getByLabelText('Continue button'), { target: { value: 'Proceed' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    const payload = updateNodeData.mock.lastCall![1] as { uiParameters?: Array<{ type: string; value: string }> }
    expect(payload.uiParameters).toEqual([{ id: expect.any(String), type: 'Button', value: 'Proceed' }])
  })

  it('does not write uiParameters when the Actions labels are left untouched', () => {
    const updateNodeData = vi.spyOn(useFlowStore.getState(), 'updateNodeData')
    useFormDocumentStore.getState().openForNode('n1', { version: 2, sections: [] })
    render(<FormDocumentDesignerModal />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect('uiParameters' in updateNodeData.mock.lastCall![1]).toBe(false)
  })

  it('commits edited Yes/No labels for a yesNoStep', () => {
    useFlowStore.setState({
      nodes: [
        { id: 'n1', type: 'yesNoStep', position: { x: 0, y: 0 }, data: { formDocument: NODE_DOCUMENT } },
      ] as never,
    })
    const updateNodeData = vi.spyOn(useFlowStore.getState(), 'updateNodeData')
    useFormDocumentStore.getState().openForNode('n1', { version: 2, sections: [] })
    render(<FormDocumentDesignerModal />)
    fireEvent.change(screen.getByLabelText('Yes button'), { target: { value: 'Approve' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    const payload = updateNodeData.mock.lastCall![1] as {
      uiParameters?: Array<{ type: string; value: string; value2?: string }>
    }
    expect(payload.uiParameters).toEqual([
      { id: expect.any(String), type: 'YesNoButtons', value: 'Approve', value2: 'No' },
    ])
  })

  it('is full-bleed and layered above app chrome (covers the header/minimap)', () => {
    // The editor must sit above the app header (z-50) and the canvas minimap toggle (z-10),
    // which are positioned with a z-index; a full-bleed modal with no z-index let them show through.
    useFormDocumentStore.getState().openForNode('n1', { version: 2, sections: [] })
    render(<FormDocumentDesignerModal />)
    const content = screen.getByRole('dialog')
    expect(content.className).toContain('inset-0')
    expect(content.className).toContain('z-[100]')
  })
})

describe('FormDocumentDesignerModal v2 authoring (P3.2)', () => {
  it('renders the palette column and inserts into the canvas on click', () => {
    useFormDocumentStore.getState().openForNode('n', { version: 2, sections: [{ id: 's', role: 'content', rows: [] }] })
    render(<FormDocumentDesignerModal />)
    fireEvent.click(screen.getByText('Divider'))
    const all = useFormDocumentStore.getState().document.sections.flatMap((s) => s.rows.flatMap((r) => r.blocks))
    expect(all).toHaveLength(1)
    expect(all[0].type).toBe('divider')
  })

  it('Ctrl+D duplicates the selected block', () => {
    const b = createDefaultBlock('text')
    const doc: FormDocument = { version: 2, sections: [{ id: 's', role: 'content', rows: [{ id: 'r', blocks: [b] }] }] }
    // Node 'n' must carry `doc` as its formDocument: the mount effect (FormDocumentDesignerModal.tsx
    // ~line 23-30) unconditionally re-seeds `document` AND resets `selection` to null from
    // useFlowStore the instant the modal mounts (see the file-level comment above), so a bare
    // `openForNode` + `selectBlock` called before `render` would be silently wiped out.
    useFlowStore.setState({
      nodes: [{ id: 'n', type: 'userInteractionStep', position: { x: 0, y: 0 }, data: { formDocument: doc } }] as never,
    })
    useFormDocumentStore.getState().openForNode('n', doc)
    render(<FormDocumentDesignerModal />)
    // Select AFTER mount, since the mount effect's own openForNode call resets selection to null.
    act(() => {
      useFormDocumentStore.getState().selectBlock(b.id)
    })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'd', ctrlKey: true })
    const all = useFormDocumentStore.getState().document.sections.flatMap((s) => s.rows.flatMap((r) => r.blocks))
    expect(all).toHaveLength(2)
  })
})

describe('FormDocumentDesignerModal drag-and-drop wiring (P3.3a T11)', () => {
  it('a stationary palette click still inserts a block: PointerSensor activationConstraint must not swallow it', () => {
    // Real click physics: pointerdown -> pointerup -> click, with NO movement between down/up.
    // A bare `useSensor(PointerSensor)` (no activationConstraint) "activates" synchronously on
    // pointerdown and installs a capture-phase `click` listener on `document` that calls
    // stopPropagation() to suppress the ghost click dnd-kit assumes follows every drag — which
    // swallows this click before it ever reaches the palette button's onClick, since document's
    // capture-phase listener runs (and halts propagation) before the event reaches the target.
    // The `{ distance: 4 }` constraint defers that activation until real pointer movement is
    // observed, so a stationary click (as simulated below) never trips it. See
    // node_modules/@dnd-kit/core/dist/core.cjs.development.js AbstractPointerSensor#attach /
    // #handleStart for the exact mechanism this test guards against regressing.
    //
    // Why spy on `insertBlock` instead of asserting a raw block-count delta: jsdom's
    // getBoundingClientRect() always returns an all-zero rect, so every drop zone the
    // structural drag layer registers measures as the identical {0,0,0,0} box. If the sensor
    // ever DOES activate (e.g. this same pointerdown->pointerup with the constraint removed),
    // `pointerWithin` collision detection degenerately resolves `over` to one of those
    // zero-rect zones, and this component's own onDragEnd->dropResolver->insertBlockAt path
    // inserts a block too — a false positive that would mask a swallowed click. `insertBlock`
    // (the plain store action FormPalette's onClick calls) is only ever invoked from that one
    // click handler, never from the drag/onDragEnd path (which exclusively calls
    // `insertBlockAt`), so it's the one signal that unambiguously proves the click itself fired.
    useFormDocumentStore.getState().openForNode('n1', NODE_DOCUMENT)
    // Spy BEFORE render: FormPalette reads `insertBlock` via a selector hook
    // (`useFormDocumentStore((s) => s.insertBlock)`) captured once into a closure at render
    // time — spying after render mutates the store's function reference too late for that
    // already-rendered closure to observe (see the modal's mount effect re-seeding the store,
    // which re-renders FormPalette once more before any click; the store's `insertBlock` key
    // is never reassigned afterwards, so installing the spy this early is sufficient).
    const insertBlockSpy = vi.spyOn(useFormDocumentStore.getState(), 'insertBlock')
    render(<FormDocumentDesignerModal />)
    const label = screen.getByText('Text') // PALETTE_ITEMS[0]; getByText targets the inner <span>
    fireEvent.pointerDown(label, { pointerId: 1, isPrimary: true, button: 0 })
    fireEvent.pointerUp(label, { pointerId: 1, isPrimary: true, button: 0 })
    fireEvent.click(label)
    expect(insertBlockSpy).toHaveBeenCalledWith('text')
  })

  it('mounts the structural drag layer inside the canvas once the open document has a block', () => {
    // Radix's Dialog.Portal renders into `document.body`, not the `render()` return value's
    // `container` (an RTL-appended div the portal bypasses entirely) — every other test in this
    // file queries via `screen` (which is body-scoped) for the same reason; query `document.body`
    // directly here since there's no built-in `screen` query for an arbitrary attribute selector.
    useFormDocumentStore.getState().openForNode('n1', NODE_DOCUMENT)
    render(<FormDocumentDesignerModal />)
    expect(document.body.querySelector('[data-drag-handle]')).not.toBeNull()
  })
})

describe('FormDocumentDesignerModal help', () => {
  it('has a Help button for the form designer and tooltips on Undo/Redo', () => {
    useFormDocumentStore.getState().openForNode('n1', { version: 2, sections: [] })
    render(<FormDocumentDesignerModal />)
    const help = screen.getByRole('link', { name: 'Form designer help' }) as HTMLAnchorElement
    expect(help.getAttribute('href')).toBe('/help.html#adding-and-arranging-elements')
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('title')).toMatch(/Ctrl\+Z/)
    expect(screen.getByRole('button', { name: 'Redo' }).getAttribute('title')).toMatch(/Ctrl\+Shift\+Z/)
  })
})
