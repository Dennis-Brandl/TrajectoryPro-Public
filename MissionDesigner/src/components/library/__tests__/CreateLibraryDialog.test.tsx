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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateLibraryDialog } from '@/components/library/CreateLibraryDialog'
import { usePrincipalStore } from '@/stores/principalStore'
import { useLibraryStore } from '@/stores/libraryStore'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'

const createLibraryMock = vi.fn()
vi.mock('@/stores/specificationStore/libraryCrud', () => ({
  createLibrary: (input: unknown) => createLibraryMock(input),
}))

const principal = (
  rightsByTeam: Record<string, string[]>,
  teams: Array<{ id: string; name: string }>,
): MePrincipal => ({
  userId: 'u1',
  isAdministrator: false,
  memberships: teams.map((t) => t.id),
  rightsByTeam,
  teams,
  editLockedStates: [],
})

beforeEach(() => {
  createLibraryMock.mockReset()
  createLibraryMock.mockResolvedValue({ id: 'new-lib' })
  useLibraryStore.setState({ activeEntityType: 'workflow', selectedTeamId: 'team-a' })
})

describe('CreateLibraryDialog team targeting', () => {
  it('hides the picker and uses the only eligible team', async () => {
    usePrincipalStore.setState({
      principal: principal({ 'team-a': ['workflow:library.create'] }, [{ id: 'team-a', name: 'Alpha' }]),
    })
    render(<CreateLibraryDialog />)
    fireEvent.click(screen.getByText('New Library'))
    expect(screen.queryByLabelText('Team')).toBeNull()
    fireEvent.change(screen.getByLabelText('Library Name'), { target: { value: 'My Lib' } })
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() =>
      expect(createLibraryMock).toHaveBeenCalledWith({ name: 'My Lib', entityType: 'workflow', teamId: 'team-a' }),
    )
  })

  it('shows a picker defaulting to the selected team and sends the chosen team', async () => {
    usePrincipalStore.setState({
      principal: principal({ 'team-a': ['workflow:library.create'], 'team-b': ['workflow:library.create'] }, [
        { id: 'team-a', name: 'Alpha' },
        { id: 'team-b', name: 'Beta' },
      ]),
    })
    useLibraryStore.setState({ selectedTeamId: 'team-b' })
    render(<CreateLibraryDialog />)
    fireEvent.click(screen.getByText('New Library'))
    const select = screen.getByLabelText('Team') as HTMLSelectElement
    expect(select.value).toBe('team-b')
    fireEvent.change(select, { target: { value: 'team-a' } })
    fireEvent.change(screen.getByLabelText('Library Name'), { target: { value: 'X' } })
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() =>
      expect(createLibraryMock).toHaveBeenCalledWith({ name: 'X', entityType: 'workflow', teamId: 'team-a' }),
    )
  })

  it('omits teams where the user lacks library.create from the picker', async () => {
    usePrincipalStore.setState({
      principal: principal({ 'team-a': ['workflow:library.create'], 'team-b': ['workflow:edit'] }, [
        { id: 'team-a', name: 'Alpha' },
        { id: 'team-b', name: 'Beta' },
      ]),
    })
    render(<CreateLibraryDialog />)
    fireEvent.click(screen.getByText('New Library'))
    // Only team-a eligible → single team → no picker
    expect(screen.queryByLabelText('Team')).toBeNull()
    fireEvent.change(screen.getByLabelText('Library Name'), { target: { value: 'Y' } })
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() =>
      expect(createLibraryMock).toHaveBeenCalledWith({ name: 'Y', entityType: 'workflow', teamId: 'team-a' }),
    )
  })

  it('never offers GLOBAL for a workflow library (spec 2026-10-12 U2)', async () => {
    usePrincipalStore.setState({
      principal: principal({ 'team-a': ['workflow:library.create'], 'team-global': ['workflow:library.create'] }, [
        { id: 'team-a', name: 'Alpha' },
        { id: 'team-global', name: 'GLOBAL' },
      ]),
    })
    useLibraryStore.setState({ activeEntityType: 'workflow', selectedTeamId: 'team-global' })
    render(<CreateLibraryDialog />)
    fireEvent.click(screen.getByText('New Library'))
    // only team-a is eligible, so the picker hides and team-a is used
    expect(screen.queryByLabelText('Team')).toBeNull()
    fireEvent.change(screen.getByLabelText('Library Name'), { target: { value: 'W' } })
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() =>
      expect(createLibraryMock).toHaveBeenCalledWith({ name: 'W', entityType: 'workflow', teamId: 'team-a' }),
    )
  })

  it('offers GLOBAL for an action library', () => {
    usePrincipalStore.setState({
      principal: principal({ 'team-a': ['action:library.create'], 'team-global': ['action:library.create'] }, [
        { id: 'team-a', name: 'Alpha' },
        { id: 'team-global', name: 'GLOBAL' },
      ]),
    })
    useLibraryStore.setState({ activeEntityType: 'action', selectedTeamId: 'team-a' })
    render(<CreateLibraryDialog />)
    fireEvent.click(screen.getByText('New Library'))
    expect(screen.queryByRole('option', { name: 'GLOBAL' })).not.toBeNull()
  })
})
