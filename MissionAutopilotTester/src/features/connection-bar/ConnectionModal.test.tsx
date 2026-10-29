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

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../../test-utils'
import { ConnectionModal, DEFAULT_MISSION_ACTIONS_URL } from './ConnectionModal'

describe('ConnectionModal — add mode', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('labels the key box for the Mission Broker token', () => {
    renderWithProviders(<ConnectionModal open onClose={() => {}} />)
    expect(screen.getByLabelText('API key or token (optional)')).toBeInTheDocument()
    expect(screen.getByText(/enter ACTIONS_API_KEY; for the Mission Broker, MISSION_BROKER_TOKEN/)).toBeInTheDocument()
  })

  it('renders three fields in add mode', () => {
    renderWithProviders(<ConnectionModal open onClose={() => {}} />)
    expect(screen.getByLabelText(/server url/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument()
  })

  it('shows the Autopilot server as the URL placeholder', () => {
    renderWithProviders(<ConnectionModal open onClose={() => {}} />)
    expect(screen.getByLabelText(/server url/i)).toHaveAttribute('placeholder', 'http://localhost:3002')
  })

  it('prefills the URL field with the Mission Actions default when nothing is stored', () => {
    renderWithProviders(<ConnectionModal open onClose={() => {}} />)
    expect(screen.getByLabelText(/server url/i)).toHaveValue(DEFAULT_MISSION_ACTIONS_URL)
  })

  it('disables Save when the URL field is cleared', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ConnectionModal open onClose={() => {}} />)
    const save = screen.getByRole('button', { name: /save/i })
    const urlInput = screen.getByLabelText(/server url/i)
    // Pre-filled with the Mission Actions default, so Save starts enabled.
    expect(save).not.toBeDisabled()
    await user.clear(urlInput)
    expect(save).toBeDisabled()
    await user.type(urlInput, 'http://localhost:3000')
    expect(save).not.toBeDisabled()
  })

  it('shows a validation error for an unparseable URL', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ConnectionModal open onClose={() => {}} />)
    const urlInput = screen.getByLabelText(/server url/i)
    await user.clear(urlInput)
    await user.type(urlInput, 'not-a-url')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(screen.getByText(/must be a valid http\(s\) url/i)).toBeInTheDocument()
  })

  it('rejects ftp:// URLs', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ConnectionModal open onClose={() => {}} />)
    const urlInput = screen.getByLabelText(/server url/i)
    await user.clear(urlInput)
    await user.type(urlInput, 'ftp://example.com')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(screen.getByText(/must be a valid http\(s\) url/i)).toBeInTheDocument()
  })

  it('calls onClose after a successful add', async () => {
    const user = userEvent.setup()
    let closed = false
    renderWithProviders(<ConnectionModal open onClose={() => { closed = true }} />)
    const urlInput = screen.getByLabelText(/server url/i)
    await user.clear(urlInput)
    await user.type(urlInput, 'http://localhost:3000')
    await user.type(screen.getByLabelText(/name/i), 'Local dev')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(closed).toBe(true)
  })

  it('Cancel calls onClose without saving', async () => {
    const user = userEvent.setup()
    let closed = false
    renderWithProviders(<ConnectionModal open onClose={() => { closed = true }} />)
    const urlInput = screen.getByLabelText(/server url/i)
    await user.clear(urlInput)
    await user.type(urlInput, 'http://localhost:3000')
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(closed).toBe(true)
    expect(localStorage.getItem('mission-tester:connections:v1')).toMatch(/"connections":\[\]/)
  })

  it('trims whitespace from the URL before persisting', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ConnectionModal open onClose={() => {}} />)
    const urlInput = screen.getByLabelText(/server url/i)
    await user.clear(urlInput)
    await user.type(urlInput, '  http://localhost:3000  ')
    await user.click(screen.getByRole('button', { name: /save/i }))
    const stored = JSON.parse(localStorage.getItem('mission-tester:connections:v1') ?? 'null')
    expect(stored.connections[0].url).toBe('http://localhost:3000')
  })
})

describe('ConnectionModal — edit mode', () => {
  beforeEach(() => {
    localStorage.setItem(
      'mission-tester:connections:v1',
      JSON.stringify({
        connections: [
          {
            id: 'conn-1',
            url: 'http://localhost:3000',
            name: 'Local dev',
            apiKey: 'sekret',
            createdAt: '2026-05-13T00:00:00Z',
          },
        ],
        activeConnectionId: 'conn-1',
      })
    )
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('prefills the form with the existing connection', () => {
    renderWithProviders(<ConnectionModal open onClose={() => {}} editingId="conn-1" />)
    expect(screen.getByLabelText(/server url/i)).toHaveValue('http://localhost:3000')
    expect(screen.getByLabelText(/name/i)).toHaveValue('Local dev')
    expect(screen.getByLabelText(/api key/i)).toHaveValue('sekret')
  })

  it('shows the stored URL, not the Mission Actions default, when a connection exists', () => {
    renderWithProviders(<ConnectionModal open onClose={() => {}} editingId="conn-1" />)
    const value = screen.getByLabelText(/server url/i)
    expect(value).toHaveValue('http://localhost:3000')
    expect(value).not.toHaveValue(DEFAULT_MISSION_ACTIONS_URL)
  })

  it('updates the connection on save', async () => {
    const user = userEvent.setup()
    let closed = false
    renderWithProviders(
      <ConnectionModal open onClose={() => { closed = true }} editingId="conn-1" />
    )
    const nameInput = screen.getByLabelText(/name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Production')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(closed).toBe(true)
    const stored = JSON.parse(localStorage.getItem('mission-tester:connections:v1') ?? 'null')
    expect(stored.connections[0].name).toBe('Production')
  })
})
