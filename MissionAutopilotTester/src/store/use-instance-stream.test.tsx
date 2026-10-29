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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { AllProviders, createTestQueryClient } from '../test-utils'
import { useActiveInstance } from './active-instance'
import { useInstanceStream } from './use-instance-stream'
import { getMockEventSources, type MockEventSource } from '../lib/test-event-source'
import type { Connection, Instance } from '../api/types'

const baseConnection: Connection = {
  id: 'conn-1',
  url: 'http://localhost:3000',
  createdAt: '2026-05-14T00:00:00Z',
}

const baseInstance: Instance = {
  instance_id: 'inst-1',
  action_oid: 'act-1',
  environment_oid: 'env-1',
  workflow_instance_id: 'wf-1',
  step_instance_id: 'step-1',
  step_oid: 'stepoid-1',
  visibility: 'observable',
  state: { current: 'STARTING', previous: null, entered_at: '2026-05-14T00:00:00Z' },
  inputs: [],
  outputs: [],
  created_at: '2026-05-14T00:00:00Z',
  started_at: '2026-05-14T00:00:00Z',
  completed_at: null,
  error: null,
}

function seedActiveConnection(connection: Connection = baseConnection) {
  // Match the localStorage seed pattern from use-invoke.test.tsx / use-send-command.test.tsx:
  // key 'mission-tester:connections:v1', shape { connections: [...], activeConnectionId: '...' }.
  localStorage.setItem(
    'mission-tester:connections:v1',
    JSON.stringify({ connections: [connection], activeConnectionId: connection.id })
  )
}

function makeWrapper(connection: Connection = baseConnection) {
  const queryClient = createTestQueryClient()
  seedActiveConnection(connection)
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AllProviders queryClient={queryClient}>
        <TrackInstance>{children}</TrackInstance>
      </AllProviders>
    )
  }
}

function TrackInstance({ children }: { children: ReactNode }) {
  const { trackInstance } = useActiveInstance()
  useEffect(() => {
    trackInstance({
      instance_id: 'inst-1',
      connection_id: 'conn-1',
      action_oid: 'act-1',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <>{children}</>
}

function mockFetchInstance() {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ data: baseInstance, meta: {} }), { status: 200 })
  )
}

describe('useInstanceStream — lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns isLoading=true while REST seed is pending', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toBeUndefined()
  })

  it('opens an EventSource against /events for the active connection', async () => {
    mockFetchInstance()
    const { result } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.data?.current_state).toBe('STARTING'))

    const sources = getMockEventSources()
    expect(sources).toHaveLength(1)
    expect(sources[0]!.url).toBe('http://localhost:3000/trajectory/v1/instances/inst-1/events')
  })

  it('returns isLoading=false and data populated in the same render when REST resolves', async () => {
    // Pins the no-flicker invariant: once query.isSuccess, consumers must
    // never observe a render where isLoading=true while data could already
    // be derived from query.data. Guards against the one-render gap
    // identified as Plan 4-04 review follow-up #1.
    mockFetchInstance()
    const { result } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.isLoading).toBe(false)
    expect(result.current.data?.current_state).toBe('STARTING')
  })

  it('appends ?token=<apiKey> to the SSE URL when set', async () => {
    mockFetchInstance()
    const wrapper = makeWrapper({ ...baseConnection, apiKey: 'secret-key' })
    renderHook(() => useInstanceStream('inst-1'), { wrapper })

    await waitFor(() => expect(getMockEventSources()).toHaveLength(1))
    expect(getMockEventSources()[0]!.url).toBe(
      'http://localhost:3000/trajectory/v1/instances/inst-1/events?token=secret-key'
    )
  })

  it('flips isConnected to true when EventSource opens', async () => {
    mockFetchInstance()
    const { result } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(getMockEventSources()).toHaveLength(1))
    expect(result.current.isConnected).toBe(false)

    const es = getMockEventSources()[0]! as MockEventSource
    act(() => es.__open())
    await waitFor(() => expect(result.current.isConnected).toBe(true))
  })

  it('reduces a state_change event into history', async () => {
    mockFetchInstance()
    const { result } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.data?.current_state).toBe('STARTING'))
    const es = getMockEventSources()[0]! as MockEventSource
    act(() => es.__open())
    act(() =>
      es.__emit(
        'state_change',
        {
          instance_id: 'inst-1',
          state: 'EXECUTING',
          previous_state: 'STARTING',
          timestamp: '2026-05-14T00:00:30Z',
        },
        0
      )
    )

    await waitFor(() => expect(result.current.data?.current_state).toBe('EXECUTING'))
    expect(result.current.data?.state_history).toHaveLength(2)
  })

  it('closes the EventSource on unmount', async () => {
    mockFetchInstance()
    const { unmount } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(getMockEventSources()).toHaveLength(1))
    const es = getMockEventSources()[0]!
    expect(es.readyState).toBe(0)

    unmount()
    expect(es.readyState).toBe(2)
  })

  it('returns idle (data undefined, isLoading false) when instanceId is null', () => {
    const { result } = renderHook(() => useInstanceStream(null), { wrapper: makeWrapper() })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.data).toBeUndefined()
  })

  it('surfaces REST fetch failure as isError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'gone' }), { status: 404, statusText: 'Not Found' })
    )
    const { result } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeDefined()
  })

  it('flips isConnected to false on EventSource error', async () => {
    mockFetchInstance()
    const { result } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(getMockEventSources()).toHaveLength(1))
    const es = getMockEventSources()[0]! as MockEventSource
    act(() => es.__open())
    await waitFor(() => expect(result.current.isConnected).toBe(true))
    act(() => es.__error())
    await waitFor(() => expect(result.current.isConnected).toBe(false))
  })
})
