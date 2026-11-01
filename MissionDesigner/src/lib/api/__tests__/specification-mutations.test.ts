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
import {
  changeSpecificationState,
  moveSpecificationToLibrary,
  moveSpecificationToTeam,
  moveErrorMessage,
} from '@/lib/api/specification-mutations'
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

describe('move calls and moveErrorMessage', () => {
  it('posts to move-to-library and move-to-team with the right bodies', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ libraryId: 'L' }), { status: 200 })))
    await moveSpecificationToLibrary('s1', 'L')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v2/specifications/s1/move-to-library')
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ targetLibraryId: 'L' })
    await moveSpecificationToTeam('s1', 'T', 'L')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v2/specifications/s1/move-to-team')
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      targetTeamId: 'T',
      targetLibraryId: 'L',
    })
  })

  it('formats server errors from the flat body', () => {
    expect(moveErrorMessage(new ApiError(409, 'move_name_conflict', { libraryName: 'Lib', name: 'Wf' }))).toBe(
      '"Lib" already has an element named "Wf"',
    )
    expect(moveErrorMessage(new ApiError(422, 'move_target_invalid', { reason: 'x' }))).toBe(
      "That library can't receive this element",
    )
    expect(moveErrorMessage(new ApiError(403, 'forbidden', { missing: ['a:b', 'c:d'] }))).toBe(
      'You need these rights: a:b, c:d',
    )
    expect(moveErrorMessage(new ApiError(403, 'forbidden', {}))).toBe('403 forbidden')
    expect(moveErrorMessage(new Error('boom'))).toBe('boom')
  })
})
