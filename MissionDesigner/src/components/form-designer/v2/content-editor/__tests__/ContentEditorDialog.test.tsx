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
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { afterEach } from 'vitest'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { useFlowStore } from '@/stores/flowStore'
import type { FormDocument } from '@mission/form-schema'
import { ContentEditorDialog } from '../ContentEditorDialog'

afterEach(cleanup)

const DOC: FormDocument = {
  version: 2,
  sections: [
    {
      id: 'sec1',
      role: 'content',
      rows: [
        {
          id: 'r1',
          blocks: [
            { id: 'b1', type: 'text', content: 'Lot {{Lot}}', size: 'md' },
            { id: 'b2', type: 'text', content: 'hi' },
            { id: 'b3', type: 'text', content: '<p>A</p><p>B</p>' },
            { id: 'b4', type: 'text', content: 'hi', fontWeight: 'bold' },
            { id: 'b5', type: 'header', content: 'Head', fontWeight: 'bold', size: 'xl' },
            { id: 'b6', type: 'text', content: 'Hello {{A<B}} World' },
          ],
        },
      ],
    },
  ],
} as unknown as FormDocument

function findSavedBlock(blockId: string) {
  return useFormDocumentStore.getState().document.sections[0].rows[0].blocks.find((b) => b.id === blockId) as {
    content: string
    fontWeight?: string
  }
}

function openFor(blockId: string, inputs: Array<{ id: string; name: string }> = []) {
  useFlowStore.setState({
    nodes: [
      {
        id: 'n1',
        type: 'userInteractionStep',
        position: { x: 0, y: 0 },
        data: { label: 'UI', stepType: 'userInteractionStep', inputs },
      },
    ],
  } as never)
  useFormDocumentStore.getState().openForNode('n1', structuredClone(DOC))
  useFormDocumentStore.getState().openContentEditor(blockId)
}

