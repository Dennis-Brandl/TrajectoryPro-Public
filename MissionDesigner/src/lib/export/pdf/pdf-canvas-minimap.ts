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

/**
 * Canvas-based minimap renderer for workflow diagrams.
 * Produces PNG images from raw node/edge data without requiring the React Flow DOM.
 *
 * Two public functions:
 * - renderMinimapThumbnail: "You Are Here" thumbnail centered on highlighted node
 * - renderMinimapFullPage: Full-page diagram fitting all nodes
 */

import jsPDF from 'jspdf'
import type { Edge } from '@xyflow/react'
import type { StepNodeData, WorkflowNode } from '@/types/nodes'
import type { Notation } from '@/types/notation'
import { NOTATION_CONFIGS } from '@/components/nodes/renderers/notation-config'
import {
  START_COLOR,
  START_FILL,
  END_COLOR,
  END_FILL,
  GATEWAY_AMBER,
  GATEWAY_FILL,
  PARALLEL_PURPLE,
  PARALLEL_FILL,
  SCRIPT_AMBER,
  DEFAULT_STROKE,
} from '@/components/nodes/renderers/shared/colors'
import { PDF_COLORS } from './pdf-types'

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type NodeShape = 'circle' | 'diamond' | 'roundedRect' | 'horizontalBar' | 'gate'
export type FidelityLevel = 'thumbnail' | 'fullPage'

interface NodeStyle {
  fill: string
  stroke: string
}

