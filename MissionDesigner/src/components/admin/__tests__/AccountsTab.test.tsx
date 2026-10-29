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
import { AccountsTab } from '../AccountsTab'
import * as adminClient from '../../../lib/admin/adminClient'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))
vi.mock('@/lib/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('../../../lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/admin/adminClient')>()
  return {
    ...actual,
    listUsers: vi.fn(),
    setUserAdmin: vi.fn(),
    deleteUser: vi.fn(),
    listUserMemberships: vi.fn(),
    listTeams: vi.fn(),
    listRoles: vi.fn(),
    createUser: vi.fn(),
    addMember: vi.fn(),
    setMemberRoles: vi.fn(),
  }
})

// Ordered by email like the server (admin@ before bob@).
const USERS: adminClient.UserAccount[] = [
  { id: 'me', name: 'Admin', email: 'admin@x.com', isAdministrator: true, createdAt: null },
  { id: 'u2', name: 'Bob', email: 'bob@x.com', isAdministrator: false, createdAt: null },
]

beforeEach(() => {
  vi.mocked(adminClient.listUsers).mockResolvedValue(structuredClone(USERS))
  vi.mocked(adminClient.setUserAdmin).mockResolvedValue(structuredClone(USERS[1]))
  vi.mocked(adminClient.deleteUser).mockResolvedValue(undefined)
  vi.mocked(adminClient.listUserMemberships).mockResolvedValue([])
  vi.mocked(adminClient.listTeams).mockResolvedValue([])
  vi.mocked(adminClient.listRoles).mockResolvedValue([])
  vi.mocked(adminClient.createUser).mockResolvedValue({
    id: 'u-new',
    name: null,
    email: 'new@x.com',
    isAdministrator: false,
    createdAt: null,
  })
  vi.mocked(adminClient.addMember).mockResolvedValue(undefined)
  vi.mocked(adminClient.setMemberRoles).mockResolvedValue([])
})
afterEach(() => vi.clearAllMocks())

describe('AccountsTab', () => {
  it('renders only the Admin capability checkbox (no legacy author/global flags)', async () => {
    render(<AccountsTab currentUserId="me" />)
    await waitFor(() => expect(screen.getByText('bob@x.com')).toBeTruthy())
    expect(screen.getAllByRole('checkbox')).toHaveLength(2) // one Admin box per user
    expect(screen.queryByText('Global')).toBeNull()
    expect(screen.queryByText('Step Lib')).toBeNull()
    expect(screen.queryByText('Environ')).toBeNull()
  })

  it('disables the delete button for the current user', async () => {
    render(<AccountsTab currentUserId="me" />)
    await waitFor(() => expect(screen.getByText('admin@x.com')).toBeTruthy())
    expect((screen.getByTitle('Cannot delete your own account') as HTMLButtonElement).disabled).toBe(true)
  })

  it('saves an admin-flag change via setUserAdmin', async () => {
    render(<AccountsTab currentUserId="me" />)
    await waitFor(() => expect(screen.getByText('bob@x.com')).toBeTruthy())
    fireEvent.click(screen.getAllByRole('checkbox')[1]) // Bob → admin
    fireEvent.click(screen.getByRole('button', { name: /save roles/i }))
    await waitFor(() => expect(adminClient.setUserAdmin).toHaveBeenCalledWith('u2', true))
  })

  it('blocks removing the last admin (warning shown, Save disabled)', async () => {
    render(<AccountsTab currentUserId="me" />)
    await waitFor(() => expect(screen.getByText('admin@x.com')).toBeTruthy())
    fireEvent.click(screen.getAllByRole('checkbox')[0]) // uncheck the only admin
    expect(screen.getByText(/at least one user must be an admin/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: /save roles/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('selecting an account reveals its teams & roles panel', async () => {
    render(<AccountsTab currentUserId="me" />)
    await waitFor(() => screen.getByText('bob@x.com'))
    fireEvent.click(screen.getByText('bob@x.com'))
    await waitFor(() => expect(screen.getByText(/Teams & roles for bob@x\.com/i)).toBeTruthy())
  })

  it('clicking the Admin label element does not select the row', async () => {
    render(<AccountsTab currentUserId="someone-else" />)
    await waitFor(() => screen.getByText('admin@x.com'))
    // The role labels are rendered as <label> elements. Query them by their HTML element type
    // to avoid ambiguity with the user name "Admin" in the row.
    // The label wraps a checkbox + the text "Admin" for the isAdministrator role.
    // Clicking the <label> directly (not the checkbox) is the bug path: without stopPropagation
    // on the label, the click event bubbles to the row div and selects it.
    const labels = document.querySelectorAll('label.cursor-pointer')
    expect(labels.length).toBeGreaterThan(0)
    const firstLabel = labels[0] as HTMLElement
    fireEvent.click(firstLabel)
    // Row must NOT have been selected → no "Teams & roles for" panel
    expect(screen.queryByText(/Teams & roles for/i)).toBeNull()
  })

  it('opens the Add Account dialog and creates via createUser', async () => {
    render(<AccountsTab currentUserId="me" />)
    await waitFor(() => screen.getByText('bob@x.com'))
    fireEvent.click(screen.getByRole('button', { name: /add account/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /create account/i })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@x.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() =>
      expect(adminClient.createUser).toHaveBeenCalledWith({
        email: 'new@x.com',
        password: 'password1',
        name: undefined,
        isAdministrator: false,
      }),
    )
  })
})
