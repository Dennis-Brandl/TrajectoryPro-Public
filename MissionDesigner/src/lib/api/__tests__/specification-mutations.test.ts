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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { changeSpecificationState } from '@/lib/api/specification-mutations'
import { ApiError } from '@/stores/specificationStore/apiClient'

const okSpec = { id: 's1', state: 'Effective' }

beforeEach(() => {
  vi.restoreAllMocks()
})
afterEach(() => vi.restoreAllMocks())

describe('changeSpecificationState', () => {
  it('includes effectiveFrom in the body only when provided', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ spec: okSpec }), { status: 200 })))

    await changeSpecificationState('s1', 'Effective', 'go live', 1_900_000_000_000)
    let body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ newState: 'Effective', reason: 'go live', effectiveFrom: 1_900_000_000_000 })

    await changeSpecificationState('s1', 'InTest', 'wip')
    body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
    expect(body).toEqual({ newState: 'InTest', reason: 'wip' })
    expect('effectiveFrom' in body).toBe(false)
  })

  it('throws ApiError with the parsed code on a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'forbidden' }), { status: 403 }),
    )
    await expect(changeSpecificationState('s1', 'Approved', 'x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'forbidden',
    })
    await expect(changeSpecificationState('s1', 'Approved', 'x')).rejects.toBeInstanceOf(ApiError)
  })
})
