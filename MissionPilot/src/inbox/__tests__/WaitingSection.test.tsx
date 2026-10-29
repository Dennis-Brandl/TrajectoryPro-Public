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
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { WaitingSection } from '../WaitingSection'
import { api, ApiError } from '../../api/client'
import { Toasts } from '../../toast'
import type { WaitingStep } from '../../api/types'

vi.mock('../../api/client', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number, _code?: string, message?: string) {
      super(message ?? `HTTP ${status}`)
      this.status = status
    }
  }
  return { api: { continueStep: vi.fn() }, ApiError }
})

function waiting(overrides: Partial<WaitingStep> = {}): WaitingStep {
  return {
    stepInstanceId: 'si1', instanceId: 'i1', stepOid: 'g', stepName: 'Cool Down',
    runtimeLabel: 'RW-7', masterName: 'Bake', masterVersion: '1.0.0', workflowPath: [], paused: false,
    timer: { mode: 'timer', deadline: new Date(Date.now() + 192_000).toISOString(), cycleSeconds: null },
    ...overrides,
  }
}

beforeEach(() => { vi.mocked(api.continueStep).mockReset() })
afterEach(cleanup)

describe('WaitingSection', () => {
  it('renders nothing when no timed gates are waiting', () => {
    render(<WaitingSection waiting={[]} offline={false} refresh={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.queryByRole('heading', { name: 'Waiting' })).toBeNull()
  })

  it('lists each gate with its countdown and continues it after confirmation', async () => {
    vi.mocked(api.continueStep).mockResolvedValue(undefined)
    const refresh = vi.fn().mockResolvedValue(undefined)
    render(<><Toasts /><WaitingSection waiting={[waiting()]} offline={false} refresh={refresh} /></>)
    expect(screen.getByRole('heading', { name: 'Waiting' })).toBeTruthy()
    expect(screen.getByText(/^Opens in 3:1\d$/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue now: Cool Down' }))
    fireEvent.change(screen.getByLabelText('Reason for continuing Cool Down (optional)'), { target: { value: 'oven ready' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.continueStep).toHaveBeenCalledWith('i1', 'si1', 'oven ready'))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(await screen.findByText('Continued: Cool Down')).toBeTruthy()
  })

  it('a paused workflow cannot be continued; a 409 shows the engine message', async () => {
    const { rerender } = render(<><Toasts /><WaitingSection waiting={[waiting({ paused: true })]} offline={false} refresh={vi.fn().mockResolvedValue(undefined)} /></>)
    expect(screen.getByRole('button', { name: 'Continue now: Cool Down' }).hasAttribute('disabled')).toBe(true)
    vi.mocked(api.continueStep).mockRejectedValue(new ApiError(409, 'ALREADY_COMPLETED', 'This step is no longer waiting'))
    rerender(<><Toasts /><WaitingSection waiting={[waiting()]} offline={false} refresh={vi.fn().mockResolvedValue(undefined)} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Continue now: Cool Down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('This step is no longer waiting')).toBeTruthy()
  })

  it('refreshes once when a deadline passes', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    render(<WaitingSection waiting={[waiting({ timer: { mode: 'timer', deadline: new Date(Date.now() - 1000).toISOString(), cycleSeconds: null } })]} offline={false} refresh={refresh} />)
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Opening…')).toBeTruthy()
  })

  it('a failed continue keeps the typed reason and does not signal done', async () => {
    vi.mocked(api.continueStep).mockRejectedValue(new ApiError(409, 'INSTANCE_PAUSED', 'Resume the workflow first'))
    const refresh = vi.fn().mockResolvedValue(undefined)
    render(<><Toasts /><WaitingSection waiting={[waiting()]} offline={false} refresh={refresh} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Continue now: Cool Down' }))
    fireEvent.change(screen.getByLabelText('Reason for continuing Cool Down (optional)'), { target: { value: 'keep me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Resume the workflow first')).toBeTruthy()
    expect((screen.getByLabelText('Reason for continuing Cool Down (optional)') as HTMLInputElement).value).toBe('keep me')
    expect(refresh).not.toHaveBeenCalled()
  })
  it('lists a repeating script with its cycle and never refreshes for a script without a limit', () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    render(<WaitingSection waiting={[waiting({ stepName: 'Poll Tank', timer: { mode: 'repeat_script', deadline: null, cycleSeconds: 5 } })]} offline={false} refresh={refresh} />)
    expect(screen.getByText('Running script · checks every 5 s')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue now: Poll Tank' })).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })
})
