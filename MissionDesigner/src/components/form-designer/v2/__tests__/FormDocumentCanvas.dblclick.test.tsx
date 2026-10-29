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
//
// Deferred ticket from the 2026-08-11 WYSIWYG final review: the canvas double-click entry
// point had no direct unit coverage. innermostBlockIdAt is DOM-geometry based (useless in
// jsdom), so it is mocked; everything else — the type guard, the select-then-open ordering,
// the store wiring — is real.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import type { FormDocument } from '@mission/form-schema'
import FormDocumentDesignerModal from '../FormDocumentDesignerModal'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { useFlowStore } from '@/stores/flowStore'
import { innermostBlockIdAt } from '../SelectionOverlay'

global.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('../SelectionOverlay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../SelectionOverlay')>()
  return { ...actual, innermostBlockIdAt: vi.fn(() => null) }
})

const TESTDOC: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's',
      role: 'content',
      rows: [
        {
          id: 'r',
          blocks: [
            { id: 'b', type: 'text', content: 'x' },
            { id: 'inp', type: 'textInput', fieldName: 'f' },
          ],
        },
      ],
    },
  ],
} as unknown as FormDocument

beforeEach(() => {
  vi.mocked(innermostBlockIdAt).mockReset().mockReturnValue(null)
  useFormDocumentStore.getState().close()
  useFlowStore.setState({
    nodes: [
      { id: 'n1', type: 'userInteractionStep', position: { x: 0, y: 0 }, data: { formDocument: TESTDOC } },
    ] as never,
  })
})

function openAndRenderViewport(): HTMLElement {
  useFormDocumentStore.getState().openForNode('n1', { version: 2, sections: [] })
  render(<FormDocumentDesignerModal />)
  return document.querySelector('[data-testid="bp-frame"] > div') as HTMLElement
}

describe('FormDocumentCanvas double-click', () => {
  it('selects a text block and opens the content editor for it', () => {
    vi.mocked(innermostBlockIdAt).mockReturnValue('b')
    const viewport = openAndRenderViewport()
    fireEvent.dblClick(viewport)
    expect(useFormDocumentStore.getState().selection).toBe('b')
    expect(useFormDocumentStore.getState().contentEditorBlockId).toBe('b')
  })

  it('is a strict no-op for a non-text/header block and for empty canvas space', () => {
    vi.mocked(innermostBlockIdAt).mockReturnValue('inp')
    const viewport = openAndRenderViewport()
    fireEvent.dblClick(viewport)
    // Neither opened NOR selected — the guard returns before any store write.
    expect(useFormDocumentStore.getState().contentEditorBlockId).toBeNull()
    expect(useFormDocumentStore.getState().selection).toBeNull()

    vi.mocked(innermostBlockIdAt).mockReturnValue(null)
    fireEvent.dblClick(viewport)
    expect(useFormDocumentStore.getState().contentEditorBlockId).toBeNull()
  })
})
