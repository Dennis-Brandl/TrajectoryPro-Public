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
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RuntimeWorkflowMonitorSummary } from '@/lib/api/types';
import { RuntimeCard } from './RuntimeCard';

afterEach(cleanup);

const BASE: RuntimeWorkflowMonitorSummary = {
  id: 'rw1', workCenterId: 'w1', runtimeNumber: 1, runtimeLabel: 'MIX-20261007-001',
  masterName: 'Bottle Fill', masterOid: 'o1', masterVersion: '1.0.0', masterState: 'released',
  status: 'running', createdByName: 'Sam',  createdByLabel: null, createdAt: '2026-08-01T00:00:00Z',
  queuedAt: '2026-08-01T00:01:00Z', startedAt: '2026-08-01T00:02:00Z', completedAt: null,
  activeSteps: [], errorText: null,
};

describe('RuntimeCard', () => {
  it('renders RW number, name+version, status badge label, and the claimed step', () => {
    const rw: RuntimeWorkflowMonitorSummary = {
      ...BASE,
      activeSteps: [
        { stepOid: 's1', stepName: 'Fill Form', stepType: 'form', state: 'WAITING_USER', claimant: { userId: 'u1', name: 'Op One', presence: 'online' } },
      ],
    };
    render(<RuntimeCard rw={rw} onOpen={vi.fn()} />);
    // Content is now real static markup, not inside the button (the button is an empty
    // overlay) — so content queries target the whole render, same as `within(container)`.
    expect(screen.getByText('MIX-20261007-001')).toBeInTheDocument();
    expect(screen.getByText('Bottle Fill')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByText('Started')).toBeInTheDocument(); // runtimeStatusLabel('running')
    expect(screen.getByText('Fill Form')).toBeInTheDocument();
    expect(screen.getByText(/Claimed by Op One/)).toBeInTheDocument();
    // The overlay button itself is still present and still empty (no accessible content
    // of its own — its name comes solely from aria-label).
    expect(screen.getByRole('button', { name: 'MIX-20261007-001 details' })).toBeInTheDocument();
  });

  it('shows errorText when the runtime workflow has errored', () => {
    const rw: RuntimeWorkflowMonitorSummary = { ...BASE, status: 'errored', errorText: 'Step blew up' };
    render(<RuntimeCard rw={rw} onOpen={vi.fn()} />);
    expect(screen.getByText('Step blew up')).toBeInTheDocument();
  });

  it('shows only the first two active steps plus a +N more counter', () => {
    const rw: RuntimeWorkflowMonitorSummary = {
      ...BASE,
      activeSteps: [
        { stepOid: 's1', stepName: 'Step One', stepType: 'form', state: 'RUNNING', claimant: null },
        { stepOid: 's2', stepName: 'Step Two', stepType: 'form', state: 'RUNNING', claimant: null },
        { stepOid: 's3', stepName: 'Step Three', stepType: 'form', state: 'RUNNING', claimant: null },
      ],
    };
    render(<RuntimeCard rw={rw} onOpen={vi.fn()} />);
    expect(screen.getByText('Step One')).toBeInTheDocument();
    expect(screen.getByText('Step Two')).toBeInTheDocument();
    expect(screen.queryByText('Step Three')).not.toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });

  it('shows Offered for an unclaimed WAITING_USER step', () => {
    const rw: RuntimeWorkflowMonitorSummary = {
      ...BASE,
      activeSteps: [
        { stepOid: 's1', stepName: 'Fill Form', stepType: 'form', state: 'WAITING_USER', claimant: null },
      ],
    };
    render(<RuntimeCard rw={rw} onOpen={vi.fn()} />);
    expect(screen.getByText(/Offered/)).toBeInTheDocument();
  });

  // M-4 fix: a non-WAITING_USER active step is routed through the diagram's own humaniseState
  // helper rather than rendering the raw DB state — a gate parked WAITING_GATE now reads as
  // "Waiting on gate" instead of the raw enum value.
  it('humanises a WAITING_GATE step as "Waiting on gate" instead of the raw state', () => {
    const rw: RuntimeWorkflowMonitorSummary = {
      ...BASE,
      activeSteps: [
        { stepOid: 's1', stepName: 'Approval Gate', stepType: 'gate', state: 'WAITING_GATE', claimant: null },
      ],
    };
    render(<RuntimeCard rw={rw} onOpen={vi.fn()} />);
    expect(screen.getByText(/Waiting on gate/)).toBeInTheDocument();
    expect(screen.queryByText(/WAITING_GATE/)).not.toBeInTheDocument();
  });

  it('humanises a WAITING_PROPERTIES step as "Reading action properties" (spec 2026-09-04 §5.5)', () => {
    const rw: RuntimeWorkflowMonitorSummary = {
      ...BASE,
      activeSteps: [
        { stepOid: 's1', stepName: 'Read Level', stepType: 'script', state: 'WAITING_PROPERTIES', claimant: null },
      ],
    };
    render(<RuntimeCard rw={rw} onOpen={vi.fn()} />);
    expect(screen.getByText(/Reading action properties/)).toBeInTheDocument();
    expect(screen.queryByText(/WAITING_PROPERTIES/)).not.toBeInTheDocument();
  });

  // 2026-08-10 user-testing ticket revised D4: the invisible whole-card overlay stays, but a
  // visible "Monitor and Control" button now advertises the affordance. Exactly those two
  // interactive elements exist — controls themselves (Start/Delete/pause…) still live only in
  // the detail dialog.
  it('exposes exactly two buttons — the RW-{n} details overlay and Monitor and Control — both opening the dialog, no Start/Delete controls', async () => {
    const onOpen = vi.fn();
    const { container } = render(<RuntimeCard rw={BASE} onOpen={onOpen} />);
    expect(screen.queryByRole('button', { name: /Start/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(within(container).getAllByRole('button')).toHaveLength(2);
    expect(container.querySelectorAll('button, a, input, select, textarea')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'MIX-20261007-001 details' }));
    expect(onOpen).toHaveBeenCalledWith('rw1');
    onOpen.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Monitor and control MIX-20261007-001' }));
    expect(onOpen).toHaveBeenCalledWith('rw1');
  });
});
