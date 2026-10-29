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
import { AccountTeamsPanel } from '../AccountTeamsPanel'
import * as adminClient from '../../../../lib/admin/adminClient'

vi.mock('../../../../lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/admin/adminClient')>()
  return {
    ...actual,
    listUserMemberships: vi.fn(),
    listTeams: vi.fn(),
    listRoles: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    setMemberRoles: vi.fn(),
  }
})

const roles: adminClient.Role[] = [
  { id: 'role-author', name: 'Author', description: 'authoring', isSeeded: 1, rights: [], assignmentCount: 1 },
  { id: 'role-approver', name: 'Approver', description: 'approving', isSeeded: 1, rights: [], assignmentCount: 0 },
]

beforeEach(() => {
  vi.mocked(adminClient.listUserMemberships).mockResolvedValue([
    { teamId: 't1', teamName: 'Alpha', roleIds: ['role-author'] },
    { teamId: 't2', teamName: 'Beta', roleIds: [] },
  ])
  vi.mocked(adminClient.listTeams).mockResolvedValue([
    { id: 't1', name: 'Alpha', description: null, createdAt: 1, updatedAt: 1, memberCount: 1, libraryCount: 0 },
    { id: 't2', name: 'Beta', description: null, createdAt: 1, updatedAt: 1, memberCount: 1, libraryCount: 0 },
    { id: 't3', name: 'Gamma', description: null, createdAt: 1, updatedAt: 1, memberCount: 0, libraryCount: 0 },
  ])
  vi.mocked(adminClient.listRoles).mockResolvedValue(roles)
  vi.mocked(adminClient.addMember).mockResolvedValue(undefined)
  vi.mocked(adminClient.removeMember).mockResolvedValue(undefined)
  vi.mocked(adminClient.setMemberRoles).mockResolvedValue(['role-approver'])
})
afterEach(() => vi.clearAllMocks())

function renderPanel(onMembershipChanged = vi.fn()) {
  render(<AccountTeamsPanel userId="u1" userEmail="ann@example.com" onMembershipChanged={onMembershipChanged} />)
  return onMembershipChanged
}

describe('AccountTeamsPanel', () => {
  it('lists the teams with role names; role-less memberships read as viewers', async () => {
    renderPanel()
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy())
    expect(screen.getByText('Author')).toBeTruthy()
    expect(screen.getByText(/viewer/i)).toBeTruthy()
  })

  it('the add picker offers only teams the user is not in; adding calls the API and notifies', async () => {
    const onChanged = renderPanel()
    await waitFor(() => screen.getByText('Alpha'))
    const select = screen.getByLabelText('Add to team') as HTMLSelectElement
    const optionValues = [...select.options].map((o) => o.value)
    expect(optionValues).toContain('t3')
    expect(optionValues).not.toContain('t1')
    fireEvent.change(select, { target: { value: 't3' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() => expect(adminClient.addMember).toHaveBeenCalledWith('t3', 'u1'))
    expect(onChanged).toHaveBeenCalled()
  })

  it('leaving a team confirms first, then calls removeMember', async () => {
    const onChanged = renderPanel()
    await waitFor(() => screen.getByText('Alpha'))
    fireEvent.click(screen.getByTitle('Remove from Alpha'))
    await waitFor(() => expect(screen.getByRole('button', { name: /^remove$/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }))
    await waitFor(() => expect(adminClient.removeMember).toHaveBeenCalledWith('t1', 'u1'))
    expect(onChanged).toHaveBeenCalled()
  })

  it('editing roles for a team sends the replace-set', async () => {
    renderPanel()
    await waitFor(() => screen.getByText('Alpha'))
    fireEvent.click(screen.getByTitle('Set roles in Alpha'))
    await waitFor(() => expect(screen.getByLabelText('Author')).toBeTruthy())
    expect((screen.getByLabelText('Author') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByLabelText('Author'))
    fireEvent.click(screen.getByLabelText('Approver'))
    fireEvent.click(screen.getByRole('button', { name: /save roles/i }))
    await waitFor(() => expect(adminClient.setMemberRoles).toHaveBeenCalledWith('t1', 'u1', ['role-approver']))
  })

  it('refetches when userId changes', async () => {
    const { rerender } = render(
      <AccountTeamsPanel userId="u1" userEmail="ann@example.com" onMembershipChanged={vi.fn()} />,
    )
    await waitFor(() => screen.getByText('Alpha'))
    rerender(<AccountTeamsPanel userId="u9" userEmail="zed@example.com" onMembershipChanged={vi.fn()} />)
    await waitFor(() => expect(adminClient.listUserMemberships).toHaveBeenCalledWith('u9'))
  })
})
