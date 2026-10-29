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
import { AddAccountDialog } from '../AddAccountDialog'
import * as adminClient from '../../../../lib/admin/adminClient'

vi.mock('../../../../lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/admin/adminClient')>()
  return {
    ...actual,
    listTeams: vi.fn(),
    listRoles: vi.fn(),
    createUser: vi.fn(),
    addMember: vi.fn(),
    setMemberRoles: vi.fn(),
  }
})

const TEAMS: adminClient.TeamWithCounts[] = [
  { id: 't1', name: 'Engineering', description: null, createdAt: 1, updatedAt: 1, memberCount: 0, libraryCount: 0 },
]
const ROLES: adminClient.Role[] = [
  { id: 'role-author', name: 'Author', description: null, isSeeded: 1, rights: [], assignmentCount: 0 },
]
const NEW_USER: adminClient.UserAccount = {
  id: 'u-new',
  name: null,
  email: 'new@x.com',
  isAdministrator: false,
  createdAt: null,
}

beforeEach(() => {
  vi.mocked(adminClient.listTeams).mockResolvedValue(TEAMS)
  vi.mocked(adminClient.listRoles).mockResolvedValue(ROLES)
  vi.mocked(adminClient.createUser).mockResolvedValue(NEW_USER)
  vi.mocked(adminClient.addMember).mockResolvedValue(undefined)
  vi.mocked(adminClient.setMemberRoles).mockResolvedValue([])
})
afterEach(() => vi.clearAllMocks())

describe('AddAccountDialog', () => {
  it('requires a password of at least 8 characters before calling createUser', async () => {
    render(<AddAccountDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() => expect(screen.getByText(/at least 8 characters/i)).toBeTruthy())
    expect(adminClient.createUser).not.toHaveBeenCalled()
  })

  it('creates a plain account and reports it via onCreated', async () => {
    const onCreated = vi.fn()
    render(<AddAccountDialog open onOpenChange={vi.fn()} onCreated={onCreated} />)
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
    expect(onCreated).toHaveBeenCalledWith(NEW_USER)
  })

  it('assigns chosen teams + roles after creating', async () => {
    render(<AddAccountDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('Team Engineering')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@x.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } })
    fireEvent.click(screen.getByLabelText('Team Engineering'))
    fireEvent.click(screen.getByLabelText('Engineering: Author'))
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() => expect(adminClient.addMember).toHaveBeenCalledWith('t1', 'u-new'))
    expect(adminClient.setMemberRoles).toHaveBeenCalledWith('t1', 'u-new', ['role-author'])
  })

  it('surfaces a duplicate-email conflict and does not report success', async () => {
    vi.mocked(adminClient.createUser).mockRejectedValue(new adminClient.AdminApiError(409, 'conflict'))
    const onCreated = vi.fn()
    render(<AddAccountDialog open onOpenChange={vi.fn()} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dupe@x.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() => expect(screen.getByText(/already in use/i)).toBeTruthy())
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('wizard variant: Administrator locked on, no teams/roles section', async () => {
    render(<AddAccountDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} lockAdministrator hideTeamsAndRoles />)
    const adminBox = screen.getByLabelText('Administrator') as HTMLInputElement
    expect(adminBox.checked).toBe(true)
    expect(adminBox.disabled).toBe(true)
    expect(screen.queryByText('Teams & roles')).toBeNull()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin2@x.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } })
    fireEvent.click(screen.getByRole('button', { name: /create administrator/i }))
    await waitFor(() =>
      expect(adminClient.createUser).toHaveBeenCalledWith({
        email: 'admin2@x.com',
        password: 'password1',
        name: undefined,
        isAdministrator: true,
      }),
    )
    expect(adminClient.listTeams).not.toHaveBeenCalled()
  })
})
