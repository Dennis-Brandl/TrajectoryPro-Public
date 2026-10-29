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
import { type RefObject, useEffect, useMemo, useReducer, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { GripVertical } from 'lucide-react'
import type { Block } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { resolveBp } from '@/lib/form-document/layout-ops'
import { useRectMap, type Rect } from './useRectMap'
import { useSpanDrag, type SpanDragController } from './useSpanDrag'
import { blockDragId, rowDragId, gapDropId, slotDropId, barDropId } from './dragTypes'

// §14.4 hover-gating: grips + seams are revealed only on hover/focus/active-resize of their row,
// so the canvas stays visually quiet until the user shows structural intent. Kept as a pure
// function (no store/DOM) so the reveal predicate is unit-testable without mounting the layer.
export interface RevealState {
  hoveredRowId: string | null
  focusedRowId: string | null
  resizingRowId: string | null
}
export function isRowRevealed(rowId: string, s: RevealState): boolean {
  return rowId === s.hoveredRowId || rowId === s.focusedRowId || rowId === s.resizingRowId
}

/** Id of the row whose vertical band contains `y`, or null. `y` MUST be host-relative — the same
 *  coordinate system as the rect-map — because rect-map rects are host-relative, not viewport. */
export function rowIdAtY(rows: readonly { id: string; rect: Rect }[], y: number): string | null {
  const hit = rows.find((r) => y >= r.rect.top && y <= r.rect.top + r.rect.height)
  return hit ? hit.id : null
}

function Grip({
  id,
  style,
  label,
  visible,
  rowId,
  onFocusRow,
  onBlurRow,
}: {
  id: string
  style: React.CSSProperties
  label: string
  visible: boolean
  rowId: string
  onFocusRow: (rowId: string) => void
  onBlurRow: (rowId: string) => void
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id })
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-drag-handle={id}
      aria-label={label}
      title={
        label === 'Drag row'
          ? 'Drag to move this row'
          : 'Drag to move this element; drop it beside another element to put them side by side'
      }
      {...attributes}
      {...listeners}
      onFocus={() => onFocusRow(rowId)}
      onBlur={() => onBlurRow(rowId)}
      style={{
        position: 'absolute',
        pointerEvents: visible ? 'auto' : 'none',
        cursor: 'grab',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        border: 'none',
        background: '#1e293b',
        color: '#fff',
        borderRadius: 4,
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        zIndex: 3,
        opacity: visible ? 1 : 0,
        transition: 'opacity 120ms ease',
        ...style,
      }}
    >
      <GripVertical size={12} />
    </button>
  )
}

const HANDLE = 16
const DROP_MIN = 14 // synthesized min hit-height for a between-row gap (empty rows collapse to 0)
const SEAM_W = 8 // seam hit-target width (px), centered on the block boundary

function SeamHandle({
  leftId,
  rightId,
  leftSpan,
  rightSpan,
  colWidthPx,
  style,
  onSeamPointerDown,
  controller,
  visible,
  rowId,
  onFocusRow,
  onBlurRow,
}: {
  leftId: string
  rightId: string
  leftSpan: number
  rightSpan: number
  colWidthPx: number
  style: React.CSSProperties
  onSeamPointerDown: ReturnType<typeof useSpanDrag>['onSeamPointerDown']
  controller: SpanDragController
  visible: boolean
  rowId: string
  onFocusRow: (rowId: string) => void
  onBlurRow: (rowId: string) => void
}) {
  return (
    <div
      data-seam-handle={`seam:${leftId}:${rightId}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize columns between blocks`}
      title="Drag to change how many columns each side gets (or click, then use the arrow keys)"
      aria-valuemin={Math.max(1, leftSpan + rightSpan - 12)}
      aria-valuemax={Math.min(12, leftSpan + rightSpan - 1)}
      aria-valuenow={leftSpan}
      aria-valuetext={`${leftSpan} of ${leftSpan + rightSpan} columns`}
      tabIndex={0}
      onPointerDown={(e) => onSeamPointerDown(e, { rowId, leftId, rightId, colWidthPx, leftSpan, rightSpan })}
      onFocus={() => onFocusRow(rowId)}
      onBlur={() => onBlurRow(rowId)}
      onKeyDown={(e) => {
        const total = leftSpan + rightSpan
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          controller.nudge(leftId, rightId, 1)
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          controller.nudge(leftId, rightId, -1)
        } else if (e.key === 'Home') {
          e.preventDefault()
          controller.resizeTo(leftId, rightId, 1)
        } else if (e.key === 'End') {
          e.preventDefault()
          controller.resizeTo(leftId, rightId, total - 1)
        }
      }}
      style={{
        position: 'absolute',
        pointerEvents: visible ? 'auto' : 'none',
        cursor: 'col-resize',
        zIndex: 3,
        opacity: visible ? 1 : 0,
        transition: 'opacity 120ms ease',
        ...style,
      }}
    />
  )
}

function seamStyle(_leftRect: Rect, rightRect: Rect, rowRect: Rect): React.CSSProperties {
  return { left: rightRect.left - SEAM_W / 2, top: rowRect.top, width: SEAM_W, height: rowRect.height }
}

