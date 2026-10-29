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
import { LibraryItem } from '@/components/library/LibraryItem'
import { usePrincipalStore } from '@/stores/principalStore'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'
import type { Library } from '@/types/library'

vi.mock('@/components/library/SpecificationItem', () => ({ SpecificationItem: () => <div /> }))
vi.mock('@/components/library/SpecTreeItem', () => ({ SpecTreeItem: () => <div /> }))

const createLibraryMock = vi.fn()
vi.mock('@/stores/specificationStore/libraryCrud', () => ({
  createLibrary: (input: unknown) => createLibraryMock(input),
  deleteLibrary: vi.fn().mockResolvedValue({ ok: true }),
  renameLibrary: vi.fn(),
}))

const library: Library = {
  id: 'lib1',
  teamId: 'team-a',
  name: 'My Lib',
  entityType: 'workflow',
  createdAt: 0,
  updatedAt: 0,
}

const principal = (rights: string[]): MePrincipal => ({
  userId: 'u1',
  isAdministrator: false,
  memberships: ['team-a'],
  rightsByTeam: { 'team-a': rights },
  teams: [{ id: 'team-a', name: 'A' }],
  editLockedStates: [],
})

const props = {
  library,
  isExpanded: false,
  isSelected: false,
  specifications: [],
  onToggle: () => {},
  onSelect: () => {},
  onExpand: () => {},
}

beforeEach(() => {
  vi.clearAllMocks()
  createLibraryMock.mockResolvedValue({ id: 'sub1' })
})

describe('LibraryItem affordance gating', () => {
  it('a pure viewer (no rights) gets no action menu', () => {
    usePrincipalStore.setState({ principal: principal([]) })
    render(<LibraryItem {...props} />)
    expect(screen.queryByRole('button', { name: /library actions/i })).toBeNull()
  })

  it('an editor sees Rename + Delete and Add Specification', () => {
    usePrincipalStore.setState({
      principal: principal(['workflow:edit', 'workflow:create', 'workflow:library.delete']),
    })
    render(<LibraryItem {...props} />)
    const trigger = screen.getByRole('button', { name: /library actions/i })
    fireEvent.pointerDown(trigger)
    fireEvent.click(trigger)
    expect(screen.getByText('Rename')).not.toBeNull()
    expect(screen.getByText('Delete')).not.toBeNull()
    expect(screen.getByText(/Add Workflow/)).not.toBeNull()
  })

  it('sub-library creation sends the parent team id', async () => {
    usePrincipalStore.setState({ principal: principal(['workflow:library.create']) })
    render(<LibraryItem {...props} />)
    const trigger = screen.getByRole('button', { name: /library actions/i })
    fireEvent.pointerDown(trigger)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByText('Add Sub-Library'))
    fireEvent.change(screen.getByPlaceholderText('Sub-library name'), { target: { value: 'Sub' } })
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() =>
      expect(createLibraryMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sub', parentLibraryId: 'lib1', teamId: 'team-a' }),
      ),
    )
  })
})

describe('LibraryItem BatchML import', () => {
  const asEditor = () => usePrincipalStore.setState({ principal: principal(['workflow:create']) })
  const batchmlFile = () =>
    new File(['<MasterRecipe xmlns="http://www.mesa.org/xml/B2MML"/>'], 'Kitchen Demo(1.0.0).batchml.xml', {
      type: 'application/xml',
    })

  it('offers "Import BatchML (ISA-88)" on a workflow library and hands the chosen file to onImportBatchml', async () => {
    asEditor()
    const onImportBatchml = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <LibraryItem {...props} onImportRuntimePackage={vi.fn()} onImportBatchml={onImportBatchml} />,
    )
    const trigger = screen.getByRole('button', { name: /library actions/i })
    fireEvent.pointerDown(trigger)
    fireEvent.click(trigger)
    expect(screen.getByText('Import BatchML (ISA-88)')).not.toBeNull()
    const input = container.querySelector('input[accept=".batchml.xml,.xml"]') as HTMLInputElement | null
    expect(input).not.toBeNull()
    const file = batchmlFile()
    fireEvent.change(input!, { target: { files: [file] } })
    await waitFor(() => expect(onImportBatchml).toHaveBeenCalledWith('lib1', file))
  })

  it('routes an .xml chosen through Import Workflow Package to onImportBatchml, not the runtime importer', async () => {
    asEditor()
    const onImportRuntimePackage = vi.fn().mockResolvedValue(undefined)
    const onImportBatchml = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <LibraryItem {...props} onImportRuntimePackage={onImportRuntimePackage} onImportBatchml={onImportBatchml} />,
    )
    const input = container.querySelector('input[accept=".WFmasterX"]') as HTMLInputElement
    const file = batchmlFile()
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(onImportBatchml).toHaveBeenCalledWith('lib1', file))
    expect(onImportRuntimePackage).not.toHaveBeenCalled()
  })

  it('still sends a .WFmasterX through Import Workflow Package to onImportRuntimePackage', async () => {
    asEditor()
    const onImportRuntimePackage = vi.fn().mockResolvedValue(undefined)
    const onImportBatchml = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <LibraryItem {...props} onImportRuntimePackage={onImportRuntimePackage} onImportBatchml={onImportBatchml} />,
    )
    const input = container.querySelector('input[accept=".WFmasterX"]') as HTMLInputElement
    const file = new File(['PK'], 'Kitchen Demo(1.0.0).WFmasterX', { type: 'application/zip' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(onImportRuntimePackage).toHaveBeenCalledWith('lib1', file))
    expect(onImportBatchml).not.toHaveBeenCalled()
  })
})
