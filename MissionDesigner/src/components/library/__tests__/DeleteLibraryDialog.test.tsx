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
import { DeleteLibraryDialog } from '@/components/library/DeleteLibraryDialog'

const getCheck = vi.fn()
vi.mock('@/stores/specificationStore/apiClient', () => ({
  api: { getLibraryDeleteCheck: (id: string) => getCheck(id) },
}))
const deleteLibrary = vi.fn()
vi.mock('@/stores/specificationStore/libraryCrud', () => ({
  deleteLibrary: (id: string, ids?: string[]) => deleteLibrary(id, ids),
}))
let isAdmin = false
vi.mock('@/stores/principalStore', () => ({
  usePrincipal: () => ({ isAdministrator: isAdmin }),
}))

const spec = (id: string, name: string, version: string, state: string, embeddedCount = 0) => ({
  id,
  name,
  version,
  state,
  embeddedCount,
})
const two = [spec('id-a', 'Kitchen Demo', '3.0.0', 'Effective', 2), spec('id-b', 'Mixer', '1.0.0', 'Approved')]

function renderDialog() {
  const onDeleted = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <DeleteLibraryDialog library={{ id: 'L1', name: 'Lib' }} open onOpenChange={onOpenChange} onDeleted={onDeleted} />,
  )
  return { onDeleted, onOpenChange }
}
const deleteButton = () => screen.getByRole('button', { name: 'Delete' })

describe('DeleteLibraryDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isAdmin = false
  })

  it('no released specs: plain confirmation, deletes without a confirmed list', async () => {
    getCheck.mockResolvedValue({ releasedSpecs: [] })
    deleteLibrary.mockResolvedValue({ ok: true })
    const { onDeleted } = renderDialog()
    expect(
      screen.getByText(
        'Are you sure you want to delete "Lib"? This also deletes every specification in it and in its sub-libraries. This cannot be undone.',
      ),
    ).toBeTruthy()
    await waitFor(() => expect((deleteButton() as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(deleteButton())
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(deleteLibrary).toHaveBeenCalledWith('L1', undefined)
  })

  it('admin with released specs: warning, list, confirms the listed ids', async () => {
    isAdmin = true
    getCheck.mockResolvedValue({ releasedSpecs: two })
    deleteLibrary.mockResolvedValue({ ok: true })
    renderDialog()
    expect(
      await screen.findByText('This library contains 2 released workflows. Deleting it removes them permanently.'),
    ).toBeTruthy()
    expect(screen.getByText('Kitchen Demo v3.0.0 (Effective), includes 2 embedded sub-workflows')).toBeTruthy()
    expect(screen.getByText('Mixer v1.0.0 (Approved)')).toBeTruthy()
    fireEvent.click(deleteButton())
    await waitFor(() => expect(deleteLibrary).toHaveBeenCalledWith('L1', ['id-a', 'id-b']))
  })

  it('non-admin with released specs: list shown, Delete disabled', async () => {
    getCheck.mockResolvedValue({ releasedSpecs: two })
    renderDialog()
    expect(await screen.findByText('Make these Obsolete first, then delete the library.')).toBeTruthy()
    expect(screen.getByText('Mixer v1.0.0 (Approved)')).toBeTruthy()
    expect((deleteButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('admin answered with a new list: stays open, shows it, asks again', async () => {
    isAdmin = true
    getCheck.mockResolvedValue({ releasedSpecs: two })
    const three = [...two, spec('id-c', 'Extra', '2.0.0', 'Superseded')]
    deleteLibrary.mockResolvedValue({ ok: false, code: 'library_has_released_specs', releasedSpecs: three })
    const { onDeleted } = renderDialog()
    await screen.findByText('Mixer v1.0.0 (Approved)')
    fireEvent.click(deleteButton())
    expect(await screen.findByText('The list changed — check it and confirm again.')).toBeTruthy()
    expect(screen.getByText('Extra v2.0.0 (Superseded)')).toBeTruthy()
    expect(
      screen.getByText('This library contains 3 released workflows. Deleting it removes them permanently.'),
    ).toBeTruthy()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('admin with one released spec: singular warning', async () => {
    isAdmin = true
    getCheck.mockResolvedValue({ releasedSpecs: [two[1]] })
    renderDialog()
    expect(
      await screen.findByText('This library contains 1 released workflow. Deleting it removes it permanently.'),
    ).toBeTruthy()
  })

  it('non-admin answered with a new list: shows it with the refusal line, not "the list changed"', async () => {
    getCheck.mockResolvedValue({ releasedSpecs: [] })
    deleteLibrary.mockResolvedValue({ ok: false, code: 'library_has_released_specs', releasedSpecs: two })
    const { onDeleted } = renderDialog()
    await waitFor(() => expect((deleteButton() as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(deleteButton())
    expect(await screen.findByText('Make these Obsolete first, then delete the library.')).toBeTruthy()
    expect(screen.getByText('Mixer v1.0.0 (Approved)')).toBeTruthy()
    expect(screen.queryByText('The list changed — check it and confirm again.')).toBeNull()
    expect((deleteButton() as HTMLButtonElement).disabled).toBe(true)
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('library_not_empty shows the link message', async () => {
    getCheck.mockResolvedValue({ releasedSpecs: [] })
    deleteLibrary.mockResolvedValue({ ok: false, code: 'library_not_empty' })
    renderDialog()
    await waitFor(() => expect((deleteButton() as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(deleteButton())
    expect(
      await screen.findByText('A workflow outside this library links into it. Remove that link first.'),
    ).toBeTruthy()
  })

  const deferred = () => {
    let resolve!: (v: unknown) => void
    const promise = new Promise((r) => (resolve = r))
    return { promise, resolve }
  }

  it('a late answer from an earlier open is ignored', async () => {
    const a = deferred()
    const b = deferred()
    getCheck.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const props = { library: { id: 'L1', name: 'Lib' }, onOpenChange: vi.fn(), onDeleted: vi.fn() }
    const { rerender } = render(<DeleteLibraryDialog {...props} open />)
    rerender(<DeleteLibraryDialog {...props} open={false} />)
    rerender(<DeleteLibraryDialog {...props} open />)
    b.resolve({ releasedSpecs: [two[1]] })
    await screen.findByText('Mixer v1.0.0 (Approved)')
    a.resolve({ releasedSpecs: [two[0]] })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByText('Mixer v1.0.0 (Approved)')).toBeTruthy()
    expect(screen.queryByText(/Kitchen Demo/)).toBeNull()
  })

  it('an answer for another library is ignored', async () => {
    const a = deferred()
    const b = deferred()
    getCheck.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const onOpenChange = vi.fn()
    const onDeleted = vi.fn()
    const { rerender } = render(
      <DeleteLibraryDialog
        library={{ id: 'L1', name: 'One' }}
        open
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
      />,
    )
    rerender(
      <DeleteLibraryDialog
        library={{ id: 'L2', name: 'Two' }}
        open
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
      />,
    )
    b.resolve({ releasedSpecs: [two[1]] })
    await screen.findByText('Mixer v1.0.0 (Approved)')
    a.resolve({ releasedSpecs: [two[0]] })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText(/Kitchen Demo/)).toBeNull()
    expect(getCheck).toHaveBeenCalledWith('L2')
  })
})
