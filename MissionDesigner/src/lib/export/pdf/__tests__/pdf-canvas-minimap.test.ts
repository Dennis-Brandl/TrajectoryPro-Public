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

import { describe, it, expect } from 'vitest'
import {
  classifyNodeShape,
  getNodeStyle,
  getNodeDimensions,
  computeBounds,
  computeViewport,
  computeThumbnailViewport,
  gateGlyph,
} from '../pdf-canvas-minimap'
import type { WorkflowNode } from '@/types/nodes'
import { PDF_COLORS } from '../pdf-types'
import {
  START_COLOR,
  START_FILL,
  END_COLOR,
  END_FILL,
  DEFAULT_STROKE,
  GATEWAY_AMBER,
  GATEWAY_FILL,
} from '@/components/nodes/renderers/shared/colors'

function mockNode(overrides: Partial<WorkflowNode> & { id: string; type: string }): WorkflowNode {
  return {
    position: { x: 0, y: 0 },
    data: { label: 'Test', stepType: 'actionProxyWait' as any },
    ...overrides,
  } as WorkflowNode
}

// ---------------------------------------------------------------------------
// classifyNodeShape
// ---------------------------------------------------------------------------

describe('classifyNodeShape', () => {
  it('start → circle at thumbnail fidelity', () => {
    expect(classifyNodeShape('start', 'thumbnail', 'flowchart')).toBe('circle')
  })

  it('end → circle at fullPage fidelity', () => {
    expect(classifyNodeShape('end', 'fullPage', 'bpmn')).toBe('circle')
  })

  it('select1 → diamond at thumbnail fidelity', () => {
    expect(classifyNodeShape('select1', 'thumbnail', 'flowchart')).toBe('diamond')
  })

  it('waitAny → diamond at fullPage fidelity (any notation)', () => {
    expect(classifyNodeShape('waitAny', 'fullPage', 'isa88')).toBe('diamond')
  })

  it('gateStep -> gate glyph at all fidelity levels and notations (follow-up item 3)', () => {
    expect(classifyNodeShape('gateStep', 'thumbnail', 'flowchart')).toBe('gate')
    expect(classifyNodeShape('gateStep', 'fullPage', 'isa88')).toBe('gate')
    expect(classifyNodeShape('gateStep', 'fullPage', 'bpmn')).toBe('gate')
  })

  it('parallel → diamond at thumbnail fidelity (any notation)', () => {
    expect(classifyNodeShape('parallel', 'thumbnail', 'isa88')).toBe('diamond')
  })

  it('parallel → diamond at fullPage fidelity, flowchart notation', () => {
    expect(classifyNodeShape('parallel', 'fullPage', 'flowchart')).toBe('diamond')
  })

  it('parallel → horizontalBar at fullPage fidelity, isa88 notation', () => {
    expect(classifyNodeShape('parallel', 'fullPage', 'isa88')).toBe('horizontalBar')
  })

  it('actionProxyWait → roundedRect at all fidelity levels', () => {
    expect(classifyNodeShape('actionProxyWait', 'thumbnail', 'flowchart')).toBe('roundedRect')
    expect(classifyNodeShape('actionProxyWait', 'fullPage', 'bpmn')).toBe('roundedRect')
  })
})

// ---------------------------------------------------------------------------
// getNodeStyle
// ---------------------------------------------------------------------------

