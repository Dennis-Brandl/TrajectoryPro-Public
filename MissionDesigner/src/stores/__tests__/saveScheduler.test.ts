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

vi.useFakeTimers()

vi.mock('../specificationStore/apiClient', () => ({
  api: { batchSave: vi.fn().mockResolvedValue({ specs: [], libraries: [] }) },
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

import {
  scheduleFlush,
  cancelFlush,
  hasPendingFlush,
  installNavigationGuard,
  flushNow,
  SaveFailedError,
} from '../specificationStore/saveScheduler'
import { api, ApiError } from '../specificationStore/apiClient'
import { useSpecificationStore } from '../specificationStore'
import type { Specification } from '../specificationStore/types'

const mockBatchSave = api.batchSave as unknown as ReturnType<typeof vi.fn>
const OK = { specs: [], libraries: [] }

function mkSpec(id: string): Specification {
  return {
    id,
    parentSpecificationId: null,
    rootSpecificationId: id,
    libraryId: 'lib',
    name: 'R',
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

function seedDirty(id = 'r'): void {
  useSpecificationStore.setState((s) => {
    s.specs.set(id, mkSpec(id))
    s.dirtyIds.add(id)
  })
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  useSpecificationStore.getState()._reset()
  cancelFlush()
  mockBatchSave.mockReset()
  mockBatchSave.mockResolvedValue(OK)
})

describe('saveScheduler', () => {
  it('debounces multiple scheduleFlush calls', () => {
    scheduleFlush()
    scheduleFlush()
    scheduleFlush()
    expect(hasPendingFlush()).toBe(true)
    // Debounce is 1500ms (saveScheduler.ts) — kept long enough that natural
    // typing pauses don't trigger saves and lose keystrokes to the edit-lock.
    vi.advanceTimersByTime(1500)
    expect(hasPendingFlush()).toBe(false)
  })

  it('cancelFlush cancels the pending flush', () => {
    scheduleFlush()
    expect(hasPendingFlush()).toBe(true)
    cancelFlush()
    expect(hasPendingFlush()).toBe(false)
  })

  it('installNavigationGuard returns a cleanup function', () => {
    const cleanup = installNavigationGuard()
    expect(typeof cleanup).toBe('function')
    cleanup()
  })

  it('flushNow waits for the in-flight save and sends the mid-save edit', async () => {
    seedDirty()
    const first = deferred<typeof OK>()
    mockBatchSave.mockReturnValueOnce(first.promise)
    const inFlight = useSpecificationStore.getState().batchSave()
    useSpecificationStore.getState().updateSpecData('r', { nodes: ['edited'] })
    let done = false
    const flushed = flushNow().then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    first.resolve(OK)
    await flushed
    await inFlight
    expect(done).toBe(true)
    expect(mockBatchSave).toHaveBeenCalledTimes(2)
    const second = mockBatchSave.mock.calls[1][0] as { specs: Array<{ data: string }> }
    expect(JSON.parse(second.specs[0].data)).toEqual({ nodes: ['edited'] })
    const s = useSpecificationStore.getState()
    expect(s.dirtyIds.size).toBe(0)
    expect(s.savingIds.size).toBe(0)
  })

  it('flushNow rejects with SaveFailedError when the save fails', async () => {
    seedDirty()
    mockBatchSave.mockRejectedValue(new ApiError(500, 'internal', {}))
    await expect(flushNow()).rejects.toBeInstanceOf(SaveFailedError)
    expect(mockBatchSave).toHaveBeenCalledTimes(1)
  })

  it('flushNow rejects when the awaited in-flight save fails', async () => {
    seedDirty()
    const first = deferred<typeof OK>()
    mockBatchSave.mockReturnValueOnce(first.promise)
    const inFlight = useSpecificationStore.getState().batchSave()
    const flushed = flushNow()
    first.reject(new ApiError(500, 'internal', {}))
    await expect(flushed).rejects.toBeInstanceOf(SaveFailedError)
    await inFlight
    expect(mockBatchSave).toHaveBeenCalledTimes(1)
  })

  it('flushNow stops after 5 passes', async () => {
    seedDirty()
    let n = 0
    mockBatchSave.mockImplementation(() => {
      n += 1
      useSpecificationStore.getState().updateSpecData('r', { nodes: [n] })
      return Promise.resolve(OK)
    })
    const err = await flushNow().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SaveFailedError)
    expect((err as SaveFailedError).saveError.code).toBe('still_changing')
    expect(mockBatchSave).toHaveBeenCalledTimes(5)
  })

  it('flushNow gives up on a dirty id that can never be sent and reports it through lastSaveError', async () => {
    // Dirty, but the spec is not in the cache: every pass has an empty payload.
    useSpecificationStore.setState((s) => {
      s.dirtyIds.add('ghost')
    })
    const err = await flushNow().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SaveFailedError)
    const last = useSpecificationStore.getState().lastSaveError
    expect(last).toEqual({ status: 0, code: 'still_changing', message: 'Changes are still being made' })
  })
})
