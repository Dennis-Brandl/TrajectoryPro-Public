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
import { RolesTab } from '../RolesTab'
import * as adminClient from '../../../lib/admin/adminClient'

vi.mock('../../../lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/admin/adminClient')>()
  return {
    ...actual,
    listRoles: vi.fn(),
    getRole: vi.fn(),
    deleteRole: vi.fn(),
    createRole: vi.fn(),
    patchRole: vi.fn(),
    getEditLockedStates: vi.fn(),
    putEditLockedStates: vi.fn(),
  }
})

const author: adminClient.Role = {
  id: 'role-author',
  name: 'Author',
  description: 'Create, edit, and delete objects (all types)',
  isSeeded: 1,
  rights: ['workflow:create', 'workflow:edit', 'workflow:delete'],
  assignmentCount: 2,
}

beforeEach(() => {
  vi.mocked(adminClient.listRoles).mockResolvedValue([author])
  vi.mocked(adminClient.getRole).mockResolvedValue({ ...author, assignmentCount: 5 })
  vi.mocked(adminClient.deleteRole).mockResolvedValue(undefined)
  vi.mocked(adminClient.getEditLockedStates).mockResolvedValue(['Approved', 'Effective', 'Superseded', 'Obsolete'])
})
afterEach(() => vi.clearAllMocks())

describe('RolesTab', () => {
  it('lists roles with the assignment count and no Seeded badge', async () => {
    render(<RolesTab />)
    await waitFor(() => expect(screen.getByText('Author')).toBeTruthy())
    expect(screen.queryByText('Seeded')).toBeNull()
    expect(screen.getByText(/2 assignments/)).toBeTruthy()
    expect(screen.getByText(/workflow: create, edit, delete/)).toBeTruthy()
  })

  it('delete dialog shows the FRESH assignment count from getRole', async () => {
    render(<RolesTab />)
    await waitFor(() => screen.getByText('Author'))
    fireEvent.click(screen.getByTitle('Delete Author'))
    // list said 2 — the dialog must show the fresh 5 from getRole
    await waitFor(() => expect(screen.getByText(/revokes 5 assignments/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(adminClient.deleteRole).toHaveBeenCalledWith('role-author'))
  })

  it('New Role opens the editor dialog in create mode', async () => {
    render(<RolesTab />)
    await waitFor(() => screen.getByText('Author'))
    fireEvent.click(screen.getByRole('button', { name: /new role/i }))
    await waitFor(() => expect(screen.getByText('New role')).toBeTruthy())
  })

  it('mounts the edit-lock card', async () => {
    render(<RolesTab />)
    await waitFor(() => expect(screen.getByText('Lifecycle Edit Lock')).toBeTruthy())
  })

  it('does not reopen the delete dialog when the fresh read lands after cancel', async () => {
    let resolveGet: (r: adminClient.Role) => void = () => {}
    vi.mocked(adminClient.getRole).mockReturnValue(
      new Promise<adminClient.Role>((res) => {
        resolveGet = res
      }),
    )
    render(<RolesTab />)
    await waitFor(() => screen.getByText('Author'))
    fireEvent.click(screen.getByTitle('Delete Author'))
    // dialog open with stale count while getRole is pending
    await waitFor(() => expect(screen.getByText(/revokes 2 assignments/)).toBeTruthy())
    // cancel before the fresh read resolves
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByText(/revokes/)).toBeNull())
    // late fresh read must NOT reopen the dialog
    resolveGet({ ...author, assignmentCount: 5 })
    await waitFor(() => expect(screen.queryByText(/revokes/)).toBeNull())
  })
})