describe('getNodeStyle', () => {
  it('highlighted node at thumbnail fidelity → orange fill and stroke', () => {
    const style = getNodeStyle('start', true, 'thumbnail')
    expect(style.fill).toBe(PDF_COLORS.ORANGE_FILL)
    expect(style.stroke).toBe(PDF_COLORS.ORANGE)
  })

  it('highlighted node at fullPage fidelity → orange fill and stroke', () => {
    const style = getNodeStyle('end', true, 'fullPage')
    expect(style.fill).toBe(PDF_COLORS.ORANGE_FILL)
    expect(style.stroke).toBe(PDF_COLORS.ORANGE)
  })

  it('thumbnail fidelity, start node → uniform light fill, DEFAULT_STROKE', () => {
    const style = getNodeStyle('start', false, 'thumbnail')
    expect(style.fill).toBe('#f8fafc')
    expect(style.stroke).toBe(DEFAULT_STROKE)
  })

  it('thumbnail fidelity, end node → uniform light fill, DEFAULT_STROKE', () => {
    const style = getNodeStyle('end', false, 'thumbnail')
    expect(style.fill).toBe('#f8fafc')
    expect(style.stroke).toBe(DEFAULT_STROKE)
  })

  it('thumbnail fidelity, select1 → uniform light fill, DEFAULT_STROKE', () => {
    const style = getNodeStyle('select1', false, 'thumbnail')
    expect(style.fill).toBe('#f8fafc')
    expect(style.stroke).toBe(DEFAULT_STROKE)
  })

  it('fullPage fidelity, start node → green fill/stroke', () => {
    const style = getNodeStyle('start', false, 'fullPage')
    expect(style.fill).toBe(START_FILL)
    expect(style.stroke).toBe(START_COLOR)
  })

  it('fullPage fidelity, end node → red fill/stroke', () => {
    const style = getNodeStyle('end', false, 'fullPage')
    expect(style.fill).toBe(END_FILL)
    expect(style.stroke).toBe(END_COLOR)
  })

  it('fullPage fidelity, default (actionProxyWait) → white fill, DEFAULT_STROKE', () => {
    const style = getNodeStyle('actionProxyWait', false, 'fullPage')
    expect(style.fill).toBe('#ffffff')
    expect(style.stroke).toBe(DEFAULT_STROKE)
  })

  it('fullPage fidelity, gateStep → gateway amber fill/stroke', () => {
    const style = getNodeStyle('gateStep', false, 'fullPage')
    expect(style.fill).toBe(GATEWAY_FILL)
    expect(style.stroke).toBe(GATEWAY_AMBER)
  })
})

// ---------------------------------------------------------------------------
// getNodeDimensions
// ---------------------------------------------------------------------------

describe('getNodeDimensions', () => {
  it('start node → { width: 30, height: 30 } (all notations)', () => {
    const node = mockNode({ id: 'n1', type: 'start' })
    expect(getNodeDimensions(node, 'flowchart')).toEqual({ width: 30, height: 30 })
    expect(getNodeDimensions(node, 'bpmn')).toEqual({ width: 30, height: 30 })
    expect(getNodeDimensions(node, 'isa88')).toEqual({ width: 30, height: 30 })
  })

  it('select1 in flowchart → { width: 60, height: 60 } (from NOTATION_CONFIGS)', () => {
    const node = mockNode({ id: 'n2', type: 'select1' })
    expect(getNodeDimensions(node, 'flowchart')).toEqual({ width: 60, height: 60 })
  })

  it('gateStep in flowchart → gateway dimensions (from NOTATION_CONFIGS)', () => {
    const node = mockNode({ id: 'n4', type: 'gateStep' })
    expect(getNodeDimensions(node, 'flowchart')).toEqual({ width: 60, height: 60 })
  })

  it('actionProxyWait in bpmn → { width: 140, height: 60 } (from NOTATION_CONFIGS.bpmn.rect)', () => {
    const node = mockNode({ id: 'n3', type: 'actionProxyWait' })
    expect(getNodeDimensions(node, 'bpmn')).toEqual({ width: 140, height: 60 })
  })
})

// ---------------------------------------------------------------------------
// computeBounds
// ---------------------------------------------------------------------------

