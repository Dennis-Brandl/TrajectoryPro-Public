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
import type { FormDocument } from '@mission/form-schema'
import { validateFormDocument } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { findBlock, pruneEmptyFooters, BOTTOM_BAR_PLACEHOLDER_ID } from '@/lib/form-document/document-ops'

/**
 * Real edit -> save -> validate coverage through the actual `useFormDocumentStore` (no mocks).
 *
 * This is the gap that hid the empty-row Critical: unit tests on `document-ops` and the store
 * asserted deletion mechanics in isolation, but nothing exercised the sequence an operator
 * actually drives — edit, delete, then the same `validateFormDocument` gate
 * `FormDocumentDesignerModal.handleSave` runs before it will let a save through. A row left
 * with `blocks: []` (schema `minItems: 1`) fails exactly that gate.
 */
const doc: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's-content',
      role: 'content',
      rows: [
        {
          id: 'r-pair',
          blocks: [
            { id: 'b1', type: 'text', content: 'Hello', size: 'sm' },
            { id: 'b2', type: 'text', content: 'World' },
          ],
        },
        {
          id: 'r-solo',
          blocks: [{ id: 'b3', type: 'text', content: 'Solo' }],
        },
      ],
    },
    {
      id: 's-footer',
      role: 'footer',
      rows: [
        {
          id: 'r-footer',
          blocks: [{ id: 'b4', type: 'button', label: 'Submit', outputValue: 'submit' }],
        },
      ],
    },
  ],
}

beforeEach(() => useFormDocumentStore.getState().close())

describe('edit -> save -> validate integration (real store)', () => {
  it('seeds a schema-valid document', () => {
    useFormDocumentStore.getState().openForNode('n1', doc)
    expect(validateFormDocument(useFormDocumentStore.getState().document).ok).toBe(true)
  })

  it('a content + size patch keeps the document schema-valid', () => {
    useFormDocumentStore.getState().openForNode('n1', doc)

    useFormDocumentStore.getState().updateBlock('b1', { content: 'Hello, edited', size: 'lg' } as never)

    const document = useFormDocumentStore.getState().document
    expect(validateFormDocument(document).ok).toBe(true)
    const patched = findBlock(document, 'b1') as { content: string; size?: string }
    expect(patched.content).toBe('Hello, edited')
    expect(patched.size).toBe('lg')
  })

  it('deleting the sole block of a single-block row keeps the document schema-valid (Critical regression)', () => {
    useFormDocumentStore.getState().openForNode('n1', doc)

    useFormDocumentStore.getState().deleteBlock('b3')

    const document = useFormDocumentStore.getState().document
    expect(findBlock(document, 'b3')).toBeUndefined()
    // The regression: an emptied row (blocks: []) violates row.blocks minItems 1. Before the
    // fix this assertion is what catches it — deleteBlockFromDocument used to leave the empty
    // row behind, which handleSave's validateFormDocument gate would reject at save time.
    expect(validateFormDocument(document).ok).toBe(true)
  })

  it('deleting one block of a two-block row leaves the sibling intact and the document schema-valid', () => {
    useFormDocumentStore.getState().openForNode('n1', doc)

    useFormDocumentStore.getState().deleteBlock('b2')

    const document = useFormDocumentStore.getState().document
    expect(findBlock(document, 'b2')).toBeUndefined()
    expect(findBlock(document, 'b1')).toBeDefined()
    expect(validateFormDocument(document).ok).toBe(true)
  })
})

describe('bottom bar on the canvas', () => {
  const contentOnly: FormDocument = {
    version: 2,
    sections: [
      { id: 's-content', role: 'content', rows: [{ id: 'r1', blocks: [{ id: 't1', type: 'text', content: 'Hi' }] }] },
    ],
  }

  it('dropping a button on the placeholder creates a real footer in ONE undo step', () => {
    useFormDocumentStore.getState().openForNode('n1', contentOnly)
    useFormDocumentStore.getState().insertBlock('button')
    const btnId = useFormDocumentStore.getState().selection as string
    const before = useFormDocumentStore.temporal.getState().pastStates.length
    useFormDocumentStore
      .getState()
      .moveBlock(btnId, { kind: 'new-row', sectionId: BOTTOM_BAR_PLACEHOLDER_ID, afterRowId: null })
    const doc = useFormDocumentStore.getState().document
    const footers = doc.sections.filter((s) => s.role === 'footer')
    expect(footers).toHaveLength(1)
    expect(footers[0].id).not.toBe(BOTTOM_BAR_PLACEHOLDER_ID)
    expect(footers[0].rows[0].blocks[0].id).toBe(btnId)
    expect(doc.sections.some((s) => s.id === BOTTOM_BAR_PLACEHOLDER_ID)).toBe(false)
    expect(useFormDocumentStore.temporal.getState().pastStates.length).toBe(before + 1)
  })

  it('insert a Button in the bottom bar, drag it back into content, save: no footer, valid', () => {
    useFormDocumentStore.getState().openForNode('n1', contentOnly)
    useFormDocumentStore
      .getState()
      .insertBlockInBottomBar({ id: 'bb', type: 'button', label: 'Go', outputValue: 'continue' })
    useFormDocumentStore.getState().moveBlock('bb', { kind: 'new-row', sectionId: 's-content', afterRowId: 'r1' })
    // handleSave runs pruneEmptyFooters before validateFormDocument
    const saved = pruneEmptyFooters(useFormDocumentStore.getState().document)
    expect(saved.sections.some((s) => s.role === 'footer')).toBe(false)
    expect(validateFormDocument(saved).ok).toBe(true)
  })
})
