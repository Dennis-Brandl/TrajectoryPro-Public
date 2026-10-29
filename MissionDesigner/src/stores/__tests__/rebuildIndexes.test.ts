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

// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { rebuildIndexes } from '../specificationStore/rebuildIndexes'
import type { SpecificationStoreState, Specification } from '../specificationStore/types'

function mkSpec(id: string, parentId: string | null, libraryId: string, rootId: string): Specification {
  return {
    id,
    parentSpecificationId: parentId,
    rootSpecificationId: rootId,
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
}

function emptyDraft(): SpecificationStoreState {
  return {
    specs: new Map(),
    libraries: new Map(),
    childrenOf: new Map(),
    rootOf: new Map(),
    rootsInLibrary: new Map(),
    dirtyCountByLibrary: new Map(),
    dirtyIds: new Set(),
    pendingDeletes: new Set(),
    pendingImageOps: [],
    preEditSnapshots: new Map(),
    unsavedNewIds: new Set(),
    savingIds: new Set(),
    sentSnapshots: new Map(),
    postSaveDirtyQueue: new Map(),
    lastSaveError: null,
    loadingTreeIds: new Set(),
    isLibrariesLoaded: false,
    isLibrariesLoading: false,
    crashBufferDirty: false,
    bootPhase: 'me-loading',
    pendingCreationIds: new Set(),
    pendingRetryIds: new Set(),
    loadedRootIds: new Set(),
    currentlyPreviewedId: null,
    previewLruIds: [],
    inflightPreviewLoads: new Map(),
    librariesDirty: new Set(),
    librariesSaving: new Set(),
    librariesPreEditSnapshots: new Map(),
    lastLibrarySaveError: null,
  }
}

describe('rebuildIndexes (§3.2 B2)', () => {
  it('builds childrenOf from scratch on full rebuild', () => {
    const d = emptyDraft()
    d.specs.set('r', mkSpec('r', null, 'lib', 'r'))
    d.specs.set('c1', mkSpec('c1', 'r', 'lib', 'r'))
    d.specs.set('c2', mkSpec('c2', 'r', 'lib', 'r'))
    rebuildIndexes(d, null) // null = full rebuild
    expect(
      d.childrenOf
        .get('r')!
        .map((s) => s.id)
        .sort(),
    ).toEqual(['c1', 'c2'])
  })

  it('populates rootOf by walking parentSpecificationId', () => {
    const d = emptyDraft()
    d.specs.set('r', mkSpec('r', null, 'lib', 'r'))
    d.specs.set('c', mkSpec('c', 'r', 'lib', 'r'))
    d.specs.set('gc', mkSpec('gc', 'c', 'lib', 'r'))
    rebuildIndexes(d, null)
    expect(d.rootOf.get('gc')).toBe('r')
    expect(d.rootOf.get('c')).toBe('r')
    expect(d.rootOf.get('r')).toBe('r')
  })

  it('populates rootsInLibrary with parentSpecificationId IS NULL only', () => {
    const d = emptyDraft()
    d.specs.set('r1', mkSpec('r1', null, 'lib', 'r1'))
    d.specs.set('r2', mkSpec('r2', null, 'lib', 'r2'))
    d.specs.set('c1', mkSpec('c1', 'r1', 'lib', 'r1'))
    rebuildIndexes(d, null)
    expect(
      d.rootsInLibrary
        .get('lib')!
        .map((s) => s.id)
        .sort(),
    ).toEqual(['r1', 'r2'])
  })

  it('counts dirtyCountByLibrary from dirtyIds', () => {
    const d = emptyDraft()
    d.specs.set('r', mkSpec('r', null, 'libA', 'r'))
    d.specs.set('c', mkSpec('c', 'r', 'libA', 'r'))
    d.specs.set('r2', mkSpec('r2', null, 'libB', 'r2'))
    d.dirtyIds.add('r')
    d.dirtyIds.add('c')
    rebuildIndexes(d, null)
    expect(d.dirtyCountByLibrary.get('libA')).toBe(2)
    expect(d.dirtyCountByLibrary.get('libB') ?? 0).toBe(0)
  })

  it('rebuilds old parent childrenOf on reparent when caller includes both parent ids', () => {
    const d = emptyDraft()
    d.specs.set('A', mkSpec('A', null, 'lib', 'A'))
    d.specs.set('B', mkSpec('B', null, 'lib', 'B'))
    d.specs.set('c', mkSpec('c', 'A', 'lib', 'A'))
    rebuildIndexes(d, null)
    expect(d.childrenOf.get('A')!.map((s) => s.id)).toEqual(['c'])
    expect(d.childrenOf.get('B') ?? []).toEqual([])

    // Reparent c from A to B. Caller must include c, A, and B in mutatedIds.
    d.specs.get('c')!.parentSpecificationId = 'B'
    rebuildIndexes(d, ['c', 'A', 'B'])

    expect(d.childrenOf.get('A') ?? []).toEqual([]) // old parent cleared
    expect(d.childrenOf.get('B')!.map((s) => s.id)).toEqual(['c']) // new parent populated
  })

  it('keeps unaffected childrenOf entries at the SAME array reference (stable identity)', () => {
    const d = emptyDraft()
    d.specs.set('r1', mkSpec('r1', null, 'lib', 'r1'))
    d.specs.set('c1', mkSpec('c1', 'r1', 'lib', 'r1'))
    d.specs.set('r2', mkSpec('r2', null, 'lib', 'r2'))
    d.specs.set('c2', mkSpec('c2', 'r2', 'lib', 'r2'))
    rebuildIndexes(d, null)
    const before = d.childrenOf.get('r2')
    // Mutate only r1's subtree
    d.specs.get('c1')!.name = 'renamed'
    rebuildIndexes(d, ['c1'])
    const after = d.childrenOf.get('r2')
    expect(after).toBe(before) // reference equality — unaffected subtree
  })
})
