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

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TeamFilterDropdown } from '@/components/library/TeamFilterDropdown'
import { useLibraryStore } from '@/stores/libraryStore'
import { usePrincipalStore } from '@/stores/principalStore'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'

function principal(teams: Array<{ id: string; name: string }>): MePrincipal {
  return {
    userId: 'u1',
    isAdministrator: false,
    memberships: teams.map((t) => t.id),
    rightsByTeam: {},
    teams,
  }
}

beforeEach(() => {
  useLibraryStore.setState({ selectedTeamId: null })
  usePrincipalStore.getState().clearPrincipal()
})

describe('TeamFilterDropdown', () => {
  it('renders an option per team and defaults the selection to the first team', async () => {
    usePrincipalStore.getState().setPrincipal(
      principal([
        { id: 'team-b', name: 'Beta' },
        { id: 'team-a', name: 'Alpha' },
      ]),
    )
    render(<TeamFilterDropdown />)
    const select = screen.getByLabelText('Filter by team') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['Beta', 'Alpha'])
    // default-selection effect picks teams[0]
    await waitFor(() => expect(useLibraryStore.getState().selectedTeamId).toBe('team-b'))
  })

  it('changing the selection updates the store', async () => {
    usePrincipalStore.getState().setPrincipal(
      principal([
        { id: 'team-a', name: 'Alpha' },
        { id: 'team-b', name: 'Beta' },
      ]),
    )
    render(<TeamFilterDropdown />)
    await waitFor(() => expect(useLibraryStore.getState().selectedTeamId).toBe('team-a'))
    fireEvent.change(screen.getByLabelText('Filter by team'), { target: { value: 'team-b' } })
    expect(useLibraryStore.getState().selectedTeamId).toBe('team-b')
  })

  it('renders nothing when the user belongs to no teams', () => {
    usePrincipalStore.getState().setPrincipal(principal([]))
    const { container } = render(<TeamFilterDropdown />)
    expect(container.firstChild).toBeNull()
    expect(useLibraryStore.getState().selectedTeamId).toBeNull()
  })

  it('re-points to the first team when the persisted selection is no longer available', async () => {
    useLibraryStore.setState({ selectedTeamId: 'team-gone' })
    usePrincipalStore.getState().setPrincipal(principal([{ id: 'team-a', name: 'Alpha' }]))
    render(<TeamFilterDropdown />)
    await waitFor(() => expect(useLibraryStore.getState().selectedTeamId).toBe('team-a'))
  })

  it('labels the GLOBAL team "GLOBAL (shared)"', () => {
    usePrincipalStore.getState().setPrincipal({
      ...principal([{ id: 'team-main', name: 'Main Team' }]),
      teams: [
        { id: 'team-main', name: 'Main Team' },
        { id: 'team-global', name: 'GLOBAL', isGlobal: true },
      ],
    })
    render(<TeamFilterDropdown />)
    expect(screen.queryByRole('option', { name: 'GLOBAL (shared)' })).not.toBeNull()
  })
})
