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

// @vitest-environment jsdom

// Round-trip primitives for sub-workflow undo/redo. deleteSubWorkflowSubtree
// captures the subtree (so undo can restore it even after the auto-save commits),
// restoreSubWorkflowSubtree brings it back — un-marking an uncommitted delete in
// place, or re-creating a committed/unsaved one as a new spec to re-persist.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../saveScheduler', () => ({ scheduleFlush: vi.fn(), cancelFlush: vi.fn() }))

import { useSpecificationStore } from '../../specificationStore'
import { clearSubWorkflowUndoBuffer } from '../subWorkflowUndo'
import type { Specification } from '../types'

/** Seed a SAVED spec (in the specs map, NOT unsavedNewIds — i.e. it exists on the server). */
function seedSavedSpec(id: string, parentId: string | null = null): void {
  useSpecificationStore.setState((s) => {
    const spec: Specification = {
      id,
      parentSpecificationId: parentId,
      rootSpecificationId: parentId ?? id,
      libraryId: 'lib-1',
      name: id,
      description: null,
      typeName: null,
      version: '1.0.0',
      state: 'Draft',
      data: { nodes: [] },
      dataSchemaVersion: 3,
      history: [],
      createdAt: 0,
      updatedAt: 0,
      lastEditedByUserId: null,
    }
    s.specs.set(id, spec)
  })
}

beforeEach(() => {
  useSpecificationStore.getState()._reset()
  clearSubWorkflowUndoBuffer()
})

describe('sub-workflow undo: deleteSubWorkflowSubtree + restoreSubWorkflowSubtree', () => {
  it('saved subtree, delete not yet auto-saved: restore un-deletes it in place', () => {
    seedSavedSpec('C', 'P')
    seedSavedSpec('G', 'C')

    useSpecificationStore.getState().deleteSubWorkflowSubtree('C')
    let s = useSpecificationStore.getState()
    expect(s.pendingDeletes.has('C'), 'child marked for deletion').toBe(true)
    expect(s.pendingDeletes.has('G'), 'grandchild cascade-deleted').toBe(true)
    expect(s.specs.has('C'), 'data preserved in specs').toBe(true)

    useSpecificationStore.getState().restoreSubWorkflowSubtree('C')
    s = useSpecificationStore.getState()
    expect(s.pendingDeletes.has('C'), 'un-deleted').toBe(false)
    expect(s.pendingDeletes.has('G')).toBe(false)
    expect(s.specs.has('C')).toBe(true)
    expect(s.unsavedNewIds.has('C'), 'still saved — not re-created').toBe(false)
  })

  it('saved subtree, delete already committed (purged): restore re-creates it as unsaved-new', () => {
    seedSavedSpec('C', 'P')
    seedSavedSpec('G', 'C')
    useSpecificationStore.getState().deleteSubWorkflowSubtree('C')

    // Simulate a successful batchSave of the deletion (purges the committed rows).
    useSpecificationStore.setState((d) => {
      for (const id of ['C', 'G']) {
        d.specs.delete(id)
        d.pendingDeletes.delete(id)
      }
    })
    expect(useSpecificationStore.getState().specs.has('C'), 'purged after commit').toBe(false)

    useSpecificationStore.getState().restoreSubWorkflowSubtree('C')
    const s = useSpecificationStore.getState()
    expect(s.specs.has('C'), 'C re-created').toBe(true)
    expect(s.specs.has('G'), 'G re-created').toBe(true)
    expect(s.unsavedNewIds.has('C'), 'C will be re-created server-side').toBe(true)
    expect(s.unsavedNewIds.has('G')).toBe(true)
    expect(s.specs.get('C')?.parentSpecificationId, 'data preserved').toBe('P')
  })

  it('unsaved subtree (created this session): delete purges, restore re-creates', () => {
    const store = useSpecificationStore.getState()
    const cId = store.createSpecInMemory({ parentId: 'P', libraryId: 'lib-1', init: { name: 'C' } })
    const gId = store.createSpecInMemory({ parentId: cId, libraryId: 'lib-1', init: { name: 'G' } })

    useSpecificationStore.getState().deleteSubWorkflowSubtree(cId)
    expect(useSpecificationStore.getState().specs.has(cId), 'unsaved → purged').toBe(false)

    useSpecificationStore.getState().restoreSubWorkflowSubtree(cId)
    const s = useSpecificationStore.getState()
    expect(s.specs.has(cId), 'C restored').toBe(true)
    expect(s.specs.has(gId), 'G restored').toBe(true)
    expect(s.unsavedNewIds.has(cId)).toBe(true)
  })
})
