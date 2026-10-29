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
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { WorkflowGraph } from '../WorkflowGraph'
import type { DiagramSpec, DiagramStep } from '../../../api/types'

const SPEC: DiagramSpec = {
  oid: 'rt_0', name: 'WF', version: null, state: null, notation: 'flowchart',
  steps: [
    { oid: 's1', name: 'Begin', stepType: 'START', x: 0, y: 0, childSpecOid: null },
    { oid: 's2', name: 'A Very Long Step Name Indeed', stepType: 'USER_INTERACTION', x: 0, y: 100, childSpecOid: null },
    { oid: 's3', name: 'Pick', stepType: 'SELECT 1', x: 0, y: 200, childSpecOid: null },
    { oid: 's4', name: 'Gate', stepType: 'GATE', x: 0, y: 300, childSpecOid: null },
  ],
  connections: [
    { fromStepOid: 's1', toStepOid: 's2', condition: null, sourceHandleId: null, waypoints: null },
    { fromStepOid: 's2', toStepOid: 's3', condition: null, sourceHandleId: null, waypoints: null },
  ],
  children: [],
}

function draw(over: Partial<Parameters<typeof WorkflowGraph>[0]> = {}) {
  const onStepTap = vi.fn()
  const view = render(
    <WorkflowGraph
      spec={SPEC}
      states={new Map([['s1', 'COMPLETED'], ['s2', 'WAITING_USER'], ['s3', 'IDLE'], ['s4', 'WAITING_GATE']])}
      mineOids={new Set(['s2'])}
      highlightedStepOid={null}
      resetKey="i1:rt_0"
      onStepTap={onStepTap}
      {...over}
    />,
  )
  return { onStepTap, container: view.container }
}

afterEach(cleanup)

