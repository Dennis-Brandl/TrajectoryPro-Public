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

vi.mock('../specificationStore/apiClient', () => ({
  api: { getMe: vi.fn(), listLibraries: vi.fn() },
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
import { runBoot } from '../specificationStore/bootSequence'
import { usePrincipalStore } from '../principalStore'

const mockApi = api as unknown as { getMe: ReturnType<typeof vi.fn>; listLibraries: ReturnType<typeof vi.fn> }

beforeEach(() => {
  useSpecificationStore.getState()._reset()
  usePrincipalStore.getState().clearPrincipal()
  mockApi.getMe.mockReset()
  mockApi.listLibraries.mockReset()
})

describe('runBoot', () => {
  it('advances through me-loading → libraries-loading → ready on success', async () => {
    mockApi.getMe.mockResolvedValue({
      userId: 'u',
      isAdministrator: false,
      memberships: [],
      rightsByTeam: {},
      teams: [],
    })
    mockApi.listLibraries.mockResolvedValue({ libraries: [] })
    const result = await runBoot()
    expect(result.ok).toBe(true)
    expect(useSpecificationStore.getState().bootPhase).toBe('ready')
    expect(usePrincipalStore.getState().principal?.userId).toBeDefined()
  })

  it('stays in me-loading on 401', async () => {
    mockApi.getMe.mockRejectedValue(new ApiError(401, 'not_found', {}))
    const result = await runBoot()
    expect(result.ok).toBe(false)
    expect(result.error).toBe('me')
    expect(useSpecificationStore.getState().bootPhase).toBe('me-loading')
  })

  it('stays in libraries-loading on loadLibraries error', async () => {
    mockApi.getMe.mockResolvedValue({
      userId: 'u',
      isAdministrator: false,
      memberships: [],
      rightsByTeam: {},
      teams: [],
    })
    mockApi.listLibraries.mockRejectedValue(new ApiError(500, 'internal', {}))
    const result = await runBoot()
    expect(result.ok).toBe(false)
    expect(result.error).toBe('libraries')
    expect(useSpecificationStore.getState().bootPhase).toBe('libraries-loading')
  })

  it('401 from /me is unauthorized', async () => {
    mockApi.getMe.mockRejectedValue(new ApiError(401, 'unauthorized', {}))
    const result = await runBoot()
    expect(result).toEqual({ ok: false, error: 'me', unauthorized: true })
  })

  it('500 from /me is not unauthorized and carries the status', async () => {
    mockApi.getMe.mockRejectedValue(new ApiError(500, 'internal', {}))
    const result = await runBoot()
    expect(result.ok).toBe(false)
    expect(result.error).toBe('me')
    expect(result.unauthorized).toBe(false)
    expect(result.detail).toBe('Server error 500')
  })

  it('network failure on /me is not unauthorized', async () => {
    mockApi.getMe.mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await runBoot()
    expect(result.unauthorized).toBe(false)
    expect(result.detail).toBe("Can't reach the server")
  })

  it('a second runBoot after /me starts resolving is ok and ready', async () => {
    mockApi.getMe.mockRejectedValueOnce(new ApiError(500, 'internal', {}))
    const first = await runBoot()
    expect(first.ok).toBe(false)
    mockApi.getMe.mockResolvedValue({
      userId: 'u',
      isAdministrator: false,
      memberships: [],
      rightsByTeam: {},
      teams: [],
    })
    mockApi.listLibraries.mockResolvedValue({ libraries: [] })
    const second = await runBoot()
    expect(second.ok).toBe(true)
    expect(useSpecificationStore.getState().bootPhase).toBe('ready')
  })
})
