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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PanelProvider } from './PanelContext'
import Layout from './Layout'
import { UNAUTHORIZED_EVENT } from '@/lib/apiKey'

vi.mock('@/lib/api', () => ({
  api: {
    serverInfo: vi.fn().mockResolvedValue({
      rest_base_url: 'http://127.0.0.1:3002',
      protocol_path: '/trajectory/v1/',
      port: 3002,
      fleet_base_url: null,
    }),
    dashboard: vi.fn().mockResolvedValue({ environments: { total_count: 1, total_actions: 2 } }),
  },
}))
vi.mock('@/features/explorer/ExplorerPanel', () => ({ default: () => <div>EXPLORER-PANE</div> }))
vi.mock('@/features/instances-panel/InstancesPanel', () => ({
  default: () => <div>INSTANCES-PANE</div>,
}))
vi.mock('@/features/explorer/hooks', () => ({ useExplorerData: () => ({ tree: [] }) }))

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <PanelProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="*" element={<Where />} />
            </Route>
          </Routes>
        </PanelProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const where = () => screen.getByTestId('where').textContent
const rail = (name: string) => screen.getByRole('button', { name })

describe('Layout frame', () => {
  beforeEach(() => localStorage.clear())

  it('marks the rail item for the current path', () => {
    renderAt('/log')
    expect(rail('Log')).toHaveAttribute('aria-current', 'page')
    expect(rail('Dashboard')).not.toHaveAttribute('aria-current')
  })

  it('settings has no active rail item and the gear is pressed', () => {
    renderAt('/settings')
    for (const n of ['Dashboard', 'Environments', 'Instances', 'Log', 'Search']) {
      expect(rail(n)).not.toHaveAttribute('aria-current')
    }
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('the gear goes to settings', () => {
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(where()).toBe('/settings')
  })

  it('a stored explorer panel shows no pane on the dashboard', () => {
    localStorage.setItem('mission-active-panel', 'explorer')
    renderAt('/')
    expect(screen.queryByText('EXPLORER-PANE')).not.toBeInTheDocument()
    expect(screen.queryByTestId('side-pane')).not.toBeInTheDocument()
  })

  it('Dashboard click goes to / with no panel', () => {
    localStorage.setItem('mission-active-panel', 'explorer')
    renderAt('/environments')
    expect(screen.getByText('EXPLORER-PANE')).toBeInTheDocument()
    fireEvent.click(rail('Dashboard'))
    expect(where()).toBe('/')
    expect(localStorage.getItem('mission-active-panel')).toBeNull()
    fireEvent.click(rail('Dashboard'))
    expect(where()).toBe('/')
  })

  it('Environments: navigates and opens explorer; click again toggles it', () => {
    renderAt('/log')
    fireEvent.click(rail('Environments'))
    expect(where()).toBe('/environments')
    expect(screen.getByText('EXPLORER-PANE')).toBeInTheDocument()
    fireEvent.click(rail('Environments'))
    expect(screen.queryByText('EXPLORER-PANE')).not.toBeInTheDocument()
    fireEvent.click(rail('Environments'))
    expect(screen.getByText('EXPLORER-PANE')).toBeInTheDocument()
  })

  it('actions paths count as Environments', () => {
    renderAt('/actions/abc')
    expect(rail('Environments')).toHaveAttribute('aria-current', 'page')
  })

  it('Instances: navigates and opens its pane; click again toggles it', () => {
    renderAt('/')
    fireEvent.click(rail('Instances'))
    expect(where()).toBe('/instances')
    expect(screen.getByText('INSTANCES-PANE')).toBeInTheDocument()
    fireEvent.click(rail('Instances'))
    expect(screen.queryByText('INSTANCES-PANE')).not.toBeInTheDocument()
  })

  it('Log goes to /log with no pane', () => {
    renderAt('/environments')
    fireEvent.click(rail('Log'))
    expect(where()).toBe('/log')
    expect(screen.queryByTestId('side-pane')).not.toBeInTheDocument()
    fireEvent.click(rail('Log'))
    expect(where()).toBe('/log')
  })

  it('Search opens on any path and toggles off, keeping the path', () => {
    renderAt('/settings')
    fireEvent.click(rail('Search'))
    expect(where()).toBe('/settings')
    expect(screen.getByPlaceholderText(/Filter environments/)).toBeInTheDocument()
    expect(rail('Search')).toHaveAttribute('aria-current', 'page')
    fireEvent.click(rail('Search'))
    expect(screen.queryByPlaceholderText(/Filter environments/)).not.toBeInTheDocument()
  })

  it('the header icon opens About, and every version shown is the build number', () => {
    renderAt('/')
    expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'About Mission Autopilot' }))
    expect(screen.getByText(`Version ${__APP_VERSION__}`)).toBeInTheDocument()
    expect(screen.getByText(`Mission Autopilot build ${__APP_VERSION__}`)).toBeInTheDocument()
    expect(screen.getByText('Runs the Python code behind environment actions')).toBeInTheDocument()
  })

  it('Sign out clears the key and signals sign-out', () => {
    sessionStorage.setItem('mission-autopilot.api-key', 'k')
    const seen: CustomEvent[] = []
    const h = (e: Event) => seen.push(e as CustomEvent)
    window.addEventListener(UNAUTHORIZED_EVENT, h)
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    window.removeEventListener(UNAUTHORIZED_EVENT, h)
    expect(sessionStorage.getItem('mission-autopilot.api-key')).toBeNull()
    expect(seen).toHaveLength(1)
    expect(seen[0].detail).toEqual({ signOut: true })
  })

  it('shows no version text in the status bar', () => {
    renderAt('/')
    expect(screen.queryByText(/Mission Autopilot v/)).not.toBeInTheDocument()
  })

  it('links to the Tester from the header', () => {
    renderAt('/')
    const link = screen.getByRole('link', { name: /Mission Autopilot Tester/ })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('title', 'Open the Mission Autopilot Tester in a new tab')
  })
})
