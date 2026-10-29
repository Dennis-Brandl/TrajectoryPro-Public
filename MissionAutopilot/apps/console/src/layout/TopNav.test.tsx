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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PanelProvider } from './PanelContext'
import TopNav, { actionTesterUrl } from './TopNav'

const serverInfoMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    rest_base_url: 'http://127.0.0.1:3002',
    protocol_path: '/trajectory/v1/',
    port: 3002,
    fleet_base_url: null,
  })
)

vi.mock('@/lib/api', () => ({
  api: {
    serverInfo: serverInfoMock,
  },
}))

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PanelProvider>{ui}</PanelProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('TopNav', () => {
  // jsdom has no Clipboard API of its own — every test that touches
  // navigator.clipboard defines it as an own property (via Object.assign or
  // Object.defineProperty). Remove it after each test so one test's
  // clipboard stub never leaks into the next.
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('has an Environments link to /environments', () => {
    renderWithProviders(<TopNav />)
    expect(screen.getByRole('link', { name: 'Environments' })).toHaveAttribute(
      'href',
      '/environments'
    )
  })

  it('actionTesterUrl builds from protocol and hostname', () => {
    expect(actionTesterUrl({ protocol: 'http:', hostname: 'plant-pc' })).toBe(
      'http://plant-pc:3004'
    )
  })

  it('Tester link follows the current host', () => {
    renderWithProviders(<TopNav />)
    const link = screen.getByRole('link', { name: 'Mission Autopilot Tester' })
    expect(link.getAttribute('href')).toBe(actionTesterUrl(window.location))
  })

  it('renders a Mission Autopilot Tester link that opens :3004 in a new tab', () => {
    renderWithProviders(<TopNav />)
    const link = screen.getByRole('link', { name: 'Mission Autopilot Tester' })
    expect(link).toHaveAttribute(
      'href',
      `${window.location.protocol}//${window.location.hostname}:3004`
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('shows the Mission Commander address chip with a copy button when fleet_base_url is set', async () => {
    serverInfoMock.mockResolvedValue({
      rest_base_url: 'http://127.0.0.1:3002',
      protocol_path: '/trajectory/v1/',
      port: 3002,
      fleet_base_url: 'http://mission-autopilot-server:3002',
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderWithProviders(<TopNav />)
    expect(await screen.findByText('http://mission-autopilot-server:3002')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Mission Commander address' }))
    expect(writeText).toHaveBeenCalledWith('http://mission-autopilot-server:3002')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('falls back to selecting the address when the clipboard API is unavailable', async () => {
    serverInfoMock.mockResolvedValue({
      rest_base_url: 'http://127.0.0.1:3002',
      protocol_path: '/trajectory/v1/',
      port: 3002,
      fleet_base_url: 'http://mission-autopilot-server:3002',
    })
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    renderWithProviders(<TopNav />)
    expect(await screen.findByText('http://mission-autopilot-server:3002')).toBeInTheDocument()
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Copy Mission Commander address' }))
    ).not.toThrow()
    expect(await screen.findByText('Select and copy')).toBeInTheDocument()
  })

  it('shows the fallback when writeText rejects', async () => {
    serverInfoMock.mockResolvedValue({
      rest_base_url: 'http://127.0.0.1:3002',
      protocol_path: '/trajectory/v1/',
      port: 3002,
      fleet_base_url: 'http://mission-autopilot-server:3002',
    })
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.assign(navigator, { clipboard: { writeText } })
    renderWithProviders(<TopNav />)
    expect(await screen.findByText('http://mission-autopilot-server:3002')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Mission Commander address' }))
    expect(writeText).toHaveBeenCalledWith('http://mission-autopilot-server:3002')
    expect(await screen.findByText('Select and copy')).toBeInTheDocument()
  })

  it('hides the Mission Commander address chip when fleet_base_url is null', async () => {
    serverInfoMock.mockResolvedValue({
      rest_base_url: 'http://127.0.0.1:3002',
      protocol_path: '/trajectory/v1/',
      port: 3002,
      fleet_base_url: null,
    })
    renderWithProviders(<TopNav />)
    expect(await screen.findByText('http://127.0.0.1:3002')).toBeInTheDocument()
    expect(screen.queryByText('Mission Commander address:')).not.toBeInTheDocument()
  })
})
