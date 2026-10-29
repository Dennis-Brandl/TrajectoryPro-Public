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
import { useLayoutEffect, useState, type RefObject } from 'react'
import { Trash2 } from 'lucide-react'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { buildRectMap } from './dnd/useRectMap'

/** Block id whose rendered rect contains the given viewport point (smallest area wins).
 *  Uses geometry (getBoundingClientRect), NOT document.elementsFromPoint: edit-mode blocks
 *  are `inert`, and real browsers (Chromium) exclude inert subtrees from hit-testing, so
 *  elementsFromPoint skips every `.tfk-block` and a click could never resolve to a block. */
export function innermostBlockIdAt(x: number, y: number): string | null {
  let best: string | null = null
  let bestArea = Infinity
  for (const el of document.querySelectorAll('[data-block-id]')) {
    const r = el.getBoundingClientRect()
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const area = r.width * r.height
      if (area <= bestArea) {
        bestArea = area
        best = el.getAttribute('data-block-id')
      }
    }
  }
  return best
}

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export function SelectionOverlay({ viewportRef }: { viewportRef: RefObject<HTMLDivElement | null> }) {
  const selection = useFormDocumentStore((s) => s.selection)
  const document_ = useFormDocumentStore((s) => s.document)
  const breakpoint = useFormDocumentStore((s) => s.activeBreakpoint)
  const deleteBlock = useFormDocumentStore((s) => s.deleteBlock)
  const [rect, setRect] = useState<Rect | null>(null)

  useLayoutEffect(() => {
    const host = viewportRef.current
    // All state writes live inside `measure` (a nested callback), never synchronously in the
    // effect body — the effect only wires up measurement + the ResizeObserver. `measure` also
    // handles the no-host / no-selection case by clearing the rect, so a separate reset effect
    // (which used to duplicate this) is unnecessary.
    const measure = () => {
      const found =
        host && selection
          ? buildRectMap(host)
              .sections.flatMap((s) => s.rows)
              .flatMap((r) => r.blocks)
              .find((b) => b.id === selection)
          : undefined
      setRect(found ? found.rect : null)
    }
    measure()
    if (!host || !selection) return
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => ro.disconnect()
    // Re-measure when the selected block, the document, or the breakpoint changes.
  }, [viewportRef, selection, document_, breakpoint])

  if (!rect) return null
  return (
    <>
      <div
        data-testid="selection-outline"
        style={{
          position: 'absolute',
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          border: '2px solid #2563eb',
          borderRadius: 4,
          boxSizing: 'border-box',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      />
      <button
        type="button"
        data-testid="delete-block-button"
        aria-label="Delete block"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          if (selection) deleteBlock(selection)
        }}
        style={{
          position: 'absolute',
          left: rect.left + rect.width - 10,
          top: rect.top - 10,
          width: 20,
          height: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          border: 'none',
          borderRadius: 4,
          background: '#dc2626',
          color: '#fff',
          cursor: 'pointer',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          pointerEvents: 'auto',
          zIndex: 4,
        }}
      >
        <Trash2 size={12} />
      </button>
    </>
  )
}
