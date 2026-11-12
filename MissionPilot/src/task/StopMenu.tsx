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


import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function stopQuestion(runtimeLabel: string): string {
  return `Stop the whole workflow «${runtimeLabel}»? Its cleanup steps will run. This also ends work other people are doing on it.`
}

export interface StopConfirmProps {
  runtimeLabel: string
  onConfirm(): void
  onCancel(): void
  /** Where focus returns when the dialog closes (the control that opened it). */
  returnFocusTo?: HTMLElement | null
}

// Stop always asks first. Focus lands on Cancel, the safe answer.
export function StopConfirm({ runtimeLabel, onConfirm, onCancel, returnFocusTo }: StopConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const cancelNow = useRef(onCancel)
  cancelNow.current = onCancel
  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelNow.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (returnFocusTo?.isConnected) returnFocusTo.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Portalled to <body>: .work-panes is a size container, which would confine a fixed overlay to the pane.
  return createPortal(
    <div className="stop-confirm" role="alertdialog" aria-modal="true" aria-label="Stop workflow">
      <div className="stop-confirm-box">
        <p>{stopQuestion(runtimeLabel)}</p>
        <div className="stop-confirm-actions">
          <button type="button" className="release-btn" onClick={onConfirm}>
            Stop workflow
          </button>
          <button type="button" className="release-btn" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export interface StopMenuProps {
  disabled?: boolean
  /** Called when the operator picks "Stop workflow…" — the host then shows the shared confirm. */
  onStop(opener: HTMLElement | null): void
}

// Phone-width home for Stop: a "⋯" button after Release that opens a one-item menu.
export function StopMenu({ disabled = false, onStop }: StopMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])
  return (
    <span className="stop-menu" ref={rootRef}>
      <button
        type="button"
        ref={btnRef}
        className="release-btn stop-menu-btn"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div role="menu" className="stop-menu-list">
          <button
            type="button"
            role="menuitem"
            className="release-btn"
            onClick={() => {
              setOpen(false)
              onStop(btnRef.current)
            }}
          >
            Stop workflow…
          </button>
        </div>
      )}
    </span>
  )
}
