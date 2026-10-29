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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AllProviders, createTestQueryClient } from '../../test-utils'
import { CommandBar } from './CommandBar'
import { OBSERVABLE_COMMANDS, OPAQUE_COMMANDS } from '../../lib/state-machine'
import type { ReactNode } from 'react'

function seedActiveConnection() {
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
  seedActiveConnection()
  return <AllProviders queryClient={client}>{children}</AllProviders>
}

describe('CommandBar', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders one button per supported command (observable)', () => {
    render(
      <CommandBar
        instanceId="inst-1"
        visibility="observable"
        currentState="EXECUTING"
        supportedCommands={OBSERVABLE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )
    for (const cmd of OBSERVABLE_COMMANDS) {
      expect(screen.getByRole('button', { name: cmd })).toBeInTheDocument()
    }
  })

  it('only shows ABORT button for opaque', () => {
    render(
      <CommandBar
        instanceId="inst-1"
        visibility="opaque"
        currentState="IN_PROGRESS"
        supportedCommands={OPAQUE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )
    expect(screen.getByRole('button', { name: 'ABORT' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'PAUSE' })).toBeNull()
  })

  it('enables PAUSE/HOLD/ABORT/STOP when in EXECUTING, disables RESUME/UNHOLD/CLEAR', () => {
    render(
      <CommandBar
        instanceId="inst-1"
        visibility="observable"
        currentState="EXECUTING"
        supportedCommands={OBSERVABLE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )
    expect(screen.getByRole('button', { name: 'PAUSE' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'HOLD' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'ABORT' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'STOP' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'RESUME' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'UNHOLD' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'CLEAR' })).toBeDisabled()
  })

  it('enables CLEAR only from ABORTED', () => {
    render(
      <CommandBar
        instanceId="inst-1"
        visibility="observable"
        currentState="ABORTED"
        supportedCommands={OBSERVABLE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )
    expect(screen.getByRole('button', { name: 'CLEAR' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'PAUSE' })).toBeDisabled()
  })

  it('disables every button in COMPLETED', () => {
    render(
      <CommandBar
        instanceId="inst-1"
        visibility="observable"
        currentState="COMPLETED"
        supportedCommands={OBSERVABLE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )
    for (const cmd of OBSERVABLE_COMMANDS) {
      expect(screen.getByRole('button', { name: cmd })).toBeDisabled()
    }
  })

  it('POSTs the command on click', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'PAUSE', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )

    render(
      <CommandBar
        instanceId="inst-1"
        visibility="observable"
        currentState="EXECUTING"
        supportedCommands={OBSERVABLE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )

    fireEvent.click(screen.getByRole('button', { name: 'PAUSE' }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/trajectory/v1/instances/inst-1/command',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ command: 'PAUSE' }) })
      )
    )
  })

  it('disables all buttons while a command is in flight', async () => {
    let resolve: (value: Response) => void = () => {}
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolve = r
      })
    )

    render(
      <CommandBar
        instanceId="inst-1"
        visibility="observable"
        currentState="EXECUTING"
        supportedCommands={OBSERVABLE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )

    fireEvent.click(screen.getByRole('button', { name: 'PAUSE' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'PAUSE' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'HOLD' })).toBeDisabled()
    })

    resolve(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'PAUSE', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )
  })

  it('renders an error pill when the command fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'INVALID_COMMAND' } }), {
        status: 422,
        statusText: 'Unprocessable Entity',
      })
    )

    render(
      <CommandBar
        instanceId="inst-1"
        visibility="observable"
        currentState="EXECUTING"
        supportedCommands={OBSERVABLE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )

    fireEvent.click(screen.getByRole('button', { name: 'PAUSE' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert').textContent).toMatch(/422|invalid|failed/i)
  })
})
