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
import { BlockInspector } from '../BlockInspector'
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

beforeEach(() => {
  useFormDocumentStore.getState().close()
  useFormDocumentStore.getState().openForNode('n', doc)
})

describe('BlockInspector', () => {
  it('prompts to select when nothing is selected', () => {
    render(<BlockInspector />)
    expect(screen.getByText(/select a block/i)).toBeTruthy()
  })
  it('deletes the selected block and prunes the now-empty row', () => {
    useFormDocumentStore.getState().selectBlock('b')
    render(<BlockInspector />)
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    // schema: row.blocks has minItems 1 — the fixture's row 'r' has only block 'b', so
    // deleting it must prune the row itself, not leave an invalid blocks: [] row behind.
    expect(useFormDocumentStore.getState().document.sections[0].rows).toHaveLength(0)
  })
})
