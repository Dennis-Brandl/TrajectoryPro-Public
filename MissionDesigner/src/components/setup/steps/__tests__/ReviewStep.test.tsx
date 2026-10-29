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
import { ReviewStep } from '../ReviewStep'
import * as adminClient from '@/lib/admin/adminClient'

const navigateMock = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateMock }))
vi.mock('@/lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/adminClient')>()
  return { ...actual, completeSetup: vi.fn() }
})

beforeEach(() => {
  vi.mocked(adminClient.completeSetup).mockResolvedValue({ setupComplete: true })
})
afterEach(() => vi.clearAllMocks())

describe('ReviewStep', () => {
  it('completes setup and navigates to / on Finish', async () => {
    render(
      <ReviewStep
        teams={[{ id: 't1', name: 'Engineering', description: null, createdAt: 0, updatedAt: 0 }]}
        onBack={vi.fn()}
      />,
    )
    expect(screen.getByText('Engineering')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /finish/i }))
    await waitFor(() => expect(adminClient.completeSetup).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/' }))
  })

  it('shows an error and does not navigate when completeSetup fails', async () => {
    vi.mocked(adminClient.completeSetup).mockRejectedValue(new adminClient.AdminApiError(409, 'setup_incomplete'))
    render(<ReviewStep teams={[]} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /finish/i }))
    await waitFor(() => expect(screen.queryByText(/at least one administrator and one team/i)).toBeTruthy())
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('shows the "Setting up your workspace…" splash after a successful Finish', async () => {
    render(
      <ReviewStep
        teams={[{ id: 't1', name: 'Engineering', description: null, createdAt: 0, updatedAt: 0 }]}
        onBack={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /finish/i }))
    await waitFor(() => expect(screen.getByText(/setting up your workspace/i)).toBeTruthy())
    // The review UI (and its Finish button) is replaced by the splash.
    expect(screen.queryByRole('button', { name: /finish/i })).toBeNull()
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/' }))
  })
})
