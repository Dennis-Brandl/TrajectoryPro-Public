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
import { useActiveInstance } from './active-instance'
import { useInvoke } from './use-invoke'

function makeWrapper() {
  const queryClient = createTestQueryClient()
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AllProviders queryClient={queryClient}>{children}</AllProviders>
  )
  return { Wrapper, queryClient }
}

function seedConnection() {
  localStorage.setItem(
    'mission-tester:connections:v1',
    JSON.stringify({
      connections: [
        { id: 'c1', url: 'http://localhost:3000', createdAt: '2026-05-13T00:00:00Z' },
      ],
      activeConnectionId: 'c1',
    })
  )
}

describe('useInvoke', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is idle until invoked', () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useInvoke(), { wrapper: Wrapper })
    expect(result.current.isIdle).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('on success: POSTs invoke, tracks the new instance, and selects it', async () => {
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-99' }, meta: {} }), {
        status: 201,
      })
    )

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => {
        const active = useActiveInstance()
        const invoke = useInvoke()
        return { active, invoke }
      },
      { wrapper: Wrapper }
    )

    result.current.invoke.mutate({
      action_oid: 'act-1',
      environment_oid: 'env-1',
      input_parameters: [{ name: 'k', value: 'v' }],
    })

    await waitFor(() => expect(result.current.invoke.isSuccess).toBe(true))

    const tracked = result.current.active.state.trackedInstances
    expect(tracked).toHaveLength(1)
    expect(tracked[0].instance_id).toBe('inst-99')
    expect(tracked[0].action_oid).toBe('act-1')
    expect(result.current.active.state.selection).toEqual({
      type: 'instance',
      instance_id: 'inst-99',
    })

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/actions/act-1/invoke',
      expect.objectContaining({ method: 'POST' })
    )
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.environment_oid).toBe('env-1')
    expect(body.input_parameters).toEqual([{ name: 'k', value: 'v' }])
    expect(body.workflow_instance_id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(body.step_instance_id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(body.step_oid).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('on error: does NOT track and does NOT change selection', async () => {
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('bad params', { status: 400, statusText: 'Bad Request' })
    )

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => {
        const active = useActiveInstance()
        const invoke = useInvoke()
        return { active, invoke }
      },
      { wrapper: Wrapper }
    )

    result.current.invoke.mutate({
      action_oid: 'act-1',
      environment_oid: 'env-1',
      input_parameters: [],
    })

    await waitFor(() => expect(result.current.invoke.isError).toBe(true))
    expect(result.current.active.state.trackedInstances).toEqual([])
    expect(result.current.active.state.selection).toBeNull()
  })

  it('throws when invoked with no active connection', async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useInvoke(), { wrapper: Wrapper })
    result.current.mutate({
      action_oid: 'act-1',
      environment_oid: 'env-1',
      input_parameters: [],
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toMatch(/no active connection/i)
  })

  it('forwards action_property_overrides to the server when provided', async () => {
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-with-override' }, meta: {} }), {
        status: 201,
      })
    )
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useInvoke(), { wrapper: Wrapper })
    result.current.mutate({
      action_oid: 'act-1',
      environment_oid: 'env-1',
      input_parameters: [],
      action_property_overrides: { SIMULATION_MODE: { Value: 'true' } },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.action_property_overrides).toEqual({
      SIMULATION_MODE: { Value: 'true' },
    })
  })

  it('omits action_property_overrides field when the override map is empty', async () => {
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-empty' }, meta: {} }), {
        status: 201,
      })
    )
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useInvoke(), { wrapper: Wrapper })
    result.current.mutate({
      action_oid: 'act-1',
      environment_oid: 'env-1',
      input_parameters: [],
      action_property_overrides: {},
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.action_property_overrides).toBeUndefined()
  })
})
