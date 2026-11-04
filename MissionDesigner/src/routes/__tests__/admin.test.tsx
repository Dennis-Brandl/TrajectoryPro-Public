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

// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  getRouteApi: () => ({ useRouteContext: () => ({ user: { id: 'u1', isAdministrator: true } }) }),
  useNavigate: () => vi.fn(),
}))
vi.mock('@/components/shell/HeaderTools', () => ({ HeaderTools: () => null }))
vi.mock('@/components/admin/AccountsTab', () => ({ AccountsTab: () => <div>accounts-content</div> }))
vi.mock('@/components/admin/TeamsTab', () => ({ TeamsTab: () => <div>teams-content</div> }))
vi.mock('@/components/admin/RolesTab', () => ({ RolesTab: () => <div /> }))
vi.mock('@/components/admin/ESignatureRolesTab', () => ({ ESignatureRolesTab: () => <div /> }))
vi.mock('@/components/admin/LibraryAdminTab', () => ({ LibraryAdminTab: () => <div /> }))
vi.mock('@/components/admin/DatabaseTab', () => ({ DatabaseTab: () => <div /> }))
vi.mock('@/components/admin/CleanupTab', () => ({ CleanupTab: () => <div /> }))

import { AdminPage } from '@/routes/_authenticated/admin'

describe('AdminPage tab bar', () => {
  it('keeps the tab names and switches content', () => {
    render(<AdminPage />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Accounts',
      'Teams',
      'Roles',
      'E-Signature Roles',
      'Action Libraries',
      'Environment Libraries',
      'Step Libraries',
      'Workflows',
      'Database',
      'Cleanup',
    ])
    expect(screen.getByText('accounts-content')).toBeTruthy()
    // The active tab is plain shared Tabs styling: no extra underline element inside it.
    expect(screen.getByRole('tab', { selected: true }).querySelector('div')).toBeNull()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Teams' }), { button: 0 })
    expect(screen.getByText('teams-content')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Teams' }).getAttribute('aria-selected')).toBe('true')
  })
})
