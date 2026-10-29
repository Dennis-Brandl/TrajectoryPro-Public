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
import { render, screen } from '@testing-library/react'
import { LibrarySidebar } from '@/components/library/LibrarySidebar'
import { usePrincipalStore } from '@/stores/principalStore'
import { useLibraryStore } from '@/stores/libraryStore'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'

// Heavy children are exercised elsewhere; stub to keep this test about gating.
vi.mock('@/components/library/LibraryTree', () => ({ LibraryTree: () => <div data-testid="tree" /> }))
vi.mock('@/components/library/TeamFilterDropdown', () => ({ TeamFilterDropdown: () => <div /> }))
vi.mock('@/components/library/CreateLibraryDialog', () => ({
  CreateLibraryDialog: () => <button>New Library</button>,
}))
vi.mock('@/components/library/use-library-export', () => ({ useLibraryExport: () => ({}) }))
vi.mock('@/components/library/use-library-import', () => ({ useLibraryImport: () => ({}) }))
vi.mock('@/components/export', () => ({
  ExportMenu: () => <div />,
  ImportButton: () => <button>Import Library</button>,
}))

const principal = (rights: string[], admin = false): MePrincipal => ({
  userId: 'u1',
  isAdministrator: admin,
  memberships: ['team-a'],
  rightsByTeam: { 'team-a': rights },
  teams: [{ id: 'team-a', name: 'A' }],
  editLockedStates: [],
})

beforeEach(() => {
  useLibraryStore.setState({ activeEntityType: 'workflow', selectedTeamId: 'team-a' })
})

describe('LibrarySidebar gating', () => {
  it('shows all four entity tabs to a member with no create rights (viewers can browse)', () => {
    usePrincipalStore.setState({ principal: principal([]) })
    render(<LibrarySidebar />)
    for (const label of ['Workflows', 'Steps', 'Environments', 'Actions']) {
      expect(screen.getByRole('tab', { name: new RegExp(label, 'i') })).not.toBeNull()
    }
  })

  it('hides New Library when the user lacks library.create in every team', () => {
    usePrincipalStore.setState({ principal: principal(['workflow:edit']) })
    render(<LibrarySidebar />)
    expect(screen.queryByText('New Library')).toBeNull()
  })

  it('shows New Library when the user holds the matching library.create right', () => {
    usePrincipalStore.setState({ principal: principal(['workflow:library.create']) })
    render(<LibrarySidebar />)
    expect(screen.getByText('New Library')).not.toBeNull()
  })
})

describe('LibrarySidebar Import button (spec 2026-10-12 deferred minor b)', () => {
  it('is hidden with GLOBAL selected when the user has no library.create right in GLOBAL', () => {
    useLibraryStore.setState({ activeEntityType: 'action', selectedTeamId: 'team-global' })
    usePrincipalStore.setState({ principal: principal(['action:library.create']) })
    render(<LibrarySidebar />)
    expect(screen.queryByText('Import Library')).toBeNull()
  })

  it('is shown when the user may create libraries in the selected team', () => {
    useLibraryStore.setState({ activeEntityType: 'action', selectedTeamId: 'team-a' })
    usePrincipalStore.setState({ principal: principal(['action:library.create']) })
    render(<LibrarySidebar />)
    expect(screen.queryByText('Import Library')).not.toBeNull()
  })
})
