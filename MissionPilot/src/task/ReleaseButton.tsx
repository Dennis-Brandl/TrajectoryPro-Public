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

export function releaseQuestion(n: number): string {
  return n === 1 ? 'Release and discard 1 entered value?' : `Release and discard ${n} entered values?`
}

export interface ReleaseButtonProps {
  /** Values the operator typed into this task (its draft); 0 releases without asking. */
  typedCount: number
  disabled?: boolean
  onRelease(): void
  /** Controlled question state, for a host that must keep it across a remount (Workstation). */
  asking?: boolean
  onAskingChange?(asking: boolean): void
}

// Spec §5.4: Release asks first when it would throw away typed values. The question
// replaces the button in place, and focus lands on Keep — the safe answer.
export function ReleaseButton({ typedCount, disabled = false, onRelease, asking: askingProp, onAskingChange }: ReleaseButtonProps) {
  const [localAsking, setLocalAsking] = useState(false)
  const asking = askingProp ?? localAsking
  const setAsking = onAskingChange ?? setLocalAsking
  const keepRef = useRef<HTMLButtonElement>(null)

  // Focus Keep only when nothing else holds focus: the Release button the operator just
  // pressed is gone by now (focus fell to <body>). A question re-mounted by the work view —
  // a filter re-showing its row while the operator types — must not steal the caret.
  useEffect(() => {
    const current = document.activeElement
    if (asking && (!current || current === document.body)) keepRef.current?.focus()
  }, [asking])

  if (asking) {
    return (
      <span className="release-confirm" role="group" aria-label="Confirm release">
        <span role="alert">{releaseQuestion(typedCount)}</span>
        <button
          type="button"
          className="release-btn"
          disabled={disabled}
          onClick={() => {
            setAsking(false)
            onRelease()
          }}
        >
          Release
        </button>
        <button type="button" className="release-btn" ref={keepRef} onClick={() => setAsking(false)}>
          Keep
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      className="release-btn"
      disabled={disabled}
      onClick={() => (typedCount > 0 ? setAsking(true) : onRelease())}
    >
      Release
    </button>
  )
}
