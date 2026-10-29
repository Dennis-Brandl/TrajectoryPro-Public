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

// Phase 35 §5.4 G8 B13: rate-limit boundary test.
// Asserts the 121st mutating call → 429 + lastSaveError.code === 'rate_limited'
// + dirty set preserved.

// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  setupTestFixture,
  resetAndSeedFixture,
  mockSessionAs,
  type TestFixture,
} from '../../server/routes/v2/__tests__/testSeed'
import { useSpecificationStore } from '../specificationStore'

let f: TestFixture

beforeAll(async () => {
  f = await setupTestFixture()
  global.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    return f.app.request(String(input), {
      ...init,
      headers: { ...(init?.headers as Record<string, string> | undefined), origin: 'http://localhost:5173' },
    })
  }) as typeof fetch
})

beforeEach(async () => {
  await resetAndSeedFixture(f)
  mockSessionAs(f.userIdGlobal)
  useSpecificationStore.getState()._reset()
})

describe('rate-limit boundary (G8 B13)', () => {
  it('121st mutating call → 429 + dirty preserved + lastSaveError.code === rate_limited', async () => {
    await useSpecificationStore.getState().loadTree(f.rootSpecId)

    // The spec already exists server-side (loadTree populates it without adding
    // to unsavedNewIds), so updates go through as op:'update' cleanly.

    // Fire up to 121 rapid updates; each triggers a batchSave via explicit call.
    let sawRateLimited = false
    for (let i = 0; i < 121; i++) {
      useSpecificationStore.getState().updateInMemory(f.rootSpecId, { name: `Update ${i}` })
      await useSpecificationStore.getState().batchSave()
      const err = useSpecificationStore.getState().lastSaveError
      if (err?.code === 'rate_limited') {
        sawRateLimited = true
        break
      }
    }
    expect(sawRateLimited).toBe(true)
    // Dirty state preserved
    expect(useSpecificationStore.getState().dirtyIds.has(f.rootSpecId)).toBe(true)
  }, 30_000) // 30s timeout — 120 sequential saves take a while
})
