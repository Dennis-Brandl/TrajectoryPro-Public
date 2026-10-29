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
//
// Live workflow diagram (spec 2026-08-19 §3.3) — a port of the free Runtime's
// WorkflowGraph (TrajectoryRuntime/engines/web-ui/src/components/screens/
// WorkflowGraph.tsx) onto the Pilot's DiagramSpec payload. Kept verbatim:
// editor node geometry, notation shapes (flowchart/BPMN/ISA-88), the editor-
// faithful waypoint routing (calculatePathPoints), zoom/pan mechanics.
// Changed: fallbackLayout dropped (projectSpec guarantees positions);
// CoordinatorSnapshot replaced by a precomputed state map; CSS module → .wf-*
// rules; hover tooltip → tap reporting (the screen renders the tooltip); the
// Runtime's reset-on-slide-active effect → resetKey (zoom survives tab
// switches, resets on instance/level change). Added: name labels (inside rect
// steps, under the rest — tablets have no hover), state glyph badges, and the "mine" accent ring.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DiagramSpec, DiagramStep, Notation } from '../../api/types'
import { colorFor, glyphFor, humaniseState, IDLE_STATE } from './state'
import { wrapLabel } from './label'

const PADDING = 40
const LABEL_ROOM = 18
const DIAMOND_STEP_TYPES = new Set(['SELECT 1', 'WAIT ANY', 'WAIT ALL', 'PARALLEL'])
const CIRCLE_STEP_TYPES = new Set(['START', 'END'])
const TRAPEZOID_STEP_TYPES = new Set(['CATCH', 'RETURN'])
const GATE_STEP_TYPES = new Set(['GATE'])

// Editor node dimensions (flowchart) — positions in the frozen spec assume these
// sizes; rendering at the same scale keeps connections meeting the symbols.
const EDITOR_RECT_W = 120
const EDITOR_RECT_H = 50
const EDITOR_GATEWAY_W = 60
const EDITOR_GATEWAY_H = 60
const EDITOR_CIRCLE_SIZE = 30
const EDITOR_RECT_RX = 4
const EDITOR_CIRCLE_R = 13

function editorNodeSize(stepType: string): { w: number; h: number } {
  if (CIRCLE_STEP_TYPES.has(stepType)) return { w: EDITOR_CIRCLE_SIZE, h: EDITOR_CIRCLE_SIZE }
  if (TRAPEZOID_STEP_TYPES.has(stepType)) return { w: EDITOR_CIRCLE_SIZE, h: EDITOR_CIRCLE_SIZE }
  if (GATE_STEP_TYPES.has(stepType)) return { w: EDITOR_GATEWAY_W, h: EDITOR_GATEWAY_H }
  if (DIAMOND_STEP_TYPES.has(stepType)) return { w: EDITOR_GATEWAY_W, h: EDITOR_GATEWAY_H }
  return { w: EDITOR_RECT_W, h: EDITOR_RECT_H }
}

// Rect steps are drawn 15% narrower than the editor's 120px slot so side-by-side
// steps get a visible gutter (Designer lays them out flush). Positions, centers, and
// top/bottom handles keep the editor scale — the frozen spec's x/y assume it — so
// only the drawn box, its ring, and the side (BPMN) handles narrow.
const RECT_DRAW_W = 102 // EDITOR_RECT_W × 0.85

function drawnNodeSize(stepType: string): { w: number; h: number } {
  const size = editorNodeSize(stepType)
  return size.w === EDITOR_RECT_W ? { w: RECT_DRAW_W, h: size.h } : size
}

// Spec §5.7 (P1d-R4/R5): names sit INSIDE rect steps on a surface-coloured plate, so the text
// is the tested text-on-surface contrast pair whatever the state fill; the fill still shows
// as a 12 px band above the plate and a 4 px frame round it. Diamonds, circles, trapezoids
// and gates are too small to hold a name and keep it underneath. Every rect, diamond and
// gate also wears its state glyph in a corner badge (circles and trapezoids are too small).
const PLATE_TOP = 12
const PLATE_INSET = 4
const LABEL_LINE = 13
const LABEL_CHARS = 15
const BADGE_R = 8
// Widest a label line may draw: the plate less 2 px each side.
const LABEL_FIT = RECT_DRAW_W - PLATE_INSET * 2 - 4

