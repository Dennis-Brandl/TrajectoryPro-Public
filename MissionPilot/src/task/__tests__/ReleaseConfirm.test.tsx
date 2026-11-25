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
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ReleaseConfirm } from '../ReleaseConfirm'

afterEach(cleanup)

describe('ReleaseConfirm', () => {
  it('asks the release question and focuses Keep', () => {
    render(<ReleaseConfirm typedCount={2} onConfirm={() => {}} onCancel={() => {}} />)
    const dlg = screen.getByRole('alertdialog', { name: 'Confirm release' })
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByText('Release and discard 2 entered values?')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep' }))
  })

  it('is portalled to the body', () => {
    render(<ReleaseConfirm typedCount={1} onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('alertdialog').parentElement).toBe(document.body)
  })

  it('Escape means Keep', () => {
    const onCancel = vi.fn()
    render(<ReleaseConfirm typedCount={2} onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Release confirms, Keep cancels', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ReleaseConfirm typedCount={2} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('disabled turns off Release only; Keep still works', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ReleaseConfirm typedCount={2} onConfirm={onConfirm} onCancel={onCancel} disabled />)
    const release = screen.getByRole('button', { name: 'Release' }) as HTMLButtonElement
    expect(release.disabled).toBe(true)
    fireEvent.click(release)
    expect(onConfirm).not.toHaveBeenCalled()
    const keep = screen.getByRole('button', { name: 'Keep' }) as HTMLButtonElement
    expect(keep.disabled).toBe(false)
    fireEvent.click(keep)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('returns focus to the opener on close', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    const { unmount } = render(
      <ReleaseConfirm typedCount={2} onConfirm={() => {}} onCancel={() => {}} returnFocusTo={opener} />,
    )
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
