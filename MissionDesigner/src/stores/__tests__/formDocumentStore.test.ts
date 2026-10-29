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
import { useFormDocumentStore } from '../formDocumentStore'
import { createDefaultBlock } from '@/lib/form-document/create-block'

const doc: FormDocument = {
  version: 2,
  sections: [{ id: 's', role: 'content', rows: [{ id: 'r', blocks: [{ id: 'b', type: 'text', content: 'hi' }] }] }],
}

beforeEach(() => useFormDocumentStore.getState().close())

describe('formDocumentStore', () => {
  it('opens with a node id, document, base breakpoint, no selection', () => {
    useFormDocumentStore.getState().openForNode('n1', doc)
    const s = useFormDocumentStore.getState()
    expect(s.openNodeId).toBe('n1')
    expect(s.document).toBe(doc)
    expect(s.activeBreakpoint).toBe('base')
    expect(s.selection).toBeNull()
    expect(s.isDirty).toBe(false)
  })
  it('selects and clears a block', () => {
    useFormDocumentStore.getState().openForNode('n1', doc)
    useFormDocumentStore.getState().selectBlock('b')
    expect(useFormDocumentStore.getState().selection).toBe('b')
    useFormDocumentStore.getState().selectBlock(null)
    expect(useFormDocumentStore.getState().selection).toBeNull()
  })
  it('updateBlock patches the document and marks dirty', () => {
    useFormDocumentStore.getState().openForNode('n1', doc)
    useFormDocumentStore.getState().updateBlock('b', { content: 'bye' } as never)
    const b = useFormDocumentStore.getState().document.sections[0].rows[0].blocks[0]
    expect((b as { content: string }).content).toBe('bye')
    expect(useFormDocumentStore.getState().isDirty).toBe(true)
  })
  it('deleteBlock removes the block, prunes the now-empty row, and clears matching selection', () => {
    useFormDocumentStore.getState().openForNode('n1', doc)
    useFormDocumentStore.getState().selectBlock('b')
    useFormDocumentStore.getState().deleteBlock('b')
    const s = useFormDocumentStore.getState()
    // schema: row.blocks has minItems 1 — the fixture's row 'r' has only block 'b', so
    // deleting it must prune the row itself, not leave an invalid blocks: [] row behind.
    expect(s.document.sections[0].rows).toHaveLength(0)
    expect(s.selection).toBeNull()
  })
  it('undo reverses an update', () => {
    useFormDocumentStore.getState().openForNode('n1', doc)
    useFormDocumentStore.getState().updateBlock('b', { content: 'bye' } as never)
    useFormDocumentStore.temporal.getState().undo()
    const b = useFormDocumentStore.getState().document.sections[0].rows[0].blocks[0]
    expect((b as { content: string }).content).toBe('hi')
  })
})

function seedOneText() {
  const b = createDefaultBlock('text')
  const doc = {
    version: 2 as const,
    sections: [{ id: 's', role: 'content' as const, rows: [{ id: 'r', blocks: [b] }] }],
  }
  useFormDocumentStore.getState().openForNode('n1', doc)
  return b.id
}

describe('formDocumentStore mutations', () => {
  it('insertBlock appends and selects the new block', () => {
    seedOneText()
    useFormDocumentStore.getState().insertBlock('divider')
    const s = useFormDocumentStore.getState()
    const all = s.document.sections.flatMap((sec) => sec.rows.flatMap((r) => r.blocks))
    expect(all).toHaveLength(2)
    expect(s.selection).toBe(all[1].id)
    expect(s.isDirty).toBe(true)
  })

  it('copy then paste yields a distinct block; clipboard survives close→reopen', () => {
    const id = seedOneText()
    useFormDocumentStore.getState().copy(id)
    useFormDocumentStore.getState().close()
    useFormDocumentStore
      .getState()
      .openForNode('n2', { version: 2, sections: [{ id: 's', role: 'content', rows: [] }] })
    useFormDocumentStore.getState().paste()
    const all = useFormDocumentStore.getState().document.sections.flatMap((sec) => sec.rows.flatMap((r) => r.blocks))
    expect(all).toHaveLength(1)
    expect(all[0].id).not.toBe(id) // fresh identity
  })

  it('cut removes the block in a single undoable step', () => {
    const id = seedOneText()
    useFormDocumentStore.getState().cut(id)
    expect(useFormDocumentStore.getState().document.sections[0].rows).toHaveLength(0)
    expect(useFormDocumentStore.temporal.getState().pastStates).toHaveLength(1)
    useFormDocumentStore.temporal.getState().undo()
    const all = useFormDocumentStore.getState().document.sections.flatMap((sec) => sec.rows.flatMap((r) => r.blocks))
    expect(all).toHaveLength(1) // one undo restores it
  })

  it('selecting a block does not create a phantom undo entry', () => {
    const b = createDefaultBlock('text')
    useFormDocumentStore
      .getState()
      .openForNode('n', { version: 2, sections: [{ id: 's', role: 'content', rows: [{ id: 'r', blocks: [b] }] }] })
    expect(useFormDocumentStore.temporal.getState().pastStates).toHaveLength(0)
    useFormDocumentStore.getState().selectBlock(b.id)
    expect(useFormDocumentStore.temporal.getState().pastStates).toHaveLength(0)
    // a REAL edit still records exactly one entry
    useFormDocumentStore.getState().insertBlock('divider')
    expect(useFormDocumentStore.temporal.getState().pastStates).toHaveLength(1)
  })

  it('duplicateBlock adds a clone and selects it', () => {
    const id = seedOneText()
    useFormDocumentStore.getState().duplicateBlock(id)
    const s = useFormDocumentStore.getState()
    const all = s.document.sections.flatMap((sec) => sec.rows.flatMap((r) => r.blocks))
    expect(all).toHaveLength(2)
    expect(s.selection).toBe(all[1].id)
  })
})
