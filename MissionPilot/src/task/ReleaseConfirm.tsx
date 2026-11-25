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

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { releaseQuestion } from './ReleaseButton'

export interface ReleaseConfirmProps {
  typedCount: number
  onConfirm(): void
  onCancel(): void
  /** Where focus returns when the dialog closes (the control that opened it). */
  returnFocusTo?: HTMLElement | null
  /** Turns off Release (submitting or offline, as the inline confirm); Keep stays available. */
  disabled?: boolean
}

// Phone-width Release question: a modal like StopConfirm. Focus lands on Keep, the safe answer.
export function ReleaseConfirm({ typedCount, onConfirm, onCancel, returnFocusTo, disabled = false }: ReleaseConfirmProps) {
  const keepRef = useRef<HTMLButtonElement>(null)
  const cancelNow = useRef(onCancel)
  cancelNow.current = onCancel
  useEffect(() => {
    keepRef.current?.focus()
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
    <div className="stop-confirm" role="alertdialog" aria-modal="true" aria-label="Confirm release">
      <div className="stop-confirm-box">
        <p>{releaseQuestion(typedCount)}</p>
        <div className="stop-confirm-actions">
          <button type="button" className="release-btn" disabled={disabled} onClick={onConfirm}>
            Release
          </button>
          <button type="button" className="release-btn" ref={keepRef} onClick={onCancel}>
            Keep
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
