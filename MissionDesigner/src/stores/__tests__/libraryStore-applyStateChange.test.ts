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

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/stores/specificationStore/saveScheduler', () => ({
  scheduleFlush: vi.fn(),
  cancelFlush: vi.fn(),
  hasPendingFlush: () => false,
  flushNow: vi.fn(),
}))

import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import type { Specification as SpecSpec } from '@/stores/specificationStore/types'

function stubFetches() {
  const fetchSpecifications = vi.fn().mockResolvedValue(undefined)
  const fetchSpecTree = vi.fn().mockResolvedValue(undefined)
  useLibraryStore.setState({ fetchSpecifications, fetchSpecTree } as unknown as Parameters<
    typeof useLibraryStore.setState
  >[0])
  return { fetchSpecifications, fetchSpecTree }
}

function seedDraft(id: string): void {
  useSpecificationStore.setState((s) => {
    const spec: SpecSpec = {
      id,
      parentSpecificationId: null,
      rootSpecificationId: id,
      libraryId: 'lib-A',
      name: 'X',
      description: null,
      typeName: null,
      version: '1.0.0',
      state: 'Draft',
      data: { nodes: [] },
      dataSchemaVersion: 4,
      history: [],
      createdAt: 0,
      updatedAt: 0,
      lastEditedByUserId: null,
    }
    s.specs.set(id, spec)
  })
}

const effectiveEntry = {
  type: 'state_change',
  at: '2026-10-21T20:33:18.593Z',
  account: 'u1',
  version: '1.0.0',
  fromState: 'Draft',
  toState: 'Effective',
  reason: 'release',
}

describe('libraryStore applyStateChange', () => {
  beforeEach(() => {
    useSpecificationStore.getState()._reset()
  })

  it('refreshes both spec list and spec tree for the affected library', async () => {
    const { fetchSpecifications, fetchSpecTree } = stubFetches()
    const updated = {
      id: 's1',
      libraryId: 'lib-A',
      name: 'X',
      version: '1.0.0',
      state: 'InReview',
      history: [],
    } as never
    await useLibraryStore.getState().applyStateChange(updated)
    expect(fetchSpecifications).toHaveBeenCalledWith('lib-A')
    expect(fetchSpecTree).toHaveBeenCalledWith('lib-A')
  })

  it('updates the open spec too, without marking it dirty', async () => {
    stubFetches()
    seedDraft('s1')
    const updated = {
      id: 's1',
      libraryId: 'lib-A',
      name: 'X',
      version: '1.0.0',
      state: 'Effective',
      history: [effectiveEntry],
    } as never
    await useLibraryStore.getState().applyStateChange(updated)
    const spec = useSpecificationStore.getState().specs.get('s1')!
    expect(spec.state).toBe('Effective')
    expect(spec.history).toEqual([effectiveEntry])
    expect(useSpecificationStore.getState().dirtyIds.has('s1')).toBe(false)
  })

  it('a later in-memory edit does not put the old state back on screen', async () => {
    stubFetches()
    seedDraft('s1')
    await useLibraryStore.getState().applyStateChange({
      id: 's1',
      libraryId: 'lib-A',
      name: 'X',
      version: '1.0.0',
      state: 'Effective',
      history: [effectiveEntry],
    } as never)
    // The canvas version bump goes through updateInMemory, which re-syncs
    // libraryStore.specifications from the spec store.
    useSpecificationStore.getState().updateInMemory('s1', { version: '2.0.0' })
    const listed = useLibraryStore
      .getState()
      .specifications.get('lib-A')!
      .find((s) => s.id === 's1')!
    expect(listed.state).toBe('Effective')
    expect(listed.version).toBe('2.0.0')
  })
})
