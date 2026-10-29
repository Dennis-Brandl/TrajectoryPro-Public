// @vitest-environment jsdom
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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { WorkflowGraph } from './WorkflowGraph';
import type { DiagramSpec, DiagramStep } from '@/lib/api/types';

afterEach(cleanup);

const SPEC: DiagramSpec = {
  oid: 'wf-1', name: 'Mix', version: '1', state: null, notation: 'flowchart',
  steps: [
    { oid: 's-1', name: 'Start', stepType: 'START', x: 100, y: 100, childSpecOid: null },
    { oid: 's-2', name: 'Fill Details', stepType: 'USER_INTERACTION', x: 100, y: 200, childSpecOid: null },
    { oid: 's-3', name: 'Gate', stepType: 'GATE', x: 100, y: 300, childSpecOid: null },
  ],
  connections: [{ fromStepOid: 's-1', toStepOid: 's-2', condition: null, waypoints: null, sourceHandleId: null }],
  children: [],
};

function graph(states: ReadonlyMap<string, string>, onStepTap = vi.fn(), spec: DiagramSpec = SPEC) {
  render(<WorkflowGraph spec={spec} states={states} mineOids={new Set()}
    highlightedStepOid={null} resetKey="k" onStepTap={onStepTap} />);
  return onStepTap;
}

describe('WorkflowGraph (CM port)', () => {
  it('renders every step with its live state on data attributes; absent states are IDLE', () => {
    graph(new Map([['s-2', 'WAITING_USER'], ['s-3', 'WAITING_GATE']]));
    const svg = screen.getByRole('img', { name: 'Workflow diagram: Mix' });
    expect(svg.querySelector('[data-step-oid="s-1"]')).toHaveAttribute('data-state', 'IDLE');
    expect(svg.querySelector('[data-step-oid="s-2"]')).toHaveAttribute('data-state', 'WAITING_USER');
    expect(svg.querySelector('[data-step-oid="s-3"]')).toHaveAttribute('data-state', 'WAITING_GATE');
  });

  it('draws GATE as a diamond with a double-bar mark, amber when WAITING_GATE', () => {
    graph(new Map([['s-3', 'WAITING_GATE']]));
    const g = document.querySelector('[data-step-oid="s-3"]')!;
    expect(g.querySelector('polygon[fill="#f59e0b"]')).toBeTruthy();
    expect(g.querySelectorAll('rect[fill="#475569"]').length).toBe(2);
  });

  it('draws the isa88 GATE as a narrow double bar with no diamond outline', () => {
    const gateStep: DiagramStep = { oid: 'g-1', name: 'Gate', stepType: 'GATE', x: 0, y: 0, childSpecOid: null };
    graph(new Map(), vi.fn(), { ...SPEC, notation: 'isa88', steps: [gateStep], connections: [] });
    const g = document.querySelector('[data-step-oid="g-1"]')!;
    expect(g.querySelectorAll('rect').length).toBe(2);
    expect(g.querySelector('polygon')).toBeNull();
    expect(g.querySelectorAll('line').length).toBe(2); // centre-line stems, top and bottom
    expect(g.querySelector('text')).toBeNull(); // no text at isa88 scale
  });

  it('isa88 GATE stems pick up the state stroke, thinner than the bars', () => {
    const gateStep: DiagramStep = { oid: 'g-1', name: 'Gate', stepType: 'GATE', x: 0, y: 0, childSpecOid: null };
    graph(new Map([['g-1', 'EXECUTING']]), vi.fn(), { ...SPEC, notation: 'isa88', steps: [gateStep], connections: [] });
    const g = document.querySelector('[data-step-oid="g-1"]')!;
    const bars = g.querySelectorAll('rect');
    expect(bars.length).toBe(2);
    for (const bar of Array.from(bars)) {
      expect(bar.getAttribute('stroke')).toBe('#93c5fd');
      expect(bar.getAttribute('stroke-width')).toBe('3');
    }
    const stems = g.querySelectorAll('line');
    expect(stems.length).toBe(2); // centre-line stems, top and bottom
    for (const stem of Array.from(stems)) {
      expect(stem.getAttribute('stroke')).toBe('#93c5fd'); // same EXECUTING stroke as the bars
      expect(Number(stem.getAttribute('stroke-width'))).toBeLessThan(3); // thin relative to the bars
    }
  });

  it('draws the bpmn GATE with a "GATE" caption inside the diamond', () => {
    const gateStep: DiagramStep = { oid: 'g-1', name: 'Gate', stepType: 'GATE', x: 0, y: 0, childSpecOid: null };
    graph(new Map(), vi.fn(), { ...SPEC, notation: 'bpmn', steps: [gateStep], connections: [] });
    const g = document.querySelector('[data-step-oid="g-1"]')!;
    expect(g.querySelector('polygon')).toBeTruthy();
    expect(g.querySelector('text')!.textContent).toBe('GATE');
  });

  it('suppresses the GATE step-name label while a neighbouring step keeps its own', () => {
    graph(new Map());
    const gGate = document.querySelector('[data-step-oid="s-3"]')!; // GATE, flowchart notation
    const gUser = document.querySelector('[data-step-oid="s-2"]')!; // USER_INTERACTION
    const gateTexts = Array.from(gGate.querySelectorAll('text')).map((t) => t.textContent);
    expect(gateTexts).toEqual(['GATE']); // only the in-shape caption, no name label ("Gate")
    expect(gUser.querySelector('text')!.textContent).toBe('Fill Details'); // unaffected
  });

  it('reports a tap with the step and an anchor', () => {
    const onStepTap = graph(new Map());
    const g = document.querySelector('[data-step-oid="s-2"]')!;
    fireEvent.click(g);
    expect(onStepTap).toHaveBeenCalledTimes(1);
    expect(onStepTap.mock.calls[0][0].oid).toBe('s-2');
    expect(onStepTap.mock.calls[0][1]).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  });

  it('offers the three zoom controls', () => {
    graph(new Map());
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeInTheDocument();
  });
});

describe('WorkflowGraph timed GATE clock mark', () => {
  for (const notation of ['flowchart', 'bpmn', 'isa88'] as const) {
    it(`${notation}: one clock on a timed GATE, none on a plain one`, () => {
      const gate = (timed: boolean): DiagramSpec => ({
        ...SPEC, notation, connections: [],
        steps: [{ oid: 'g-1', name: 'Gate', stepType: 'GATE', x: 0, y: 0, childSpecOid: null, ...(timed ? { timedGate: true as const } : {}) }],
      });
      graph(new Map(), vi.fn(), gate(true));
      expect(screen.getAllByTestId('gate-clock')).toHaveLength(1);
      cleanup();
      graph(new Map(), vi.fn(), gate(false));
      expect(screen.queryAllByTestId('gate-clock')).toHaveLength(0);
    });
  }
});
