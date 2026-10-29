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

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  setupTestFixture,
  resetAndSeedFixture,
  mockSessionAs,
  type TestFixture,
} from '../../server/routes/v2/__tests__/testSeed'
import { useSpecificationStore } from '../specificationStore'

// We patch global fetch to route through the test fixture's Hono app.
// This gives us real server behavior (DB + triggers + auth + rate limits)
// with zero mocking of the store-side code.

let f: TestFixture

beforeAll(async () => {
  f = await setupTestFixture()
  const originalFetch = global.fetch
  global.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.startsWith('/api/v2/')) {
      return f.app.request(url, {
        ...init,
        headers: { ...(init?.headers as Record<string, string> | undefined), origin: 'http://localhost:5173' },
      })
    }
    return originalFetch(input, init)
  }) as typeof fetch
})

beforeEach(async () => {
  await resetAndSeedFixture(f)
  mockSessionAs(f.userIdGlobal)
  useSpecificationStore.getState()._reset()
})

describe('contract.live: real API round-trip', () => {
  it('loadLibraries → loadTree → updateInMemory → batchSave round-trips through the real server', async () => {
    await useSpecificationStore.getState().loadLibraries()
    expect(useSpecificationStore.getState().libraries.size).toBeGreaterThan(0)

    await useSpecificationStore.getState().loadTree(f.rootSpecId)
    expect(useSpecificationStore.getState().specs.has(f.rootSpecId)).toBe(true)

    // The spec already exists server-side (not unsaved), so buildBatchSavePayload
    // will emit op:'update' by default.
    useSpecificationStore.getState().updateInMemory(f.rootSpecId, { name: 'Renamed via contract test' })
    expect(useSpecificationStore.getState().dirtyIds.has(f.rootSpecId)).toBe(true)

    await useSpecificationStore.getState().batchSave()
    const saved = useSpecificationStore.getState().specs.get(f.rootSpecId)
    expect(saved?.name).toBe('Renamed via contract test')
    expect(useSpecificationStore.getState().dirtyIds.has(f.rootSpecId)).toBe(false)
  })

  it('bulk-fetch returns missingIds for unreadable ids', async () => {
    await useSpecificationStore.getState().loadBulk([f.rootSpecId, 'nope'])
    expect(useSpecificationStore.getState().specs.has(f.rootSpecId)).toBe(true)
    expect(useSpecificationStore.getState().specs.has('nope')).toBe(false)
  })
})
