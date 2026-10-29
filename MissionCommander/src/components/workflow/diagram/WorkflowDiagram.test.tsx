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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DiagramSpec } from '@/lib/api/types';
import { WorkflowDiagram } from './WorkflowDiagram';

afterEach(cleanup);

// This project's jsdom has no PointerEvent constructor (only real browsers and newer jsdom
// do), so testing-library's fireEvent.pointerDown/Move/Up convenience helpers silently fall
// back to a plain `Event` and drop clientX/clientY/pointerId — every property the drag
// handler reads comes back undefined, not a realistic 0. Building the Event by hand and
// assigning those fields as own properties sidesteps that gap (React's synthetic pointer
// event reads them straight off the native event object, regardless of its concrete class),
// while still going through the base `fireEvent(element, event)` — not raw
// `element.dispatchEvent` — so the act()-wrapping that flushes the resulting state update
// before the assertion runs is preserved.
function firePointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
  clientY: number,
  pointerId = 1,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX, clientY, pointerId });
  fireEvent(target, event);
}

const child: DiagramSpec = {
  oid: 'c1', name: 'Sub Task', version: '1.0.0', state: 'Draft', notation: 'flowchart',
  steps: [{ oid: 'cs0', name: 'Confirm', stepType: 'YES_NO', x: 0, y: 0, childSpecOid: null }],
  connections: [], children: [],
};
const root: DiagramSpec = {
  oid: 'root', name: 'Root', version: '1.0.0', state: 'Draft', notation: 'flowchart',
  steps: [
    { oid: 's0', name: 'START', stepType: 'START', x: 0, y: 0, childSpecOid: null },
    { oid: 's1', name: 'Sub Task', stepType: 'WORKFLOW PROXY', x: 0, y: 120, childSpecOid: 'c1' },
  ],
  connections: [{ fromStepOid: 's0', toStepOid: 's1', condition: null, sourceHandleId: null, waypoints: null }],
  children: [child],
};

