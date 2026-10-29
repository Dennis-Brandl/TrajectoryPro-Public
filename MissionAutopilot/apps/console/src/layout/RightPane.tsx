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

import { useCallback, useEffect, useRef, useState } from 'react'
import { PanelRight, PanelLeft } from 'lucide-react'
import { useRightPane } from './RightPaneContext'

const WIDTH_KEY = 'console:rightPaneWidth'
const COLLAPSED_KEY = 'console:rightPaneCollapsed'
const DEFAULT_WIDTH = 360
const MIN_WIDTH = 280
const MAX_WIDTH = 640

function readWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const raw = window.localStorage.getItem(WIDTH_KEY)
  const parsed = raw ? parseInt(raw, 10) : NaN
  if (Number.isNaN(parsed)) return DEFAULT_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed))
}

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(COLLAPSED_KEY) === '1'
}

export default function RightPane() {
  const { payload } = useRightPane()
  const [width, setWidth] = useState<number>(() => readWidth())
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed())
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startWidth: width }
      document.body.style.userSelect = 'none'

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return
        const dx = dragRef.current.startX - ev.clientX
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + dx))
        setWidth(next)
      }
      const onUp = () => {
        document.body.style.userSelect = ''
        dragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [width]
  )

  // Persist width on every change. setState is batched per drag frame so this
  // ends up firing once per visible width step — fine for localStorage.
  useEffect(() => {
    window.localStorage.setItem(WIDTH_KEY, String(width))
  }, [width])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  if (!payload) return null

  if (collapsed) {
    return (
      <div className="w-7 bg-[var(--side-panel)] border-l border-border shrink-0 flex items-start justify-center pt-2">
        <button
          onClick={toggleCollapsed}
          title="Show properties pane"
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <PanelLeft size={14} />
        </button>
      </div>
    )
  }

  return (
    <aside
      className="relative bg-[var(--side-panel)] border-l border-border shrink-0 flex flex-col overflow-hidden"
      style={{ width }}
    >
      {/* Resize handle (left edge) */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 z-10"
        aria-label="Resize properties pane"
      />

      {/* Sticky header */}
      <div className="sticky top-0 z-20 h-12 px-3 flex items-center justify-between border-b border-border bg-[var(--side-panel)] shrink-0">
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {payload.header.eyebrow}
          </span>
          <span className="text-sm font-medium text-foreground truncate">
            {payload.header.name}
          </span>
        </div>
        <button
          onClick={toggleCollapsed}
          title="Hide properties pane"
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0 ml-2"
        >
          <PanelRight size={14} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">{payload.content}</div>
    </aside>
  )
}
