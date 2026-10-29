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

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface SheetProps {
  label: string
  onClose(): void
  children: ReactNode
  className?: string
}

const FOCUSABLE = 'button, select, input, [href], [tabindex]:not([tabindex="-1"])'

// One overlay for the work-center switcher, the operator menu and the tablet "N open"
// claims list: a modal panel over a scrim. Escape and a scrim tap close it; focus moves in
// on open (the Close button comes first, so there is always a target even while a list
// is still loading) and returns to whatever opened it on close.
export function Sheet({ label, onClose, children, className }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  // Portalled to <body>: rendered in place, a sheet opened from the header inherited
  // .top-bar button styles (transparent, header-fg text) — white on white until hover.
  return createPortal(
    <div
      className="sheet-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label} className={className ? `sheet ${className}` : 'sheet'}>
        <div className="sheet-head">
          <h2 className="sheet-title">{label}</h2>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
