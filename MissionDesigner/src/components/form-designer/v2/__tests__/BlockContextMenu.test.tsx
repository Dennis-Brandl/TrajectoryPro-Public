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
import { render, screen, fireEvent } from '@testing-library/react'
import { BlockContextMenu } from '../BlockContextMenu'
import { useFormDocumentStore } from '@/stores/formDocumentStore'

const doc = {
  version: 2 as const,
  sections: [
    {
      id: 's',
      role: 'content' as const,
      rows: [{ id: 'r', blocks: [{ id: 'b', type: 'text' as const, content: 'hi' }] }],
    },
  ],
}

const flushFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

beforeEach(() => {
  useFormDocumentStore.getState().close()
  useFormDocumentStore.getState().openForNode('n', doc)
  // close() deliberately preserves the clipboard (formDocumentStore.test.ts: "clipboard
  // survives close→reopen"), so reset it explicitly for test isolation — otherwise an
  // earlier Copy/Cut test leaves a clipboard entry that the "disables Paste" test below
  // would see.
  useFormDocumentStore.setState({ clipboard: null })
})

describe('BlockContextMenu', () => {
  it('renders nothing when position is null', () => {
    const { container } = render(<BlockContextMenu position={null} targetBlockId="b" onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders all five actions for a block target', () => {
    render(<BlockContextMenu position={{ x: 0, y: 0 }} targetBlockId="b" onClose={() => {}} />)
    for (const name of [/duplicate/i, /copy/i, /cut/i, /paste/i, /delete/i]) {
      expect(screen.getByRole('menuitem', { name })).toBeTruthy()
    }
  })

  it('deletes the target block when Delete is clicked', () => {
    const onClose = vi.fn()
    render(<BlockContextMenu position={{ x: 0, y: 0 }} targetBlockId="b" onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))
    expect(useFormDocumentStore.getState().document.sections[0].rows).toHaveLength(0)
    expect(onClose).toHaveBeenCalled()
  })

  it('duplicates the target block when Duplicate is clicked', () => {
    render(<BlockContextMenu position={{ x: 0, y: 0 }} targetBlockId="b" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /duplicate/i }))
    // duplicateBlockInDocument inserts the clone into a NEW row right after the source row
    // (see document-ops.test.ts), not into the same row's blocks array.
    expect(useFormDocumentStore.getState().document.sections[0].rows).toHaveLength(2)
  })

  it('copies the target block to the clipboard when Copy is clicked', () => {
    render(<BlockContextMenu position={{ x: 0, y: 0 }} targetBlockId="b" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /copy/i }))
    expect(useFormDocumentStore.getState().clipboard?.id).toBe('b')
  })

  it('cuts the target block when Cut is clicked', () => {
    render(<BlockContextMenu position={{ x: 0, y: 0 }} targetBlockId="b" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /cut/i }))
    expect(useFormDocumentStore.getState().clipboard?.id).toBe('b')
    expect(useFormDocumentStore.getState().document.sections[0].rows).toHaveLength(0)
  })

  it('disables Paste when the clipboard is empty', () => {
    render(<BlockContextMenu position={{ x: 0, y: 0 }} targetBlockId="b" onClose={() => {}} />)
    expect((screen.getByRole('menuitem', { name: /paste/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows only Paste for an empty (null) target', () => {
    render(<BlockContextMenu position={{ x: 0, y: 0 }} targetBlockId={null} onClose={() => {}} />)
    expect(screen.getByRole('menuitem', { name: /paste/i })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /delete/i })).toBeNull()
  })

  it('closes on Escape without letting the event bubble (so the modal stays open)', async () => {
    const onClose = vi.fn()
    const bubbleSpy = vi.fn()
    document.addEventListener('keydown', bubbleSpy) // bubble-phase listener on document
    render(<BlockContextMenu position={{ x: 0, y: 0 }} targetBlockId="b" onClose={onClose} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(bubbleSpy).not.toHaveBeenCalled()
    document.removeEventListener('keydown', bubbleSpy)
  })

  it('closes on an outside mousedown', async () => {
    const onClose = vi.fn()
    render(<BlockContextMenu position={{ x: 0, y: 0 }} targetBlockId="b" onClose={onClose} />)
    await flushFrame() // the outside-mousedown listener is armed on the next frame
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })

  describe('column commands', () => {
    const rowsDoc = (rows: string[]) => ({
      version: 2 as const,
      sections: [
        {
          id: 's',
          role: 'content' as const,
          rows: rows.map((r, i) => ({
            id: `r${i}`,
            blocks: [...r].map((id) => ({ id, type: 'text' as const, content: id })),
          })),
        },
      ],
    })
    const shape = () =>
      useFormDocumentStore.getState().document.sections[0].rows.map((r) => r.blocks.map((b) => b.id).join(''))

    it('Move into row above puts the element beside the row above', () => {
      useFormDocumentStore.getState().openForNode('n', rowsDoc(['A', 'B']))
      render(<BlockContextMenu position={{ x: 0, y: 0 }} targetBlockId="B" onClose={() => {}} />)
      fireEvent.click(screen.getByRole('menuitem', { name: /move into row above/i }))
      expect(shape()).toEqual(['AB'])
    })

    it('Move to its own row splits the element out of its row', () => {
      useFormDocumentStore.getState().openForNode('n', rowsDoc(['AB']))
      render(<BlockContextMenu position={{ x: 0, y: 0 }} targetBlockId="A" onClose={() => {}} />)
      fireEvent.click(screen.getByRole('menuitem', { name: /move to its own row/i }))
      expect(shape()).toEqual(['B', 'A'])
    })

    it('Arrange in 3 columns pulls elements up from the rows below', () => {
      useFormDocumentStore.getState().openForNode('n', rowsDoc(['A', 'B', 'C', 'D']))
      render(<BlockContextMenu position={{ x: 0, y: 0 }} targetBlockId="A" onClose={() => {}} />)
      fireEvent.click(screen.getByRole('menuitem', { name: /3 columns/i }))
      expect(shape()).toEqual(['ABC', 'D'])
    })

    it('disables commands that would change nothing', () => {
      useFormDocumentStore.getState().openForNode('n', rowsDoc(['A']))
      render(<BlockContextMenu position={{ x: 0, y: 0 }} targetBlockId="A" onClose={() => {}} />)
      expect((screen.getByRole('menuitem', { name: /move into row above/i }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('menuitem', { name: /move to its own row/i }) as HTMLButtonElement).disabled).toBe(true)
    })
  })
})