describe('ContentEditorDialog', () => {
  beforeEach(() => useFormDocumentStore.getState().close())

  it('renders the toolbar and loads content with {{Lot}} as a chip', async () => {
    openFor('b1')
    render(<ContentEditorDialog />)
    expect(screen.getByLabelText('Text size')).not.toBeNull()
    expect(screen.getByLabelText('Bold')).not.toBeNull()
    expect(screen.getByLabelText('Italic')).not.toBeNull()
    expect(screen.getByLabelText('Align center')).not.toBeNull()
    await waitFor(() => expect(document.querySelector('[data-param-token="Lot"]')).not.toBeNull())
  })

  it('Save serializes chips back to {{tokens}} and closes; Cancel leaves content untouched', async () => {
    openFor('b1')
    render(<ContentEditorDialog />)
    await waitFor(() => expect(document.querySelector('[data-param-token="Lot"]')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = useFormDocumentStore.getState().document.sections[0].rows[0].blocks[0] as { content: string }
    expect(saved.content).toContain('{{Lot}}')
    expect(saved.content).not.toContain('data-param-token')
    expect(useFormDocumentStore.getState().contentEditorBlockId).toBeNull()
  })

  it('size and align patch the block immediately (live, before Save)', () => {
    openFor('b1')
    render(<ContentEditorDialog />)
    fireEvent.change(screen.getByLabelText('Text size'), { target: { value: 'xl' } })
    fireEvent.click(screen.getByLabelText('Align center'))
    const b = useFormDocumentStore.getState().document.sections[0].rows[0].blocks[0] as {
      size?: string
      align?: string
    }
    expect(b.size).toBe('xl')
    expect(b.align).toBe('center')
  })

  it('inserting a parameter from the dropdown adds a chip that survives Save as a token', async () => {
    openFor('b1', [{ id: 'oid-1', name: 'Batch' }])
    render(<ContentEditorDialog />)
    await waitFor(() => expect(document.querySelector('[data-param-token="Lot"]')).not.toBeNull())
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Insert parameter'), { target: { value: 'Batch' } })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = useFormDocumentStore.getState().document.sections[0].rows[0].blocks[0] as { content: string }
    expect(saved.content).toContain('{{Batch}}')
  })

  it('with no input parameters the dropdown is disabled', () => {
    openFor('b1', [])
    render(<ContentEditorDialog />)
    expect((screen.getByLabelText('Insert parameter') as HTMLSelectElement).disabled).toBe(true)
  })

  it('a no-op Save (plain content, untouched) does not dirty the document or rewrite content', async () => {
    openFor('b2')
    render(<ContentEditorDialog />)
    await waitFor(() => expect(screen.getByText('hi')).not.toBeNull())
    const docBefore = useFormDocumentStore.getState().document
    const dirtyBefore = useFormDocumentStore.getState().isDirty
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const state = useFormDocumentStore.getState()
    expect(findSavedBlock('b2').content).toBe('hi')
    expect(state.document).toBe(docBefore)
    expect(state.isDirty).toBe(dirtyBefore)
    expect(state.contentEditorBlockId).toBeNull()
  })

  it('multi-paragraph content is left as authored on Save (not unwrapped)', async () => {
    openFor('b3', [{ id: 'oid-1', name: 'Extra' }])
    render(<ContentEditorDialog />)
    await waitFor(() => expect(screen.getByText('A')).not.toBeNull())
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Insert parameter'), { target: { value: 'Extra' } })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = findSavedBlock('b3')
    expect((saved.content.match(/<p\b/g) ?? []).length).toBe(2)
    expect(saved.content).toContain('{{Extra}}')
  })

  it('legacy block-level bold on a TEXT block migrates to inline <strong> + fontWeight:normal on Save', async () => {
    openFor('b4')
    render(<ContentEditorDialog />)
    await waitFor(() => expect(screen.getByText('hi')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = findSavedBlock('b4')
    expect(saved.content).toContain('<strong>hi</strong>')
    expect(saved.fontWeight).toBe('normal')
  })

  it('does not migrate legacy bold on HEADER blocks (F3 is text-only)', async () => {
    openFor('b5')
    render(<ContentEditorDialog />)
    await waitFor(() => expect(screen.getByText('Head')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = findSavedBlock('b5')
    expect(saved.content).not.toContain('<strong>')
    expect(saved.fontWeight).toBe('bold')
  })

  it('a param name containing < round-trips without swallowing surrounding text (F1 residual fix)', async () => {
    openFor('b6', [{ id: 'oid-1', name: 'A<B' }])
    render(<ContentEditorDialog />)
    await waitFor(() => expect(document.querySelector('[data-param-token="A<B"]')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = findSavedBlock('b6')
    expect(saved.content).toBe('Hello {{A<B}} World')
  })
})

// ── deferred final-review minors M1 + M4 (2026-08-11 ticket bundle) ──

describe('ContentEditorDialog deferred-minor fixes', () => {
  it('M1: the Bold button aria-pressed tracks the editor state after toggling (shouldRerenderOnTransaction)', async () => {
    openFor('b1')
    render(<ContentEditorDialog />)
    const bold = screen.getByLabelText('Bold') as HTMLButtonElement
    expect(bold.getAttribute('aria-pressed')).toBe('false')
    // Toggling bold at the cursor sets a stored mark -> isActive('bold') true. Without
    // shouldRerenderOnTransaction the component never re-rendered, so the indicator froze.
    await act(async () => {
      fireEvent.click(bold)
    })
    await waitFor(() => expect(screen.getByLabelText('Bold').getAttribute('aria-pressed')).toBe('true'))
  })

  it('M4: a header without an explicit size shows the renderer default xl, a text block md', () => {
    const doc = {
      version: 2,
      sections: [
        {
          id: 'sec1',
          role: 'content',
          rows: [
            {
              id: 'r1',
              blocks: [
                { id: 'h1', type: 'header', content: 'Title' },
                { id: 't1', type: 'text', content: 'Body' },
              ],
            },
          ],
        },
      ],
    } as unknown as FormDocument
    useFlowStore.setState({
      nodes: [
        {
          id: 'n1',
          type: 'userInteractionStep',
          position: { x: 0, y: 0 },
          data: { label: 'UI', stepType: 'userInteractionStep', inputs: [] },
        },
      ],
    } as never)
    useFormDocumentStore.getState().openForNode('n1', structuredClone(doc))
    useFormDocumentStore.getState().openContentEditor('h1')
    render(<ContentEditorDialog />)
    expect((screen.getByLabelText('Text size') as HTMLSelectElement).value).toBe('xl')
    cleanup()
    useFormDocumentStore.getState().openContentEditor('t1')
    render(<ContentEditorDialog />)
    expect((screen.getByLabelText('Text size') as HTMLSelectElement).value).toBe('md')
  })
})
