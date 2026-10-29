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
import { TeamsTab } from '../TeamsTab'
import * as adminClient from '../../../lib/admin/adminClient'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../../lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/admin/adminClient')>()
  return {
    ...actual,
    listTeams: vi.fn(),
    createTeam: vi.fn(),
    patchTeam: vi.fn(),
    deleteTeam: vi.fn(),
    // TeamMembersPanel dependencies — selected-team rendering drives these
    listMembers: vi.fn(),
    listRoles: vi.fn(),
    listUsers: vi.fn(),
  }
})

const alpha: adminClient.TeamWithCounts = {
  id: 't1',
  name: 'Alpha',
  description: 'first team',
  createdAt: 1,
  updatedAt: 1,
  memberCount: 2,
  libraryCount: 3,
}

beforeEach(() => {
  vi.mocked(adminClient.listTeams).mockResolvedValue([alpha])
  vi.mocked(adminClient.createTeam).mockResolvedValue({ ...alpha, id: 't2', name: 'Beta' })
  vi.mocked(adminClient.deleteTeam).mockResolvedValue(undefined)
  vi.mocked(adminClient.listMembers).mockResolvedValue([])
  vi.mocked(adminClient.listRoles).mockResolvedValue([])
  vi.mocked(adminClient.listUsers).mockResolvedValue([])
})
afterEach(() => vi.clearAllMocks())

describe('TeamsTab', () => {
  it('lists teams with member and library counts', async () => {
    render(<TeamsTab />)
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy())
    expect(screen.getByText(/2 members/)).toBeTruthy()
    expect(screen.getByText(/3 libraries/)).toBeTruthy()
  })

  it('creates a team and refreshes the list', async () => {
    render(<TeamsTab />)
    await waitFor(() => screen.getByText('Alpha'))
    fireEvent.click(screen.getByRole('button', { name: /new team/i }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Beta' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(adminClient.createTeam).toHaveBeenCalledWith({ name: 'Beta', description: undefined }))
    expect(vi.mocked(adminClient.listTeams).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('surfaces team_not_empty on delete as a friendly toast', async () => {
    vi.mocked(adminClient.deleteTeam).mockRejectedValue(new adminClient.AdminApiError(409, 'team_not_empty'))
    render(<TeamsTab />)
    await waitFor(() => screen.getByText('Alpha'))
    fireEvent.click(screen.getByTitle('Delete Alpha'))
    await waitFor(() => screen.getByRole('button', { name: /^delete$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        'This team still owns libraries — delete or reassign them first.',
      ),
    )
  })

  it('edits a team and calls patchTeam', async () => {
    vi.mocked(adminClient.patchTeam).mockResolvedValue({ ...alpha, name: 'Alpha Updated' })
    render(<TeamsTab />)
    await waitFor(() => screen.getByText('Alpha'))
    fireEvent.click(screen.getByTitle('Edit Alpha'))
    const nameInput = screen.getByLabelText('Name')
    fireEvent.change(nameInput, { target: { value: 'Alpha Updated' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(adminClient.patchTeam).toHaveBeenCalledWith('t1', {
        name: 'Alpha Updated',
        description: 'first team',
      }),
    )
  })

  it('selecting a team shows its members panel', async () => {
    render(<TeamsTab />)
    await waitFor(() => screen.getByText('Alpha'))
    fireEvent.click(screen.getByText('Alpha'))
    await waitFor(() => expect(screen.getByText('Members of Alpha')).toBeTruthy())
    expect(adminClient.listMembers).toHaveBeenCalledWith('t1')
  })
})