export interface BoundsRect {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export interface ViewportTransform {
  offsetX: number
  offsetY: number
  scale: number
}

// ---------------------------------------------------------------------------
// Exported pure logic functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Classify the visual shape for a node type.
 * - start, end → circle
 * - gateStep → gate (all notations, all fidelity levels)
 * - select1, waitAny → diamond (all notations, all fidelity levels)
 * - parallel, waitAll → diamond at thumbnail fidelity or flowchart/BPMN;
 *                       horizontalBar at ISA88 full-page fidelity
 * - all others → roundedRect
 */
export function classifyNodeShape(nodeType: string, fidelity: FidelityLevel, notation: Notation): NodeShape {
  if (nodeType === 'start' || nodeType === 'end') return 'circle'
  if (nodeType === 'gateStep') return 'gate'
  if (nodeType === 'select1' || nodeType === 'waitAny') return 'diamond'
  if (nodeType === 'parallel' || nodeType === 'waitAll') {
    if (fidelity === 'fullPage' && notation === 'isa88') return 'horizontalBar'
    return 'diamond'
  }
  return 'roundedRect'
}

export type Segment = { x1: number; y1: number; x2: number; y2: number }
export type GateGlyph = {
  /** false for ISA-88, whose transition mark has no gateway outline */
  diamond: boolean
  bars: Segment[]
  stems: Segment[]
  caption: { x: number; y: number; fontSize: number } | null
  /** Timed gates (spec 2026-10-13 §4.4): a small clock face; null for a plain gate */
  clock: { cx: number; cy: number; r: number } | null
}

/** The GATE symbol per notation, scaled into the node's box — the same geometry as the
 *  editor's GateNode.tsx (flowchart 60×60 diamond + two horizontal bars in the upper half +
 *  "GATE"; BPMN 40×50 diamond + two vertical bars + a smaller "GATE"; ISA-88 double bar with
 *  centre-line stems to both connection points, no text). Pure so the test suite can pin it
 *  without a canvas (GATE follow-up item 3). The caption is dropped at thumbnail fidelity —
 *  the marks alone distinguish a gate from a plain gateway at that scale. Like every other
 *  surface since the 2026-08-30 amendment, a gate shows no step-name label. */
export function gateGlyph(
  notation: Notation,
  fidelity: FidelityLevel,
  x: number,
  y: number,
  w: number,
  h: number,
  timed = false,
): GateGlyph {
  const cx = x + w / 2
  if (notation === 'isa88') {
    const y1 = y + h * (9 / 24)
    const y2 = y + h * (15 / 24)
    const bx1 = x + w * (10 / 60)
    const bx2 = x + w * (50 / 60)
    return {
      diamond: false,
      bars: [
        { x1: bx1, y1, x2: bx2, y2: y1 },
        { x1: bx1, y1: y2, x2: bx2, y2 },
      ],
      stems: [
        { x1: cx, y1: y, x2: cx, y2: y1 },
        { x1: cx, y1: y2, x2: cx, y2: y + h },
      ],
      caption: null,
      clock: timed ? { cx: x + w * (56 / 60), cy: y + h * (12 / 24), r: Math.min(w / 60, h / 24) * 3.5 } : null,
    }
  }
  if (notation === 'bpmn') {
    const bx1 = x + w * (16 / 40)
    const bx2 = x + w * (24 / 40)
    const top = y + h * (10 / 50)
    const bottom = y + h * (22 / 50)
    return {
      diamond: true,
      bars: [
        { x1: bx1, y1: top, x2: bx1, y2: bottom },
        { x1: bx2, y1: top, x2: bx2, y2: bottom },
      ],
      stems: [],
      caption: fidelity === 'fullPage' ? { x: cx, y: y + h * (35 / 50), fontSize: 6 } : null,
      clock: timed ? { cx, cy: y + h * (42 / 50), r: Math.min(w / 40, h / 50) * 3 } : null,
    }
  }
  const bx1 = x + w * (18 / 60)
  const bx2 = x + w * (42 / 60)
  const y1 = y + h * (22 / 60)
  const y2 = y + h * (29 / 60)
  return {
    diamond: true,
    bars: [
      { x1: bx1, y1, x2: bx2, y2: y1 },
      { x1: bx1, y1: y2, x2: bx2, y2 },
    ],
    stems: [],
    caption: fidelity === 'fullPage' ? { x: cx, y: y + h * (42 / 60), fontSize: 8 } : null,
    clock: timed ? { cx, cy: y + h * (12 / 60), r: Math.min(w / 60, h / 60) * 4 } : null,
  }
}

/**
 * Get the fill/stroke style for a node.
 * - Highlighted nodes always get orange (highest priority)
 * - Thumbnail fidelity: uniform light fill for all non-highlighted nodes (shape distinguishes type)
 * - Full-page fidelity: editor-accurate colors per node type
 */
export function getNodeStyle(nodeType: string, isHighlighted: boolean, fidelity: FidelityLevel): NodeStyle {
  if (isHighlighted) {
    return { fill: PDF_COLORS.ORANGE_FILL, stroke: PDF_COLORS.ORANGE }
  }

  if (fidelity === 'thumbnail') {
    return { fill: '#f8fafc', stroke: DEFAULT_STROKE }
  }

  // Full-page fidelity: editor-accurate colors
  switch (nodeType) {
    case 'start':
      return { fill: START_FILL, stroke: START_COLOR }
    case 'end':
      return { fill: END_FILL, stroke: END_COLOR }
    case 'gateStep':
    case 'select1':
    case 'waitAny':
      return { fill: GATEWAY_FILL, stroke: GATEWAY_AMBER }
    case 'parallel':
    case 'waitAll':
      return { fill: PARALLEL_FILL, stroke: PARALLEL_PURPLE }
    case 'scriptStep':
      return { fill: '#ffffff', stroke: SCRIPT_AMBER }
    default:
      return { fill: '#ffffff', stroke: DEFAULT_STROKE }
  }
}

/**
 * Get the width/height of a node based on its type and the active notation.
 * - start/end: fixed 30x30
 * - gateway types: from NOTATION_CONFIGS[notation].gateway
 * - all others: from NOTATION_CONFIGS[notation].rect, preferring measured dimensions
 */
export function getNodeDimensions(node: WorkflowNode, notation: Notation): { width: number; height: number } {
  const config = NOTATION_CONFIGS[notation]

  if (node.type === 'start' || node.type === 'end') {
    return { width: 30, height: 30 }
  }

  if (
    node.type === 'gateStep' ||
    node.type === 'select1' ||
    node.type === 'waitAny' ||
    node.type === 'parallel' ||
    node.type === 'waitAll'
  ) {
    return { width: config.gateway.width, height: config.gateway.height }
  }

  // For rect nodes, prefer measured dimensions if available
  const width = node.measured?.width ?? config.rect.width
  const height = node.measured?.height ?? config.rect.height
  return { width, height }
}

/**
 * Compute the bounding box that encompasses all nodes.
 * Returns zero-size bounds for empty arrays.
 */
export function computeBounds(nodes: WorkflowNode[], notation: Notation): BoundsRect {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    const { width, height } = getNodeDimensions(node, notation)
    const x = node.position.x
    const y = node.position.y
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/**
 * Compute a viewport transform that fits the given bounds into the canvas
 * with the specified padding, centered.
 */
export function computeViewport(
  bounds: BoundsRect,
  canvasWidth: number,
  canvasHeight: number,
  padding: number,
): ViewportTransform {
  if (bounds.width === 0 || bounds.height === 0) {
    return { offsetX: 0, offsetY: 0, scale: 1 }
  }

  const scale = Math.min((canvasWidth - 2 * padding) / bounds.width, (canvasHeight - 2 * padding) / bounds.height)

  const offsetX = (canvasWidth - bounds.width * scale) / 2 - bounds.minX * scale
  const offsetY = (canvasHeight - bounds.height * scale) / 2 - bounds.minY * scale

  return { offsetX, offsetY, scale }
}

/**
 * Compute a viewport transform that centers on the highlighted node
 * with a 200px world-space radius context window.
 */
export function computeThumbnailViewport(
  highlightedNode: WorkflowNode,
  notation: Notation,
  canvasWidth: number,
  canvasHeight: number,
): ViewportTransform {
  const { width: w, height: h } = getNodeDimensions(highlightedNode, notation)
  const cx = highlightedNode.position.x + w / 2
  const cy = highlightedNode.position.y + h / 2

  // 400x300 world-space view window centered on the node (4:3 ratio)
  const viewW = 400
  const viewH = 300
  const viewMinX = cx - viewW / 2
  const viewMinY = cy - viewH / 2

  const scale = Math.min(canvasWidth / viewW, canvasHeight / viewH)

  const offsetX = (canvasWidth - viewW * scale) / 2 - viewMinX * scale
  const offsetY = (canvasHeight - viewH * scale) / 2 - viewMinY * scale

  return { offsetX, offsetY, scale }
}

// ---------------------------------------------------------------------------
// Internal drawing functions
// ---------------------------------------------------------------------------

/** The four-move gateway diamond path shared by the plain 'diamond' shape and the 'gate'
 *  shape's optional outline. Does not begin/close the surrounding path segment beyond its
 *  own moveTo/lineTo/closePath calls, so callers control ctx.beginPath() themselves. */
function diamondPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const cx = x + w / 2
  const cy = y + h / 2
  ctx.moveTo(cx, y) // top-center
  ctx.lineTo(x + w, cy) // right-center
  ctx.lineTo(cx, y + h) // bottom-center
  ctx.lineTo(x, cy) // left-center
  ctx.closePath()
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: WorkflowNode,
  notation: Notation,
  fidelity: FidelityLevel,
  highlightedNodeId?: string,
): void {
  const shape = classifyNodeShape(node.type ?? '', fidelity, notation)
  const style = getNodeStyle(node.type ?? '', node.id === highlightedNodeId, fidelity)
  const { width: w, height: h } = getNodeDimensions(node, notation)
  const x = node.position.x
  const y = node.position.y
  const gateMode = (node.data as StepNodeData | undefined)?.gateMode
  const glyph =
    shape === 'gate'
      ? gateGlyph(notation, fidelity, x, y, w, h, gateMode === 'timer' || gateMode === 'condition_or_timer')
      : null

  ctx.save()
  ctx.fillStyle = style.fill
  ctx.strokeStyle = style.stroke
  ctx.lineWidth = fidelity === 'thumbnail' ? 1.5 : 2

  ctx.beginPath()
  switch (shape) {
    case 'circle': {
      const cx = x + w / 2
      const cy = y + h / 2
      const r = Math.min(w, h) / 2
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      break
    }
    case 'diamond': {
      diamondPath(ctx, x, y, w, h)
      break
    }
    case 'horizontalBar': {
      // ISA88 gateway: horizontal bar spanning full width, with end caps
      const barY = y + h / 2 - 2
      const barH = 4
      const capH = h * 0.3
      const capY = y + (h - capH) / 2
      // Main horizontal bar
      ctx.rect(x, barY, w, barH)
      // Left vertical cap
      ctx.rect(x, capY, 2, capH)
      // Right vertical cap
      ctx.rect(x + w - 2, capY, 2, capH)
      break
    }
    case 'roundedRect': {
      const config = NOTATION_CONFIGS[notation]
      const rx = config.rect.rx ?? 4
      ctx.roundRect(x, y, w, h, rx)
      break
    }
    case 'gate': {
      if (glyph?.diamond) {
        diamondPath(ctx, x, y, w, h)
      }
      break
    }
  }

  ctx.fill()
  ctx.stroke()

  if (glyph) {
    // The transition marks: bars in the gateway stroke, stems at half weight (a connector
    // mark, not the transition itself — the live diagrams' rule).
    ctx.beginPath()
    for (const s of glyph.bars) {
      ctx.moveTo(s.x1, s.y1)
      ctx.lineTo(s.x2, s.y2)
    }
    ctx.stroke()
    if (glyph.stems.length > 0) {
      ctx.save()
      ctx.lineWidth = ctx.lineWidth / 2
      ctx.beginPath()
      for (const s of glyph.stems) {
        ctx.moveTo(s.x1, s.y1)
        ctx.lineTo(s.x2, s.y2)
      }
      ctx.stroke()
      ctx.restore()
    }
    if (glyph.clock) {
      const { cx: kx, cy: ky, r } = glyph.clock
      ctx.save()
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(kx, ky, r, 0, Math.PI * 2)
      ctx.moveTo(kx, ky)
      ctx.lineTo(kx, ky - r * 0.7)
      ctx.moveTo(kx, ky)
      ctx.lineTo(kx + r * 0.6, ky)
      ctx.stroke()
      ctx.restore()
    }
    if (glyph.caption) {
      ctx.font = `bold ${glyph.caption.fontSize}px Arial`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#78350f' // GateNode.tsx's caption colour (8.1:1 on the amber fill)
      ctx.fillText('GATE', glyph.caption.x, glyph.caption.y)
    }
  }

  // Draw label
  const fontSize = fidelity === 'thumbnail' ? 8 : 10
  ctx.font = `bold ${fontSize}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = style.stroke // Use stroke color for label contrast

  let label: string
  if (node.type === 'start') {
    label = 'Start'
  } else if (node.type === 'end') {
    label = 'End'
  } else {
    const rawLabel = node.data?.label ?? ''
    label = rawLabel.length > 15 ? rawLabel.slice(0, 14) + '…' : rawLabel
  }

  // horizontalBar: too thin. gate: no external step-name label on any surface (2026-08-30 amendment).
  if (shape !== 'horizontalBar' && shape !== 'gate') {
    ctx.fillText(label, x + w / 2, y + h / 2)
  }

  ctx.restore()
}

function drawEdge(
  ctx: CanvasRenderingContext2D,
  edge: Edge,
  nodeMap: Map<string, WorkflowNode>,
  notation: Notation,
  fidelity: FidelityLevel,
): void {
  const src = nodeMap.get(edge.source)
  const tgt = nodeMap.get(edge.target)
  if (!src || !tgt) return

  const srcConfig = NOTATION_CONFIGS[notation]
  const { width: srcW, height: srcH } = getNodeDimensions(src, notation)
  const { width: tgtW, height: tgtH } = getNodeDimensions(tgt, notation)

  const srcX = src.position.x
  const srcY = src.position.y
  const tgtX = tgt.position.x
  const tgtY = tgt.position.y

  // Determine flow direction based on notation
  const isTB = notation === 'flowchart' || notation === 'isa88'

  ctx.save()
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = fidelity === 'thumbnail' ? 1.5 : 2
  ctx.beginPath()

  if (isTB) {
    // Vertical-first (Top-to-Bottom): exit bottom, enter top
    const fromX = srcX + srcW / 2
    const fromY = srcY + srcH
    const toX = tgtX + tgtW / 2
    const toY = tgtY
    const midY = (fromY + toY) / 2

    ctx.moveTo(fromX, fromY)
    ctx.lineTo(fromX, midY)
    ctx.lineTo(toX, midY)
    ctx.lineTo(toX, toY)
  } else {
    // Horizontal-first (Left-to-Right, BPMN): exit right, enter left
    const fromX = srcX + srcW
    const fromY = srcY + srcH / 2
    const toX = tgtX
    const toY = tgtY + tgtH / 2
    const midX = (fromX + toX) / 2

    ctx.moveTo(fromX, fromY)
    ctx.lineTo(midX, fromY)
    ctx.lineTo(midX, toY)
    ctx.lineTo(toX, toY)
  }

  ctx.stroke()
  ctx.restore()

  // Suppress unused variable warning
  void srcConfig
}

function renderToCanvas(
  nodes: WorkflowNode[],
  edges: Edge[],
  notation: Notation,
  fidelity: FidelityLevel,
  canvasWidth: number,
  canvasHeight: number,
  viewport: ViewportTransform,
  highlightedNodeId?: string,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight

  const ctx = canvas.getContext('2d')!

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)

  // Apply viewport transform
  ctx.translate(viewport.offsetX, viewport.offsetY)
  ctx.scale(viewport.scale, viewport.scale)

  // Build nodeMap for edge lookup
  const nodeMap = new Map<string, WorkflowNode>()
  for (const node of nodes) {
    nodeMap.set(node.id, node)
  }

  // Draw edges first (behind nodes)
  for (const edge of edges) {
    drawEdge(ctx, edge, nodeMap, notation, fidelity)
  }

  // Draw nodes on top
  for (const node of nodes) {
    drawNode(ctx, node, notation, fidelity, highlightedNodeId)
  }

  return canvas
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a "You Are Here" thumbnail centered on the highlighted node
 * and embed it into the jsPDF document at the specified position.
 *
 * @param doc - jsPDF document instance
 * @param nodes - All nodes in the workflow
 * @param edges - All edges in the workflow
 * @param highlightedNodeId - ID of the node to center on and highlight
 * @param notation - Active notation (flowchart, bpmn, isa88)
 * @param x - PDF x position (points)
 * @param y - PDF y position (points)
 * @param thumbWidth - Thumbnail width in PDF points
 * @param thumbHeight - Thumbnail height in PDF points
 */
export function renderMinimapThumbnail(
  doc: jsPDF,
  nodes: WorkflowNode[],
  edges: Edge[],
  highlightedNodeId: string,
  notation: Notation,
  x: number,
  y: number,
  thumbWidth: number,
  thumbHeight: number,
): void {
  // 4x resolution canvas for crisp rendering at thumbnail size
  const canvasWidth = 480
  const canvasHeight = 360

  const highlightedNode = nodes.find((n) => n.id === highlightedNodeId)

  let viewport: ViewportTransform
  if (highlightedNode) {
    viewport = computeThumbnailViewport(highlightedNode, notation, canvasWidth, canvasHeight)
  } else {
    // Fallback: fit entire workflow
    const bounds = computeBounds(nodes, notation)
    viewport = computeViewport(bounds, canvasWidth, canvasHeight, 20)
  }

  const canvas = renderToCanvas(
    nodes,
    edges,
    notation,
    'thumbnail',
    canvasWidth,
    canvasHeight,
    viewport,
    highlightedNodeId,
  )

  const dataUrl = canvas.toDataURL('image/png')
  doc.addImage(dataUrl, 'PNG', x, y, thumbWidth, thumbHeight)
}

/**
 * Render a full-page workflow diagram fitting all nodes and embed into jsPDF.
 * Uses editor-accurate colors and ISA88-correct shapes.
 *
 * @param doc - jsPDF document instance
 * @param nodes - All nodes in the workflow
 * @param edges - All edges in the workflow
 * @param notation - Active notation (flowchart, bpmn, isa88)
 * @param x - PDF x position (points)
 * @param y - PDF y position (points)
 * @param maxWidth - Maximum width available in PDF points
 * @param maxHeight - Maximum height available in PDF points
 */
export function renderMinimapFullPage(
  doc: jsPDF,
  nodes: WorkflowNode[],
  edges: Edge[],
  notation: Notation,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
): void {
  const canvasWidth = 1600
  const canvasHeight = 1200

  const bounds = computeBounds(nodes, notation)
  const viewport = computeViewport(bounds, canvasWidth, canvasHeight, 40)

  const canvas = renderToCanvas(nodes, edges, notation, 'fullPage', canvasWidth, canvasHeight, viewport)

  const dataUrl = canvas.toDataURL('image/png')

  // Preserve aspect ratio, center within maxWidth x maxHeight
  const canvasAspect = canvasWidth / canvasHeight
  const areaAspect = maxWidth / maxHeight

  let placedW: number
  let placedH: number

  if (canvasAspect > areaAspect) {
    // Constrained by width
    placedW = maxWidth
    placedH = maxWidth / canvasAspect
  } else {
    // Constrained by height
    placedH = maxHeight
    placedW = maxHeight * canvasAspect
  }

  // Center within the available area
  const placedX = x + (maxWidth - placedW) / 2
  const placedY = y + (maxHeight - placedH) / 2

  doc.addImage(dataUrl, 'PNG', placedX, placedY, placedW, placedH)
}
