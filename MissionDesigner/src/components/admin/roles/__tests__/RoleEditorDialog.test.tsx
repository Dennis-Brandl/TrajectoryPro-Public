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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RoleEditorDialog } from '../RoleEditorDialog'
import * as adminClient from '../../../../lib/admin/adminClient'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../../../lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/admin/adminClient')>()
  return { ...actual, createRole: vi.fn(), patchRole: vi.fn() }
})

const sampleRole: adminClient.Role = {
  id: 'r1',
  name: 'QA Approver',
  description: 'approve only',
  isSeeded: 0,
  rights: ['workflow:approve'],
  assignmentCount: 0,
}

beforeEach(() => {
  vi.mocked(adminClient.createRole).mockResolvedValue(sampleRole)
  vi.mocked(adminClient.patchRole).mockResolvedValue(sampleRole)
})
afterEach(() => vi.clearAllMocks())

describe('RoleEditorDialog', () => {
  it('creates a role with the checked rights', async () => {
    const onSaved = vi.fn()
    render(<RoleEditorDialog open onOpenChange={() => {}} initial={null} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'QA Approver' } })
    fireEvent.click(screen.getByLabelText('Approve — Workflow (+ Steps)'))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(adminClient.createRole).toHaveBeenCalledWith({
        name: 'QA Approver',
        description: undefined,
        rights: ['workflow:approve'],
      }),
    )
    expect(onSaved).toHaveBeenCalled()
  })

  it('edits an existing role with a replace-set of rights', async () => {
    render(<RoleEditorDialog open onOpenChange={() => {}} initial={sampleRole} onSaved={() => {}} />)
    expect((screen.getByLabelText('Approve — Workflow (+ Steps)') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByLabelText('Approve — Workflow (+ Steps)')) // uncheck
    fireEvent.click(screen.getByLabelText('Approve — Environment')) // check
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(adminClient.patchRole).toHaveBeenCalledWith('r1', {
        name: 'QA Approver',
        description: 'approve only',
        rights: ['environment:approve'],
      }),
    )
  })

  it('save is disabled while the name is empty', () => {
    render(<RoleEditorDialog open onOpenChange={() => {}} initial={null} onSaved={() => {}} />)
    expect((screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('surfaces a duplicate-name 409 as a toast', async () => {
    vi.mocked(adminClient.createRole).mockRejectedValue(new adminClient.AdminApiError(409, 'conflict'))
    render(<RoleEditorDialog open onOpenChange={() => {}} initial={null} onSaved={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Author' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith('That name is already in use.'))
  })

  it('does not signal onSaved when the API rejects', async () => {
    vi.mocked(adminClient.createRole).mockRejectedValueOnce(new adminClient.AdminApiError(500, 'internal'))
    const onSaved = vi.fn()
    const onOpenChange = vi.fn()
    render(<RoleEditorDialog open onOpenChange={onOpenChange} initial={null} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Doomed' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled())
    expect(onSaved).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
