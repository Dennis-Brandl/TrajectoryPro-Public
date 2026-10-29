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
import { useState } from 'react'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { resolveBp } from '@/lib/form-document/layout-ops'
import { findBlock } from '@/lib/form-document/document-ops'
import { resizeSpan as resizeSpanOp, snapSpanDelta } from '@/lib/form-document/span-resize'

export interface SeamParams {
  rowId: string
  leftId: string
  rightId: string
  startX: number
  colWidthPx: number
  leftSpan: number
  rightSpan: number
}

type Store = typeof useFormDocumentStore

/**
 * Plain state machine for a pointer span-resize. Live-previews via `setDocument` while zundo is
 * paused, then coalesces the whole drag into ONE undo entry (baseline → final) on `end`. Kept
 * store-driven (no React/DOM) so it is unit-testable directly.
 */
export function createSpanDragController(store: Store = useFormDocumentStore) {
  let active: SeamParams | null = null
  let baseline = store.getState().document

  return {
    get resizing() {
      return active !== null
    },
    get activeRowId() {
      return active ? active.rowId : null
    },
    begin(p: SeamParams) {
      if (active) {
        // finalize an interrupted prior drag before starting a new one
        if (store.getState().document !== baseline) store.getState().setDocument(baseline)
        store.temporal.getState().resume()
      }
      active = p
      baseline = store.getState().document
      store.temporal.getState().pause()
    },
    move(clientX: number) {
      if (!active) return
      const bp = store.getState().activeBreakpoint
      const delta = snapSpanDelta(clientX - active.startX, active.colWidthPx, active.leftSpan, active.rightSpan)
      store.getState().setDocument(resizeSpanOp(baseline, active.leftId, active.rightId, delta, bp))
    },
    end() {
      if (!active) return
      const final = store.getState().document
      if (final !== baseline) store.getState().setDocument(baseline) // restore (still paused)
      store.temporal.getState().resume()
      if (final !== baseline) store.getState().setDocument(final) // one tracked transition
      active = null
    },
    cancel() {
      if (!active) return
      if (store.getState().document !== baseline) store.getState().setDocument(baseline)
      store.temporal.getState().resume()
      active = null
    },
    nudge(leftId: string, rightId: string, dir: 1 | -1) {
      store.getState().resizeSpan(leftId, rightId, dir)
    },
    resizeTo(leftId: string, rightId: string, targetLeftSpan: number) {
      const bp = store.getState().activeBreakpoint
      const cur = resolveBp(findBlock(store.getState().document, leftId)?.layout?.span, bp, 12)
      store.getState().resizeSpan(leftId, rightId, targetLeftSpan - cur)
    },
  }
}

export type SpanDragController = ReturnType<typeof createSpanDragController>

/** React binding: one controller per layer, window pointer/keydown listeners installed per drag. */
export function useSpanDrag(): {
  onSeamPointerDown: (e: React.PointerEvent, p: Omit<SeamParams, 'startX'>) => void
  controller: SpanDragController
} {
  const [controller] = useState(() => createSpanDragController())

  const onSeamPointerDown = (e: React.PointerEvent, p: Omit<SeamParams, 'startX'>) => {
    e.preventDefault()
    e.stopPropagation() // don't let the seam pointerdown reach canvas click-select
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // setPointerCapture unsupported (e.g. jsdom) — window listeners still cover the normal path
    }
    controller.begin({ ...p, startX: e.clientX })
    const move = (ev: PointerEvent) => controller.move(ev.clientX)
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', key, true)
    }
    const up = () => {
      controller.end()
      cleanup()
    }
    const onCancel = () => {
      controller.cancel()
      cleanup()
    }
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation() // beat Radix Dialog onEscapeKeyDown while a seam drag is live
        controller.cancel()
        cleanup()
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', onCancel)
    // capture phase: fire BEFORE Radix Dialog's document-level Escape handler so our
    // stopPropagation actually prevents the modal from closing mid-drag (bubble is too late).
    window.addEventListener('keydown', key, true)
  }

  return { onSeamPointerDown, controller }
}
