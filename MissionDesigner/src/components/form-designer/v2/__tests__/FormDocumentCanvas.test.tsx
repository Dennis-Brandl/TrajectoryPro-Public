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
import { FormDocumentCanvas } from '../FormDocumentCanvas'
import { useFormDocumentStore } from '@/stores/formDocumentStore'

const doc = {
  version: 2 as const,
  sections: [
    {
      id: 's',
      role: 'content' as const,
      rows: [{ id: 'r', blocks: [{ id: 'b', type: 'text' as const, content: 'hello' }] }],
    },
  ],
}

beforeEach(() => {
  useFormDocumentStore.getState().close()
  useFormDocumentStore.getState().openForNode('n', doc)
})

describe('FormDocumentCanvas', () => {
  it('renders the shared renderer in edit mode with the store document', () => {
    const { container } = render(<FormDocumentCanvas />)
    expect(container.querySelector('.tfk-viewport')).not.toBeNull()
    expect(container.innerHTML).toContain('data-mode="edit"')
    expect(container.querySelector('[data-block-id="b"]')).not.toBeNull()
  })
  it('sizes the frame to the active breakpoint', () => {
    useFormDocumentStore.getState().setActiveBreakpoint('phone')
    const { container } = render(<FormDocumentCanvas />)
    const frame = container.querySelector('[data-testid="bp-frame"]') as HTMLElement
    expect(frame.style.width).toBe('390px')
  })
  it('opens the context menu with block actions on right-click over a block', () => {
    const { container } = render(<FormDocumentCanvas />)
    // jsdom rects are all-zero, so a contextmenu at (0,0) resolves to the only block.
    fireEvent.contextMenu(container.querySelector('[data-block-id="b"]')!, { clientX: 0, clientY: 0 })
    expect(useFormDocumentStore.getState().selection).toBe('b')
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeTruthy()
  })
  it('suppresses the native menu and shows a paste-only menu on empty canvas', () => {
    const { container } = render(<FormDocumentCanvas />)
    const prevented =
      fireEvent.contextMenu(container.querySelector('[data-block-id="b"]')!, { clientX: 99999, clientY: 99999 }) ===
      false
    expect(prevented).toBe(true) // preventDefault was called
    expect(screen.getByRole('menuitem', { name: /paste/i })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /delete/i })).toBeNull()
  })
  it('preserves an existing selection on an empty-canvas right-click', () => {
    useFormDocumentStore.getState().selectBlock('b')
    const { container } = render(<FormDocumentCanvas />)
    // (99999,99999) hits no block (jsdom rects are all-zero), so onContextMenu opens the
    // paste-only menu without calling selectBlock — the prior selection must survive.
    fireEvent.contextMenu(container.querySelector('[data-block-id="b"]')!, { clientX: 99999, clientY: 99999 })
    expect(useFormDocumentStore.getState().selection).toBe('b')
  })
})

describe('FormDocumentCanvas job buttons', () => {
  it('shows the Actions panel Continue label on an empty-label Continue job button and follows edits', () => {
    const jobDoc = {
      version: 2 as const,
      sections: [
        {
          id: 's',
          role: 'content' as const,
          rows: [
            {
              id: 'r',
              blocks: [
                { id: 'jb', type: 'button' as const, label: '', outputValue: 'continue', job: 'continue' as const },
              ],
            },
          ],
        },
      ],
    }
    useFormDocumentStore.getState().close()
    useFormDocumentStore.getState().openForNode('n', jobDoc)
    useFormDocumentStore.getState().seedActions({ kind: 'continue', label: 'Proceed' })
    const { container } = render(<FormDocumentCanvas />)
    const label = () => container.querySelector('[data-block-id="jb"] button')?.textContent
    expect(label()).toBe('Proceed')
    act(() => useFormDocumentStore.getState().updateActionDraft({ kind: 'continue', label: 'Onward' }))
    expect(label()).toBe('Onward')
  })
})
