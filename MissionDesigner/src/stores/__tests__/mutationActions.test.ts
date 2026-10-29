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

import { describe, it, expect, beforeEach } from 'vitest'
import { useSpecificationStore } from '../specificationStore'
import type { Specification } from '../specificationStore/types'
import { CURRENT_DATA_SCHEMA_VERSION } from '@/lib/data-schema-version'

function seedSpec(id: string, libraryId: string, parentId: string | null = null): void {
  useSpecificationStore.setState((s) => {
    const spec: Specification = {
      id,
      parentSpecificationId: parentId,
      rootSpecificationId: parentId ?? id,
      libraryId,
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
})

describe('updateInMemory', () => {
  it('takes a snapshot on first edit and marks dirty', () => {
    seedSpec('r', 'lib')
    useSpecificationStore.getState().updateInMemory('r', { name: 'Renamed' })
    const s = useSpecificationStore.getState()
    expect(s.specs.get('r')?.name).toBe('Renamed')
    expect(s.dirtyIds.has('r')).toBe(true)
    expect(s.preEditSnapshots.has('r')).toBe(true)
    expect(s.preEditSnapshots.get('r')?.name).toBe('r')
    expect(s.dirtyCountByLibrary.get('lib')).toBe(1)
  })

  it('§3.13 i5 (revised): mid-save edits ARE applied and re-dirty the spec', () => {
    // Original i5 made updateInMemory a no-op while savingIds.has(id), which
    // caused user-visible keystroke loss in controlled inputs (input value
    // reverts to the unchanged store state on the next render). Revised
    // behavior: allow the mutation, re-add to dirtyIds (batchSave's F1 check
    // then re-marks dirty so a follow-up save fires after the in-flight one
    // completes). preEditSnapshots is NOT overwritten by the mid-save edit.
    seedSpec('r', 'lib')
    useSpecificationStore.getState().updateInMemory('r', { name: 'First' })
    const originalSnapshot = useSpecificationStore.getState().preEditSnapshots.get('r')
    // Simulate save in flight: batchSave moves the id from dirtyIds to savingIds.
    useSpecificationStore.setState((s) => {
      s.savingIds.add('r')
      s.dirtyIds.delete('r')
    })
    useSpecificationStore.getState().updateInMemory('r', { name: 'During-save' })
    const s = useSpecificationStore.getState()
    expect(s.specs.get('r')?.name).toBe('During-save') // mutation applied
    expect(s.dirtyIds.has('r')).toBe(true) // re-dirtied for follow-up save
    expect(s.preEditSnapshots.get('r')).toBe(originalSnapshot) // snapshot preserved
  })

  it('does not replace snapshot on second edit', () => {
    seedSpec('r', 'lib')
    useSpecificationStore.getState().updateInMemory('r', { name: 'First' })
    const snap1 = useSpecificationStore.getState().preEditSnapshots.get('r')
    useSpecificationStore.getState().updateInMemory('r', { name: 'Second' })
    const snap2 = useSpecificationStore.getState().preEditSnapshots.get('r')
    expect(snap1).toEqual(snap2)
  })
})

describe('updateSpecData (mid-save behavior)', () => {
  // Regression coverage for the user-reported character-loss bug in the
  // action / value editor. Typing through a controlled input writes through
  // to updateSpecData; if the mutation were skipped while a save was in
  // flight, the input's value prop would revert and the typed character
  // would visually disappear.
  it('applies mid-save data edits and re-dirties for a follow-up save', () => {
    seedSpec('r', 'lib')
    useSpecificationStore.getState().updateSpecData('r', { inputs: [{ id: 'p1', name: 'a', entries: [] }] })
    const originalSnapshot = useSpecificationStore.getState().preEditSnapshots.get('r')
    useSpecificationStore.setState((s) => {
      s.savingIds.add('r')
      s.dirtyIds.delete('r')
    })
    useSpecificationStore.getState().updateSpecData('r', { inputs: [{ id: 'p1', name: 'ab', entries: [] }] })
    const s = useSpecificationStore.getState()
    expect((s.specs.get('r')?.data as { inputs: Array<{ name: string }> }).inputs[0].name).toBe('ab')
    expect(s.dirtyIds.has('r')).toBe(true)
    expect(s.preEditSnapshots.get('r')).toBe(originalSnapshot)
  })
})

describe('createSpecInMemory', () => {
  it('returns a new id and inserts a root when parentId is null', () => {
    const id = useSpecificationStore.getState().createSpecInMemory({
      parentId: null,
      libraryId: 'lib',
      init: { name: 'New Root' },
    })
    expect(id).toMatch(/.+/)
    const spec = useSpecificationStore.getState().specs.get(id)
    expect(spec?.parentSpecificationId).toBe(null)
    expect(spec?.rootSpecificationId).toBe(id)
  })

  it('adds to pendingCreationIds when isFromCopyLoop is true', () => {
    const id = useSpecificationStore.getState().createSpecInMemory({
      parentId: null,
      libraryId: 'lib',
      init: { name: 'X' },
      isFromCopyLoop: true,
    })
    expect(useSpecificationStore.getState().pendingCreationIds.has(id)).toBe(true)
  })

  // Task 4 fix: copy/import call sites must thread a source spec's real
  // dataSchemaVersion through so unconverted (< CURRENT) data copied from an
  // existing spec is still visible to the boot migration as unconverted —
  // it must NOT silently inherit the fresh-creation default.
  it('preserves a source spec dataSchemaVersion when the copy path supplies one', () => {
    const id = useSpecificationStore.getState().createSpecInMemory({
      parentId: null,
      libraryId: 'lib',
      init: { name: 'Copied', dataSchemaVersion: 3 },
    })
    const spec = useSpecificationStore.getState().specs.get(id)
    expect(spec?.dataSchemaVersion).toBe(3)
  })

  it('defaults to CURRENT_DATA_SCHEMA_VERSION for a fresh create with no source stamp', () => {
    const id = useSpecificationStore.getState().createSpecInMemory({
      parentId: null,
      libraryId: 'lib',
      init: { name: 'Fresh' },
    })
    const spec = useSpecificationStore.getState().specs.get(id)
    expect(spec?.dataSchemaVersion).toBe(CURRENT_DATA_SCHEMA_VERSION)
    expect(CURRENT_DATA_SCHEMA_VERSION).toBe(4)
  })
})

describe('deleteSpecInMemory', () => {
  it('moves id + descendants into pendingDeletes', () => {
    seedSpec('r', 'lib')
    seedSpec('c', 'lib', 'r')
    useSpecificationStore.setState((s) => {
      s.childrenOf.set('r', Object.freeze([s.specs.get('c')!]) as Specification[])
    })
    useSpecificationStore.getState().deleteSpecInMemory('r')
    const s = useSpecificationStore.getState()
    expect(s.pendingDeletes.has('r')).toBe(true)
    expect(s.pendingDeletes.has('c')).toBe(true)
  })
})

describe('discardLocalEdits', () => {
  it('restores from snapshot and clears dirty state', () => {
    seedSpec('r', 'lib')
    useSpecificationStore.getState().updateInMemory('r', { name: 'Bad' })
    useSpecificationStore.getState().discardLocalEdits(['r'], { confirmedByUser: true })
    const s = useSpecificationStore.getState()
    expect(s.specs.get('r')?.name).toBe('r')
    expect(s.dirtyIds.has('r')).toBe(false)
    expect(s.preEditSnapshots.has('r')).toBe(false)
  })
})

describe('discardUncreated', () => {
  it('refuses on a spec not in unsavedNewIds', () => {
    seedSpec('r', 'lib', null)
    // r was not added via createSpecInMemory → not in unsavedNewIds
    expect(() => useSpecificationStore.getState().discardUncreated('r')).toThrow()
  })

  it('removes an uncreated spec entirely', () => {
    const id = useSpecificationStore
      .getState()
      .createSpecInMemory({ parentId: null, libraryId: 'lib', init: { name: 'X' } })
    useSpecificationStore.getState().discardUncreated(id)
    expect(useSpecificationStore.getState().specs.has(id)).toBe(false)
    expect(useSpecificationStore.getState().dirtyIds.has(id)).toBe(false)
  })
})
