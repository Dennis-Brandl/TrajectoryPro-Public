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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '@/lib/api/runtime-workflows';
import type { RuntimeWorkflowDiagram, RuntimeWorkflowLiveStates } from '@/lib/api/types';
import { RuntimeDiagramCard } from './RuntimeDiagramCard';

const CHILD = {
  oid: 'child-1', name: 'Sub', version: '1', state: null, notation: 'flowchart' as const,
  steps: [{ oid: 'c-1', name: 'Child Step', stepType: 'USER_INTERACTION', x: 50, y: 50, childSpecOid: null }],
  connections: [], children: [],
};
const DIAGRAM: RuntimeWorkflowDiagram = {
  instanceId: 'rw1', runtimeNumber: 1, runtimeLabel: 'MIX-20261007-001', masterName: 'Mix',
  root: {
    oid: 'wf-1', name: 'Mix', version: '1', state: null, notation: 'flowchart',
    steps: [
      { oid: 's-1', name: 'Fill Details', stepType: 'USER_INTERACTION', x: 100, y: 100, childSpecOid: null },
      { oid: 's-2', name: 'Sub', stepType: 'WORKFLOW PROXY', x: 100, y: 200, childSpecOid: 'child-1' },
      { oid: 's-3', name: 'Temp Gate', stepType: 'GATE', x: 100, y: 300, childSpecOid: null },
    ],
    connections: [], children: [CHILD],
  },
};
const LIVE: RuntimeWorkflowLiveStates = {
  instanceId: 'rw1', status: 'running',
  steps: {
    's-1': { state: 'WAITING_USER', nodeOid: 'wf-1', error: null,
      assignment: { id: 'a1', status: 'offered', claimant: null, mine: false } },
  },
  childActive: {},
};

beforeEach(() => {
  vi.spyOn(api.runtimeWorkflows, 'diagram').mockResolvedValue(DIAGRAM);
  vi.spyOn(api.runtimeWorkflows, 'liveStates').mockResolvedValue(LIVE);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function card(overrides: Partial<React.ComponentProps<typeof RuntimeDiagramCard>> = {}) {
  const onAssign = vi.fn();
  const onForceRelease = vi.fn();
  render(<RuntimeDiagramCard instanceId="rw1" canCommand busy={false}
    onAssign={onAssign} onForceRelease={onForceRelease} {...overrides} />);
  return { onAssign, onForceRelease };
}

describe('RuntimeDiagramCard', () => {
  it('renders the live-colored diagram and the legend', async () => {
    card();
    const g = await screen.findByRole('img', { name: 'Workflow diagram: Mix' });
    expect(g.querySelector('[data-step-oid="s-1"]')).toHaveAttribute('data-state', 'WAITING_USER');
    expect(screen.getByText('Executing')).toBeInTheDocument(); // legend entry
  });

  it('tapping a step opens the tooltip; an offered step exposes Assign wired to the callback', async () => {
    const { onAssign } = card();
    await screen.findByRole('img', { name: 'Workflow diagram: Mix' });
    fireEvent.click(document.querySelector('[data-step-oid="s-1"]')!);
    expect(await screen.findByText('Waiting for operator')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(onAssign).toHaveBeenCalledWith('a1', 'Fill Details');
  });

  it('tapping a WORKFLOW PROXY with a resolvable child drills down; the breadcrumb returns', async () => {
    card();
    await screen.findByRole('img', { name: 'Workflow diagram: Mix' });
    fireEvent.click(document.querySelector('[data-step-oid="s-2"]')!);
    expect(await screen.findByRole('img', { name: 'Workflow diagram: Sub' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'MIX-20261007-001 Mix' }));
    expect(await screen.findByRole('img', { name: 'Workflow diagram: Mix' })).toBeInTheDocument();
  });

  it('the breadcrumb clears an open tooltip when jumping levels', async () => {
    card();
    await screen.findByRole('img', { name: 'Workflow diagram: Mix' });
    fireEvent.click(document.querySelector('[data-step-oid="s-2"]')!);
    await screen.findByRole('img', { name: 'Workflow diagram: Sub' });
    fireEvent.click(document.querySelector('[data-step-oid="c-1"]')!);
    // "Not started" (humanised IDLE) lives only in the tooltip's state line, unlike the step
    // name — which is ambiguous with the SVG's own <text> label for the same node.
    expect(await screen.findByText('Not started')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'MIX-20261007-001 Mix' }));
    expect(await screen.findByRole('img', { name: 'Workflow diagram: Mix' })).toBeInTheDocument();
    expect(screen.queryByText('Not started')).toBeNull();
  });

  it('non-commander: the tooltip renders info but no claim controls', async () => {
    card({ canCommand: false });
    await screen.findByRole('img', { name: 'Workflow diagram: Mix' });
    fireEvent.click(document.querySelector('[data-step-oid="s-1"]')!);
    expect(await screen.findByText('Waiting for operator')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
  });

  it('an armed GATE tooltip names the action it controls and its arming state (GATE follow-up 8c)', async () => {
    vi.spyOn(api.runtimeWorkflows, 'liveStates').mockResolvedValue({
      ...LIVE,
      steps: {
        ...LIVE.steps,
        's-3': { state: 'WAITING_GATE', nodeOid: 'wf-1', error: null, assignment: null,
          armedGate: { predecessorOid: 's-1', open: false, stopSent: false } },
      },
    });
    card();
    await screen.findByRole('img', { name: 'Workflow diagram: Mix' });
    fireEvent.click(document.querySelector('[data-step-oid="s-3"]')!);
    expect(await screen.findByText('Controls Fill Details · evaluating')).toBeInTheDocument();
    cleanup();

    vi.spyOn(api.runtimeWorkflows, 'liveStates').mockResolvedValue({
      ...LIVE,
      steps: { ...LIVE.steps, 's-3': { state: 'WAITING_GATE', nodeOid: 'wf-1', error: null, assignment: null,
        armedGate: { predecessorOid: 's-1', open: true, stopSent: true } } },
    });
    card();
    await screen.findByRole('img', { name: 'Workflow diagram: Mix' });
    fireEvent.click(document.querySelector('[data-step-oid="s-3"]')!);
    expect(await screen.findByText('Controls Fill Details · open, STOP requested')).toBeInTheDocument();
  });
});