function GapZone({ id, style }: { id: string; style: React.CSSProperties }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} data-drop-zone={id} style={{ position: 'absolute', pointerEvents: 'none', ...style }}>
      {isOver && (
        <>
          {/* ghost band: shows the new row that a drop here would create */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              height: 22,
              background: 'rgba(37, 99, 235, 0.12)',
              border: '1px dashed #2563eb',
              borderRadius: 4,
            }}
          />
          {/* insertion line */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '50%',
              height: 4,
              marginTop: -2,
              background: '#2563eb',
              borderRadius: 2,
              boxShadow: '0 0 6px rgba(37, 99, 235, 0.6)',
            }}
          />
        </>
      )}
    </div>
  )
}

/** The whole bottom-bar band. Overlaps the bar's gaps and slots, which win (preferPreciseZones);
 *  a drop here lands beside the bar's last button. */
function BarZone({ id, style }: { id: string; style: React.CSSProperties }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} data-drop-zone={id} style={{ position: 'absolute', pointerEvents: 'none', ...style }}>
      {isOver && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(37, 99, 235, 0.08)',
            outline: '2px dashed #2563eb',
            outlineOffset: -2,
            borderRadius: 4,
          }}
        />
      )}
    </div>
  )
}

function SlotZone({ id, style }: { id: string; style: React.CSSProperties }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} data-drop-zone={id} style={{ position: 'absolute', pointerEvents: 'none', ...style }}>
      {isOver && (
        <>
          {/* ghost column: shows the slot in the row a drop here would join */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 26,
              background: 'rgba(124, 58, 237, 0.12)',
              border: '1px dashed #7c3aed',
              borderRadius: 4,
            }}
          />
          {/* insertion line */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '50%',
              width: 4,
              marginLeft: -2,
              background: '#7c3aed',
              borderRadius: 2,
              boxShadow: '0 0 6px rgba(124, 58, 237, 0.6)',
            }}
          />
        </>
      )}
    </div>
  )
}

