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
import { useFormDocumentStore } from '@/stores/formDocumentStore'

const doc = (): FormDocument => ({
  version: 2,
  sections: [
    {
      id: 'c',
      role: 'content',
      rows: [
        { id: 'r1', blocks: [{ id: 'a', type: 'text', content: 'a' }] },
        { id: 'r2', blocks: [{ id: 'b', type: 'text', content: 'b' }] },
      ],
    },
  ],
})

beforeEach(() => {
  useFormDocumentStore.getState().close()
  useFormDocumentStore.temporal.getState().clear()
})

describe('formDocumentStore structural actions', () => {
  it('moveRow records exactly one undo entry and can be undone', () => {
    useFormDocumentStore.getState().openForNode('n', doc())
    expect(useFormDocumentStore.temporal.getState().pastStates).toHaveLength(0)
    useFormDocumentStore.getState().moveRow('r2', { sectionId: 'c', afterRowId: null })
    expect(useFormDocumentStore.getState().document.sections[0].rows.map((r) => r.id)).toEqual(['r2', 'r1'])
    expect(useFormDocumentStore.temporal.getState().pastStates).toHaveLength(1)
    useFormDocumentStore.temporal.getState().undo()
    expect(useFormDocumentStore.getState().document.sections[0].rows.map((r) => r.id)).toEqual(['r1', 'r2'])
  })
  it('a no-op moveRow records NO undo entry', () => {
    useFormDocumentStore.getState().openForNode('n', doc())
    useFormDocumentStore.getState().moveRow('r2', { sectionId: 'c', afterRowId: 'r1' }) // in place
    expect(useFormDocumentStore.temporal.getState().pastStates).toHaveLength(0)
    expect(useFormDocumentStore.getState().isDirty).toBe(false)
  })
  it('moveBlock selects the moved block', () => {
    useFormDocumentStore.getState().openForNode('n', doc())
    useFormDocumentStore.getState().moveBlock('a', { kind: 'in-row', rowId: 'r2', beforeBlockId: 'b' })
    expect(useFormDocumentStore.getState().selection).toBe('a')
    expect(useFormDocumentStore.temporal.getState().pastStates).toHaveLength(1)
  })
  it('insertBlockAt creates + selects a new block and records one entry', () => {
    useFormDocumentStore.getState().openForNode('n', doc())
    useFormDocumentStore.getState().insertBlockAt('divider', { kind: 'in-row', rowId: 'r1', beforeBlockId: null })
    const sel = useFormDocumentStore.getState().selection!
    expect(useFormDocumentStore.getState().document.sections[0].rows[0].blocks.map((b) => b.id)).toContain(sel)
    expect(useFormDocumentStore.temporal.getState().pastStates).toHaveLength(1)
  })
})
