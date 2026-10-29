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
import { TeamMembersPanel } from '../TeamMembersPanel'
import * as adminClient from '../../../../lib/admin/adminClient'

vi.mock('../../../../lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/admin/adminClient')>()
  return {
    ...actual,
    listMembers: vi.fn(),
    listRoles: vi.fn(),
    listUsers: vi.fn(),
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
  vi.mocked(adminClient.listMembers).mockResolvedValue([
    { userId: 'u1', email: 'ann@example.com', name: 'Ann', roleIds: ['role-author'] },
    { userId: 'u2', email: 'bob@example.com', name: 'Bob', roleIds: [] },
  ])
  vi.mocked(adminClient.listRoles).mockResolvedValue(roles)
  vi.mocked(adminClient.listUsers).mockResolvedValue([
    { id: 'u1', name: 'Ann', email: 'ann@example.com', isAdministrator: false, createdAt: null },
    { id: 'u2', name: 'Bob', email: 'bob@example.com', isAdministrator: false, createdAt: null },
    { id: 'u3', name: 'Cid', email: 'cid@example.com', isAdministrator: false, createdAt: null },
  ])
  vi.mocked(adminClient.addMember).mockResolvedValue(undefined)
  vi.mocked(adminClient.removeMember).mockResolvedValue(undefined)
  vi.mocked(adminClient.setMemberRoles).mockResolvedValue(['role-approver'])
})
afterEach(() => vi.clearAllMocks())

function renderPanel(onMembershipChanged = vi.fn()) {
  render(<TeamMembersPanel teamId="t1" teamName="Alpha" onMembershipChanged={onMembershipChanged} />)
  return onMembershipChanged
}

describe('TeamMembersPanel', () => {
  it('lists members with role names; roleless members read as viewers', async () => {
    renderPanel()
    await waitFor(() => expect(screen.getByText('ann@example.com')).toBeTruthy())
    expect(screen.getByText('Author')).toBeTruthy()
    expect(screen.getByText(/viewer/i)).toBeTruthy() // Bob has no roles
  })

  it('the add picker offers only non-members; adding calls the API and notifies the parent', async () => {
    const onChanged = renderPanel()
    await waitFor(() => screen.getByText('ann@example.com'))
    const select = screen.getByLabelText('Add member') as HTMLSelectElement
    const optionValues = [...select.options].map((o) => o.value)
    expect(optionValues).toContain('u3')
    expect(optionValues).not.toContain('u1')
    fireEvent.change(select, { target: { value: 'u3' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() => expect(adminClient.addMember).toHaveBeenCalledWith('t1', 'u3'))
    expect(onChanged).toHaveBeenCalled()
  })

  it('removing a member confirms first and warns about role revocation', async () => {
    const onChanged = renderPanel()
    await waitFor(() => screen.getByText('ann@example.com'))
    fireEvent.click(screen.getByTitle('Remove ann@example.com'))
    await waitFor(() => expect(screen.getByText(/role assignments in this team are revoked/i)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }))
    await waitFor(() => expect(adminClient.removeMember).toHaveBeenCalledWith('t1', 'u1'))
    expect(onChanged).toHaveBeenCalled()
  })

  it('resets open dialogs and refetches when teamId changes', async () => {
    const { rerender } = render(<TeamMembersPanel teamId="t1" teamName="Alpha" onMembershipChanged={vi.fn()} />)
    await waitFor(() => screen.getByText('ann@example.com'))
    // open the remove dialog for Ann
    fireEvent.click(screen.getByTitle('Remove ann@example.com'))
    await waitFor(() => expect(screen.getByText(/loses visibility of all/i)).toBeTruthy())
    // switch teams — the panel stays mounted, only the prop changes
    rerender(<TeamMembersPanel teamId="t2" teamName="Beta" onMembershipChanged={vi.fn()} />)
    // the stale remove dialog must be gone, and members refetched for t2
    await waitFor(() => expect(screen.queryByText(/loses visibility of all/i)).toBeNull())
    expect(adminClient.listMembers).toHaveBeenCalledWith('t2')
  })

  it('editing roles sends the replace-set', async () => {
    renderPanel()
    await waitFor(() => screen.getByText('ann@example.com'))
    fireEvent.click(screen.getByTitle('Set roles for ann@example.com'))
    await waitFor(() => expect(screen.getByLabelText('Author')).toBeTruthy())
    expect((screen.getByLabelText('Author') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByLabelText('Author')) // uncheck
    fireEvent.click(screen.getByLabelText('Approver')) // check
    fireEvent.click(screen.getByRole('button', { name: /save roles/i }))
    await waitFor(() => expect(adminClient.setMemberRoles).toHaveBeenCalledWith('t1', 'u1', ['role-approver']))
  })
})
