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
import { useEffect, type ReactNode } from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import { AllProviders, createTestQueryClient } from '../../test-utils'
import { InstancePanel } from './InstancePanel'
import { useActiveInstance } from '../../store/active-instance'
import { getMockEventSources, type MockEventSource } from '../../lib/test-event-source'

function seedConnection() {
  localStorage.setItem(
    'mission-tester:connections:v1',
    JSON.stringify({
      connections: [{ id: 'conn-1', url: 'http://localhost:3000', createdAt: '2026-05-14T00:00:00Z' }],
      activeConnectionId: 'conn-1',
    })
  )
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = createTestQueryClient()
  seedConnection()
  return (
    <AllProviders queryClient={client}>
      <Seed>{children}</Seed>
    </AllProviders>
  )
}

function Seed({ children }: { children: ReactNode }) {
  const { trackInstance, selectInstance } = useActiveInstance()
  useEffect(() => {
    trackInstance({
      instance_id: 'inst-1',
      connection_id: 'conn-1',
      action_oid: 'act-1',
    })
    selectInstance('inst-1')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <>{children}</>
}

function mockCapabilities() {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        data: {
          environments: [
            {
              environment_oid: 'env-1',
              environment_name: 'Warehouse',
              environment_state: 'Effective',
              action_properties: [],
              actions: [
                {
                  action_oid: 'act-1',
                  action_name: 'PickItem',
                  action_state: 'Effective',
                  local_id: 'PickItem',
                  version: '1.0.0',
                  description: 'Pick an item.',
                  visibility: 'observable',
                  input_parameters: [],
                  output_parameters: [],
                  supported_commands: ['PAUSE', 'RESUME', 'HOLD', 'UNHOLD', 'ABORT', 'STOP', 'CLEAR'],
                },
              ],
            },
          ],
        },
        meta: { total_environments: 1, total_actions: 1 },
      }),
      { status: 200 }
    )
  )
}

function mockInstanceSeed(overrides: Partial<{
  state: { current: string; previous: string | null; entered_at: string }
  error: string | null
  outputs: { key: string; value: string }[]
}> = {}) {
  const data = {
    instance_id: 'inst-1',
    action_oid: 'act-1',
    environment_oid: 'env-1',
    workflow_instance_id: 'wf-1',
    step_instance_id: 'step-1',
    step_oid: 'stepoid-1',
    visibility: 'observable',
    state: overrides.state ?? { current: 'STARTING', previous: null, entered_at: '2026-05-14T00:00:00Z' },
    inputs: [],
    outputs: overrides.outputs ?? [],
    created_at: '2026-05-14T00:00:00Z',
    started_at: '2026-05-14T00:00:00Z',
    completed_at: null,
    error: overrides.error ?? null,
  }
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ data, meta: {} }), { status: 200 })
  )
}

describe('InstancePanel', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows a loading message before REST seed resolves', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
    render(<InstancePanel />, { wrapper: Wrapper })
    expect(screen.getByText(/loading instance/i)).toBeInTheDocument()
  })

  it('renders header, timeline, commands, outputs, no error block after seed', async () => {
    mockCapabilities()
    mockInstanceSeed()

    render(<InstancePanel />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText('inst-1')).toBeInTheDocument())
    expect(screen.getAllByText('STARTING').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: 'PAUSE' })).toBeInTheDocument()
    expect(screen.getByText(/no outputs yet/i)).toBeInTheDocument()
    // No terminal error block
    expect(screen.queryByText(/terminal error/i)).toBeNull()
  })

  it('updates the state pill when SSE state_change arrives', async () => {
    mockCapabilities()
    mockInstanceSeed()

    render(<InstancePanel />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getAllByText('STARTING').length).toBeGreaterThanOrEqual(1))
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

    await waitFor(() => expect(screen.getAllByText('EXECUTING').length).toBeGreaterThanOrEqual(1))
  })

  it('renders ErrorPanel when terminal_error is on seed', async () => {
    mockCapabilities()
    mockInstanceSeed({
      state: { current: 'ABORTED', previous: 'ABORTING', entered_at: '2026-05-14T00:01:00Z' },
      error: 'action raised NameError',
    })

    render(<InstancePanel />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText('inst-1')).toBeInTheDocument())
    expect(screen.getByText(/terminal error/i)).toBeInTheDocument()
    expect(screen.getByText('action raised NameError')).toBeInTheDocument()
  })

  it('renders error message on REST seed failure', async () => {
    mockCapabilities()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'gone' }), { status: 404, statusText: 'Not Found' })
    )

    render(<InstancePanel />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText(/failed to load instance/i)).toBeInTheDocument())
  })

  it('shows "Loading commands…" in Commands section while capabilities is fetching', async () => {
    // Capabilities never resolves; instance seed resolves immediately.
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url).includes('/capabilities')) {
        return new Promise(() => {}) // pending forever
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
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
            },
            meta: {},
          }),
          { status: 200 }
        )
      )
    })

    render(<InstancePanel />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText('inst-1')).toBeInTheDocument())
    // Commands section header is present + loading message visible
    expect(screen.getByRole('region', { name: /commands/i })).toBeInTheDocument()
    expect(screen.getByText(/loading commands/i)).toBeInTheDocument()
  })

  it('shows "Action capability not found" when the action_oid does not match any capability', async () => {
    // Capabilities returns a different action_oid than the one tracked.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            environments: [
              {
                environment_oid: 'env-1',
                environment_name: 'Warehouse',
                environment_state: 'Effective',
                action_properties: [],
                actions: [
                  {
                    action_oid: 'some-other-action',
                    action_name: 'OtherAction',
                    action_state: 'Effective',
                    local_id: 'OtherAction',
                    version: '1.0.0',
                    visibility: 'observable',
                    input_parameters: [],
                    output_parameters: [],
                    supported_commands: ['PAUSE'],
                  },
                ],
              },
            ],
          },
          meta: { total_environments: 1, total_actions: 1 },
        }),
        { status: 200 }
      )
    )
    mockInstanceSeed()

    render(<InstancePanel />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText('inst-1')).toBeInTheDocument())
    expect(screen.getByRole('region', { name: /commands/i })).toBeInTheDocument()
    expect(screen.getByText(/action capability not found/i)).toBeInTheDocument()
    // No CommandBar PAUSE button rendered
    expect(screen.queryByRole('button', { name: 'PAUSE' })).toBeNull()
  })
})
