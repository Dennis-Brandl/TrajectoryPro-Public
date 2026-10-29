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

// Radix UI calls hasPointerCapture / releasePointerCapture in jsdom where they are not implemented.
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkflowLibraryImportDialog } from '@/components/import/WorkflowLibraryImportDialog'
import type { ImportPlan } from '@/types/wflibx-import'
import { usePrincipalStore } from '@/stores/principalStore'
import { useLibraryStore } from '@/stores/libraryStore'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'

function makePlan(): ImportPlan {
  return {
    previewId: 'p1',
    bundleLibraryName: 'My Lib',
    warnings: [],
    rows: [
      {
        kind: 'library',
        entityType: 'workflow',
        bundleOid: 'L1',
        bundleName: 'My Lib',
        bundleVersion: '1.0.0',
        status: { tag: 'create' },
      },
      {
        kind: 'specification',
        entityType: 'workflow',
        bundleOid: 'S1',
        bundleName: 'A',
        bundleVersion: '1.0.0',
        parentLibraryOid: 'L1',
        status: { tag: 'conflict', existingOid: 'X', existingName: 'A', existingVersion: '0.9.0' },
      },
    ],
  }
}

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
  usePrincipalStore.setState({
    principal: principal({ 'team-a': ['workflow:library.create'] }, [{ id: 'team-a', name: 'Team A' }]),
  })
  useLibraryStore.setState({ selectedTeamId: 'team-a' })
})

describe('WorkflowLibraryImportDialog', () => {
  it('disables Import until every conflict has a resolution', () => {
    const onCommit = vi.fn()
    render(<WorkflowLibraryImportDialog open plan={makePlan()} onCommit={onCommit} onCancel={() => {}} />)
    const importBtn = screen.getByRole('button', { name: /^import$/i }) as HTMLButtonElement
    expect(importBtn.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Keep S1'))
    expect(importBtn.disabled).toBe(false)
  })

  it('hides the picker for a single eligible team and commits with it', () => {
    const onCommit = vi.fn()
    render(<WorkflowLibraryImportDialog open plan={makePlan()} onCommit={onCommit} onCancel={() => {}} />)
    expect(screen.queryByLabelText('Team')).toBeNull() // hidden when ≤1 eligible team
    fireEvent.click(screen.getByRole('button', { name: /replace all with imported/i }))
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    expect(onCommit).toHaveBeenCalledWith({ S1: 'replace' }, 'team-a')
  })

  it('shows the picker for multiple teams and commits with the selected one', () => {
    usePrincipalStore.setState({
      principal: principal({ 'team-a': ['workflow:library.create'], 'team-b': ['workflow:library.create'] }, [
        { id: 'team-a', name: 'Team A' },
        { id: 'team-b', name: 'Team B' },
      ]),
    })
    const onCommit = vi.fn()
    render(<WorkflowLibraryImportDialog open plan={makePlan()} onCommit={onCommit} onCancel={() => {}} />)
    const select = screen.getByLabelText('Team') as HTMLSelectElement
    expect(select.value).toBe('team-a')
    fireEvent.change(select, { target: { value: 'team-b' } })
    fireEvent.click(screen.getByRole('button', { name: /replace all with imported/i }))
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    expect(onCommit).toHaveBeenCalledWith({ S1: 'replace' }, 'team-b')
  })

  it('never offers GLOBAL — workflow libraries cannot belong to it — even with GLOBAL selected', () => {
    usePrincipalStore.setState({
      principal: principal({ 'team-a': ['workflow:library.create'], 'team-global': ['workflow:library.create'] }, [
        { id: 'team-a', name: 'Team A' },
        { id: 'team-global', name: 'GLOBAL' },
      ]),
    })
    useLibraryStore.setState({ selectedTeamId: 'team-global' })
    const onCommit = vi.fn()
    render(<WorkflowLibraryImportDialog open plan={makePlan()} onCommit={onCommit} onCancel={() => {}} />)
    expect(screen.queryByLabelText('Team')).toBeNull() // Team A is the only eligible team
    fireEvent.click(screen.getByRole('button', { name: /replace all with imported/i }))
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    expect(onCommit).toHaveBeenCalledWith({ S1: 'replace' }, 'team-a')
  })
})
