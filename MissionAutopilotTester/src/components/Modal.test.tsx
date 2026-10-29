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

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

describe('Modal', () => {
  it('renders nothing when open is false', () => {
    const onClose = vi.fn()
    render(
      <Modal open={false} onClose={onClose} titleId="t">
        <h2 id="t">Hidden</h2>
        <p>body</p>
      </Modal>
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders children inside a dialog when open', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} titleId="t">
        <h2 id="t">My Title</h2>
        <p>body</p>
      </Modal>
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 't')
    expect(screen.getByText('My Title')).toBeInTheDocument()
  })

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} titleId="t">
        <h2 id="t">x</h2>
      </Modal>
    )
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} titleId="t">
        <h2 id="t">x</h2>
      </Modal>
    )
    const backdrop = screen.getByTestId('modal-backdrop')
    await user.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT call onClose when the dialog body is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} titleId="t">
        <h2 id="t">x</h2>
        <p>body</p>
      </Modal>
    )
    await user.click(screen.getByText('body'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
