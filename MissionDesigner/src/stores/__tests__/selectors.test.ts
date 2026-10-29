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
import { renderHook, act } from '@testing-library/react'
import { useSpecificationStore } from '../specificationStore'
import { useChildren, getDescendants } from '../specificationStore/selectors'
import type { Specification } from '../specificationStore/types'

function seed(id: string, parentId: string | null, libraryId = 'lib'): Specification {
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
  return spec
}

beforeEach(() => useSpecificationStore.getState()._reset())

describe('useChildren stable reference', () => {
  it('returns the same reference across unrelated mutations (§3.13 i1)', () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('r1', seed('r1', null))
      s.specs.set('c1', seed('c1', 'r1'))
      s.specs.set('r2', seed('r2', null))
      s.specs.set('c2', seed('c2', 'r2'))
    })
    // Prime indexes
    useSpecificationStore
      .getState()
      .loadBulk([])
      .catch(() => {})
    // Force a rebuild
    useSpecificationStore.setState((s) => {
      const children1: Specification[] = Object.freeze([s.specs.get('c1')!]) as Specification[]
      const children2: Specification[] = Object.freeze([s.specs.get('c2')!]) as Specification[]
      s.childrenOf.set('r1', children1)
      s.childrenOf.set('r2', children2)
    })
    const { result, rerender } = renderHook(() => useChildren('r2'))
    const before = result.current
    // Mutate only r1's subtree
    act(() => {
      useSpecificationStore.getState().updateInMemory('c1', { name: 'renamed' })
    })
    rerender()
    const after = result.current
    expect(after).toBe(before)
  })
})

describe('getDescendants', () => {
  it('returns the root + all descendants', () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('r', seed('r', null))
      s.specs.set('c', seed('c', 'r'))
      s.specs.set('gc', seed('gc', 'c'))
      s.childrenOf.set('r', Object.freeze([s.specs.get('c')!]) as Specification[])
      s.childrenOf.set('c', Object.freeze([s.specs.get('gc')!]) as Specification[])
    })
    const ds = getDescendants('r')
      .map((sp) => sp.id)
      .sort()
    expect(ds).toEqual(['c', 'gc', 'r'])
  })
})
