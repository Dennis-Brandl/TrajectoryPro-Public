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
import { render, screen, fireEvent } from '@testing-library/react'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { emptyDocument } from '@/lib/form-document/document-ops'
import FormDocumentDesignerModal from '../FormDocumentDesignerModal'

describe('FormDocumentDesignerModal — Edit⇄Preview toggle', () => {
  beforeEach(() => {
    useFormDocumentStore.getState().openForNode('n1', emptyDocument())
  })

  it('starts in Edit with the palette + inspector visible', () => {
    render(<FormDocumentDesignerModal />)
    expect(screen.getByTestId('bp-frame')).toBeTruthy()
    expect(screen.getByTestId('inspector-slot')).toBeTruthy()
    expect(document.querySelector('[data-palette-drag]')).toBeTruthy()
  })

  it('Preview hides palette + inspector and shows the run preview; Edit restores', () => {
    render(<FormDocumentDesignerModal />)

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(useFormDocumentStore.getState().previewMode).toBe('preview')
    expect(screen.getByTestId('preview-frame')).toBeTruthy()
    expect(screen.queryByTestId('inspector-slot')).toBeNull()
    expect(document.querySelector('[data-palette-drag]')).toBeNull()
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(useFormDocumentStore.getState().previewMode).toBe('edit')
    expect(screen.getByTestId('bp-frame')).toBeTruthy()
    expect(screen.queryByTestId('preview-frame')).toBeNull()
  })

  it('authoring keys are inert in preview (guards the no-mutation boundary)', () => {
    render(<FormDocumentDesignerModal />)
    // Insert a block (this also selects it), then enter Preview WITHOUT clearing the selection.
    useFormDocumentStore.getState().insertBlock('text')
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(useFormDocumentStore.getState().selection).not.toBeNull() // selection survives into preview
    const before = useFormDocumentStore.getState().document
    // Delete must be a no-op in preview — the handleKeyDown guard returns early.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Delete' })
    expect(useFormDocumentStore.getState().document).toBe(before) // referentially unchanged → not mutated
  })
})
