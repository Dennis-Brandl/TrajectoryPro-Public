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

// Mock the apiClient BEFORE importing the store
vi.mock('../specificationStore/apiClient', () => ({
  api: {
    listLibraries: vi.fn(),
    getTree: vi.fn(),
    bulkFetch: vi.fn(),
    getSpec: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      public body: Record<string, unknown>,
    ) {
      super(`${status} ${code}`)
    }
  },
}))

import { api } from '../specificationStore/apiClient'
import { useSpecificationStore } from '../specificationStore'

const mockApi = api as unknown as {
  listLibraries: ReturnType<typeof vi.fn>
  getTree: ReturnType<typeof vi.fn>
  bulkFetch: ReturnType<typeof vi.fn>
  getSpec: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  useSpecificationStore.getState()._reset()
  mockApi.listLibraries.mockReset()
  mockApi.getTree.mockReset()
  mockApi.bulkFetch.mockReset()
  mockApi.getSpec.mockReset()
})

describe('loadLibraries', () => {
  it('populates libraries map and sets isLibrariesLoaded', async () => {
    mockApi.listLibraries.mockResolvedValue({
      libraries: [
        {
          id: 'l1',
          parentLibraryId: null,
          userId: 'u',
          name: 'Lib',
          entityType: 'workflow',
          description: null,
          version: '1.0.0',
          forkedFromLibraryId: null,
          forkedFromVersion: null,
          forkedAt: null,
          createdAt: 0,
          updatedAt: 0,
          lastEditedByUserId: null,
        },
      ],
    })
    await useSpecificationStore.getState().loadLibraries()
    const s = useSpecificationStore.getState()
    expect(s.libraries.size).toBe(1)
    expect(s.libraries.get('l1')?.name).toBe('Lib')
    expect(s.isLibrariesLoaded).toBe(true)
    expect(s.isLibrariesLoading).toBe(false)
  })

  it('rejects malformed library rows via zod', async () => {
    mockApi.listLibraries.mockResolvedValue({ libraries: [{ id: 'l1' /* missing required fields */ }] })
    await expect(useSpecificationStore.getState().loadLibraries()).rejects.toThrow()
    expect(useSpecificationStore.getState().libraries.size).toBe(0)
  })
})

describe('loadTree', () => {
  it('inserts all tree specs and rebuilds indexes', async () => {
    const now = Date.now()
    mockApi.getTree.mockResolvedValue({
      library: {
        id: 'l1',
        parentLibraryId: null,
        userId: 'u',
        name: 'L',
        entityType: 'workflow',
        description: null,
        version: '1.0.0',
        forkedFromLibraryId: null,
        forkedFromVersion: null,
        forkedAt: null,
        createdAt: now,
        updatedAt: now,
        lastEditedByUserId: null,
      },
      specs: [
        {
          id: 'r',
          parentSpecificationId: null,
          rootSpecificationId: 'r',
          libraryId: 'l1',
          name: 'R',
          description: null,
          version: '1.0.0',
          state: 'Draft',
          data: '{"nodes":[]}',
          dataSchemaVersion: 3,
          createdAt: now,
          updatedAt: now,
          lastEditedByUserId: null,
        },
        {
          id: 'c',
          parentSpecificationId: 'r',
          rootSpecificationId: 'r',
          libraryId: 'l1',
          name: 'C',
          description: null,
          version: '1.0.0',
          state: 'Draft',
          data: '{"nodes":[]}',
          dataSchemaVersion: 3,
          createdAt: now,
          updatedAt: now,
          lastEditedByUserId: null,
        },
      ],
      proxyRefs: [],
      specEnvs: [],
      imageManifest: {},
    })
    await useSpecificationStore.getState().loadTree('r')
    const s = useSpecificationStore.getState()
    expect(s.specs.size).toBe(2)
    expect(s.childrenOf.get('r')!.map((sp) => sp.id)).toEqual(['c'])
    expect(s.loadedRootIds.has('r')).toBe(true)
  })
})
