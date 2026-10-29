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
import { CreateAdminStep } from '../CreateAdminStep'
import * as adminClient from '@/lib/admin/adminClient'

const signUpEmail = vi.fn()
vi.mock('@/lib/auth-client', () => ({ signUp: { email: (...args: unknown[]) => signUpEmail(...args) } }))
vi.mock('@/lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/adminClient')>()
  return { ...actual, listTeams: vi.fn(), listRoles: vi.fn(), createUser: vi.fn() }
})

beforeEach(() => {
  signUpEmail.mockResolvedValue({ error: null })
  vi.mocked(adminClient.createUser).mockResolvedValue({
    id: 'a2',
    name: null,
    email: 'admin2@x.com',
    isAdministrator: true,
    createdAt: null,
  })
})
afterEach(() => vi.clearAllMocks())

async function createFirstAdmin() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Boss' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'boss@x.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password1' } })
  fireEvent.click(screen.getByRole('button', { name: /create administrator & continue/i }))
}

describe('CreateAdminStep', () => {
  it('creates the first admin via signUp, then shows the post-create state (no auto-advance)', async () => {
    const onCreated = vi.fn()
    render(<CreateAdminStep onCreated={onCreated} />)
    await createFirstAdmin()
    await waitFor(() => expect(signUpEmail).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeTruthy())
    expect(onCreated).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('can add another administrator via the dialog after the first is created', async () => {
    render(<CreateAdminStep onCreated={vi.fn()} />)
    await createFirstAdmin()
    await waitFor(() => screen.getByRole('button', { name: /add another administrator/i }))
    fireEvent.click(screen.getByRole('button', { name: /add another administrator/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /create administrator$/i })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin2@x.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } })
    fireEvent.click(screen.getByRole('button', { name: /create administrator$/i }))
    await waitFor(() =>
      expect(adminClient.createUser).toHaveBeenCalledWith({
        email: 'admin2@x.com',
        password: 'password1',
        name: undefined,
        isAdministrator: true,
      }),
    )
    await waitFor(() => expect(screen.getByText(/added admin2@x\.com/i)).toBeTruthy())
  })
})