describe('computeBounds', () => {
  it('empty array → zero bounds', () => {
    expect(computeBounds([], 'flowchart')).toEqual({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    })
  })

  it('single flowchart actionProxyWait at (100, 200) → bounds include node dimensions', () => {
    // flowchart rect: 120x50
    const node = mockNode({ id: 'n1', type: 'actionProxyWait', position: { x: 100, y: 200 } })
    const bounds = computeBounds([node], 'flowchart')
    expect(bounds.minX).toBe(100)
    expect(bounds.minY).toBe(200)
    expect(bounds.maxX).toBe(220) // 100 + 120
    expect(bounds.maxY).toBe(250) // 200 + 50
    expect(bounds.width).toBe(120)
    expect(bounds.height).toBe(50)
  })

  it('two nodes: one at (0,0) and one at (300,400) → bounds span correctly', () => {
    // flowchart rect: 120x50
    const n1 = mockNode({ id: 'n1', type: 'actionProxyWait', position: { x: 0, y: 0 } })
    const n2 = mockNode({ id: 'n2', type: 'actionProxyWait', position: { x: 300, y: 400 } })
    const bounds = computeBounds([n1, n2], 'flowchart')
    expect(bounds.minX).toBe(0)
    expect(bounds.minY).toBe(0)
    expect(bounds.maxX).toBe(420) // 300 + 120
    expect(bounds.maxY).toBe(450) // 400 + 50
    expect(bounds.width).toBe(420)
    expect(bounds.height).toBe(450)
  })
})

// ---------------------------------------------------------------------------
// computeViewport
// ---------------------------------------------------------------------------

describe('computeViewport', () => {
  it('zero-size bounds → scale 1, offsets 0', () => {
    const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
    const vp = computeViewport(bounds, 800, 600, 40)
    expect(vp).toEqual({ offsetX: 0, offsetY: 0, scale: 1 })
  })

  it('400x300 bounds on 800x600 canvas with 40px padding → scale fits with padding, centered', () => {
    // Available area: 720x520 → scale = min(720/400, 520/300) = min(1.8, 1.733) = 1.733
    const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300, width: 400, height: 300 }
    const vp = computeViewport(bounds, 800, 600, 40)
    const expectedScale = Math.min((800 - 80) / 400, (600 - 80) / 300)
    expect(vp.scale).toBeCloseTo(expectedScale, 5)
    // Centered: offsetX = (800 - 400*scale)/2, offsetY = (600 - 300*scale)/2
    expect(vp.offsetX).toBeCloseTo((800 - 400 * expectedScale) / 2, 5)
    expect(vp.offsetY).toBeCloseTo((600 - 300 * expectedScale) / 2, 5)
  })

  it('wide bounds (800x200) on 800x600 canvas → scale limited by width', () => {
    // Available area: 720x520 → scale = min(720/800, 520/200) = min(0.9, 2.6) = 0.9
    const bounds = { minX: 0, minY: 0, maxX: 800, maxY: 200, width: 800, height: 200 }
    const vp = computeViewport(bounds, 800, 600, 40)
    const expectedScale = Math.min((800 - 80) / 800, (600 - 80) / 200)
    expect(vp.scale).toBeCloseTo(expectedScale, 5)
  })
})

// ---------------------------------------------------------------------------
// computeThumbnailViewport
// ---------------------------------------------------------------------------

describe('computeThumbnailViewport', () => {
  it('node at (100, 100) → viewport centers on node center, scale based on 400x300 world window', () => {
    // flowchart actionProxyWait: 120x50 → center at (160, 125)
    const node = mockNode({ id: 'n1', type: 'actionProxyWait', position: { x: 100, y: 100 } })
    const vp = computeThumbnailViewport(node, 'flowchart', 480, 360)

    const expectedScale = Math.min(480 / 400, 360 / 300)
    expect(vp.scale).toBeCloseTo(expectedScale, 5)

    // Node center: (100 + 60, 100 + 25) = (160, 125)
    // viewMinX = 160 - 200 = -40, viewMinY = 125 - 150 = -25
    // offsetX = (480 - 400*scale)/2 - (-40)*scale
    const cx = 100 + 120 / 2 // 160
    const cy = 100 + 50 / 2 // 125
    const viewMinX = cx - 200
    const viewMinY = cy - 150
    const scale = expectedScale
    const expectedOffsetX = (480 - 400 * scale) / 2 - viewMinX * scale
    const expectedOffsetY = (360 - 300 * scale) / 2 - viewMinY * scale
    expect(vp.offsetX).toBeCloseTo(expectedOffsetX, 5)
    expect(vp.offsetY).toBeCloseTo(expectedOffsetY, 5)
  })

  it('node at (0, 0) → viewport still produces valid transform', () => {
    const node = mockNode({ id: 'n1', type: 'start', position: { x: 0, y: 0 } })
    const vp = computeThumbnailViewport(node, 'flowchart', 480, 360)
    // Scale should be positive
    expect(vp.scale).toBeGreaterThan(0)
    // Should produce finite numbers
    expect(isFinite(vp.offsetX)).toBe(true)
    expect(isFinite(vp.offsetY)).toBe(true)
  })
})

