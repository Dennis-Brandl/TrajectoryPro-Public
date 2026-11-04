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

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

export const SIDE_PANE = { default: 256, min: 200, max: 400 } as const

export function clampPaneWidth(n: number): number {
  if (!Number.isFinite(n)) return SIDE_PANE.default
  return Math.min(SIDE_PANE.max, Math.max(SIDE_PANE.min, n))
}

function readWidth(key: string): number {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? SIDE_PANE.default : clampPaneWidth(Number(raw))
  } catch {
    return SIDE_PANE.default
  }
}

export function SidePane({
  storageKey = 'mission-side-pane-width',
  children,
}: {
  storageKey?: string
  children: ReactNode
}) {
  const [width, setWidth] = useState(() => readWidth(storageKey))
  const widthRef = useRef(width)
  useEffect(() => {
    widthRef.current = width
  }, [width])
  const cleanup = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanup.current?.(), [])

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = widthRef.current
      let latest = startW
      const onMove = (ev: MouseEvent) => {
        latest = clampPaneWidth(startW + ev.clientX - startX)
        setWidth(latest)
      }
      const stop = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', stop)
        cleanup.current = null
        try {
          localStorage.setItem(storageKey, String(latest))
        } catch {
          /* storage unavailable */
        }
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', stop)
      cleanup.current = stop
    },
    [storageKey],
  )

  return (
    <aside data-testid="side-pane" style={{ width }} className="relative shrink-0 border-r border-border bg-side-panel">
      <div className="h-full overflow-auto">{children}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onMouseDown}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-selection"
      />
    </aside>
  )
}
