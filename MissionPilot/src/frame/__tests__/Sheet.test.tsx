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
import { useState } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Sheet } from '../Sheet'

afterEach(cleanup)

function Harness({ onClose }: { onClose(): void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      {open && (
        <Sheet
          label="Test sheet"
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        >
          <button type="button">Inside</button>
        </Sheet>
      )}
    </>
  )
}

function openIt(onClose = vi.fn()) {
  render(<Harness onClose={onClose} />)
  const opener = screen.getByRole('button', { name: 'Opener' })
  opener.focus()
  fireEvent.click(opener)
  return { onClose, opener }
}

describe('Sheet', () => {
  it('is a labelled modal dialog that Escape closes', () => {
    const { onClose } = openIt()
    expect(screen.getByRole('dialog', { name: 'Test sheet' }).getAttribute('aria-modal')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a tap on the scrim closes it; a tap inside the panel does not', () => {
    const { onClose } = openIt()
    fireEvent.click(screen.getByRole('button', { name: 'Inside' }))
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('.sheet-scrim')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('focus moves into the sheet on open and back to the opener on close', () => {
    const { opener } = openIt()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(document.activeElement).toBe(opener)
  })

  it('renders on <body>, outside its opener, so header styles never reach its buttons (Away/Sign Out were white on white)', () => {
    render(
      <header className="top-bar">
        <Sheet label="Operator menu" onClose={() => {}}>
          <button type="button">Sign Out</button>
        </Sheet>
      </header>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Operator menu' })
    expect(dialog.closest('.top-bar')).toBeNull()
    expect(dialog.parentElement?.parentElement).toBe(document.body)
  })
})
