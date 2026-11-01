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
import { MoveToLibraryDialog } from '@/components/library/MoveToLibraryDialog'
import * as mutations from '@/lib/api/specification-mutations'
import { ApiError } from '@/stores/specificationStore/apiClient'
import { usePrincipalStore } from '@/stores/principalStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import type { Specification } from '@/types/library'

vi.mock('@/lib/api/specification-mutations', async (orig) => ({
  ...(await orig<typeof mutations>()),
  moveSpecificationToLibrary: vi.fn(),
  copySpecificationToLibrary: vi.fn(),
}))
vi.mock('@/stores/specificationStore/saveScheduler', () => ({ flushNow: vi.fn().mockResolvedValue(undefined) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const spec: Specification = {
  id: 's1',
  libraryId: 'src',
  name: 'Mixer',
  description: null,
  version: '1.0.0',
  state: 'Draft',
  data: {},
  history: [],
  createdAt: 0,
  updatedAt: 0,
}
const library = { id: 'src', teamId: 't1', name: 'Src', entityType: 'environment' as const, createdAt: 0, updatedAt: 0 }

function lib(
  id: string,
  name: string,
  teamId: string,
  entityType = 'environment',
  parentLibraryId: string | null = null,
) {
  return {
    id,
    name,
    teamId,
    entityType,
    parentLibraryId,
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

function setup(isAdministrator: boolean, globalRights: string[] = []) {
  usePrincipalStore.setState({
    principal: {
      userId: 'u',
      isAdministrator,
      memberships: ['t1'],
      rightsByTeam: { t1: [], 'team-global': globalRights },
      teams: [{ id: 't1', name: 'T1' }],
    },
  })
  useSpecificationStore.setState({
    libraries: new Map(
      [
        lib('src', 'Src', 't1'),
        lib('a', 'Alpha', 't1'),
        lib('a-sub', 'Sub', 't1', 'environment', 'a'),
        lib('wf', 'Workflows', 't1', 'workflow'),
        lib('other', 'OtherTeam', 't2'),
        lib('g', 'Shared', 'team-global'),
      ].map((l) => [l.id, l]),
    ),
  } as never)
}

const onSuccess = vi.fn()
const onCopied = vi.fn()

function renderIt() {
  return render(
    <MoveToLibraryDialog
      open
      onOpenChange={() => {}}
      spec={spec}
      library={library}
      onSuccess={onSuccess}
      onCopied={onCopied}
    />,
  )
}

const optionTexts = () => screen.getAllByRole('option').map((o) => o.textContent)

describe('MoveToLibraryDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(flushNow).mockResolvedValue(undefined)
  })

  it('lists same-team same-type libraries and sub-libraries, not the source, other teams or other types', () => {
    setup(false)
    renderIt()
    expect(optionTexts()).toEqual(['Choose a library…', 'Alpha', 'Alpha / Sub'])
  })

  it('adds GLOBAL libraries for admins', () => {
    setup(true)
    renderIt()
    expect(optionTexts()).toContain('Shared (GLOBAL)')
  })

  it('adds GLOBAL libraries for holders of the Librarian pair there', () => {
    setup(false, ['environment:library.create', 'environment:library.delete'])
    renderIt()
    expect(optionTexts()).toContain('Shared (GLOBAL)')
  })

  it('Move is disabled until a library is chosen', () => {
    setup(false)
    renderIt()
    expect((screen.getByRole('button', { name: 'Move' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Destination library'), { target: { value: 'a' } })
    expect((screen.getByRole('button', { name: 'Move' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('calls the API and reports success', async () => {
    setup(false)
    vi.mocked(mutations.moveSpecificationToLibrary).mockResolvedValue({
      movedRootIds: ['s1', 's0'],
      referencesUpdated: 2,
      libraryId: 'a',
    })
    renderIt()
    fireEvent.change(screen.getByLabelText('Destination library'), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(mutations.moveSpecificationToLibrary).toHaveBeenCalledWith('s1', 'a')
    expect(onSuccess).toHaveBeenCalledWith({
      libraryId: 'a',
      specId: 's1',
      fromLibraryId: 'src',
      movedRootIds: ['s1', 's0'],
    })
    expect(toast.success).toHaveBeenCalledWith('Moved "Mixer" to "Alpha", 2 references updated')
  })

  it('Copy is disabled until a library is chosen', () => {
    setup(false)
    renderIt()
    expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Destination library'), { target: { value: 'a' } })
    expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('Copy flushes, calls the copy API and reports through onCopied, never the move path', async () => {
    const order: string[] = []
    vi.mocked(flushNow).mockImplementation(async () => {
      await Promise.resolve()
      order.push('flush')
    })
    vi.mocked(mutations.copySpecificationToLibrary).mockImplementation(async () => {
      order.push('api')
      return { copiedRootIds: ['n1', 'n2'], libraryId: 'a' }
    })
    setup(false)
    renderIt()
    fireEvent.change(screen.getByLabelText('Destination library'), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(onCopied).toHaveBeenCalledWith({ copiedRootIds: ['n1', 'n2'], libraryId: 'a' }))
    expect(order).toEqual(['flush', 'api'])
    expect(mutations.copySpecificationToLibrary).toHaveBeenCalledWith('s1', 'a')
    expect(mutations.moveSpecificationToLibrary).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Copied "Mixer" to "Alpha"')
  })

  it('a failed Copy shows the error inline and does not call onCopied', async () => {
    setup(false)
    vi.mocked(mutations.copySpecificationToLibrary).mockRejectedValue(
      new ApiError(403, 'forbidden', { missing: ['environment:create'] }),
    )
    renderIt()
    fireEvent.change(screen.getByLabelText('Destination library'), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByText('You need these rights: environment:create')).toBeTruthy()
    expect(onCopied).not.toHaveBeenCalled()
  })

  it('shows the conflict message inline and does not call onSuccess', async () => {
    setup(false)
    vi.mocked(mutations.moveSpecificationToLibrary).mockRejectedValue(
      new ApiError(409, 'move_name_conflict', { libraryName: 'Alpha', name: 'Mixer' }),
    )
    renderIt()
    fireEvent.change(screen.getByLabelText('Destination library'), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(await screen.findByText('"Alpha" already has an element named "Mixer"')).toBeTruthy()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('awaits the pending-save flush before calling the API', async () => {
    const order: string[] = []
    vi.mocked(flushNow).mockImplementation(async () => {
      await Promise.resolve()
      order.push('flush')
    })
    vi.mocked(mutations.moveSpecificationToLibrary).mockImplementation(async () => {
      order.push('api')
      return { movedRootIds: ['s1'], referencesUpdated: 0, libraryId: 'a' } as never
    })
    setup(false)
    renderIt()
    fireEvent.change(screen.getByLabelText('Destination library'), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(order).toEqual(['flush', 'api'])
  })

  it('aborts with an error when the flush fails', async () => {
    vi.mocked(flushNow).mockRejectedValue(new Error('save failed'))
    setup(false)
    renderIt()
    fireEvent.change(screen.getByLabelText('Destination library'), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(await screen.findByText(/pending changes/)).toBeTruthy()
    expect(mutations.moveSpecificationToLibrary).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
