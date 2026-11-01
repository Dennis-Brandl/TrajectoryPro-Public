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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { flushNow } from '@/stores/specificationStore/saveScheduler'
import { MoveToTeamDialog } from '@/components/library/MoveToTeamDialog'
import * as mutations from '@/lib/api/specification-mutations'
import { ApiError } from '@/stores/specificationStore/apiClient'
import { usePrincipalStore } from '@/stores/principalStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import type { Specification } from '@/types/library'

vi.mock('@/lib/api/specification-mutations', async (orig) => ({
  ...(await orig<typeof mutations>()),
  moveSpecificationToTeam: vi.fn(),
  copySpecificationToTeam: vi.fn(),
}))
vi.mock('@/stores/specificationStore/saveScheduler', () => ({ flushNow: vi.fn().mockResolvedValue(undefined) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const spec: Specification = {
  id: 's1',
  libraryId: 'src',
  name: 'Batch',
  description: null,
  version: '1.0.0',
  state: 'Draft',
  data: {},
  history: [],
  createdAt: 0,
  updatedAt: 0,
}
const library = { id: 'src', teamId: 't1', name: 'Src', entityType: 'workflow' as const, createdAt: 0, updatedAt: 0 }
const pair = ['workflow:library.create', 'workflow:library.delete']

function lib(id: string, name: string, teamId: string, entityType = 'workflow') {
  return {
    id,
    name,
    teamId,
    entityType,
    parentLibraryId: null,
    description: null,
    author: null,
    changeHistory: null,
    version: '1.0.0',
    environmentLibraryIds: [],
    createdAt: 0,
    updatedAt: 0,
    lastEditedByUserId: null,
  }
}

const onSuccess = vi.fn()
const onCopied = vi.fn()
const renderIt = () =>
  render(
    <MoveToTeamDialog
      open
      onOpenChange={() => {}}
      spec={spec}
      library={library}
      onSuccess={onSuccess}
      onCopied={onCopied}
    />,
  )

function chooseTeamAndLibrary() {
  fireEvent.change(screen.getByLabelText('Destination team'), { target: { value: 't2' } })
  fireEvent.change(screen.getByLabelText('Workflow library'), { target: { value: 'w2' } })
}

describe('MoveToTeamDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(flushNow).mockResolvedValue(undefined)
    usePrincipalStore.setState({
      principal: {
        userId: 'u',
        isAdministrator: false,
        memberships: ['t1', 't2', 't3'],
        rightsByTeam: { t1: pair, t2: pair, t3: ['workflow:library.create'], 'team-global': pair },
        teams: [
          { id: 't1', name: 'Source' },
          { id: 't2', name: 'Two' },
          { id: 't3', name: 'Three' },
          { id: 'team-global', name: 'GLOBAL', isGlobal: true },
        ],
      },
    })
    useSpecificationStore.setState({
      libraries: new Map(
        [
          lib('w2', 'Two Workflows', 't2'),
          lib('w3', 'Three Workflows', 't3'),
          lib('e2', 'Two Envs', 't2', 'environment'),
        ].map((l) => [l.id, l]),
      ),
    } as never)
  })

  it('offers only other teams where the principal holds the Librarian pair, never GLOBAL', () => {
    renderIt()
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a team…', 'Two'])
  })

  it('shows the explanatory lines', () => {
    renderIt()
    expect(
      screen.getByText(
        "Either way, environments, actions and sub-workflows it uses are copied into that team's libraries of the same name when missing.",
      ),
    ).toBeTruthy()
    expect(
      screen.getByText("Copying needs create rights in that team; you'll be told if any are missing."),
    ).toBeTruthy()
  })

  it("lists only the chosen team's workflow libraries; Move needs both choices", () => {
    renderIt()
    expect(screen.queryByLabelText('Workflow library')).toBeNull()
    fireEvent.change(screen.getByLabelText('Destination team'), { target: { value: 't2' } })
    const options = Array.from(screen.getByLabelText('Workflow library').querySelectorAll('option')).map(
      (o) => o.textContent,
    )
    expect(options).toEqual(['Choose a library…', 'Two Workflows'])
    expect((screen.getByRole('button', { name: 'Move' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Workflow library'), { target: { value: 'w2' } })
    expect((screen.getByRole('button', { name: 'Move' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('calls the API, toasts what was created and copied, and reports success', async () => {
    vi.mocked(mutations.moveSpecificationToTeam).mockResolvedValue({
      movedRootIds: ['s1'],
      libraryId: 'w2',
      teamId: 't2',
      librariesCreated: [{ id: 'n', name: 'Envs', entityType: 'environment' }],
      elementsCopied: 3,
      touchedLibraryIds: ['n', 'w2'],
    })
    renderIt()
    chooseTeamAndLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(mutations.moveSpecificationToTeam).toHaveBeenCalledWith('s1', 't2', 'w2')
    expect(onSuccess).toHaveBeenCalledWith({
      libraryId: 'w2',
      specId: 's1',
      fromLibraryId: 'src',
      movedRootIds: ['s1'],
      teamId: 't2',
      librariesCreated: true,
      touchedLibraryIds: ['n', 'w2'],
    })
    expect(toast.success).toHaveBeenCalledWith(
      'Moved "Batch" to "Two Workflows" (libraries created: Envs; 3 elements copied)',
    )
  })

  it('Copy calls the copy API, toasts what was created and copied, and reports through onCopied', async () => {
    vi.mocked(mutations.copySpecificationToTeam).mockResolvedValue({
      copiedRootIds: ['n1'],
      libraryId: 'w2',
      teamId: 't2',
      librariesCreated: [{ id: 'n', name: 'Envs', entityType: 'environment' }],
      elementsCopied: 3,
      touchedLibraryIds: ['n', 'w2'],
    })
    renderIt()
    chooseTeamAndLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(onCopied).toHaveBeenCalled())
    expect(mutations.copySpecificationToTeam).toHaveBeenCalledWith('s1', 't2', 'w2')
    expect(mutations.moveSpecificationToTeam).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onCopied).toHaveBeenCalledWith({
      libraryId: 'w2',
      copiedRootIds: ['n1'],
      librariesCreated: true,
      touchedLibraryIds: ['n', 'w2'],
    })
    expect(toast.success).toHaveBeenCalledWith(
      'Copied "Batch" to "Two Workflows" (libraries created: Envs; 3 elements copied)',
    )
  })

  it('lists missing rights inline on a 403', async () => {
    vi.mocked(mutations.moveSpecificationToTeam).mockRejectedValue(
      new ApiError(403, 'forbidden', { missing: ['environment:create'] }),
    )
    renderIt()
    chooseTeamAndLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(await screen.findByText('You need these rights: environment:create')).toBeTruthy()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('awaits the pending-save flush before calling the API', async () => {
    const order: string[] = []
    vi.mocked(flushNow).mockImplementation(async () => {
      await Promise.resolve()
      order.push('flush')
    })
    vi.mocked(mutations.moveSpecificationToTeam).mockImplementation(async () => {
      order.push('api')
      return { movedRootIds: ['s1'], libraryId: 'w2', teamId: 't2', librariesCreated: [], elementsCopied: 0 } as never
    })
    renderIt()
    chooseTeamAndLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(order).toEqual(['flush', 'api'])
  })

  it('aborts with an error when the flush fails', async () => {
    vi.mocked(flushNow).mockRejectedValue(new Error('save failed'))
    renderIt()
    chooseTeamAndLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(await screen.findByText(/pending changes/)).toBeTruthy()
    expect(mutations.moveSpecificationToTeam).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
