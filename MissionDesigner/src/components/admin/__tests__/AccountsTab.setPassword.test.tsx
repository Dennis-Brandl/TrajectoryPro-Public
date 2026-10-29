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
import { signOut } from '@/lib/auth-client'
import { toast } from 'sonner'

const navigate = vi.fn()
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))
vi.mock('@/lib/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('../../../lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/admin/adminClient')>()
  return {
    ...actual,
    listUsers: vi.fn(),
    setUserPassword: vi.fn(),
    listUserMemberships: vi.fn(),
    listTeams: vi.fn(),
    listRoles: vi.fn(),
  }
})

const USERS: adminClient.UserAccount[] = [
  { id: 'me', name: 'Admin', email: 'admin@x.com', isAdministrator: true, createdAt: null },
  { id: 'u2', name: 'Bob', email: 'bob@x.com', isAdministrator: false, createdAt: null },
]

beforeEach(() => {
  vi.mocked(adminClient.listUsers).mockResolvedValue(structuredClone(USERS))
  vi.mocked(adminClient.setUserPassword).mockResolvedValue(undefined)
  vi.mocked(adminClient.listUserMemberships).mockResolvedValue([])
  vi.mocked(adminClient.listTeams).mockResolvedValue([])
  vi.mocked(adminClient.listRoles).mockResolvedValue([])
})
afterEach(() => vi.clearAllMocks())

async function setPasswordFor(title: string) {
  render(<AccountsTab currentUserId="me" />)
  fireEvent.click(await screen.findByTitle(title))
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'longenough' } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'longenough' } })
  fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
  await waitFor(() => expect(adminClient.setUserPassword).toHaveBeenCalled())
}

describe('AccountsTab set password', () => {
  it('setting your own password signs out and goes to /login', async () => {
    await setPasswordFor('Set password for Admin')
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }))
    expect(signOut).toHaveBeenCalled()
  })

  it('a failed sign-out after your own password shows an error and still goes to /login', async () => {
    vi.mocked(signOut).mockRejectedValueOnce(new Error('network down'))
    await setPasswordFor('Set password for Admin')
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }))
    expect(toast.error).toHaveBeenCalledWith('network down')
  })

  it("setting another account's password does neither", async () => {
    await setPasswordFor('Set password for Bob')
    await new Promise((r) => setTimeout(r, 50))
    expect(signOut).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})
