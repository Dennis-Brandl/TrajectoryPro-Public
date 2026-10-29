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

// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, it, expect, beforeEach } from 'vitest'
import GateNode from '../GateNode'
import type { StepNodeData } from '@/types/nodes'
import { useNotationStore } from '@/stores/notationStore'

function renderNode(label = 'Gate', extra: Partial<StepNodeData> = {}) {
  return render(
    <ReactFlowProvider>
      <GateNode
        id="g1"
        type="gateStep"
        selected={false}
        dragging={false}
        draggable={true}
        selectable={true}
        deletable={true}
        zIndex={0}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{ label, stepType: 'gateStep', ...extra }}
      />
    </ReactFlowProvider>,
  )
}

/** A horizontal SVG line: same y, different x. */
function isHorizontal(line: SVGLineElement): boolean {
  return line.getAttribute('y1') === line.getAttribute('y2') && line.getAttribute('x1') !== line.getAttribute('x2')
}

/** A vertical SVG line: same x, different y. */
function isVertical(line: SVGLineElement): boolean {
  return line.getAttribute('x1') === line.getAttribute('x2') && line.getAttribute('y1') !== line.getAttribute('y2')
}

describe('GateNode', () => {
  beforeEach(() => useNotationStore.setState({ notation: 'flowchart' }))

  it('never renders an external label — a custom data.label must not appear anywhere', () => {
    const { container, queryByText } = renderNode('My Custom Gate Name')
    expect(queryByText('My Custom Gate Name')).toBeNull()
    // No stray text node carrying the label outside the svg subtree either.
    expect(container.textContent).not.toContain('My Custom Gate Name')
  })

  describe('flowchart', () => {
    it('renders a diamond with exactly 2 horizontal parallel lines shifted into the upper half', () => {
      const { container } = renderNode()
      expect(container.querySelector('polygon')).not.toBeNull()
      const lines = Array.from(container.querySelectorAll('line')) as SVGLineElement[]
      expect(lines).toHaveLength(2)
      expect(lines.every(isHorizontal)).toBe(true)
      // Upper half: y < 30 (diamond center).
      for (const line of lines) {
        expect(Number(line.getAttribute('y1'))).toBeLessThan(30)
      }
    })

    it('renders a GATE text element inside the svg, centered below the lines', () => {
      const { container } = renderNode()
      const svg = container.querySelector('svg')!
      const text = svg.querySelector('text')!
      expect(text).not.toBeNull()
      expect(text.textContent).toBe('GATE')
    })

    it('exposes exactly one target (top) and one source (bottom) handle', () => {
      const { container } = renderNode()
      const handles = container.querySelectorAll('.react-flow__handle')
      expect(handles.length).toBe(2)
      const target = Array.from(handles).find((h) => h.classList.contains('target'))!
      const source = Array.from(handles).find((h) => h.classList.contains('source'))!
      expect(target.getAttribute('data-handlepos')).toBe('top')
      expect(source.getAttribute('data-handlepos')).toBe('bottom')
    })
  })

  describe('bpmn', () => {
    beforeEach(() => useNotationStore.setState({ notation: 'bpmn' }))

    it('renders a 40x50 diamond with exactly 2 vertical parallel lines, shortened/raised', () => {
      const { container } = renderNode()
      const svg = container.querySelector('svg')!
      expect(svg.getAttribute('width')).toBe('40')
      expect(svg.getAttribute('height')).toBe('50')
      expect(container.querySelector('polygon')).not.toBeNull()
      const lines = Array.from(container.querySelectorAll('line')) as SVGLineElement[]
      expect(lines).toHaveLength(2)
      expect(lines.every(isVertical)).toBe(true)
    })

    it('renders a GATE text element inside the svg, centered below the lines, sized to fit the diamond', () => {
      const { container } = renderNode()
      const svg = container.querySelector('svg')!
      const text = svg.querySelector('text')!
      expect(text).not.toBeNull()
      expect(text.textContent).toBe('GATE')
      // Must not overflow the narrow BPMN diamond — keep the font small.
      expect(Number(text.getAttribute('font-size'))).toBeLessThanOrEqual(7)
    })

    it('exposes a target (left) and source (right) handle', () => {
      const { container } = renderNode()
      const handles = container.querySelectorAll('.react-flow__handle')
      expect(handles.length).toBe(2)
      const target = Array.from(handles).find((h) => h.classList.contains('target'))!
      const source = Array.from(handles).find((h) => h.classList.contains('source'))!
      expect(target.getAttribute('data-handlepos')).toBe('left')
      expect(source.getAttribute('data-handlepos')).toBe('right')
    })
  })

  describe('isa88', () => {
    beforeEach(() => useNotationStore.setState({ notation: 'isa88' }))

    it('renders a 60x24 mark with no polygon and no text', () => {
      const { container } = renderNode()
      const svg = container.querySelector('svg')!
      expect(svg.getAttribute('width')).toBe('60')
      expect(svg.getAttribute('height')).toBe('24')
      expect(container.querySelector('polygon')).toBeNull()
      expect(container.querySelector('text')).toBeNull()
    })

    it('renders 4 lines: 2 horizontal bars + 2 thin vertical stems on the centre line', () => {
      const { container } = renderNode()
      const lines = Array.from(container.querySelectorAll('line')) as SVGLineElement[]
      expect(lines).toHaveLength(4)

      const bars = lines.filter(isHorizontal)
      const stems = lines.filter(isVertical)
      expect(bars).toHaveLength(2)
      expect(stems).toHaveLength(2)

      // Stems sit on the centre line (x=30) and are thin (strokeWidth 1).
      for (const stem of stems) {
        expect(stem.getAttribute('x1')).toBe('30')
        expect(stem.getAttribute('x2')).toBe('30')
        expect(stem.getAttribute('stroke-width')).toBe('1')
      }
    })

    it('exposes a target (top) and source (bottom) handle (same family as flowchart)', () => {
      const { container } = renderNode()
      const handles = container.querySelectorAll('.react-flow__handle')
      expect(handles.length).toBe(2)
      const target = Array.from(handles).find((h) => h.classList.contains('target'))!
      const source = Array.from(handles).find((h) => h.classList.contains('source'))!
      expect(target.getAttribute('data-handlepos')).toBe('top')
      expect(source.getAttribute('data-handlepos')).toBe('bottom')
    })
  })
})

describe('GateNode timed clock mark (spec 2026-10-13 §4.4)', () => {
  for (const notation of ['flowchart', 'bpmn', 'isa88'] as const) {
    describe(notation, () => {
      beforeEach(() => useNotationStore.setState({ notation }))

      it('shows the clock for timer and condition_or_timer gates', () => {
        for (const gateMode of ['timer', 'condition_or_timer'] as const) {
          const { container, unmount } = renderNode('Gate', { gateMode })
          const clock = container.querySelector('[data-testid="gate-clock"]')
          expect(clock).not.toBeNull()
          expect(clock!.closest('svg')).not.toBeNull()
          expect(clock!.querySelector('circle')).not.toBeNull()
          unmount()
        }
      })

      it('shows no clock for a plain or condition-mode gate', () => {
        const plain = renderNode()
        expect(plain.container.querySelector('[data-testid="gate-clock"]')).toBeNull()
        plain.unmount()
        const cond = renderNode('Gate', { gateMode: 'condition' })
        expect(cond.container.querySelector('[data-testid="gate-clock"]')).toBeNull()
      })
    })
  }
})
