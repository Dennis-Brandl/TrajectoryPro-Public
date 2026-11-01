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
  flushNow: vi.fn().mockResolvedValue(undefined),
}))

import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import type { Specification as SpecSpec } from '@/stores/specificationStore/types'

function seed(id: string, rootId: string, parent: string | null, libraryId: string): void {
  useSpecificationStore.setState((s) => {
    const spec: SpecSpec = {
      id,
      parentSpecificationId: parent,
      rootSpecificationId: rootId,
      libraryId,
      name: 'X',
      description: null,
      typeName: null,
      version: '1.0.0',
      state: 'Draft',
      data: {},
      dataSchemaVersion: 4,
      history: [],
      createdAt: 0,
      updatedAt: 0,
      lastEditedByUserId: null,
    }
    s.specs.set(id, spec)
  })
}

describe('libraryStore applyMove', () => {
  const fetchSpecifications = vi.fn().mockResolvedValue(undefined)
  const fetchSpecTree = vi.fn().mockResolvedValue(undefined)
  const fetchLibraries = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    useSpecificationStore.getState()._reset()
    useLibraryStore.setState({
      fetchSpecifications,
      fetchSpecTree,
      fetchLibraries,
      selectedTeamId: 't1',
    } as unknown as Parameters<typeof useLibraryStore.setState>[0])
  })

  it('re-homes the cached roots and their children, refreshes both libraries and selects the element', async () => {
    seed('s1', 's1', null, 'lib-A')
    seed('c1', 's1', 's1', 'lib-A')
    await useLibraryStore
      .getState()
      .applyMove({ libraryId: 'lib-B', specId: 's1', fromLibraryId: 'lib-A', movedRootIds: ['s1'] })
    const specs = useSpecificationStore.getState().specs
    expect(specs.get('s1')?.libraryId).toBe('lib-B')
    expect(specs.get('c1')?.libraryId).toBe('lib-B')
    expect(fetchSpecifications).toHaveBeenCalledWith('lib-A')
    expect(fetchSpecifications).toHaveBeenCalledWith('lib-B')
    expect(fetchSpecTree).toHaveBeenCalledWith('lib-A')
    expect(fetchSpecTree).toHaveBeenCalledWith('lib-B')
    expect(fetchLibraries).not.toHaveBeenCalled()
    expect(useLibraryStore.getState().selectedSpecificationId).toBe('s1')
    expect(useLibraryStore.getState().selectedLibraryId).toBe('lib-B')
    expect(useLibraryStore.getState().selectedTeamId).toBe('t1')
  })

  it('switches the team and reloads libraries when the move created some', async () => {
    const loadLibraries = vi.fn().mockResolvedValue(undefined)
    const loadBulk = vi.fn().mockResolvedValue(undefined)
    useSpecificationStore.setState({ loadLibraries, loadBulk } as unknown as Parameters<
      typeof useSpecificationStore.setState
    >[0])
    await useLibraryStore
      .getState()
      .applyMove({ libraryId: 'lib-B', specId: 's1', fromLibraryId: 'lib-A', teamId: 't2', librariesCreated: true })
    expect(loadLibraries).toHaveBeenCalled()
    expect(fetchLibraries).toHaveBeenCalled()
    expect(useLibraryStore.getState().selectedTeamId).toBe('t2')
    expect(useLibraryStore.getState().selectedSpecificationId).toBe('s1')
  })

  it('also refreshes destination libraries that received dependency copies', async () => {
    const fetchSpecs = vi.fn().mockResolvedValue(undefined)
    const fetchTree = vi.fn().mockResolvedValue(undefined)
    useLibraryStore.setState({ fetchSpecifications: fetchSpecs, fetchSpecTree: fetchTree } as never)
    await useLibraryStore.getState().applyMove({
      libraryId: 'lib-B',
      specId: 's1',
      fromLibraryId: 'lib-A',
      teamId: 't2',
      touchedLibraryIds: ['env-dest', 'lib-B'],
    })
    const specIds = fetchSpecs.mock.calls.map((c) => c[0] as string).sort()
    expect(specIds).toEqual(['env-dest', 'lib-A', 'lib-B'])
    expect(fetchTree.mock.calls.map((c) => c[0] as string).sort()).toEqual(['env-dest', 'lib-A', 'lib-B'])
  })

  describe('applyCopy', () => {
    it('pulls in the copies and refreshes only the destinations, leaving the selection alone', async () => {
      const loadBulk = vi.fn().mockResolvedValue(undefined)
      useSpecificationStore.setState({ loadBulk } as unknown as Parameters<typeof useSpecificationStore.setState>[0])
      seed('s1', 's1', null, 'lib-A')
      useLibraryStore.setState({ selectedSpecificationId: 's1', selectedLibraryId: 'lib-A' })
      await useLibraryStore
        .getState()
        .applyCopy({ libraryId: 'lib-B', copiedRootIds: ['n1'], touchedLibraryIds: ['env-dest', 'lib-B'] })
      expect(loadBulk).toHaveBeenCalledWith(['n1'])
      expect(fetchSpecifications.mock.calls.map((c) => c[0] as string).sort()).toEqual(['env-dest', 'lib-B'])
      expect(fetchSpecTree.mock.calls.map((c) => c[0] as string).sort()).toEqual(['env-dest', 'lib-B'])
      expect(fetchLibraries).not.toHaveBeenCalled()
      expect(useSpecificationStore.getState().specs.get('s1')?.libraryId).toBe('lib-A')
      expect(useLibraryStore.getState().selectedSpecificationId).toBe('s1')
      expect(useLibraryStore.getState().selectedLibraryId).toBe('lib-A')
      expect(useLibraryStore.getState().selectedTeamId).toBe('t1')
    })

    it('reloads libraries when the copy created some', async () => {
      const loadLibraries = vi.fn().mockResolvedValue(undefined)
      useSpecificationStore.setState({
        loadLibraries,
        loadBulk: vi.fn().mockResolvedValue(undefined),
      } as unknown as Parameters<typeof useSpecificationStore.setState>[0])
      await useLibraryStore.getState().applyCopy({ libraryId: 'lib-B', copiedRootIds: ['n1'], librariesCreated: true })
      expect(loadLibraries).toHaveBeenCalled()
      expect(fetchLibraries).toHaveBeenCalled()
    })
  })

  describe('reloading cached specs', () => {
    it('reloads a cached moved workflow (all versions and children) even though it was cached', async () => {
      seed('s1', 's1', null, 'lib-A')
      seed('c1', 's1', 's1', 'lib-A')
      seed('s0', 's0', null, 'lib-A')
      const loadBulk = vi.fn().mockResolvedValue(undefined)
      useSpecificationStore.setState({ loadBulk } as unknown as Parameters<typeof useSpecificationStore.setState>[0])
      await useLibraryStore.getState().applyMove({
        libraryId: 'lib-B',
        specId: 's1',
        fromLibraryId: 'lib-A',
        movedRootIds: ['s1', 's0'],
        teamId: 't2',
      })
      const ids = loadBulk.mock.calls.flatMap((c) => c[0] as string[])
      expect(new Set(ids)).toEqual(new Set(['s1', 'c1', 's0']))
    })

    it('reloads a cached environment whose data names the source library, but not dirty or unrelated specs', async () => {
      seed('moved-1', 'moved-1', null, 'lib-A')
      seed('env', 'env', null, 'lib-E')
      seed('dirty', 'dirty', null, 'lib-E')
      seed('other', 'other', null, 'lib-E')
      useSpecificationStore.setState((st) => {
        st.libraries.set('lib-A', { id: 'lib-A', name: 'Pumps' } as never)
        st.specs.get('env')!.data = { actions: [{ library: 'Pumps' }] }
        st.specs.get('dirty')!.data = { actions: [{ library: 'Pumps' }] }
        st.specs.get('other')!.data = { actions: [{ library: 'Valves' }] }
        st.dirtyIds.add('dirty')
      })
      const loadBulk = vi.fn().mockResolvedValue(undefined)
      useSpecificationStore.setState({ loadBulk } as unknown as Parameters<typeof useSpecificationStore.setState>[0])
      await useLibraryStore
        .getState()
        .applyMove({ libraryId: 'lib-B', specId: 'moved-1', fromLibraryId: 'lib-A', movedRootIds: ['moved-1'] })
      const ids = loadBulk.mock.calls.flatMap((c) => c[0] as string[])
      expect(new Set(ids)).toEqual(new Set(['moved-1', 'env']))
    })
  })
})
