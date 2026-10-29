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
import type { PointerEvent as ReactPointerEvent } from 'react'

export interface PaneResizeHandleProps {
  /** Current pane width in px (baseline captured at drag start). */
  width: number
  min: number
  max: number
  /** +1: dragging right widens the pane (left pane). -1: dragging right narrows it (right pane). */
  direction: 1 | -1
  onResize: (width: number) => void
  label: string
}

/**
 * Vertical drag strip on a designer side pane's inner edge. Window listeners drive the drag
 * (same pattern as useSpanDrag) so it survives the pointer leaving the strip; width is
 * clamped to [min, max]. Host pane must be position:relative and must not scroll itself.
 */
export function PaneResizeHandle({ width, min, max, direction, onResize, label }: PaneResizeHandleProps) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // setPointerCapture unsupported (e.g. jsdom) — window listeners still cover the normal path
    }
    const startX = e.clientX
    const startWidth = width
    const move = (ev: PointerEvent) => {
      const next = startWidth + direction * (ev.clientX - startX)
      onResize(Math.min(max, Math.max(min, next)))
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
      className="absolute inset-y-0 z-10 w-1.5 cursor-col-resize hover:bg-blue-400/50 active:bg-blue-500/60"
      style={{ [direction === 1 ? 'right' : 'left']: 0, touchAction: 'none' }}
    />
  )
}
