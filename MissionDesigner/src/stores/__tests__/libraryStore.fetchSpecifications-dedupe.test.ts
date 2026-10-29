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
    listLibrarySpecs: vi.fn(),
    bulkFetch: vi.fn(async () => ({ specs: [], missingIds: [] })),
    batchSave: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}))

import { api } from '../specificationStore/apiClient'
import { useLibraryStore } from '../libraryStore'
import { useSpecificationStore } from '../specificationStore'

const listLibrarySpecs = vi.mocked(api.listLibrarySpecs)

/** A listLibrarySpecs that stays pending until the test resolves it, per library. */
function deferredListLibrarySpecs() {
  const resolvers = new Map<string, () => void>()
  listLibrarySpecs.mockImplementation(
    (libraryId: string) =>
      new Promise((resolve) => {
        resolvers.set(libraryId, () => resolve({ library: { id: libraryId }, specs: [] } as never))
      }),
  )
  return {
    resolve: async (libraryId: string) => {
      resolvers.get(libraryId)?.()
      // let the store's continuation (set specifications) run
      await new Promise((r) => setTimeout(r, 0))
    },
  }
}

beforeEach(() => {
  listLibrarySpecs.mockReset()
  useLibraryStore.setState({ specifications: new Map(), error: null } as never)
  useSpecificationStore.setState({ specs: new Map() } as never)
})

describe('libraryStore.fetchSpecifications — concurrent calls are deduplicated', () => {
  it('three concurrent fetches of one library issue ONE request and share the result', async () => {
    const server = deferredListLibrarySpecs()
    const store = useLibraryStore.getState()

    const p1 = store.fetchSpecifications('lib-1')
    const p2 = store.fetchSpecifications('lib-1')
    const p3 = store.fetchSpecifications('lib-1')
    expect(listLibrarySpecs).toHaveBeenCalledTimes(1)

    await server.resolve('lib-1')
    await Promise.all([p1, p2, p3])
    expect(useLibraryStore.getState().specifications.has('lib-1')).toBe(true)
    expect(listLibrarySpecs).toHaveBeenCalledTimes(1)
  })

  it('a fetch after the first one settled is a real fetch again (dedupe is only while in flight)', async () => {
    const server = deferredListLibrarySpecs()
    const store = useLibraryStore.getState()

    const p1 = store.fetchSpecifications('lib-1')
    await server.resolve('lib-1')
    await p1
    const p2 = store.fetchSpecifications('lib-1')
    await server.resolve('lib-1')
    await p2
    expect(listLibrarySpecs).toHaveBeenCalledTimes(2)
  })

  it('a specifications-keyed fan-out effect over N libraries costs N requests, not N²', async () => {
    // This is the shape of SpecificationHeader's and OutdatedActionsChip's effects:
    // whenever `specifications` changes, (re)fetch every library not yet present.
    // Without in-flight dedupe every completion re-fetches all the libraries
    // still loading, so N libraries cost N + (N-1) + ... + 1 requests — the
    // burst that tripped the 100/min API limiter with 8 libraries.
    const server = deferredListLibrarySpecs()
    const libs = ['lib-a', 'lib-b', 'lib-c', 'lib-d']
    const refetchMissing = () => {
      const s = useLibraryStore.getState()
      for (const id of libs) if (!s.specifications.has(id)) void s.fetchSpecifications(id)
    }
    const unsubscribe = useLibraryStore.subscribe((s, prev) => {
      if (s.specifications !== prev.specifications) refetchMissing()
    })
    try {
      refetchMissing()
      for (const id of libs) await server.resolve(id)
      expect(useLibraryStore.getState().specifications.size).toBe(libs.length)
      expect(listLibrarySpecs).toHaveBeenCalledTimes(libs.length)
    } finally {
      unsubscribe()
    }
  })
})