function isRectStep(stepType: string): boolean {
  return !CIRCLE_STEP_TYPES.has(stepType) && !TRAPEZOID_STEP_TYPES.has(stepType)
    && !GATE_STEP_TYPES.has(stepType) && !DIAMOND_STEP_TYPES.has(stepType)
}

function hasBadge(stepType: string): boolean {
  return !CIRCLE_STEP_TYPES.has(stepType) && !TRAPEZOID_STEP_TYPES.has(stepType)
}

function nodeLabel(step: DiagramStep): React.ReactElement {
  const { cx } = stepCenter(step)
  const { w, h } = drawnNodeSize(step.stepType)
  const plateH = h - PLATE_TOP - PLATE_INSET
  const lines = wrapLabel(step.name, LABEL_CHARS, 2)
  const firstBaseline = step.y + PLATE_TOP + plateH / 2 + 4 - ((lines.length - 1) * LABEL_LINE) / 2
  return (
    <>
      <rect
        className="wf-node-plate"
        x={cx - w / 2 + PLATE_INSET} y={step.y + PLATE_TOP} width={w - PLATE_INSET * 2} height={plateH} rx={2}
        fill="var(--pilot-surface-raised)" pointerEvents="none"
      />
      <text x={cx} y={firstBaseline} textAnchor="middle" fontSize={11} fill="var(--pilot-text)" pointerEvents="none">
        {lines.map((line, i) => (
          <tspan key={i} className="wf-label-line" x={cx} dy={i === 0 ? 0 : LABEL_LINE}>
            {line}
          </tspan>
        ))}
      </text>
    </>
  )
}

function stateBadge(step: DiagramStep, state: string): React.ReactElement {
  const { cx } = stepCenter(step)
  const { w } = drawnNodeSize(step.stepType)
  const bx = cx + w / 2 - BADGE_R / 2
  const by = step.y + BADGE_R / 2
  return (
    <g className="wf-badge" pointerEvents="none">
      <circle cx={bx} cy={by} r={BADGE_R} fill="var(--pilot-surface-raised)" stroke="var(--pilot-border-strong)" strokeWidth={1} />
      <text className="wf-badge-glyph" x={bx} y={by + 4} textAnchor="middle" fontSize={11} fill="var(--pilot-text)">
        {glyphFor(state)}
      </text>
    </g>
  )
}

function stepCenter(step: DiagramStep): { cx: number; cy: number } {
  const { w, h } = editorNodeSize(step.stepType)
  return { cx: step.x + w / 2, cy: step.y + h / 2 }
}

function computeViewBox(steps: DiagramStep[]): { x: number; y: number; w: number; h: number } {
  if (steps.length === 0) return { x: 0, y: 0, w: 400, h: 300 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const step of steps) {
    const { w, h } = editorNodeSize(step.stepType)
    if (step.x < minX) minX = step.x
    if (step.y < minY) minY = step.y
    if (step.x + w > maxX) maxX = step.x + w
    if (step.y + h + LABEL_ROOM > maxY) maxY = step.y + h + LABEL_ROOM
  }
  return { x: minX - PADDING, y: minY - PADDING, w: maxX - minX + PADDING * 2, h: maxY - minY + PADDING * 2 }
}

// ── Editor-faithful waypoint routing — verbatim port (see the Runtime original
//    and TrajectoryEditor/docs/specs/07-connection-waypoint-routing.md) ──
const ROUTE_OFFSET = 5
const ROUTE_TURN = 20
const ROUTE_NODE_CLEARANCE_V = 30
const ROUTE_NODE_CLEARANCE_H = 50

function sourceHandlePos(
  step: DiagramStep, sourceHandleId: string | null, notation: Notation,
): { x: number; y: number } {
  const { w, h } = editorNodeSize(step.stepType)
  if (notation === 'bpmn') return { x: step.x + w / 2 + drawnNodeSize(step.stepType).w / 2, y: step.y + h / 2 }
  if (step.stepType === 'YES_NO' && sourceHandleId === 'yes') return { x: step.x + 40, y: step.y + h }
  if (step.stepType === 'YES_NO' && sourceHandleId === 'no') return { x: step.x + 80, y: step.y + h }
  return { x: step.x + w / 2, y: step.y + h }
}

