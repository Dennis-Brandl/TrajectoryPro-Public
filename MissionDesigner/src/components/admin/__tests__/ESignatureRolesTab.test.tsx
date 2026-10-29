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
import { ESignatureRolesTab } from '../ESignatureRolesTab'
import * as adminClient from '../../../lib/admin/adminClient'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('../../../lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/admin/adminClient')>()
  return { ...actual, getEsignatureRoles: vi.fn(), putEsignatureRoles: vi.fn() }
})

beforeEach(() => {
  vi.mocked(adminClient.getEsignatureRoles).mockResolvedValue(['Time Sheet Approver'])
  vi.mocked(adminClient.putEsignatureRoles).mockImplementation(async (r) => r)
})
afterEach(() => vi.clearAllMocks())

describe('ESignatureRolesTab', () => {
  it('loads the list and shows the help text', async () => {
    render(<ESignatureRolesTab />)
    expect(await screen.findByText('Time Sheet Approver')).toBeTruthy()
    expect(screen.getByText(/must match the role names created in Mission Commander/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('adds a trimmed name, rejects blanks and case-insensitive duplicates client-side, removes, saves', async () => {
    render(<ESignatureRolesTab />)
    await screen.findByText('Time Sheet Approver')
    const input = screen.getByLabelText('New role name') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('Enter a role name.')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'time sheet approver' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('That role is already listed.')).toBeTruthy()
    fireEvent.change(input, { target: { value: '  QA Lead ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('QA Lead')).toBeTruthy()
    expect(input.value).toBe('')
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Time Sheet Approver' }))
    expect(screen.queryByText('Time Sheet Approver')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(adminClient.putEsignatureRoles).toHaveBeenCalledWith(['QA Lead']))
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('E-signature roles saved')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('shows an error toast when save fails and keeps the draft', async () => {
    vi.mocked(adminClient.putEsignatureRoles).mockRejectedValueOnce(
      new adminClient.AdminApiError(422, 'schema_mismatch'),
    )
    render(<ESignatureRolesTab />)
    await screen.findByText('Time Sheet Approver')
    fireEvent.change(screen.getByLabelText('New role name'), { target: { value: 'QA Lead' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Invalid input.'))
    expect(screen.getByText('QA Lead')).toBeTruthy()
  })
})
