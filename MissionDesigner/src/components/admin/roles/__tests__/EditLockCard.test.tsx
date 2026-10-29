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
import { EditLockCard } from '../EditLockCard'
import * as adminClient from '../../../../lib/admin/adminClient'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('../../../../lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/admin/adminClient')>()
  return { ...actual, getEditLockedStates: vi.fn(), putEditLockedStates: vi.fn() }
})

beforeEach(() => {
  vi.mocked(adminClient.getEditLockedStates).mockResolvedValue(['Approved', 'Effective', 'Superseded', 'Obsolete'])
  vi.mocked(adminClient.putEditLockedStates).mockImplementation(async (s) => s)
})
afterEach(() => vi.clearAllMocks())

describe('EditLockCard', () => {
  it('loads and checks the currently locked states', async () => {
    render(<EditLockCard />)
    await waitFor(() => expect(screen.getByLabelText('Approved')).toBeTruthy())
    expect((screen.getByLabelText('Approved') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Draft') as HTMLInputElement).checked).toBe(false)
  })

  it('save stays disabled until something changes', async () => {
    render(<EditLockCard />)
    await waitFor(() => screen.getByLabelText('Draft'))
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Draft'))
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('saves the toggled set in lifecycle order', async () => {
    render(<EditLockCard />)
    await waitFor(() => screen.getByLabelText('Draft'))
    fireEvent.click(screen.getByLabelText('Draft')) // check
    fireEvent.click(screen.getByLabelText('Obsolete')) // uncheck
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(adminClient.putEditLockedStates).toHaveBeenCalledWith(['Draft', 'Approved', 'Effective', 'Superseded']),
    )
  })

  it('shows an error toast when save fails', async () => {
    vi.mocked(adminClient.putEditLockedStates).mockRejectedValueOnce(new adminClient.AdminApiError(500, 'internal'))
    render(<EditLockCard />)
    await waitFor(() => screen.getByLabelText('Draft'))
    fireEvent.click(screen.getByLabelText('Draft'))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to save edit-lock setting'))
  })
})