describe('WorkflowGraph', () => {
  it('renders one data-tagged group per step with the state fill and shape family', () => {
    const { container } = draw()
    const g1 = container.querySelector('g[data-step-oid="s1"]')!
    const g2 = container.querySelector('g[data-step-oid="s2"]')!
    const g3 = container.querySelector('g[data-step-oid="s3"]')!
    const g4 = container.querySelector('g[data-step-oid="s4"]')!
    expect(g1.getAttribute('data-state')).toBe('COMPLETED')
    expect(g1.querySelector('circle')).toBeTruthy() // START = circle in flowchart
    expect(g2.getAttribute('data-state')).toBe('WAITING_USER')
    expect(g2.querySelector('rect[fill="var(--pilot-state-waiting)"]')).toBeTruthy()
    expect(g3.querySelector('polygon')).toBeTruthy() // SELECT 1 = diamond
    expect(g4.getAttribute('data-state')).toBe('WAITING_GATE')
    expect(g4.querySelector('polygon[fill="var(--pilot-state-gate)"]')).toBeTruthy() // GATE = diamond, amber when waiting
    expect(g4.querySelectorAll('rect[fill="var(--pilot-diagram-glyph)"]').length).toBe(2) // gate double-bar mark
    expect(container.querySelectorAll('path').length).toBe(2) // the two edges
  })

  it('marks mine steps with data-mine and an accent ring; labels are truncated', () => {
    const { container } = draw()
    const g2 = container.querySelector('g[data-step-oid="s2"]')!
    expect(g2.getAttribute('data-mine')).toBe('true')
    expect(g2.querySelectorAll('rect').length).toBe(3) // shape + ring + name plate
    expect(Array.from(g2.querySelectorAll('text:not(.wf-badge-glyph) tspan')).map((t) => t.textContent))
      .toEqual(['A Very Long', 'Step Name Inde…'])
    expect(container.querySelector('g[data-step-oid="s1"]')!.getAttribute('data-mine')).toBeNull()
  })

  it('draws rect steps 15% narrower than their editor slot, centered, with the ring following', () => {
    const { container } = draw()
    const g2 = container.querySelector('g[data-step-oid="s2"]')!
    const shape = g2.querySelector('rect[fill="var(--pilot-state-waiting)"]')!
    expect(shape.getAttribute('x')).toBe('9') // (120 − 102) / 2 — centered in the slot
    expect(shape.getAttribute('width')).toBe('102') // 120 × 0.85
    const ring = g2.querySelector('rect[fill="none"]')!
    expect(ring.getAttribute('x')).toBe('4') // drawn x − 5
    expect(ring.getAttribute('width')).toBe('112') // drawn w + 10
  })

  it('reports taps with the tapped step', () => {
    const { container, onStepTap } = draw()
    fireEvent.click(container.querySelector('g[data-step-oid="s2"]')!)
    expect(onStepTap).toHaveBeenCalledTimes(1)
    expect((onStepTap.mock.calls[0]![0] as DiagramStep).oid).toBe('s2')
  })

  it('highlight ring: highlighted step gets the text-colour stroke treatment', () => {
    const { container } = draw({ highlightedStepOid: 's2' })
    const shape = container.querySelector('g[data-step-oid="s2"] rect[fill="var(--pilot-state-waiting)"]')!
    expect(shape.getAttribute('stroke')).toBe('var(--pilot-diagram-highlight)')
    expect(shape.getAttribute('stroke-width')).toBe('4')
  })

  it('draws the GATE symbol per notation: SFC double bar + stems for isa88, vertical bars + caption for bpmn', () => {
    const gateStep: DiagramStep = { oid: 'g1', name: 'Gate', stepType: 'GATE', x: 0, y: 0, childSpecOid: null }
    const isa88 = draw({ spec: { ...SPEC, notation: 'isa88', steps: [gateStep], connections: [] } })
    const gIsa = isa88.container.querySelector('g[data-step-oid="g1"]')!
    expect(gIsa.querySelectorAll('rect').length).toBe(2) // narrow double bar, no diamond outline
    expect(gIsa.querySelector('polygon')).toBeNull()
    expect(gIsa.querySelectorAll('line').length).toBe(2) // centre-line stems, top and bottom
    expect(gIsa.querySelector('text:not(.wf-badge-glyph)')).toBeNull() // no text at isa88 scale

    const bpmn = draw({ spec: { ...SPEC, notation: 'bpmn', steps: [gateStep], connections: [] } })
    const gBpmn = bpmn.container.querySelector('g[data-step-oid="g1"]')!
    expect(gBpmn.querySelector('polygon')).toBeTruthy() // diamond outline
    expect(gBpmn.querySelectorAll('rect[fill="var(--pilot-diagram-glyph)"][width="3"]').length).toBe(2) // vertical bars
    expect(gBpmn.querySelector('text')!.textContent).toBe('GATE') // caption inside the diamond
  })

  it('isa88 GATE stems pick up the state stroke, thinner than the bars', () => {
    const gateStep: DiagramStep = { oid: 'g1', name: 'Gate', stepType: 'GATE', x: 0, y: 0, childSpecOid: null }
    const { container } = draw({
      spec: { ...SPEC, notation: 'isa88', steps: [gateStep], connections: [] },
      highlightedStepOid: 'g1', // black 4px stroke, same treatment the bars get via `common`
    })
    const g = container.querySelector('g[data-step-oid="g1"]')!
    const bars = g.querySelectorAll('rect')
    expect(bars.length).toBe(2)
    for (const bar of Array.from(bars)) {
      expect(bar.getAttribute('stroke')).toBe('var(--pilot-diagram-highlight)')
      expect(bar.getAttribute('stroke-width')).toBe('4')
    }
    const stems = g.querySelectorAll('line')
    expect(stems.length).toBe(2)
    for (const stem of Array.from(stems)) {
      expect(stem.getAttribute('stroke')).toBe('var(--pilot-diagram-highlight)') // same highlight colour as the bars
      expect(Number(stem.getAttribute('stroke-width'))).toBeLessThan(4) // thin relative to the bars
    }
  })

  it('suppresses the GATE step-name label while a neighbouring step keeps its own', () => {
    const { container } = draw()
    const g4 = container.querySelector('g[data-step-oid="s4"]')! // GATE, flowchart notation
    const g2 = container.querySelector('g[data-step-oid="s2"]')! // USER_INTERACTION
    const g4Texts = Array.from(g4.querySelectorAll('text:not(.wf-badge-glyph)')).map((t) => t.textContent)
    expect(g4Texts).toEqual(['GATE']) // only the in-shape caption, no name label ("Gate")
    expect(g2.querySelector('text:not(.wf-badge-glyph)')!.textContent).toBe('A Very LongStep Name Inde…') // unaffected
  })

  it('edges, labels and the mine ring use tokens, never raw colours (dark mode must re-colour them)', () => {
    const { container } = draw()
    for (const edge of Array.from(container.querySelectorAll('path'))) {
      expect(edge.getAttribute('stroke')).toBe('var(--pilot-diagram-edge)')
    }
    const g2 = container.querySelector('g[data-step-oid="s2"]')!
    expect(g2.querySelector('rect[fill="none"]')!.getAttribute('stroke')).toBe('var(--pilot-mine-ring)')
    expect(g2.querySelector('text:not(.wf-badge-glyph)')!.getAttribute('fill')).toBe('var(--pilot-text)')
    expect(g2.querySelector('rect.wf-node-plate')!.getAttribute('fill')).toBe('var(--pilot-surface-raised)')
    const g3 = container.querySelector('g[data-step-oid="s3"]')! // diamond: name stays below the shape
    expect(g3.querySelector('text:not(.wf-badge-glyph)')!.getAttribute('fill')).toBe('var(--pilot-text-muted)')
  })

  it('a rect step carries its name inside, on a plate inset from the state fill (P1d-R5)', () => {
    const { container } = draw()
    const g2 = container.querySelector('g[data-step-oid="s2"]')!
    const plate = g2.querySelector('rect.wf-node-plate')!
    expect(plate.getAttribute('x')).toBe('13') // drawn x 9 + inset 4
    expect(plate.getAttribute('y')).toBe('112') // step y 100 + 12 px state band
    expect(plate.getAttribute('width')).toBe('94')
    expect(plate.getAttribute('height')).toBe('34')
    expect(g2.querySelector('title')!.textContent).toBe('A Very Long Step Name Indeed: Waiting for operator')
  })

  it('every rect, diamond and gate wears its state glyph; START does not', () => {
    const { container } = draw()
    const glyph = (oid: string) => container.querySelector(`g[data-step-oid="${oid}"] .wf-badge-glyph`)?.textContent ?? null
    expect(glyph('s1')).toBeNull()
    expect(glyph('s2')).toBe('◐')
    expect(glyph('s3')).toBe('○')
    expect(glyph('s4')).toBe('◇')
  })

  it('a long unbroken name never runs past the plate (Review Focus 4)', () => {
    const long: DiagramStep = { oid: 'L', name: 'Superlongunbrokenstepnameforthetest', stepType: 'USER_INTERACTION', x: 0, y: 0, childSpecOid: null }
    const { container } = draw({ spec: { ...SPEC, steps: [long], connections: [] } })
    const lines = Array.from(container.querySelectorAll('g[data-step-oid="L"] tspan')).map((t) => t.textContent!)
    expect(lines).toEqual(['Superlongunbrok', 'enstepnamefort…'])
  })

  it('the diagram never renders below its natural size, so 11 px labels stay 11 px (P1d-R3)', () => {
    const { container } = draw()
    const svg = container.querySelector('svg')!
    expect(svg.style.minWidth).toBe('200px') // steps span x 0–120, plus 40 px padding each side
    expect(svg.style.minHeight).toBe('458px') // to the gate's bottom (300 + 60) + 18 label room, plus padding
    expect(svg.parentElement!.className).toBe('wf-graph-scroll')
    const zoomOut = container.querySelector('button[aria-label="Zoom out"]') as HTMLButtonElement
    expect(zoomOut.disabled).toBe(true)
    fireEvent.click(container.querySelector('button[aria-label="Zoom in"]')!)
    expect(zoomOut.disabled).toBe(false)
  })

  it('only Ctrl/⌘+wheel zooms; a plain wheel scrolls and leaves the view alone (Review Focus 5)', () => {
    const { container } = draw()
    const svg = container.querySelector('svg')!
    const before = svg.getAttribute('viewBox')
    expect(fireEvent.wheel(svg, { deltaY: -100 })).toBe(true) // not prevented: the box scrolls
    expect(svg.getAttribute('viewBox')).toBe(before)
    expect(fireEvent.wheel(svg, { deltaY: -100, ctrlKey: true })).toBe(false) // prevented: no browser zoom
    expect(svg.getAttribute('viewBox')).not.toBe(before)
    const zoomed = svg.getAttribute('viewBox')
    expect(fireEvent.wheel(svg, { deltaY: -100, metaKey: true })).toBe(false)
    expect(svg.getAttribute('viewBox')).not.toBe(zoomed)
  })

  it('a label line wider than the plate is squeezed to fit — capitals are wider than the character budget (final review)', () => {
    const proto = SVGElement.prototype as unknown as { getComputedTextLength?: () => number }
    proto.getComputedTextLength = function (this: SVGElement) { return (this.textContent ?? '').length * 8 }
    try {
      const wide: DiagramStep = { oid: 'W', name: 'CHARGE KETTLE A', stepType: 'USER_INTERACTION', x: 0, y: 0, childSpecOid: null }
      const narrow: DiagramStep = { oid: 'N', name: 'Mix', stepType: 'USER_INTERACTION', x: 200, y: 0, childSpecOid: null }
      const { container } = draw({ spec: { ...SPEC, steps: [wide, narrow], connections: [] } })
      const w = container.querySelector('g[data-step-oid="W"] tspan')!
      expect(w.getAttribute('textLength')).toBe('90')
      expect(w.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs')
      expect(container.querySelector('g[data-step-oid="N"] tspan')!.getAttribute('textLength')).toBeNull()
    } finally {
      delete proto.getComputedTextLength
    }
  })

  it('a trackpad pinch zooms in proportion to the gesture, and pinching back lands exactly on natural size (final review)', () => {
    const { container } = draw()
    const svg = container.querySelector('svg')!
    const width = () => Number(svg.getAttribute('viewBox')!.split(' ')[2])
    const natural = width()
    fireEvent.wheel(svg, { deltaY: -10, ctrlKey: true })
    const ratio = natural / width()
    expect(ratio).toBeGreaterThan(1)
    expect(ratio).toBeLessThan(1.3)
    for (let i = 0; i < 5; i++) fireEvent.wheel(svg, { deltaY: -7, ctrlKey: true })
    for (let i = 0; i < 5; i++) fireEvent.wheel(svg, { deltaY: 7, ctrlKey: true })
    fireEvent.wheel(svg, { deltaY: 10, ctrlKey: true })
    expect((container.querySelector('button[aria-label="Zoom out"]') as HTMLButtonElement).disabled).toBe(true)
    expect(width()).toBe(natural)
  })
})

describe('WorkflowGraph timed gate mark', () => {
  it('draws a clock only on a timed gate, in every notation', () => {
    for (const notation of ['flowchart', 'bpmn', 'isa88'] as const) {
      const spec: DiagramSpec = {
        ...SPEC, notation,
        steps: [
          { oid: 'g1', name: 'Timed', stepType: 'GATE', x: 0, y: 0, childSpecOid: null, timedGate: true },
          { oid: 'g2', name: 'Plain', stepType: 'GATE', x: 0, y: 200, childSpecOid: null },
        ],
        connections: [],
      }
      const { container } = draw({ spec, states: new Map([['g1', 'WAITING_GATE'], ['g2', 'WAITING_GATE']]) })
      expect(container.querySelectorAll('[data-testid="gate-clock"]').length).toBe(1)
      expect(container.querySelector('g[data-step-oid="g1"] [data-testid="gate-clock"]')).toBeTruthy()
      expect(container.querySelector('g[data-step-oid="g2"] [data-testid="gate-clock"]')).toBeNull()
      cleanup()
    }
  })
})