describe('WorkflowDiagram', () => {
  it('renders every step and connection of the root spec', () => {
    render(<WorkflowDiagram root={root} />);
    expect(screen.getByText('START')).toBeInTheDocument();
    expect(screen.getByText('Sub Task')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid="diagram-edge"]')).toHaveLength(1);
  });

  it('descends into a linked child and climbs back via the breadcrumb', async () => {
    render(<WorkflowDiagram root={root} />);
    await userEvent.click(screen.getByRole('button', { name: /Open Sub Task/ }));
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.queryByText('START')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Root' }));
    expect(screen.getByText('START')).toBeInTheDocument();
  });

  it('does not make an unlinked step clickable', () => {
    render(<WorkflowDiagram root={root} />);
    expect(screen.queryByRole('button', { name: /Open START/ })).not.toBeInTheDocument();
  });

  // GATE steps show no external name label (spec 2026-08-30 symbol amendment), so this suite
  // locates the step's <g> via its <title> (name — stepType) rather than screen.getByText.
  // Typed as HTMLElement (not SVGGElement) only because that's what testing-library's
  // `within`/query helpers accept — an SVG <g> works identically at runtime.
  function gateGroup(container: HTMLElement, titleText: string): HTMLElement {
    const title = Array.from(container.querySelectorAll('title')).find((t) => t.textContent === titleText);
    if (!title) throw new Error(`no <title>${titleText}</title> found`);
    return title.closest('g') as unknown as HTMLElement;
  }

  it('renders a flowchart GATE as a diamond with bars + a GATE caption, and no name label', () => {
    const withGate: DiagramSpec = {
      ...root,
      steps: [...root.steps, { oid: 'g0', name: 'Approval Gate', stepType: 'GATE', x: 0, y: 240, childSpecOid: null }],
    };
    const { container } = render(<WorkflowDiagram root={withGate} />);
    const g = gateGroup(container, 'Approval Gate — GATE');
    expect(g.querySelector('polygon')).toBeTruthy(); // gateway-shaped outline
    expect(g.querySelectorAll('line').length).toBeGreaterThan(0); // the bar mark distinguishing it from a plain gateway
    // The light/dark duplicate <g> pair (see the fill comment above DiagramStep's `content`)
    // means the same caption/label text is rendered twice in jsdom (only one copy is ever
    // shown in a real browser, via the dark: CSS variant) — getAllByText, not getByText.
    expect(within(g).getAllByText('GATE').length).toBeGreaterThan(0); // caption inside the shape
    expect(within(g).queryByText('Approval Gate')).not.toBeInTheDocument(); // name label suppressed
    // Caption colour is class-based (not a `fill` attribute) so it resolves independently
    // under each theme's <g fill=...> wrapper instead of inheriting a single fixed colour —
    // the fix for the ~1.8:1 light-mode contrast the raw `fill={stroke}` attribute produced.
    for (const caption of within(g).getAllByText('GATE')) {
      expect(caption).not.toHaveAttribute('fill');
      expect(caption.getAttribute('class')).toContain('fill-amber-900');
      expect(caption.getAttribute('class')).toContain('dark:fill-amber-500');
    }
    // A neighbouring non-gate step is unaffected and still shows its name label.
    expect(screen.getByText('Sub Task')).toBeInTheDocument();
  });

  it('renders the bpmn GATE with the caption sized for its narrower diamond', () => {
    const bpmnRoot: DiagramSpec = {
      ...root, notation: 'bpmn',
      steps: [{ oid: 'g0', name: 'Gate', stepType: 'GATE', x: 0, y: 0, childSpecOid: null }],
      connections: [],
    };
    const { container } = render(<WorkflowDiagram root={bpmnRoot} />);
    const g = gateGroup(container, 'Gate — GATE');
    expect(g.querySelector('polygon')).toBeTruthy();
    expect(within(g).getAllByText('GATE').length).toBeGreaterThan(0);
    expect(within(g).queryByText('Gate')).not.toBeInTheDocument(); // no separate name label
    for (const caption of within(g).getAllByText('GATE')) {
      expect(caption).not.toHaveAttribute('fill');
      expect(caption.getAttribute('class')).toContain('fill-amber-900');
      expect(caption.getAttribute('class')).toContain('dark:fill-amber-500');
    }
  });

  it('renders the isa88 GATE with centre-line stems and no text', () => {
    const isa88Root: DiagramSpec = {
      ...root, notation: 'isa88',
      steps: [{ oid: 'g0', name: 'Gate', stepType: 'GATE', x: 0, y: 0, childSpecOid: null }],
      connections: [],
    };
    const { container } = render(<WorkflowDiagram root={isa88Root} />);
    const g = gateGroup(container, 'Gate — GATE');
    expect(g.querySelector('polygon')).toBeNull(); // no diamond outline at isa88 scale
    expect(g.querySelectorAll('line').length).toBeGreaterThanOrEqual(2); // the centre-line stems
    expect(g.querySelectorAll('rect').length).toBeGreaterThanOrEqual(2); // the double bar mark
    expect(g.querySelector('text')).toBeNull(); // no text at isa88 scale
  });

  it('lists children that no proxy step links to, and hides the strip otherwise', () => {
    const orphaned: DiagramSpec = {
      ...root,
      steps: [root.steps[0]],
      children: [child],
    };
    const { unmount } = render(<WorkflowDiagram root={orphaned} />);
    expect(screen.getByText('Child workflows')).toBeVisible();
    expect(screen.getByRole('button', { name: /Open Sub Task/ })).toBeVisible();
    unmount();
    render(<WorkflowDiagram root={root} />);
    expect(screen.queryByText('Child workflows')).not.toBeInTheDocument();
  });

  it('shows an empty state for a spec with no steps', () => {
    render(<WorkflowDiagram root={{ ...root, steps: [], connections: [], children: [] }} />);
    expect(screen.getByText('This workflow has no steps')).toBeVisible();
  });

  it('resets to the root when a different workflow is shown', async () => {
    const { rerender } = render(<WorkflowDiagram root={root} />);
    await userEvent.click(screen.getByRole('button', { name: /Open Sub Task/ }));
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    rerender(<WorkflowDiagram root={{ ...root, oid: 'other', name: 'Other' }} />);
    expect(screen.getByText('START')).toBeInTheDocument();
  });

  it('converts a pointer-drag delta from screen pixels to viewBox units using a single uniform scale, not a per-axis stretch', () => {
    const { container } = render(<WorkflowDiagram root={root} />);
    const svg = container.querySelector('svg')!;
    // The <svg> sets no preserveAspectRatio, so it defaults to `xMidYMid meet`: the true
    // screen-px -> viewBox-unit scale is min(rect.width/viewBoxWidth, rect.height/viewBoxHeight)
    // applied to BOTH axes. Stub a rect whose aspect ratio differs from the viewBox's own —
    // and, specifically, where the WIDTH ratio is the tighter (binding) one — so the X axis
    // comes out the same under either formula (a sanity check) while the Y axis is where a
    // per-axis divide-by-rect.height would diverge from the correct uniform scale.
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 600));

    const [beforeX, beforeY, viewBoxWidth, viewBoxHeight] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const scale = Math.min(300 / viewBoxWidth, 600 / viewBoxHeight);

    firePointer(svg, 'pointerdown', 200, 200);
    firePointer(svg, 'pointermove', 100, 140);
    firePointer(svg, 'pointerup', 100, 140);

    const [afterX, afterY] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    // Dragged 100 screen px left, 60 screen px up: both axes must divide by the SAME scale
    // factor. A per-axis implementation gets the (non-binding) Y axis wrong here.
    expect(afterX - beforeX).toBeCloseTo(100 / scale, 5);
    expect(afterY - beforeY).toBeCloseTo(60 / scale, 5);
  });

  it('does not let a zero-sized rendered SVG turn a drag into NaN or Infinity in the viewBox', () => {
    const { container } = render(<WorkflowDiagram root={root} />);
    const svg = container.querySelector('svg')!;
    // jsdom's own default getBoundingClientRect is already all-zero; stubbing it explicitly
    // documents the case under test rather than relying on that default.
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 0, 0));

    firePointer(svg, 'pointerdown', 200, 200);
    firePointer(svg, 'pointermove', 100, 150);
    firePointer(svg, 'pointerup', 100, 150);

    expect(svg.getAttribute('viewBox')).not.toMatch(/NaN|Infinity/);
  });

  // jsdom returns an all-zero rect from getBoundingClientRect, so a zoom test MUST stub one.
  // Deliberately NON-square: a square rect makes min(w/vbW, h/vbH) pick either axis, so a
  // wrong-axis implementation would pass.
  const RECT = { left: 0, top: 0, width: 400, height: 200 } as DOMRect;

  function stubRect(svg: Element) {
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      ...RECT, right: 400, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
  }

  function viewBoxUnder(svg: Element, clientX: number, clientY: number) {
    const [x, y, w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const scale = Math.min(RECT.width / w, RECT.height / h);
    return {
      x: x + (clientX - RECT.left - (RECT.width - w * scale) / 2) / scale,
      y: y + (clientY - RECT.top - (RECT.height - h * scale) / 2) / scale,
    };
  }

  it('wheel zoom keeps the point under the cursor fixed', async () => {
    render(<WorkflowDiagram root={root} />);
    const svg = screen.getByRole('group');
    stubRect(svg);

    const CX = 320, CY = 40;                       // deliberately off-centre, off-axis
    const before = viewBoxUnder(svg, CX, CY);
    fireEvent.wheel(svg, { deltaY: -100, clientX: CX, clientY: CY });
    const after = viewBoxUnder(svg, CX, CY);

    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('button zoom keeps the viewBox centre fixed, with no rect available', async () => {
    render(<WorkflowDiagram root={root} />);
    const svg = screen.getByRole('group');
    // No stubRect here on purpose: the centre anchor must not need a rect at all.
    const centreOf = () => {
      const [x, y, w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number);
      return { x: x + w / 2, y: y + h / 2 };
    };
    const before = centreOf();
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const after = centreOf();
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('wheel zoom on a zero-sized rect falls back to the centre anchor instead of NaN', () => {
    render(<WorkflowDiagram root={root} />);
    const svg = screen.getByRole('group');
    // jsdom's default rect is all zeros — no stub. The viewBox must stay finite.
    fireEvent.wheel(svg, { deltaY: -100, clientX: 10, clientY: 10 });
    const nums = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(nums.every(Number.isFinite)).toBe(true);
  });
});

// The global vitest.setup.ts stub returns false unconditionally, so the release guard in
// onPointerUp/onPointerCancel could never branch true in any test — the guard was
// inspection-verified only. A minimal real implementation, scoped to this file, exercises
// it. Deliberately not moved into vitest.setup.ts: Radix primitives across the suite rely
// on the always-false stub, and a real one there risks unrelated failures.
describe('pointer capture release', () => {
  const captured = new Set<number>();
  beforeEach(() => {
    captured.clear();
    vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation((id: number) => {
      captured.add(id);
    });
    vi.spyOn(Element.prototype, 'releasePointerCapture').mockImplementation((id: number) => {
      captured.delete(id);
    });
    vi.spyOn(Element.prototype, 'hasPointerCapture').mockImplementation((id: number) =>
      captured.has(id));
  });
  afterEach(() => vi.restoreAllMocks());

  it('releases capture taken by a pan gesture', () => {
    render(<WorkflowDiagram root={root} />);
    const svg = screen.getByRole('group');
    firePointer(svg, 'pointerdown', 10, 10, 7);
    expect(captured.has(7)).toBe(true);
    firePointer(svg, 'pointerup', 10, 10, 7);
    expect(captured.has(7)).toBe(false);
  });

  it('does not take capture when the gesture starts on a clickable step', () => {
    // The guard that keeps proxy drill-down working in real browsers: capturing here would
    // retarget the subsequent click to the <svg>, so the step's onClick would never fire.
    render(<WorkflowDiagram root={root} />);
    const step = screen.getByRole('button', { name: /Open Sub Task/ });
    firePointer(step, 'pointerdown', 10, 10, 9);
    expect(captured.has(9)).toBe(false);
  });
});
