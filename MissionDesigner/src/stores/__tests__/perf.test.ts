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

// Phase 35 §5.4 G8: perf gate.
// Not run in the default suite — invoke via `npm run test:run:perf`.
// Uses a pre-built perf DB at test-data/perf.db (skips if absent).

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const DB_PATH = join(process.cwd(), 'test-data', 'perf.db')

// Thresholds (§5.4 G8)
const LOAD_TREE_MAX_MS = 3000
const FIRST_SELECTOR_MAX_MS = 50
const MEMORY_DELTA_MAX_MB = 200

describe.skipIf(!existsSync(DB_PATH))('perf gate (G8)', () => {
  it('loadTree completes within threshold', async () => {
    process.env.DATABASE_URL = DB_PATH
    // Boot the test server against the perf DB
    const { setupTestFixture, mockSessionAs } = await import('../../server/routes/v2/__tests__/testSeed')
    const f = await setupTestFixture()
    mockSessionAs('perf-user')
    // Patch fetch
    global.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      return f.app.request(String(input), {
        ...init,
        headers: { ...(init?.headers as Record<string, string> | undefined), origin: 'http://localhost:5173' },
      })
    }) as typeof fetch

    const { useSpecificationStore } = await import('../specificationStore')
    useSpecificationStore.getState()._reset()

    const heapBefore = process.memoryUsage().heapUsed

    const t0 = performance.now()
    await useSpecificationStore.getState().loadTree('perf-spec-0')
    const loadMs = performance.now() - t0

    const t1 = performance.now()
    const _first = useSpecificationStore.getState().specs.get('perf-spec-0')
    const firstMs = performance.now() - t1
    void _first

    const heapAfter = process.memoryUsage().heapUsed
    const deltaMb = (heapAfter - heapBefore) / (1024 * 1024)

    console.log(
      `loadTree: ${loadMs.toFixed(1)} ms, first read: ${firstMs.toFixed(3)} ms, memory delta: ${deltaMb.toFixed(1)} MB`,
    )

    expect(loadMs).toBeLessThan(LOAD_TREE_MAX_MS)
    expect(firstMs).toBeLessThan(FIRST_SELECTOR_MAX_MS)
    expect(deltaMb).toBeLessThan(MEMORY_DELTA_MAX_MB)

    // Ensure no dirty-mark paths were touched
    expect(useSpecificationStore.getState().dirtyIds.size).toBe(0)
  })
})