function targetHandlePos(step: DiagramStep, notation: Notation): { x: number; y: number } {
  const { w, h } = editorNodeSize(step.stepType)
  if (notation === 'bpmn') return { x: step.x + w / 2 - drawnNodeSize(step.stepType).w / 2, y: step.y + h / 2 }
  return { x: step.x + w / 2, y: step.y }
}

function calculatePathPoints(
  sourceX: number, sourceY: number, targetX: number, targetY: number,
  isVerticalFlow: boolean, waypoints: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [{ x: sourceX, y: sourceY }]
  const wpX = waypoints[0]?.x ?? 0
  const wpY = waypoints[0]?.y ?? 0

  if (isVerticalFlow) {
    if (targetY < sourceY) {
      const routeX = Math.max(sourceX, targetX) + ROUTE_NODE_CLEARANCE_H + wpX
      points.push({ x: sourceX, y: sourceY + ROUTE_TURN })
      points.push({ x: routeX, y: sourceY + ROUTE_TURN })
      points.push({ x: routeX, y: targetY - ROUTE_TURN })
      points.push({ x: targetX, y: targetY - ROUTE_TURN })
    } else {
      const dy = Math.abs(targetY - sourceY)
      const dx = Math.abs(targetX - sourceX)
      if (dy > 5 && dx > 5) {
        const midY = (sourceY + targetY) / 2 + wpY
        points.push({ x: sourceX, y: midY })
        points.push({ x: targetX, y: midY })
      } else {
        const nearY = sourceY + ROUTE_OFFSET
        points.push({ x: sourceX, y: nearY })
        points.push({ x: targetX, y: nearY })
      }
    }
  } else {
    if (targetX < sourceX) {
      const routeY = Math.max(sourceY, targetY) + ROUTE_NODE_CLEARANCE_V + wpY
      points.push({ x: sourceX + ROUTE_TURN, y: sourceY })
      points.push({ x: sourceX + ROUTE_TURN, y: routeY })
      points.push({ x: targetX - ROUTE_TURN, y: routeY })
      points.push({ x: targetX - ROUTE_TURN, y: targetY })
    } else {
      const dx = Math.abs(targetX - sourceX)
      const dy = Math.abs(targetY - sourceY)
      if (dx > 5 && dy > 5) {
        const midX = (sourceX + targetX) / 2 + wpX
        points.push({ x: midX, y: sourceY })
        points.push({ x: midX, y: targetY })
      } else {
        const nearX = sourceX + ROUTE_OFFSET
        points.push({ x: nearX, y: sourceY })
        points.push({ x: nearX, y: targetY })
      }
    }
  }

  points.push({ x: targetX, y: targetY })
  return points
}

function pointsToPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
}

// ── Shape helpers (fill/stroke applied per state; tap/ring handled by the <g>) ──

/** Timed GATE mark (spec 2026-10-13 §4.4): a small clock — face + hour and minute hands. Mirrors MissionCommander's runtime WorkflowGraph. */
function clockMark(cx: number, cy: number, r: number, color: string, opacity: number): React.ReactElement {
  return (
    <g data-testid="gate-clock" opacity={opacity}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1} />
      <line x1={cx} y1={cy} x2={cx} y2={cy - r * 0.7} stroke={color} strokeWidth={1} />
      <line x1={cx} y1={cy} x2={cx + r * 0.6} y2={cy} stroke={color} strokeWidth={1} />
    </g>
  )
}

