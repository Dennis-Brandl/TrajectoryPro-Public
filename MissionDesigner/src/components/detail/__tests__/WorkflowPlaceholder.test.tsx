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
import { WorkflowPlaceholder } from '@/components/detail/WorkflowPlaceholder'
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

describe('WorkflowPlaceholder (start screen)', () => {
  it('renders the logo, heading and welcome copy', () => {
    usePrincipalStore.getState().setPrincipal(principal([{ id: 'team-a', name: 'Alpha' }]))
    render(<WorkflowPlaceholder />)

    const logo = screen.getByAltText('Mission Designer') as HTMLImageElement
    expect(logo.getAttribute('src')).toContain('/MissionDesignerStartGraphic.png')
    expect(screen.getByText('Welcome to Mission Designer')).toBeTruthy()
    expect(screen.getByText(/Please select a starting team\./)).toBeTruthy()
  })

  it('lists an option per team from the principal', () => {
    usePrincipalStore.getState().setPrincipal(
      principal([
        { id: 'team-b', name: 'Beta' },
        { id: 'team-a', name: 'Alpha' },
      ]),
    )
    render(<WorkflowPlaceholder />)
    const select = screen.getByLabelText('Starting team') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['Beta', 'Alpha'])
  })

  it('initializes the selection from the store team when it is still valid', async () => {
    useLibraryStore.setState({ selectedTeamId: 'team-b' })
    usePrincipalStore.getState().setPrincipal(
      principal([
        { id: 'team-a', name: 'Alpha' },
        { id: 'team-b', name: 'Beta' },
      ]),
    )
    render(<WorkflowPlaceholder />)
    const select = screen.getByLabelText('Starting team') as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('team-b'))
  })

  it('does not touch the store until Continue, then commits and dismisses', async () => {
    usePrincipalStore.getState().setPrincipal(
      principal([
        { id: 'team-a', name: 'Alpha' },
        { id: 'team-b', name: 'Beta' },
      ]),
    )
    render(<WorkflowPlaceholder />)

    // Store untouched on mount (this screen does not auto-select).
    expect(useLibraryStore.getState().selectedTeamId).toBeNull()

    // Local-only change until Continue.
    fireEvent.change(screen.getByLabelText('Starting team'), { target: { value: 'team-b' } })
    expect(useLibraryStore.getState().selectedTeamId).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(useLibraryStore.getState().selectedTeamId).toBe('team-b')
    // Welcome content is dismissed.
    await waitFor(() => expect(screen.queryByText('Welcome to Mission Designer')).toBeNull())
  })

  it('shows a no-team note and disables Continue when the user has no teams', () => {
    usePrincipalStore.getState().setPrincipal(principal([]))
    render(<WorkflowPlaceholder />)

    expect(screen.queryByLabelText('Starting team')).toBeNull()
    expect(screen.getByText(/don't belong to any team yet/)).toBeTruthy()
    const btn = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('does not offer GLOBAL as a starting team to someone who is not a member of it', () => {
    usePrincipalStore.getState().setPrincipal({
      ...principal([{ id: 'team-a', name: 'Alpha' }]),
      teams: [
        { id: 'team-a', name: 'Alpha' },
        { id: 'team-global', name: 'GLOBAL', isGlobal: true },
      ],
    })
    render(<WorkflowPlaceholder />)
    const select = screen.getByLabelText('Starting team') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['Alpha'])
  })

  it('shows the no-team note when GLOBAL is the only team the user can see', () => {
    usePrincipalStore.getState().setPrincipal({
      ...principal([]),
      teams: [{ id: 'team-global', name: 'GLOBAL', isGlobal: true }],
    })
    render(<WorkflowPlaceholder />)
    expect(screen.getByText(/don't belong to any team yet/)).toBeTruthy()
  })

  it('offers GLOBAL, labelled as shared, to a member of GLOBAL', () => {
    usePrincipalStore.getState().setPrincipal(
      principal([
        { id: 'team-a', name: 'Alpha' },
        { id: 'team-global', name: 'GLOBAL' },
      ]),
    )
    render(<WorkflowPlaceholder />)
    const select = screen.getByLabelText('Starting team') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['Alpha', 'GLOBAL (shared)'])
  })
})
