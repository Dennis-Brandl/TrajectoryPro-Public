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
import { render, screen, fireEvent } from '@testing-library/react'
import { SpecificationItem } from '@/components/library/SpecificationItem'
import { usePrincipalStore } from '@/stores/principalStore'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'
import type { Library, Specification } from '@/types/library'

const library: Pick<Library, 'teamId' | 'entityType'> = { teamId: 'team-a', entityType: 'workflow' }
const draft: Specification = {
  id: 's1',
  libraryId: 'lib1',
  name: 'WP',
  description: null,
  version: '1.0.0',
  state: 'Draft',
  data: {},
  history: [],
  createdAt: 0,
  updatedAt: 0,
}
const p = (rights: string[]): MePrincipal => ({
  userId: 'u1',
  isAdministrator: false,
  memberships: ['team-a'],
  rightsByTeam: { 'team-a': rights },
  teams: [{ id: 'team-a', name: 'A' }],
  editLockedStates: ['Approved', 'Effective', 'Superseded', 'Obsolete'],
})
const handlers = {
  selectedSpecificationId: null,
  onSelect: vi.fn(),
  onDelete: vi.fn(),
  onChangeState: vi.fn(),
  onCreateVersion: vi.fn(),
  onExportPDF: vi.fn(),
  onDragStart: vi.fn(),
  libraryId: 'lib1',
}
function openMenu() {
  const trigger = screen.getByRole('button', { name: /item actions/i })
  fireEvent.pointerDown(trigger)
  fireEvent.click(trigger)
}

beforeEach(() => vi.clearAllMocks())

describe('SpecificationItem capability gating', () => {
  it('viewer (no rights) gets no action menu', () => {
    usePrincipalStore.setState({ principal: p([]) })
    render(<SpecificationItem spec={draft} library={library} {...handlers} />)
    expect(screen.queryByRole('button', { name: /item actions/i })).toBeNull()
  })

  it('approver sees Change State but not New Version or Delete', () => {
    usePrincipalStore.setState({ principal: p(['workflow:approve']) })
    render(<SpecificationItem spec={draft} library={library} {...handlers} />)
    openMenu()
    expect(screen.getByText('Change State…')).not.toBeNull()
    expect(screen.queryByText('Create New Version…')).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it('author sees Change State, New Version, and Delete', () => {
    usePrincipalStore.setState({ principal: p(['workflow:edit', 'workflow:create', 'workflow:delete']) })
    render(<SpecificationItem spec={draft} library={library} {...handlers} />)
    openMenu()
    expect(screen.getByText('Change State…')).not.toBeNull()
    expect(screen.getByText('Create New Version…')).not.toBeNull()
    expect(screen.getByText('Delete')).not.toBeNull()
  })
})
