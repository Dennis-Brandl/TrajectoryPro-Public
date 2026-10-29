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

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LibrarySidebar } from '@/components/library/LibrarySidebar'
import { usePrincipalStore } from '@/stores/principalStore'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'

const { handleBatchmlImport } = vi.hoisted(() => ({ handleBatchmlImport: vi.fn() }))

vi.mock('@/components/library/LibraryTree', () => ({
  LibraryTree: (p: { onImportBatchml?: unknown }) => (
    <div data-testid="tree" data-batchml={p.onImportBatchml === handleBatchmlImport ? 'wired' : 'missing'} />
  ),
}))
vi.mock('@/components/library/TeamFilterDropdown', () => ({ TeamFilterDropdown: () => <div /> }))
vi.mock('@/components/library/CreateLibraryDialog', () => ({ CreateLibraryDialog: () => <div /> }))
vi.mock('@/components/library/use-library-export', () => ({ useLibraryExport: () => ({}) }))
vi.mock('@/components/library/use-library-import', () => ({ useLibraryImport: () => ({ handleBatchmlImport }) }))
vi.mock('@/components/export', () => ({ ExportMenu: () => <div />, ImportButton: () => <div /> }))

const principal: MePrincipal = {
  userId: 'u1',
  isAdministrator: false,
  memberships: ['team-a'],
  rightsByTeam: { 'team-a': ['workflow:create'] },
  teams: [{ id: 'team-a', name: 'A' }],
  editLockedStates: [],
}

describe('LibrarySidebar BatchML wiring', () => {
  it('passes the BatchML import handler down to the library tree', () => {
    usePrincipalStore.setState({ principal })
    render(<LibrarySidebar />)
    expect(screen.getByTestId('tree').getAttribute('data-batchml')).toBe('wired')
  })
})
