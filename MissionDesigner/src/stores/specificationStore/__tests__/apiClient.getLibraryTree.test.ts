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

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { api, ApiError } from '../apiClient'

const originalFetch = global.fetch

beforeEach(() => {
  vi.restoreAllMocks()
})
afterEach(() => {
  global.fetch = originalFetch
})

describe('api.getLibraryTree', () => {
  it('GETs /api/v2/libraries/:id/specifications/tree with credentials', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ roots: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    global.fetch = fetchMock as unknown as typeof fetch
    const out = await api.getLibraryTree('lib-1')
    expect(out).toEqual({ roots: [] })
    expect(fetchMock).toHaveBeenCalledWith('/api/v2/libraries/lib-1/specifications/tree', { credentials: 'include' })
  })

  it('throws ApiError on non-2xx', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch
    await expect(api.getLibraryTree('missing')).rejects.toBeInstanceOf(ApiError)
  })
})