function shapeFor(step: DiagramStep, notation: Notation, fill: string, opacity: number, stroke: string, strokeW: number, dashed: boolean): React.ReactElement {
  const common = {
    fill, opacity,
    stroke: strokeW > 0 ? stroke : 'none',
    strokeWidth: strokeW,
    strokeDasharray: dashed ? '6 4' : undefined,
  }
  const { cx, cy } = stepCenter(step)
  const { w, h } = editorNodeSize(step.stepType)

  if (CIRCLE_STEP_TYPES.has(step.stepType)) {
    if (notation === 'isa88') {
      const r = EDITOR_CIRCLE_SIZE / 2
      const points = step.stepType === 'START'
        ? `${cx - r},${cy - r} ${cx + r},${cy - r} ${cx},${cy + r}`   // inverted triangle
        : `${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`   // upright triangle
      return <polygon points={points} {...common} />
    }
    return <circle cx={cx} cy={cy} r={EDITOR_CIRCLE_R} {...common} />
  }

  if (TRAPEZOID_STEP_TYPES.has(step.stepType)) {
    const r = EDITOR_CIRCLE_SIZE / 2
    const x = cx - r
    const y = cy - r
    const local: Array<[number, number]> = step.stepType === 'CATCH'
      ? [[0, 0], [30, 0], [23, 30], [7, 30]]
      : [[7, 0], [23, 0], [30, 30], [0, 30]]
    const points = local.map(([dx, dy]) => `${x + dx},${y + dy}`).join(' ')
    const rotate = notation === 'bpmn' ? `rotate(-90 ${cx} ${cy})` : undefined
    return <polygon points={points} transform={rotate} {...common} />
  }

  if (GATE_STEP_TYPES.has(step.stepType)) {
    if (notation === 'isa88') {
      // Narrow double bar (the SFC transition mark), centered in the gateway slot, with thin
      // centre-line stems running from the slot's top/bottom connection points to the bars —
      // derived from the 60×60 gateway slot every notation uses here, not Designer's per-notation
      // ISA-88 size. No text at this scale (illegible). The stems pick up the same state
      // stroke as the bars (so a highlighted/EXECUTING gate outlines its stems too), at half
      // the bars' stroke width — they're a connector mark, not the transition mark itself.
      const stemStroke = strokeW > 0 ? stroke : fill
      const stemStrokeWidth = strokeW > 0 ? Math.max(1, strokeW / 2) : 1
      return (
        <g>
          <line x1={cx} y1={cy - EDITOR_GATEWAY_H / 2} x2={cx} y2={cy - 6} stroke={stemStroke} strokeWidth={stemStrokeWidth} opacity={opacity} />
          <line x1={cx} y1={cy + 6} x2={cx} y2={cy + EDITOR_GATEWAY_H / 2} stroke={stemStroke} strokeWidth={stemStrokeWidth} opacity={opacity} />
          <rect x={cx - 20} y={cy - 6} width={40} height={4} {...common} />
          <rect x={cx - 20} y={cy + 2} width={40} height={4} {...common} />
          {step.timedGate && clockMark(cx + 26, cy, 3.5, stemStroke, opacity)}
        </g>
      )
    }
    const hw = notation === 'bpmn' ? 20 : 30
    const hh = notation === 'bpmn' ? 25 : 30
    // Parallel bars sit in the upper half so the "GATE" caption fits below them, inside the
    // diamond — same glyph token as the caption text, deliberately not the state fill.
    const bars = notation === 'bpmn'
      ? <>
          <rect x={cx - 6} y={cy - 15} width={3} height={12} fill="var(--pilot-diagram-glyph)" opacity={opacity} />
          <rect x={cx + 3} y={cy - 15} width={3} height={12} fill="var(--pilot-diagram-glyph)" opacity={opacity} />
        </>
      : <>
          <rect x={cx - 10} y={cy - 9.5} width={20} height={3} fill="var(--pilot-diagram-glyph)" opacity={opacity} />
          <rect x={cx - 10} y={cy - 2.5} width={20} height={3} fill="var(--pilot-diagram-glyph)" opacity={opacity} />
        </>
    return (
      <g>
        <polygon points={`${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`} {...common} />
        {bars}
        <text
          x={cx} y={cy + (notation === 'bpmn' ? 10 : 12)} textAnchor="middle"
          fontSize={notation === 'bpmn' ? 6 : 8} fill="var(--pilot-diagram-glyph)" opacity={opacity}
        >
          GATE
        </text>
        {step.timedGate && (notation === 'bpmn'
          ? clockMark(cx, cy + 17, 3, 'var(--pilot-diagram-glyph)', opacity)
          : clockMark(cx, cy - 18, 4, 'var(--pilot-diagram-glyph)', opacity))}
      </g>
    )
  }

  if (DIAMOND_STEP_TYPES.has(step.stepType)) {
    const hw = w / 2
    const hh = h / 2
    return <polygon points={`${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`} {...common} />
  }

  const dw = drawnNodeSize(step.stepType).w
  return <rect x={cx - dw / 2} y={cy - h / 2} width={dw} height={h} rx={EDITOR_RECT_RX} {...common} />
}

