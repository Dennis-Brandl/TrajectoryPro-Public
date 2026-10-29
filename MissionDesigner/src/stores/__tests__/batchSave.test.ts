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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../specificationStore/apiClient', () => ({
  api: { batchSave: vi.fn(), bulkFetch: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      public body: Record<string, unknown>,
    ) {
      super(`${status}`)
    }
  },
}))

import { api, ApiError } from '../specificationStore/apiClient'
import { useSpecificationStore } from '../specificationStore'
import type { Specification } from '../specificationStore/types'

const mockApi = api as unknown as { batchSave: ReturnType<typeof vi.fn>; bulkFetch: ReturnType<typeof vi.fn> }

function mkSpec(overrides: Partial<Specification> & { id: string }): Specification {
  return {
    id: overrides.id,
    parentSpecificationId: null,
    rootSpecificationId: overrides.id,
    libraryId: 'lib',
    name: overrides.name ?? 'R',
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

beforeEach(() => {
  useSpecificationStore.getState()._reset()
  mockApi.batchSave.mockReset()
  mockApi.bulkFetch.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const OK = { specs: [], libraries: [] }

describe('batchSave', () => {
  it('200 happy path: clears dirty and savingIds', async () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('r', mkSpec({ id: 'r', name: 'Edited' }))
      s.dirtyIds.add('r')
    })
    mockApi.batchSave.mockResolvedValue({
      specs: [{ id: 'r' }],
      libraries: [{ id: 'lib' }],
    })
    await useSpecificationStore.getState().batchSave()
    const s = useSpecificationStore.getState()
    expect(s.dirtyIds.has('r')).toBe(false)
    expect(s.savingIds.size).toBe(0)
  })

  it('updateInMemory({ typeName }) is carried into the batch-save payload update', async () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('r', mkSpec({ id: 'r' }))
    })
    useSpecificationStore.getState().updateInMemory('r', { typeName: 'Operation' })
    mockApi.batchSave.mockResolvedValue({ specs: [{ id: 'r' }], libraries: [{ id: 'lib' }] })
    await useSpecificationStore.getState().batchSave()
    const payload = mockApi.batchSave.mock.calls[0][0] as {
      specs: Array<{ op: string; id: string; typeName?: string | null }>
    }
    expect(payload.specs.find((x) => x.id === 'r')).toMatchObject({ op: 'update', typeName: 'Operation' })
  })

  it('non-5xx/409 error keeps dirty and sets lastSaveError', async () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('r', mkSpec({ id: 'r' }))
      s.dirtyIds.add('r')
    })
    mockApi.batchSave.mockRejectedValue(new ApiError(500, 'internal', {}))
    await useSpecificationStore.getState().batchSave()
    const s = useSpecificationStore.getState()
    expect(s.dirtyIds.has('r')).toBe(true)
    expect(s.savingIds.size).toBe(0)
    expect(s.lastSaveError?.status).toBe(500)
  })

  it('409 on CREATE self-heals by demoting server-existing ids from unsavedNewIds', async () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('r', mkSpec({ id: 'r' }))
      s.dirtyIds.add('r')
      s.unsavedNewIds.add('r')
    })
    mockApi.batchSave.mockRejectedValue(new ApiError(409, 'conflict', { conflictType: 'unique', constraint: 'pk' }))
    mockApi.bulkFetch.mockResolvedValue({ specs: [{ id: 'r' }], missingIds: [] })
    await useSpecificationStore.getState().batchSave()
    // Let the fire-and-forget reconciliation settle
    await new Promise((r) => setTimeout(r, 0))
    const s = useSpecificationStore.getState()
    expect(s.unsavedNewIds.has('r')).toBe(false) // demoted — next save will be UPDATE
    expect(s.dirtyIds.has('r')).toBe(true) // still dirty so it retries
    expect(mockApi.bulkFetch).toHaveBeenCalledWith(['r'])
  })

  it('409 self-heal does not demote ids the server does not have', async () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('r', mkSpec({ id: 'r' }))
      s.dirtyIds.add('r')
      s.unsavedNewIds.add('r')
    })
    mockApi.batchSave.mockRejectedValue(
      new ApiError(409, 'conflict', { conflictType: 'unique', constraint: 'specification.name' }),
    )
    mockApi.bulkFetch.mockResolvedValue({ specs: [], missingIds: ['r'] })
    await useSpecificationStore.getState().batchSave()
    await new Promise((r) => setTimeout(r, 0))
    const s = useSpecificationStore.getState()
    expect(s.unsavedNewIds.has('r')).toBe(true) // still a pending create — user name collision, not self-healable
  })

  it('an edit made during an in-flight save is saved after it', async () => {
    vi.useFakeTimers()
    useSpecificationStore.setState((s) => {
      s.specs.set('r', mkSpec({ id: 'r' }))
      s.dirtyIds.add('r')
    })
    const first = deferred<typeof OK>()
    mockApi.batchSave.mockReturnValueOnce(first.promise).mockResolvedValue(OK)
    const saving = useSpecificationStore.getState().batchSave()
    useSpecificationStore.getState().updateSpecData('r', { nodes: ['edited'] })
    // The debounce timer fires while the first save is still in flight.
    await vi.advanceTimersByTimeAsync(1500)
    first.resolve(OK)
    await saving
    await vi.advanceTimersByTimeAsync(1500)
    expect(mockApi.batchSave).toHaveBeenCalledTimes(2)
    const second = mockApi.batchSave.mock.calls[1][0] as { specs: Array<{ id: string; data: string }> }
    expect(JSON.parse(second.specs[0].data)).toEqual({ nodes: ['edited'] })
    expect(useSpecificationStore.getState().dirtyIds.size).toBe(0)
  })

  it('a failed save is not retried by itself', async () => {
    vi.useFakeTimers()
    useSpecificationStore.setState((s) => {
      s.specs.set('r', mkSpec({ id: 'r' }))
      s.dirtyIds.add('r')
    })
    mockApi.batchSave.mockRejectedValue(new ApiError(500, 'internal', {}))
    await useSpecificationStore.getState().batchSave()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mockApi.batchSave).toHaveBeenCalledTimes(1)
  })

  it('a delete-only batch is not sent twice concurrently', async () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('r', mkSpec({ id: 'r' }))
      s.pendingDeletes.add('r')
    })
    const first = deferred<typeof OK>()
    mockApi.batchSave.mockReturnValueOnce(first.promise).mockResolvedValue(OK)
    const a = useSpecificationStore.getState().batchSave()
    const b = useSpecificationStore.getState().batchSave()
    await Promise.resolve()
    await Promise.resolve()
    expect(mockApi.batchSave).toHaveBeenCalledTimes(1)
    first.resolve(OK)
    await Promise.all([a, b])
    expect(mockApi.batchSave).toHaveBeenCalledTimes(1)
    expect(useSpecificationStore.getState().specs.has('r')).toBe(false)
  })
})
