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

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../specificationStore/apiClient', () => ({
  api: {
    getLibraryTree: vi.fn(),
    listLibraries: vi.fn(async () => ({ libraries: [] })),
    listLibrarySpecs: vi.fn(async () => ({ library: { id: 'x' }, specs: [] })),
    bulkFetch: vi.fn(async () => ({ specs: [], missingIds: [] })),
    batchSave: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}))

import { api } from '../specificationStore/apiClient'
import { useLibraryStore } from '../libraryStore'
import type { Specification } from '@/types/library'

const mockApi = api as unknown as { getLibraryTree: ReturnType<typeof vi.fn> }

beforeEach(() => {
  useLibraryStore.setState({ specTrees: new Map() } as Partial<ReturnType<typeof useLibraryStore.getState>>)
  mockApi.getLibraryTree.mockReset()
})

describe('libraryStore.fetchSpecTree', () => {
  it('stores the tree under specTrees keyed by libraryId', async () => {
    mockApi.getLibraryTree.mockResolvedValue({
      roots: [
        {
          id: 'r1',
          libraryId: 'lib-1',
          name: 'A',
          version: '1.0.0',
          state: 'Draft',
          description: null,
          createdAt: 0,
          updatedAt: 0,
          lastEditedByUserId: null,
          children: [],
          referencedChildren: [],
        },
      ],
    })
    await useLibraryStore.getState().fetchSpecTree('lib-1')
    const trees = useLibraryStore.getState().specTrees
    expect(trees.get('lib-1')).toHaveLength(1)
    expect(trees.get('lib-1')![0].id).toBe('r1')
  })
})

describe('specTrees in-memory sync', () => {
  it('patches a tree node when its underlying spec mutates in specStore', async () => {
    const { useSpecificationStore } = await import('../specificationStore')

    // Seed both caches: one tree (cache from server), one matching spec in specStore.
    mockApi.getLibraryTree.mockResolvedValue({
      roots: [
        {
          id: 'spec-A',
          libraryId: 'lib-1',
          name: 'Original',
          version: '1.0.0',
          state: 'Draft',
          description: null,
          createdAt: 0,
          updatedAt: 0,
          lastEditedByUserId: null,
          children: [],
          referencedChildren: [],
        },
      ],
    })
    await useLibraryStore.getState().fetchSpecTree('lib-1')

    useSpecificationStore.setState((s) => {
      const next = new Map(s.specs) as unknown as Map<string, Specification>
      next.set('spec-A', {
        id: 'spec-A',
        libraryId: 'lib-1',
        name: 'Original',
        description: null,
        version: '1.0.0',
        state: 'Draft' as const,
        data: {},
        history: [],
        createdAt: 0,
        updatedAt: 0,
      })
      return { specs: next }
    })

    // Bumping the version on the spec must propagate into the tree node.
    useSpecificationStore.getState().updateInMemory('spec-A', { version: '2.0.0' })

    const treeAfter = useLibraryStore.getState().specTrees.get('lib-1')!
    expect(treeAfter[0].version).toBe('2.0.0')

    // Renaming must propagate too — same code path, same coverage.
    useSpecificationStore.getState().updateInMemory('spec-A', { name: 'Renamed' })
    const treeAfter2 = useLibraryStore.getState().specTrees.get('lib-1')!
    expect(treeAfter2[0].name).toBe('Renamed')
  })
})
