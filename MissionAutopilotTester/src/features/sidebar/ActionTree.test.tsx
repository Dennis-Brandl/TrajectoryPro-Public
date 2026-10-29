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

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test-utils'
import { ActionTree } from './ActionTree'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

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
            visibility: 'observable',
            input_parameters: [],
            output_parameters: [],
            supported_commands: ['PAUSE'],
          },
          {
            action_oid: 'act-scan',
            action_name: 'ScanBarcode',
            action_state: 'Effective',
            local_id: 'ScanBarcode',
            version: '1.0.0',
            visibility: 'opaque',
            input_parameters: [],
            output_parameters: [],
            supported_commands: ['ABORT'],
          },
        ],
      },
    ],
  },
  meta: { total_environments: 1, total_actions: 2 },
}

describe('ActionTree', () => {
  it('shows an idle prompt when no connection is active', () => {
    renderWithProviders(<ActionTree />)
    expect(screen.getByText(/no active connection/i)).toBeInTheDocument()
  })

  it('shows a loading state while fetching', async () => {
    seedConnection()
    vi.mocked(fetch).mockReturnValueOnce(new Promise(() => {}))
    renderWithProviders(<ActionTree />)
    expect(await screen.findByText(/loading/i)).toBeInTheDocument()
  })

  it('shows an empty state when the active connection reports zero actions', async () => {
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { environments: [] },
          meta: { total_environments: 0, total_actions: 0 },
        }),
        { status: 200 }
      )
    )
    renderWithProviders(<ActionTree />)
    await waitFor(() => expect(screen.getByText(/no actions/i)).toBeInTheDocument())
  })

  it('shows an error state when capabilities fetch fails', async () => {
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }))
    renderWithProviders(<ActionTree />)
    await waitFor(() => expect(screen.getByText(/failed to load actions/i)).toBeInTheDocument())
  })

  it('groups by visibility with Observable first then Opaque', async () => {
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(sampleCapabilities), { status: 200 })
    )
    renderWithProviders(<ActionTree />)
    await waitFor(() => expect(screen.getByText('PickItem')).toBeInTheDocument())

    const observableHeading = screen.getByRole('heading', { name: /observable/i })
    const opaqueHeading = screen.getByRole('heading', { name: /opaque/i })
    expect(observableHeading.compareDocumentPosition(opaqueHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  it('click on a row selects the action and highlights it', async () => {
    const user = userEvent.setup()
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(sampleCapabilities), { status: 200 })
    )
    renderWithProviders(<ActionTree />)
    await waitFor(() => expect(screen.getByText('PickItem')).toBeInTheDocument())
    const row = screen.getByTestId('action-row-act-pick')
    await user.click(row)
    expect(row.className).toMatch(/active/i)
  })
})
