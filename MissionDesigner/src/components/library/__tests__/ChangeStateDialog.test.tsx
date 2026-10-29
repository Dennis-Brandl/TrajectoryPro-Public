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

// Radix UI Select calls scrollIntoView on the selected item in jsdom where it is not implemented.
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChangeStateDialog } from '@/components/library/ChangeStateDialog'
import * as mutations from '@/lib/api/specification-mutations'
import { usePrincipalStore } from '@/stores/principalStore'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'
import type { Library, Specification } from '@/types/library'

vi.mock('@/lib/api/specification-mutations')

const library: Library = {
  id: 'lib1',
  teamId: 'team-a',
  name: 'L',
  entityType: 'workflow',
  createdAt: 0,
  updatedAt: 0,
}

const draftSpec: Specification = {
  id: 's1',
  libraryId: 'lib1',
  name: 'WP-101',
  description: null,
  version: '1.2.0',
  state: 'Draft',
  data: {},
  history: [],
  createdAt: 0,
  updatedAt: 0,
}

const principal = (rights: string[], admin = false): MePrincipal => ({
  userId: 'u1',
  isAdministrator: admin,
  memberships: ['team-a'],
  rightsByTeam: { 'team-a': rights },
  teams: [{ id: 'team-a', name: 'A' }],
  editLockedStates: ['Approved', 'Effective', 'Superseded', 'Obsolete'],
})

function openSelect(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0 })
  fireEvent.click(trigger)
}

beforeEach(() => vi.resetAllMocks())

describe('ChangeStateDialog', () => {
  it('only offers legal targets the user holds the right for', async () => {
    usePrincipalStore.setState({ principal: principal(['workflow:edit']) }) // edit only, no approve
    render(<ChangeStateDialog spec={draftSpec} library={library} open onOpenChange={() => {}} />)
    openSelect(screen.getByRole('combobox'))
    expect(await screen.findByRole('option', { name: 'InTest' })).not.toBeNull()
    expect(screen.queryByRole('option', { name: 'InReview' })).not.toBeNull()
    expect(screen.queryByRole('option', { name: 'Approved' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Draft' })).toBeNull()
  })

  it('admin sees every state (force-illegal override), including non-adjacent', async () => {
    usePrincipalStore.setState({ principal: principal([], true) })
    render(<ChangeStateDialog spec={draftSpec} library={library} open onOpenChange={() => {}} />)
    openSelect(screen.getByRole('combobox'))
    expect(await screen.findByRole('option', { name: 'Obsolete' })).not.toBeNull()
    expect(screen.queryByRole('option', { name: 'Draft' })).toBeNull()
  })

  it('requires an effectiveFrom date when moving to Effective and passes it as start-of-day ms', async () => {
    usePrincipalStore.setState({ principal: principal(['workflow:makeEffective']) })
    const approved = { ...draftSpec, state: 'Approved' as const }
    vi.mocked(mutations.changeSpecificationState).mockResolvedValue({ ...approved, state: 'Effective' })

    render(<ChangeStateDialog spec={approved} library={library} open onOpenChange={() => {}} onSuccess={() => {}} />)
    openSelect(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Effective' }))

    const date = screen.getByLabelText(/effective date/i) as HTMLInputElement
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'launch' } })
    fireEvent.change(date, { target: { value: '2026-07-01' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    const expectedMs = new Date('2026-07-01T00:00:00').getTime()
    await waitFor(() =>
      expect(mutations.changeSpecificationState).toHaveBeenCalledWith('s1', 'Effective', 'launch', expectedMs),
    )
  })

  it('non-Effective transitions call without effectiveFrom', async () => {
    usePrincipalStore.setState({ principal: principal(['workflow:edit']) })
    vi.mocked(mutations.changeSpecificationState).mockResolvedValue({ ...draftSpec, state: 'InTest' })
    render(<ChangeStateDialog spec={draftSpec} library={library} open onOpenChange={() => {}} onSuccess={() => {}} />)
    openSelect(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'InTest' }))
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'wip' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(mutations.changeSpecificationState).toHaveBeenCalledWith('s1', 'InTest', 'wip', undefined),
    )
  })
})
