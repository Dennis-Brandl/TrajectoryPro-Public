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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ImportPreviewCache } from '@/server/lib/importPreviewCache'

describe('ImportPreviewCache', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('round-trips a stored bundle by previewId', () => {
    const cache = new ImportPreviewCache({ capacity: 4, ttlMs: 10_000 })
    const id = cache.put({ marker: 'x' } as unknown as never)
    expect(cache.get(id)).toEqual({ marker: 'x' })
  })

  it('returns undefined after TTL expires', () => {
    const cache = new ImportPreviewCache({ capacity: 4, ttlMs: 1_000 })
    const id = cache.put({ marker: 'x' } as unknown as never)
    vi.advanceTimersByTime(2_000)
    expect(cache.get(id)).toBeUndefined()
  })

  it('evicts oldest when capacity exceeded', () => {
    const cache = new ImportPreviewCache({ capacity: 2, ttlMs: 60_000 })
    const a = cache.put({ marker: 'a' } as unknown as never)
    const b = cache.put({ marker: 'b' } as unknown as never)
    const c = cache.put({ marker: 'c' } as unknown as never)
    expect(cache.get(a)).toBeUndefined()
    expect(cache.get(b)).toEqual({ marker: 'b' })
    expect(cache.get(c)).toEqual({ marker: 'c' })
  })

  it('evict() removes a single entry', () => {
    const cache = new ImportPreviewCache({ capacity: 4, ttlMs: 60_000 })
    const id = cache.put({ marker: 'x' } as unknown as never)
    cache.evict(id)
    expect(cache.get(id)).toBeUndefined()
  })
})
