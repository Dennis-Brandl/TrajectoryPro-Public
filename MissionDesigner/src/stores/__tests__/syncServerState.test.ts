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

// The library export builds its file from the spec store; syncServerState brings cached specs'
// state/version/history up to date with the server listing first, without touching content.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/stores/specificationStore/saveScheduler', () => ({
  scheduleFlush: vi.fn(),
  cancelFlush: vi.fn(),
  hasPendingFlush: () => false,
  flushNow: vi.fn(),
}))

const bulkFetch = vi.fn()
vi.mock('@/stores/specificationStore/apiClient', async (orig) => {
  const mod = await orig<typeof import('@/stores/specificationStore/apiClient')>()
  return { ...mod, api: { ...mod.api, bulkFetch: (ids: string[]) => bulkFetch(ids) } }
})

import { useSpecificationStore } from '@/stores/specificationStore'
import { syncServerState } from '@/stores/specificationStore/syncServerState'
import type { Specification } from '@/stores/specificationStore/types'

function seed(id: string, state: string, version = '1.0.0'): void {
  useSpecificationStore.setState((s) => {
    const spec: Specification = {
      id,
      parentSpecificationId: null,
      rootSpecificationId: id,
      libraryId: 'lib-A',
      name: id,
      description: null,
      typeName: null,
      version,
      state,
      data: { nodes: ['local edit'] },
      dataSchemaVersion: 4,
      history: [],
      createdAt: 0,
      updatedAt: 0,
      lastEditedByUserId: null,
    }
    s.specs.set(id, spec)
  })
}

const entry = {
  type: 'state_change',
  at: '2026-10-22T12:17:18.851Z',
  account: 'u1',
  version: '2.0.0',
  fromState: 'Draft',
  toState: 'Effective',
  reason: 'release',
}

describe('syncServerState', () => {
  beforeEach(() => {
    useSpecificationStore.getState()._reset()
    bulkFetch.mockReset()
  })

  it('re-fetches only the specs whose state or version differ, and keeps their content', async () => {
    seed('same', 'Draft')
    seed('stale', 'Draft', '1.0.0')
    bulkFetch.mockResolvedValue({
      specs: [{ id: 'stale', state: 'Effective', version: '2.0.0', history: JSON.stringify([entry]), data: '{}' }],
      missingIds: [],
    })

    await syncServerState([
      { id: 'same', state: 'Draft', version: '1.0.0' },
      { id: 'stale', state: 'Effective', version: '2.0.0' },
      { id: 'not-cached', state: 'Effective', version: '1.0.0' },
    ])

    expect(bulkFetch).toHaveBeenCalledWith(['stale'])
    const stale = useSpecificationStore.getState().specs.get('stale')!
    expect(stale.state).toBe('Effective')
    expect(stale.version).toBe('2.0.0')
    expect(stale.history).toEqual([entry])
    expect(stale.data).toEqual({ nodes: ['local edit'] })
    expect(useSpecificationStore.getState().dirtyIds.has('stale')).toBe(false)
  })

  it('does not call the server when nothing is stale', async () => {
    seed('same', 'Effective')
    await syncServerState([{ id: 'same', state: 'Effective', version: '1.0.0' }])
    expect(bulkFetch).not.toHaveBeenCalled()
  })
})
