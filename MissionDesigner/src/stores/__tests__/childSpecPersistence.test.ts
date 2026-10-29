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
  api: { batchSave: vi.fn(), bulkFetch: vi.fn() },
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
      public body: Record<string, unknown>,
    ) {
      super(code)
    }
  },
}))

import { api } from '../specificationStore/apiClient'
import { useSpecificationStore } from '../specificationStore'

const mockApi = api as unknown as { batchSave: ReturnType<typeof vi.fn>; bulkFetch: ReturnType<typeof vi.fn> }

beforeEach(() => {
  useSpecificationStore.getState()._reset()
  mockApi.batchSave.mockReset()
  mockApi.bulkFetch.mockReset()
})

describe('parent + child + grandchild batchSave', () => {
  it('includes all three creates with correct parent/root links in one payload', async () => {
    const state = useSpecificationStore.getState()
    const rootId = state.createSpecInMemory({ parentId: null, libraryId: 'lib-1', init: { name: 'Root' } })
    const childId = state.createSpecInMemory({ parentId: rootId, libraryId: 'lib-1', init: { name: 'Child' } })
    const grandId = state.createSpecInMemory({ parentId: childId, libraryId: 'lib-1', init: { name: 'Grand' } })

    mockApi.batchSave.mockResolvedValue({
      specs: [{ id: rootId }, { id: childId }, { id: grandId }],
      libraries: [{ id: 'lib-1' }],
    })

    await useSpecificationStore.getState().batchSave()

    expect(mockApi.batchSave).toHaveBeenCalledTimes(1)
    const payload = mockApi.batchSave.mock.calls[0][0] as {
      specs: Array<{ op: string; id: string; parentSpecificationId?: string | null; rootSpecificationId?: string }>
    }

    const root = payload.specs.find((s) => s.id === rootId)!
    const child = payload.specs.find((s) => s.id === childId)!
    const grand = payload.specs.find((s) => s.id === grandId)!

    expect(root.op).toBe('create')
    expect(root.parentSpecificationId).toBeNull()
    expect(root.rootSpecificationId).toBe(rootId)

    expect(child.op).toBe('create')
    expect(child.parentSpecificationId).toBe(rootId)
    expect(child.rootSpecificationId).toBe(rootId)

    expect(grand.op).toBe('create')
    expect(grand.parentSpecificationId).toBe(childId)
    expect(grand.rootSpecificationId).toBe(rootId)
  })

  it('clears unsavedNewIds for all three after a successful save', async () => {
    const state = useSpecificationStore.getState()
    const rootId = state.createSpecInMemory({ parentId: null, libraryId: 'lib-1', init: { name: 'Root' } })
    const childId = state.createSpecInMemory({ parentId: rootId, libraryId: 'lib-1', init: { name: 'Child' } })
    mockApi.batchSave.mockResolvedValue({ specs: [{ id: rootId }, { id: childId }], libraries: [{ id: 'lib-1' }] })

    await useSpecificationStore.getState().batchSave()

    const s = useSpecificationStore.getState()
    expect(s.unsavedNewIds.has(rootId)).toBe(false)
    expect(s.unsavedNewIds.has(childId)).toBe(false)
    expect(s.dirtyIds.size).toBe(0)
  })
})
