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
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { LibraryAdminTab } from '../LibraryAdminTab'
import * as adminClient from '@/lib/admin/adminClient'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/admin/adminClient', async (orig) => {
  const actual = await orig<typeof import('@/lib/admin/adminClient')>()
  return { ...actual, listTeams: vi.fn(), moveLibrary: vi.fn() }
})

const row = {
  id: 'lib-1',
  createdByUserId: null,
  teamId: 'team-main',
  teamName: 'Main Team',
  name: 'Distributed Actions',
  entityType: 'action',
  description: null,
  createdAt: 0,
  updatedAt: 0,
  ownerName: null,
  ownerEmail: null,
}

beforeEach(() => {
  vi.mocked(adminClient.listTeams).mockResolvedValue([
    {
      id: 'team-main',
      name: 'Main Team',
      description: null,
      createdAt: 0,
      updatedAt: 0,
      memberCount: 1,
      libraryCount: 1,
    },
    {
      id: 'team-global',
      name: 'GLOBAL',
      description: null,
      createdAt: 0,
      updatedAt: 0,
      memberCount: 0,
      libraryCount: 0,
    },
  ] as never)
  vi.mocked(adminClient.moveLibrary).mockResolvedValue({ moved: 1 })
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ libraries: [row] }), { status: 200 })) as never
})

describe('LibraryAdminTab — Move to team', () => {
  it('moves a library to GLOBAL', async () => {
    render(<LibraryAdminTab entityType="action" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Move library: Distributed Actions' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Target team' }), { target: { value: 'team-global' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(adminClient.moveLibrary).toHaveBeenCalledWith('lib-1', 'team-global'))
  })

  it('does not offer GLOBAL for a workflow library', async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ libraries: [{ ...row, entityType: 'workflow' }] }), { status: 200 }),
    ) as never
    render(<LibraryAdminTab entityType="workflow" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Move library: Distributed Actions' }))
    await screen.findByRole('combobox', { name: 'Target team' })
    await waitFor(() => expect(adminClient.listTeams).toHaveBeenCalled())
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).not.toContain('GLOBAL (shared)')
  })

  it('asks before moving a library other teams use, then moves with force', async () => {
    vi.mocked(adminClient.moveLibrary)
      .mockRejectedValueOnce(
        new adminClient.AdminApiError(409, 'conflict', { conflictType: 'referenced', references: 2 }),
      )
      .mockResolvedValueOnce({ moved: 1 })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<LibraryAdminTab entityType="action" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Move library: Distributed Actions' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Target team' }), { target: { value: 'team-global' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(adminClient.moveLibrary).toHaveBeenLastCalledWith('lib-1', 'team-global', true))
    expect(confirm.mock.calls[0][0]).toMatch(/2 items in other teams/)
    confirm.mockRestore()
  })
})
