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
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResumeDialog } from './ResumeDialog';
import { preview, view } from './fixtures';

afterEach(cleanup);
const held = (id: string, name: string) => ({
  id, itemId: 'i-' + id, name, occurrenceNumber: 1, scheduledAt: '2026-11-09T15:00:00Z',
  fromRunLabel: 'RW-101', fromFinalState: 'completed', fromFinishedAt: '2026-11-09T17:02:00Z', disabled: false,
});
const open = (p: ReturnType<typeof preview>, onConfirm = vi.fn(), outage = false) =>
  render(<ResumeDialog schedule={view()} preview={p} outage={outage} onConfirm={onConfirm} onClose={() => {}} />);

describe('ResumeDialog', () => {
  it('with one missed start defaults to Start it', async () => {
    const onConfirm = vi.fn();
    open(preview({ missedCount: 1, missedFirst: '2026-11-09T16:00:00Z', missedLast: '2026-11-09T16:00:00Z' }), onConfirm);
    expect(screen.getByRole('radio', { name: 'Start it' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onConfirm).toHaveBeenCalledWith({ missed: 'all', expectedMissedCount: 1 });
  });

  it('with 97 missed makes you choose, and words the choices from the spec', async () => {
    const onConfirm = vi.fn();
    open(preview({ missedCount: 97, missedFirst: '2026-11-09T16:00:00Z', missedLast: '2026-11-14T16:00:00Z' }), onConfirm);
    expect(screen.getByText(/Missed scheduled starts: 97 \(Mon 10:00 … Sat 10:00\)/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Start all 97' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Start only the latest (Sat 10:00)' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Skip them all' })).toBeInTheDocument();
    const resume = screen.getByRole('button', { name: 'Resume' });
    expect(resume).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Skip them all' }));
    expect(resume).toBeEnabled();
    await userEvent.click(resume);
    expect(onConfirm).toHaveBeenCalledWith({ missed: 'skip', expectedMissedCount: 97 });
  });

  it('over the limit, Start all is unavailable and says why', () => {
    open(preview({ missedCount: 501, missedMore: true, startAllAllowed: false, missedFirst: '2026-11-09T16:00:00Z', missedLast: '2026-11-14T16:00:00Z' }));
    expect(screen.getByRole('radio', { name: /Start all/ })).toBeDisabled();
    expect(screen.getByText(/more than 500/i, { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Skip them all' })).toBeEnabled();
  });

  it('held chains are ticked by default and the unticked ones are sent as skipped', async () => {
    const onConfirm = vi.fn();
    open(preview({ held: [held('h1', 'Move Material'), held('h2', 'Lab Test')] }), onConfirm);
    expect(screen.getByRole('checkbox', { name: /Move Material/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Lab Test/ })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: /Lab Test/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onConfirm).toHaveBeenCalledWith({ expectedMissedCount: 0, heldChains: { start: ['h1'], skip: ['h2'] } });
  });

  it('opens with the spec line: when, by whom, how long ago', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-13T17:14:00Z') });
    try {
      open(preview({ pausedAt: '2026-11-09T15:14:00Z', pausedBy: 'jsmith' }));
      expect(screen.getByText('Paused Monday 09:14 by jsmith, 4 days 2 hours ago')).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('a refreshed preview with a different count clears the radio choice', async () => {
    const p = (n: number) => preview({ missedCount: n, missedFirst: '2026-11-09T16:00:00Z', missedLast: '2026-11-14T16:00:00Z' });
    const props = { schedule: view(), onConfirm: vi.fn(), onClose: () => {} };
    const { rerender } = render(<ResumeDialog {...props} preview={p(97)} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Start all 97' }));
    expect(screen.getByRole('radio', { name: 'Start all 97' })).toBeChecked();
    rerender(<ResumeDialog {...props} preview={p(98)} notice="The number of missed starts changed: 98 now." />);
    expect(screen.getByRole('radio', { name: 'Start all 98' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('The number of missed starts changed: 98 now.');
  });

  it('the outage form has its own heading', () => {
    open(preview({ missedCount: 2, missedFirst: '2026-11-09T16:00:00Z', missedLast: '2026-11-09T17:00:00Z' }), vi.fn(), true);
    expect(screen.getByRole('heading', { name: /Missed starts for RS-12/ })).toBeInTheDocument();
  });
});