export interface WorkflowGraphProps {
  spec: DiagramSpec
  states: ReadonlyMap<string, string>
  mineOids: ReadonlySet<string>
  highlightedStepOid: string | null
  resetKey: string
  onStepTap(step: DiagramStep, anchor: { x: number; y: number }): void
}

export function WorkflowGraph({ spec, states, mineOids, highlightedStepOid, resetKey, onStepTap }: WorkflowGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const notation = spec.notation

  const baseVB = useMemo(() => computeViewBox(spec.steps), [spec])

  // Zoom/pan in refs (the Runtime's performance pattern): pan updates re-write the
  // viewBox attribute directly instead of re-rendering the node tree.
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const [, forceRender] = useState(0)

  const getViewBox = useCallback(() => {
    const z = zoomRef.current
    const p = panRef.current
    const w = baseVB.w / z
    const h = baseVB.h / z
    const cx = baseVB.x + baseVB.w / 2 + p.x
    const cy = baseVB.y + baseVB.h / 2 + p.y
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`
  }, [baseVB])

  const applyViewBox = useCallback(() => {
    svgRef.current?.setAttribute('viewBox', getViewBox())
  }, [getViewBox])

  const zoomBy = useCallback((factor: number) => {
    // P1d-R3: never below natural size, so 11 px labels never render smaller. Snap to exactly
    // 1: float drift (1.0000000000000002) would otherwise re-enable drag-pan and Zoom out there.
    const z = Math.min(3, Math.max(1, zoomRef.current * factor))
    zoomRef.current = Math.abs(z - 1) < 1e-6 ? 1 : z
    applyViewBox()
    forceRender((n) => n + 1)
  }, [applyViewBox])

  const zoom = useCallback((direction: 1 | -1) => zoomBy(direction === 1 ? 1.3 : 1 / 1.3), [zoomBy])

  const resetZoom = useCallback(() => {
    zoomRef.current = 1
    panRef.current = { x: 0, y: 0 }
    applyViewBox()
    forceRender((n) => n + 1)
  }, [applyViewBox])

  // Zoom/pan reset on instance/level change ONLY — never on tab switches (spec §3.3:
  // panes stay mounted; the operator's zoom must survive a trip to a task pane).
  useEffect(() => {
    zoomRef.current = 1
    panRef.current = { x: 0, y: 0 }
    applyViewBox()
    forceRender((n) => n + 1)
  }, [resetKey, applyViewBox])

  const dragState = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (zoomRef.current <= 1) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragState.current = {
      startX: e.clientX, startY: e.clientY,
      startPanX: panRef.current.x, startPanY: panRef.current.y,
    }
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const scaleX = (baseVB.w / zoomRef.current) / rect.width
    const scaleY = (baseVB.h / zoomRef.current) / rect.height
    panRef.current = {
      x: dragState.current.startPanX - (e.clientX - dragState.current.startX) * scaleX,
      y: dragState.current.startPanY - (e.clientY - dragState.current.startY) * scaleY,
    }
    requestAnimationFrame(applyViewBox)
  }, [baseVB, applyViewBox])

  const onPointerUp = useCallback(() => { dragState.current = null }, [])

  // Spec §5.7 (Review Focus 5): only Ctrl/⌘+wheel zooms (a trackpad pinch arrives as
  // ctrl+wheel); a plain wheel scrolls the diagram's box like any page. Native and
  // non-passive: React's onWheel is passive, so its preventDefault could not stop the
  // browser zooming the whole page.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      // In proportion to the gesture (final review): a pinch sends dozens of small deltas, and a
      // fixed 1.3 step per event jumped straight from 1x to 3x. One 100 px mouse notch ≈ 1.28x.
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
      zoomBy(Math.exp(-px * 0.0025))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  // Final review: wrapping counts characters, but capitals and wide theme fonts outgrow the
  // budget — squeeze any line that measures wider than the plate (the 11 px height stays).
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    for (const line of Array.from(svg.querySelectorAll<SVGTSpanElement>('tspan.wf-label-line'))) {
      line.removeAttribute('textLength')
      line.removeAttribute('lengthAdjust')
      if (typeof line.getComputedTextLength !== 'function') continue
      if (line.getComputedTextLength() > LABEL_FIT) {
        line.setAttribute('textLength', String(LABEL_FIT))
        line.setAttribute('lengthAdjust', 'spacingAndGlyphs')
      }
    }
  }, [spec])

  const tap = useCallback((step: DiagramStep) => (e: React.MouseEvent) => {
    const base = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const rect = (e.currentTarget as Element).getBoundingClientRect()
    onStepTap(step, { x: rect.left + rect.width / 2 - base.left, y: rect.top - base.top - 8 })
  }, [onStepTap])

  const stepByOid = useMemo(() => new Map(spec.steps.map((s) => [s.oid, s])), [spec])
  const isZoomed = zoomRef.current > 1.05
  const isVerticalFlow = notation !== 'bpmn'

  return (
    <div className="wf-graph" ref={containerRef}>
      <div className="wf-graph-scroll">
        <svg
          ref={svgRef}
          className="wf-graph-svg"
          viewBox={getViewBox()}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ touchAction: isZoomed ? 'none' : 'pan-x pan-y', minWidth: baseVB.w, minHeight: baseVB.h }}
          role="img"
          aria-label={`Workflow diagram: ${spec.name}`}
        >
          {spec.connections.map((conn, i) => {
            const from = stepByOid.get(conn.fromStepOid)
            const to = stepByOid.get(conn.toStepOid)
            if (!from || !to) return null
            const src = sourceHandlePos(from, conn.sourceHandleId, notation)
            const tgt = targetHandlePos(to, notation)
            const points = calculatePathPoints(src.x, src.y, tgt.x, tgt.y, isVerticalFlow, conn.waypoints ?? [])
            return <path key={`edge-${i}`} d={pointsToPath(points)} stroke="var(--pilot-diagram-edge)" strokeWidth={2} fill="none" />
          })}

          {spec.steps.map((step) => {
            const state = states.get(step.oid) ?? IDLE_STATE
            const visual = colorFor(state)
            const mine = mineOids.has(step.oid)
            const highlighted = step.oid === highlightedStepOid
            const stroke = highlighted ? 'var(--pilot-diagram-highlight)' : (visual.stroke ?? 'none')
            const strokeW = highlighted ? 4 : (visual.strokeWidth ?? 0)
            const { w: dw, h } = drawnNodeSize(step.stepType)
            const { cx } = stepCenter(step)
            return (
              <g
                key={step.oid}
                data-step-oid={step.oid}
                data-step-name={step.name}
                data-state={state}
                data-mine={mine ? 'true' : undefined}
                onClick={tap(step)}
                style={{ cursor: 'pointer' }}
              >
                <title>{`${step.name}: ${humaniseState(state)}`}</title>
                {mine && (
                  <rect
                    x={cx - dw / 2 - 5} y={step.y - 5} width={dw + 10} height={h + 10} rx={8}
                    fill="none" stroke="var(--pilot-mine-ring)" strokeWidth={3}
                    pointerEvents="none"
                  />
                )}
                {shapeFor(step, notation, visual.fill, visual.opacity ?? 1, stroke, strokeW, visual.dashed ?? false)}
                {isRectStep(step.stepType) && nodeLabel(step)}
                {!isRectStep(step.stepType) && !GATE_STEP_TYPES.has(step.stepType) && (
                  <text
                    x={cx} y={step.y + h + 13} textAnchor="middle" fontSize={11}
                    fill="var(--pilot-text-muted)" pointerEvents="none"
                  >
                    {wrapLabel(step.name, 20, 1)[0]}
                  </text>
                )}
                {hasBadge(step.stepType) && stateBadge(step, state)}
              </g>
            )
          })}
        </svg>
      </div>

      <div className="wf-zoom">
        <button type="button" className="wf-zoom-btn" onClick={() => zoom(1)} aria-label="Zoom in">+</button>
        <button type="button" className="wf-zoom-btn" onClick={() => zoom(-1)} disabled={zoomRef.current <= 1} aria-label="Zoom out">−</button>
        <button type="button" className="wf-zoom-btn" onClick={resetZoom} aria-label="Reset zoom">⟲</button>
      </div>
    </div>
  )
}
