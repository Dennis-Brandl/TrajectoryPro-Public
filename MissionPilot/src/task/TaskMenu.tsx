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

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface TaskMenuItem {
  label: string
  /** Called after the menu closes; `opener` is the ⋮ trigger, for returning focus. */
  onSelect(opener: HTMLElement | null): void
  disabled?: boolean
}

export interface TaskMenuProps {
  items: TaskMenuItem[]
  disabled?: boolean
}

// Phone task app bar's overflow menu. The list is portalled to <body> (a size container
// would confine it) and positioned under the trigger, right-aligned.
export function TaskMenu({ items, disabled = false }: TaskMenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useLayoutEffect(() => {
    if (!open) return
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom, right: Math.max(0, window.innerWidth - r.right) })
    listRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: Event) => {
      const t = e.target as Node
      if (!listRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      btnRef.current?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const enabled = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])
    if (enabled.length === 0) return
    const at = enabled.indexOf(document.activeElement as HTMLElement)
    const step = e.key === 'ArrowDown' ? 1 : -1
    const next = at < 0 ? (step === 1 ? 0 : enabled.length - 1) : (at + step + enabled.length) % enabled.length
    enabled[next]!.focus()
  }

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className="task-menu-btn"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        ⋮
      </button>
      {open &&
        createPortal(
          <div
            role="menu"
            ref={listRef}
            className="task-menu-list"
            style={{ position: 'fixed', top: pos.top, right: pos.right }}
            onKeyDown={onKeyDown}
          >
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className="task-menu-item"
                disabled={it.disabled}
                onClick={() => {
                  // Focus ⋮ before this item unmounts: a sheet or dialog opened from here then
                  // records ⋮ as its opener and returns focus there, never to <body>.
                  btnRef.current?.focus()
                  setOpen(false)
                  it.onSelect(btnRef.current)
                }}
              >
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