describe('gateGlyph mirrors GateNode.tsx per notation (follow-up item 3)', () => {
  const box = { x: 100, y: 200, w: 60, h: 60 }
  const horizontal = (s: { x1: number; y1: number; x2: number; y2: number }) => s.y1 === s.y2 && s.x1 !== s.x2
  const vertical = (s: { x1: number; y1: number; x2: number; y2: number }) => s.x1 === s.x2 && s.y1 !== s.y2

  it('flowchart: diamond, two horizontal bars in the UPPER half, caption below them at full page', () => {
    const g = gateGlyph('flowchart', 'fullPage', box.x, box.y, box.w, box.h)
    expect(g.diamond).toBe(true)
    expect(g.bars).toHaveLength(2)
    expect(g.bars.every(horizontal)).toBe(true)
    expect(g.bars.every((b) => b.y1 < box.y + box.h / 2)).toBe(true)
    expect(g.stems).toHaveLength(0)
    expect(g.caption).toEqual({ x: box.x + box.w / 2, y: box.y + box.h * (42 / 60), fontSize: 8 })
  })

  it('bpmn: diamond, two vertical bars, the smaller caption', () => {
    const g = gateGlyph('bpmn', 'fullPage', 0, 0, 40, 50)
    expect(g.diamond).toBe(true)
    expect(g.bars).toHaveLength(2)
    expect(g.bars.every(vertical)).toBe(true)
    expect(g.caption).toEqual({ x: 20, y: 50 * (35 / 50), fontSize: 6 })
  })

  it('isa88: no diamond, two horizontal bars with centre-line stems to both edges, no caption', () => {
    const g = gateGlyph('isa88', 'fullPage', 0, 0, 90, 40)
    expect(g.diamond).toBe(false)
    expect(g.bars).toHaveLength(2)
    expect(g.bars.every(horizontal)).toBe(true)
    expect(g.stems).toHaveLength(2)
    expect(g.stems.every(vertical)).toBe(true)
    expect(g.stems.some((s) => s.y1 === 0)).toBe(true)
    expect(g.stems.some((s) => s.y2 === 40)).toBe(true)
    expect(g.caption).toBeNull()
  })

  it('thumbnail fidelity drops the caption in every notation (unreadable at that scale) but keeps the marks', () => {
    for (const n of ['flowchart', 'bpmn', 'isa88'] as const) {
      const g = gateGlyph(n, 'thumbnail', 0, 0, 60, 60)
      expect(g.caption).toBeNull()
      expect(g.bars).toHaveLength(2)
    }
  })
})

describe('gateGlyph clock mark for timed gates (spec 2026-10-13 §4.4)', () => {
  it('places the clock per notation at native size', () => {
    expect(gateGlyph('flowchart', 'fullPage', 0, 0, 60, 60, true).clock).toEqual({ cx: 30, cy: 12, r: 4 })
    expect(gateGlyph('bpmn', 'fullPage', 0, 0, 40, 50, true).clock).toEqual({ cx: 20, cy: 42, r: 3 })
    expect(gateGlyph('isa88', 'fullPage', 0, 0, 60, 24, true).clock).toEqual({ cx: 56, cy: 12, r: 3.5 })
  })

  it('has no clock when timed is omitted or false', () => {
    expect(gateGlyph('flowchart', 'fullPage', 0, 0, 60, 60).clock).toBeNull()
    expect(gateGlyph('bpmn', 'thumbnail', 0, 0, 40, 50, false).clock).toBeNull()
    expect(gateGlyph('isa88', 'fullPage', 0, 0, 60, 24).clock).toBeNull()
  })

  it('scales the clock with the node box', () => {
    const c = gateGlyph('flowchart', 'fullPage', 10, 20, 120, 120, true).clock!
    expect(c).toEqual({ cx: 70, cy: 44, r: 8 })
  })
})
