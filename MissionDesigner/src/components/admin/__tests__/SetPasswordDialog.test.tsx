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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SetPasswordDialog } from '../accounts/SetPasswordDialog'
import * as adminClient from '../../../lib/admin/adminClient'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../../lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/admin/adminClient')>()
  return { ...actual, setUserPassword: vi.fn() }
})

afterEach(() => vi.clearAllMocks())

function setup(isSelf = false) {
  const onDone = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <SetPasswordDialog open onOpenChange={onOpenChange} userId="u-x" userLabel="Ann" isSelf={isSelf} onDone={onDone} />,
  )
  return { onDone, onOpenChange }
}
const fill = (a: string, b: string) => {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: a } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: b } })
  fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
}

describe('SetPasswordDialog', () => {
  it('rejects fewer than 8 characters without calling the server', () => {
    setup()
    fill('short', 'short')
    expect(screen.getByText('Password must be at least 8 characters')).toBeTruthy()
    expect(adminClient.setUserPassword).not.toHaveBeenCalled()
  })

  it('rejects mismatched fields', () => {
    setup()
    fill('longenough', 'different1')
    expect(screen.getByText('Passwords do not match')).toBeTruthy()
    expect(adminClient.setUserPassword).not.toHaveBeenCalled()
  })

  it('calls the server then onDone on success', async () => {
    vi.mocked(adminClient.setUserPassword).mockResolvedValue(undefined)
    const { onDone } = setup()
    fill('longenough', 'longenough')
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(adminClient.setUserPassword).toHaveBeenCalledWith('u-x', 'longenough')
  })

  it('isSelf: toasts the sign-in-again message, then onDone', async () => {
    vi.mocked(adminClient.setUserPassword).mockResolvedValue(undefined)
    const { onDone } = setup(true)
    fill('longenough', 'longenough')
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith('Password changed — sign in with your new password')
  })

  it('not isSelf: keeps the signed-out-everywhere toast', async () => {
    vi.mocked(adminClient.setUserPassword).mockResolvedValue(undefined)
    const { onDone } = setup(false)
    fill('longenough', 'longenough')
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith('Password set — the user was signed out everywhere')
  })
})