export function StructuralDragLayer({ hostRef }: { hostRef: RefObject<HTMLDivElement | null> }) {
  const document_ = useFormDocumentStore((s) => s.document)
  const breakpoint = useFormDocumentStore((s) => s.activeBreakpoint)
  // hostRef is attached by an ancestor (the canvas host div), and React commits a host node's
  // ref during its OWN layout phase, which runs after all of its descendants' layout effects
  // (children-first commit order). So useRectMap's layout effect — which lives one level down,
  // in this component — sees a null host on the very first pass and bails before it can even
  // register the ResizeObserver, leaving the map empty forever with nothing to self-heal it.
  // A passive effect fires once the whole tree's layout phase (incl. the ancestor's ref attach)
  // has finished, so bumping a tick from it and folding that into useRectMap's deps forces the
  // one extra remeasure pass that picks up the now-attached host.
  const [mountTick, bumpMountTick] = useReducer((c: number) => c + 1, 0)
  useEffect(() => bumpMountTick(), [])
  const map = useRectMap(hostRef, [document_, breakpoint, mountTick])

  // §14.4 hover-gating: track the hovered row from raw pointer position against the rect-map (rAF
  // throttled so a fast mousemove stream doesn't thrash React state), plus keyboard-focus tracking
  // for the a11y path. `resizingRowId` (below, from the span-drag controller) is best-effort — a
  // controller field read doesn't itself trigger a re-render — but the pointer stays over the row
  // for the whole drag, so `hoveredRowId` already keeps the row revealed while resizing.
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null)
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let raf = 0
    const onMove = (e: PointerEvent) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        // rect-map rects are HOST-RELATIVE; the pointer's clientY is VIEWPORT-relative. Convert
        // before hit-testing — otherwise (host offset below the viewport top) no row ever matches
        // and grips/seams never reveal. jsdom zero-rects hide this; only a real browser catches it.
        const y = e.clientY - host.getBoundingClientRect().top
        setHoveredRowId(
          rowIdAtY(
            map.sections.flatMap((s) => s.rows),
            y,
          ),
        )
      })
    }
    const onLeave = () => setHoveredRowId(null)
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(raf)
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
    }
  }, [hostRef, map])

  const { onSeamPointerDown, controller } = useSpanDrag()
  const blockById = useMemo(() => {
    const m = new Map<string, Block>()
    document_.sections.forEach((s) => s.rows.forEach((r) => r.blocks.forEach((b) => m.set(b.id, b))))
    return m
  }, [document_])

  const onFocusRow = (rowId: string) => setFocusedRowId(rowId)
  const onBlurRow = (rowId: string) => setFocusedRowId((cur) => (cur === rowId ? null : cur))
  const reveal: RevealState = { hoveredRowId, focusedRowId, resizingRowId: controller.activeRowId }
  const revealedRowId = (rowId: string) => isRowRevealed(rowId, reveal)

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>
      {map.sections.flatMap((section) => {
        const zones: React.ReactNode[] = []
        if (section.role === 'footer') {
          const { left, top, width, height } = section.rect
          zones.push(
            <BarZone key={barDropId(section.id)} id={barDropId(section.id)} style={{ left, top, width, height }} />,
          )
        }
        // gap above the first row
        zones.push(
          <GapZone
            key={gapDropId(section.id, null)}
            id={gapDropId(section.id, null)}
            style={gapStyleTop(section, section.rows[0])}
          />,
        )
        section.rows.forEach((row, i) => {
          // gap after this row
          zones.push(
            <GapZone
              key={gapDropId(section.id, row.id)}
              id={gapDropId(section.id, row.id)}
              style={gapStyleAfter(row, section.rows[i + 1])}
            />,
          )
          // beside-slots before each block + trailing @end — skipped once the row is full (12 blocks):
          // a 13th single-column block cannot fit and apportioning would emit an invalid span (spec §4.4).
          if (row.blocks.length < 12) {
            row.blocks.forEach((b) => {
              zones.push(
                <SlotZone
                  key={slotDropId(row.id, b.id)}
                  id={slotDropId(row.id, b.id)}
                  style={slotStyleBefore(b.rect)}
                />,
              )
            })
            zones.push(
              <SlotZone key={slotDropId(row.id, null)} id={slotDropId(row.id, null)} style={slotStyleEnd(row.rect)} />,
            )
          }
        })
        return zones
      })}
      {map.sections.flatMap((section) =>
        section.rows.flatMap((row) => [
          <Grip
            key={rowDragId(row.id)}
            id={rowDragId(row.id)}
            label="Drag row"
            style={rowGripStyle(row.rect)}
            visible={revealedRowId(row.id)}
            rowId={row.id}
            onFocusRow={onFocusRow}
            onBlurRow={onBlurRow}
          />,
          ...row.blocks.map((b) => (
            <Grip
              key={blockDragId(b.id)}
              id={blockDragId(b.id)}
              label="Drag block"
              style={blockGripStyle(b.rect)}
              visible={revealedRowId(row.id)}
              rowId={row.id}
              onFocusRow={onFocusRow}
              onBlurRow={onBlurRow}
            />
          )),
        ]),
      )}
      {map.sections.flatMap((section) =>
        section.rows.flatMap((row) =>
          row.blocks.slice(0, -1).map((b, i) => {
            const right = row.blocks[i + 1]
            const leftSpan = resolveBp(blockById.get(b.id)?.layout?.span, breakpoint, 12)
            const rightSpan = resolveBp(blockById.get(right.id)?.layout?.span, breakpoint, 12)
            const pairW = right.rect.left + right.rect.width - b.rect.left
            return (
              <SeamHandle
                key={`seam:${b.id}:${right.id}`}
                leftId={b.id}
                rightId={right.id}
                leftSpan={leftSpan}
                rightSpan={rightSpan}
                colWidthPx={pairW / (leftSpan + rightSpan)}
                style={seamStyle(b.rect, right.rect, row.rect)}
                onSeamPointerDown={onSeamPointerDown}
                controller={controller}
                visible={revealedRowId(row.id)}
                rowId={row.id}
                onFocusRow={onFocusRow}
                onBlurRow={onBlurRow}
              />
            )
          }),
        ),
      )}
    </div>
  )
}

function blockGripStyle(rect: Rect): React.CSSProperties {
  return { left: rect.left - HANDLE / 2, top: rect.top - HANDLE / 2, width: HANDLE, height: HANDLE }
}
function rowGripStyle(rect: Rect): React.CSSProperties {
  return { left: rect.left - HANDLE - 4, top: rect.top + rect.height / 2 - HANDLE / 2, width: HANDLE, height: HANDLE }
}

/** An empty section (the bottom-bar placeholder) gets its whole band as the drop target, so a drop
 *  anywhere on "drag buttons here" lands; otherwise a thin gap straddles the first row's top. */
export function gapStyleTop(section: { rect: Rect }, firstRow?: { rect: Rect }): React.CSSProperties {
  if (!firstRow) {
    const { left, top, width, height } = section.rect
    return { left, width, top, height: Math.max(height, DROP_MIN) }
  }
  const top = firstRow.rect.top - DROP_MIN / 2
  return { left: section.rect.left, width: section.rect.width, top, height: DROP_MIN }
}
function gapStyleAfter(row: { rect: Rect }, nextRow?: { rect: Rect }): React.CSSProperties {
  const boundary = nextRow ? (row.rect.top + row.rect.height + nextRow.rect.top) / 2 : row.rect.top + row.rect.height
  return { left: row.rect.left, width: row.rect.width, top: boundary - DROP_MIN / 2, height: DROP_MIN }
}
function slotStyleBefore(rect: Rect): React.CSSProperties {
  return { left: rect.left - 8, top: rect.top, width: 16, height: rect.height }
}
function slotStyleEnd(rowRect: Rect): React.CSSProperties {
  return { left: rowRect.left + rowRect.width - 8, top: rowRect.top, width: 16, height: rowRect.height }
}
