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

import { screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { renderWithProviders } from '../../test-utils'
import { useActiveInstance } from '../../store/active-instance'
import { InvokePanel } from './InvokePanel'

const sampleCapabilities = {
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
            description: 'Pick an item from a shelf',
            visibility: 'observable',
            input_parameters: [
              { name: 'item_sku' },
              { name: 'quantity', default_value: '1' },
            ],
            output_parameters: [{ name: 'status' }],
            supported_commands: ['PAUSE'],
          },
        ],
      },
    ],
  },
  meta: { total_environments: 1, total_actions: 1 },
}

function seedConnectionAndSelection() {
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

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// A tiny harness that pre-selects the action via the context, then mounts the panel.
function TestHarness() {
  const { selectAction } = useActiveInstance()
  useEffect(() => {
    selectAction('act-pick')
  }, [selectAction])
  return <InvokePanel />
}

async function renderWithActionSelected() {
  seedConnectionAndSelection()
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(sampleCapabilities), { status: 200 })
  )
  const utils = renderWithProviders(<TestHarness />)
  // Wait for capabilities to load AND the harness's useEffect to fire.
  await waitFor(() => expect(screen.getByText('PickItem')).toBeInTheDocument())
  return utils
}

describe('InvokePanel', () => {
  it('shows nothing useful when no action is selected', () => {
    renderWithProviders(<InvokePanel />)
    expect(screen.queryByRole('button', { name: /invoke/i })).not.toBeInTheDocument()
  })

  it('renders the action name + description once selected and capabilities load', async () => {
    await renderWithActionSelected()
    expect(screen.getByText('Pick an item from a shelf')).toBeInTheDocument()
  })

  it('renders one input field per input_parameter, default-filled', async () => {
    await renderWithActionSelected()
    const skuInput = screen.getByLabelText(/item_sku/i)
    const qtyInput = screen.getByLabelText(/quantity/i)
    expect(skuInput).toHaveValue('')
    expect(qtyInput).toHaveValue('1')
  })

  it('submits invoke with {action_oid, environment_oid, input_parameters}', async () => {
    const user = userEvent.setup()
    await renderWithActionSelected()
    // Queue the invoke response AFTER the capabilities mock has been consumed.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-1' }, meta: {} }), { status: 201 })
    )
    await user.type(screen.getByLabelText(/item_sku/i), 'SKU-1001')
    await user.click(screen.getByRole('button', { name: /invoke/i }))
    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls
      const invokeCall = calls.find(([url]) => String(url).includes('/invoke'))
      expect(invokeCall).toBeDefined()
      const body = JSON.parse(invokeCall![1]!.body as string)
      expect(body.environment_oid).toBe('env-1')
      expect(body.input_parameters).toEqual([
        { name: 'item_sku', value: 'SKU-1001' },
        { name: 'quantity', value: '1' },
      ])
    })
  })

  it('shows the error message inline on invoke failure', async () => {
    const user = userEvent.setup()
    await renderWithActionSelected()
    // Queue the failure AFTER the capabilities mock has been consumed.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('bad', { status: 400, statusText: 'Bad Request' })
    )
    await user.type(screen.getByLabelText(/item_sku/i), 'SKU-1001')
    await user.click(screen.getByRole('button', { name: /invoke/i }))
    await waitFor(() => expect(screen.getByText(/invoke failed/i)).toBeInTheDocument())
  })

  // ----------------------------------------------------------
  // Simulate-failures checkbox — server-side action_property_overrides field
  // ----------------------------------------------------------

  it('omits action_property_overrides when Simulate failures is unchecked', async () => {
    const user = userEvent.setup()
    await renderWithActionSelected()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-no-sim' }, meta: {} }), {
        status: 201,
      })
    )
    // Checkbox should be present and unchecked by default.
    const checkbox = screen.getByLabelText(/simulate failures/i)
    expect(checkbox).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: /invoke/i }))
    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls
      const invokeCall = calls.find(([url]) => String(url).includes('/invoke'))
      expect(invokeCall).toBeDefined()
      const body = JSON.parse(invokeCall![1]!.body as string)
      expect(body.action_property_overrides).toBeUndefined()
    })
  })

  it('injects SIMULATION_MODE override when Simulate failures is checked', async () => {
    const user = userEvent.setup()
    await renderWithActionSelected()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-sim-on' }, meta: {} }), {
        status: 201,
      })
    )
    await user.click(screen.getByLabelText(/simulate failures/i))
    expect(screen.getByLabelText(/simulate failures/i)).toBeChecked()

    await user.click(screen.getByRole('button', { name: /invoke/i }))
    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls
      const invokeCall = calls.find(([url]) => String(url).includes('/invoke'))
      expect(invokeCall).toBeDefined()
      const body = JSON.parse(invokeCall![1]!.body as string)
      expect(body.action_property_overrides).toEqual({
        SIMULATION_MODE: { Value: 'true' },
      })
    })
  })
})

describe('InvokePanel — capability refetch resilience', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('preserves in-flight user input when capabilities refetches the same OID', async () => {
    const user = userEvent.setup()

    // Seed connection so capabilities query is enabled
    seedConnectionAndSelection()

    // Use structuralSharing:false so every refetch produces a new data object reference,
    // accurately modelling a future useCapabilities that disables sharing or returns a
    // transformed value. This is the condition that exposes the [action] dep bug.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
          staleTime: 0,
          refetchOnWindowFocus: false,
          structuralSharing: false,
        },
        mutations: { retry: false },
      },
    })

    const capPayload = JSON.stringify({
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
                input_parameters: [{ name: 'shelf_location' }],
                output_parameters: [],
                supported_commands: [],
              },
            ],
          },
        ],
      },
      meta: { total_environments: 1, total_actions: 1 },
    })

    // Initial capabilities load
    vi.mocked(fetch).mockResolvedValueOnce(new Response(capPayload, { status: 200 }))

    // Use a harness that selects 'act-1'
    function RefetchHarness() {
      const { selectAction } = useActiveInstance()
      useEffect(() => {
        selectAction('act-1')
      }, [selectAction])
      return <InvokePanel />
    }

    renderWithProviders(<RefetchHarness />, { queryClient })

    // Wait for capabilities to load
    await waitFor(() => expect(screen.getByText('PickItem')).toBeInTheDocument())

    // Type a value into the shelf_location input
    const input = screen.getByLabelText(/shelf_location/)
    await user.type(input, 'BIN-A1')
    expect((input as HTMLInputElement).value).toBe('BIN-A1')

    // Second capabilities load — same OID, but structuralSharing:false means a new
    // data reference is produced, triggering the useMemo and exposing the [action] dep bug.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(capPayload, { status: 200 }))

    // Trigger refetch — invalidating with prefix key covers all connection-specific variants
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['capabilities'] })
    })

    // Wait for refetch to complete (fetch will have been called again)
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2))

    // After refetch: the in-flight value must still be preserved
    expect((screen.getByLabelText(/shelf_location/) as HTMLInputElement).value).toBe('BIN-A1')
  })
})
