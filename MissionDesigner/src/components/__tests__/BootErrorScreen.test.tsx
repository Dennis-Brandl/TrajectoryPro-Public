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

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BootErrorScreen } from '../BootErrorScreen'

describe('BootErrorScreen', () => {
  it('shows the message and the detail', () => {
    render(<BootErrorScreen detail="Server error 500" onRetry={vi.fn()} onSignOut={vi.fn()} />)
    expect(screen.getByText("Mission Designer can't load your account right now.")).toBeTruthy()
    expect(screen.getByText('Server error 500')).toBeTruthy()
  })

  it('Retry calls onRetry', () => {
    const onRetry = vi.fn()
    render(<BootErrorScreen detail="x" onRetry={onRetry} onSignOut={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('Sign out calls onSignOut', () => {
    const onSignOut = vi.fn()
    render(<BootErrorScreen detail="x" onRetry={vi.fn()} onSignOut={onSignOut} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
  it('Retry is disabled and reads Retrying... while pending, then says it is still failing', async () => {
    let resolve!: () => void
    const onRetry = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r
        }),
    )
    render(<BootErrorScreen detail="x" onRetry={onRetry} onSignOut={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    const busy = screen.getByRole('button', { name: 'Retrying…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    expect(screen.queryByText(/Still failing/)).toBeNull()
    resolve()
    await waitFor(() => expect(screen.getByText(/^Still failing \(checked at \d{1,2}:\d{2}.*\)\.$/)).toBeTruthy())
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
