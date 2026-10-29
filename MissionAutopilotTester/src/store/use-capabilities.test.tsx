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

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AllProviders, createTestQueryClient } from '../test-utils'
import { useConnections } from './connections'
import { useCapabilities } from './use-capabilities'

function makeWrapper() {
  const queryClient = createTestQueryClient()
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AllProviders queryClient={queryClient}>{children}</AllProviders>
  )
  return { Wrapper, queryClient }
}

describe('useCapabilities', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is idle when no connection is active', () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useCapabilities(), { wrapper: Wrapper })
    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fetches capabilities for the active connection and returns data on success', async () => {
    const responseBody = {
      data: { environments: [] },
      meta: { total_environments: 0, total_actions: 0 },
    }
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(responseBody), { status: 200 })
    )

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => {
        const connections = useConnections()
        const capabilities = useCapabilities()
        return { connections, capabilities }
      },
      { wrapper: Wrapper }
    )

    // Add connection -> becomes active -> query fires.
    result.current.connections.addConnection({ url: 'http://localhost:3000' })

    await waitFor(() => expect(result.current.capabilities.isSuccess).toBe(true))
    expect(result.current.capabilities.data).toEqual(responseBody)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/capabilities',
      expect.anything()
    )
  })

  it('surfaces network failures as isError', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => {
        const connections = useConnections()
        const capabilities = useCapabilities()
        return { connections, capabilities }
      },
      { wrapper: Wrapper }
    )

    result.current.connections.addConnection({ url: 'http://unreachable' })
    await waitFor(() => expect(result.current.capabilities.isError).toBe(true))
    expect(result.current.capabilities.error).toBeInstanceOf(TypeError)
  })

  it('surfaces 5xx as isError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('boom', { status: 500, statusText: 'Internal Server Error' })
    )

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => {
        const connections = useConnections()
        const capabilities = useCapabilities()
        return { connections, capabilities }
      },
      { wrapper: Wrapper }
    )

    result.current.connections.addConnection({ url: 'http://err' })
    await waitFor(() => expect(result.current.capabilities.isError).toBe(true))
  })

  it('refetches when the active connection URL is updated', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { environments: [] }, meta: { total_environments: 0, total_actions: 0 } }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { environments: [] }, meta: { total_environments: 1, total_actions: 2 } }),
          { status: 200 }
        )
      )

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => {
        const connections = useConnections()
        const capabilities = useCapabilities()
        return { connections, capabilities }
      },
      { wrapper: Wrapper }
    )

    const connection = result.current.connections.addConnection({ url: 'http://first' })
    await waitFor(() => expect(result.current.capabilities.isSuccess).toBe(true))
    expect(result.current.capabilities.data?.meta.total_environments).toBe(0)

    // Edit the URL — should trigger a refetch via the new queryKey.
    result.current.connections.updateConnection(connection.id, { url: 'http://second' })
    await waitFor(() =>
      expect(result.current.capabilities.data?.meta.total_environments).toBe(1)
    )
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenLastCalledWith(
      'http://second/trajectory/v1/capabilities',
      expect.anything()
    )
  })
})
