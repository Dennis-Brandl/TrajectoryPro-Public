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

import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { getMockEventSources, type MockEventSource } from '../lib/test-event-source'
import { createTestQueryClient, renderWithProviders } from '../test-utils'

describe('Integration: add a connection and load capabilities', () => {
  beforeEach(() => {
    localStorage.clear()
    // Skip the welcome splash so renderWithProviders(<App />) shows the main shell.
    localStorage.setItem('mission-tester-splash-dismissed', 'true')
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('happy path: no connections → add → green dot, sidebar shows the connection, capabilities cached', async () => {
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
                    visibility: 'observable',
                    input_parameters: [],
                    output_parameters: [],
                    supported_commands: ['PAUSE', 'RESUME'],
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

    const user = userEvent.setup()
    renderWithProviders(<App />)

    // 1. Initial empty state.
    expect(screen.getByTestId('connection-trigger')).toHaveTextContent(/no connection/i)
    expect(screen.getByText(/no connections yet/i)).toBeInTheDocument()

    // 2. Open the dropdown, click "Add connection".
    await user.click(screen.getByTestId('connection-trigger'))
    await user.click(screen.getByRole('button', { name: /add connection/i }))

    // 3. Fill in URL + name, submit.
    await user.clear(screen.getByLabelText(/server url/i))
    await user.type(screen.getByLabelText(/server url/i), 'http://localhost:3000')
    await user.type(screen.getByLabelText(/name/i), 'Local dev')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // 4. Modal closes, capabilities fetch fires.
    // Use word-boundary regex to avoid false match: "disconnected" contains
    // "connected" as a substring, so /connected/i would pass even on error state.
    // \bconnected\b matches only the whole word "connected".
    await waitFor(() => {
      expect(screen.getByTestId('connection-status-dot').className).toMatch(/\bconnected\b/)
    })

    // 5. Sidebar + bar both reflect the new connection name.
    // "Local dev" appears in both the ConnectionBar trigger label and the
    // Sidebar ConnectionList row — assert at least one match.
    const matches = await screen.findAllByText(/local dev/i)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('shows red dot when /capabilities returns 500', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('boom', { status: 500, statusText: 'Internal Server Error' })
    )

    const user = userEvent.setup()
    renderWithProviders(<App />)

    await user.click(screen.getByTestId('connection-trigger'))
    await user.click(screen.getByRole('button', { name: /add connection/i }))
    await user.clear(screen.getByLabelText(/server url/i))
    await user.type(screen.getByLabelText(/server url/i), 'http://localhost:3000')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(screen.getByTestId('connection-status-dot').className).toMatch(/disconnected/i)
    })
  })

  it('full happy path: connect → browse → select action → invoke → instance shown', async () => {
    // 1. /capabilities returns one action.
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
                    action_oid: 'act-pick',
                    action_name: 'PickItem',
                    action_state: 'Effective',
                    local_id: 'PickItem',
                    version: '1.0.0',
                    description: 'Pick an item',
                    visibility: 'observable',
                    input_parameters: [{ name: 'sku' }],
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
    // 2. /invoke returns a new instance_id.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-42' }, meta: {} }), {
        status: 201,
      })
    )
    // 3. /instances/inst-42 returns the polled instance shape.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            instance_id: 'inst-42',
            action_oid: 'act-pick',
            environment_oid: 'env-1',
            workflow_instance_id: 'wf',
            step_instance_id: 'step',
            step_oid: 'step-oid',
            visibility: 'observable',
            state: { current: 'COMPLETED', previous: 'COMPLETING', entered_at: '2026-05-13T00:00:02Z' },
            inputs: [{ key: 'sku', value: 'SKU-1001' }],
            outputs: [{ key: 'status', value: '0' }],
            created_at: '2026-05-13T00:00:00Z',
            started_at: '2026-05-13T00:00:00Z',
            completed_at: '2026-05-13T00:00:02Z',
            error: null,
          },
          meta: {},
        }),
        { status: 200 }
      )
    )

    // Use staleTime: Infinity so background refetches don't race with the
    // ordered mocks (capabilities → invoke → instance).
    const queryClient = createTestQueryClient()
    queryClient.setDefaultOptions({ queries: { staleTime: Infinity, retry: false } })

    const user = userEvent.setup()
    renderWithProviders(<App />, { queryClient })

    // Add the connection.
    await user.click(screen.getByTestId('connection-trigger'))
    await user.click(screen.getByRole('button', { name: /add connection/i }))
    await user.clear(screen.getByLabelText(/server url/i))
    await user.type(screen.getByLabelText(/server url/i), 'http://localhost:3000')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Wait for capabilities to load → ActionTree shows PickItem.
    await waitFor(() => expect(screen.getByText('PickItem')).toBeInTheDocument())

    // Click the action — InvokePanel mounts in the main pane.
    await user.click(screen.getByTestId('action-row-act-pick'))
    await waitFor(() => expect(screen.getByText(/pick an item/i)).toBeInTheDocument())

    // Fill the required input, submit.
    await user.type(screen.getByLabelText(/^sku/i), 'SKU-1001')
    await user.click(screen.getByRole('button', { name: /invoke/i }))

    // InstancePanel renders with the polled state.
    await waitFor(() => expect(screen.getByText('inst-42')).toBeInTheDocument())
    expect(screen.getAllByText('COMPLETED').length).toBeGreaterThanOrEqual(1)

    // Sidebar Instances section now lists the new instance.
    expect(screen.getByTestId('instance-row-inst-42')).toBeInTheDocument()
  })
})

describe('integration — invoke → SSE state stream → command', () => {
  beforeEach(() => {
    localStorage.clear()
    // Skip the welcome splash so renderWithProviders(<App />) shows the main shell.
    localStorage.setItem('mission-tester-splash-dismissed', 'true')
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('streams state_change events and accepts a PAUSE command click', async () => {
    // 1) Capabilities response
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

    // 2) Invoke response
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { instance_id: 'inst-1' }, meta: {} }),
        { status: 201 }
      )
    )

    // 3) Instance REST seed
    vi.mocked(fetch).mockResolvedValueOnce(
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

    // 4) Command POST response
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'PAUSE', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )

    // Use staleTime: Infinity so background refetches don't race with the
    // ordered mocks (capabilities → invoke → instance → command).
    const queryClient = createTestQueryClient()
    queryClient.setDefaultOptions({ queries: { staleTime: Infinity, retry: false } })

    // Mount the app
    const user = userEvent.setup()
    renderWithProviders(<App />, { queryClient })

    // Add a connection
    await user.click(screen.getByTestId('connection-trigger'))
    await user.click(screen.getByRole('button', { name: /add connection/i }))
    await user.clear(screen.getByLabelText(/server url/i))
    await user.type(screen.getByLabelText(/server url/i), 'http://localhost:3000')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Click action row to open InvokePanel
    await screen.findByText('PickItem')
    await user.click(screen.getByTestId('action-row-act-1'))

    // Submit Invoke
    await user.click(await screen.findByRole('button', { name: /^invoke$/i }))

    // InstancePanel should show STARTING
    await waitFor(() => expect(screen.getAllByText('STARTING').length).toBeGreaterThanOrEqual(1))

    // SSE state_change → EXECUTING
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

    // Click PAUSE
    await user.click(screen.getByRole('button', { name: 'PAUSE' }))

    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringMatching(/\/trajectory\/v1\/instances\/inst-1\/command$/),
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ command: 'PAUSE' }) })
      )
    )
  })
})
