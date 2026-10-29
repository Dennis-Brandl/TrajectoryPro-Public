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
import { renderHook, act, waitFor } from '@testing-library/react'
import { AllProviders, createTestQueryClient } from '../test-utils'
import { ApiError } from '../api/types'
import { useSendCommand } from './use-send-command'
import type { Connection } from '../api/types'

const connection: Connection = {
  id: 'conn-1',
  url: 'http://localhost:3000',
  createdAt: '2026-05-14T00:00:00Z',
}

// Seed localStorage so useActiveConnection() returns `connection`.
// Matches the format written by ConnectionsProvider / use-local-storage-persist.
function seedActiveConnection() {
  localStorage.setItem(
    'mission-tester:connections:v1',
    JSON.stringify({
      connections: [connection],
      activeConnectionId: connection.id,
    })
  )
}

function setupWithActiveConnection() {
  seedActiveConnection()
  const client = createTestQueryClient()
  return ({ children }: { children: React.ReactNode }) => (
    <AllProviders queryClient={client}>{children}</AllProviders>
  )
}

describe('useSendCommand', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts in idle state', () => {
    const { result } = renderHook(() => useSendCommand(), { wrapper: setupWithActiveConnection() })
    expect(result.current.status).toBe('idle')
    expect(result.current.isPending).toBe(false)
  })

  it('on mutate, calls sendCommand against the active connection', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'PAUSE', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )

    const { result } = renderHook(() => useSendCommand(), { wrapper: setupWithActiveConnection() })

    act(() => {
      result.current.mutate({ instanceId: 'inst-1', command: 'PAUSE' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ instance_id: 'inst-1', command: 'PAUSE', accepted: true })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/instances/inst-1/command',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('surfaces ApiError on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'INVALID_COMMAND' } }), {
        status: 422,
        statusText: 'Unprocessable Entity',
      })
    )

    const { result } = renderHook(() => useSendCommand(), { wrapper: setupWithActiveConnection() })

    act(() => {
      result.current.mutate({ instanceId: 'inst-1', command: 'PAUSE' })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
  })

  it('rejects when no active connection', async () => {
    const client = createTestQueryClient()
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AllProviders queryClient={client}>{children}</AllProviders>
    )
    const { result } = renderHook(() => useSendCommand(), { wrapper })

    act(() => {
      result.current.mutate({ instanceId: 'inst-1', command: 'PAUSE' })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toMatch(/no active connection/i)
  })
})
