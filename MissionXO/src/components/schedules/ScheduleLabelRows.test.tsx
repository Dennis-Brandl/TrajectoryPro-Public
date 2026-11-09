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
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { HistoryEntry, RuntimeWorkflowMonitorSummary } from '@/lib/api/types';
import { RuntimeRow } from '~/components/running/RuntimeRow';
import { HistoryList } from '~/components/history/HistoryList';

afterEach(cleanup);

describe('scheduled runs in Running and History rows', () => {
  const running = (scheduleLabel: string | null) => ({
    id: 'r1', runtimeLabel: 'RW-5', masterName: 'Mix', masterVersion: '1.0.0', status: 'running', activeSteps: [],
    startedAt: null, createdByName: null, scheduleLabel,
  }) as unknown as RuntimeWorkflowMonitorSummary;
  const history = (scheduleLabel: string | null) => ({
    kind: 'workflow', id: 'h1', runtimeLabel: 'RW-4', masterName: 'Mix', masterVersion: '1.0.0', finalState: 'completed',
    startedAt: '2026-11-08T10:00:00Z', finishedAt: '2026-11-08T10:05:00Z', scheduleLabel,
  }) as unknown as HistoryEntry;

  it('a Running row shows the schedule label when present', () => {
    render(<RuntimeRow runtime={running('RS-12 / occurrence 7')} selected={false} onSelect={() => {}} />);
    expect(screen.getByText(/RW-5 · RS-12 \/ occurrence 7/)).toBeInTheDocument();
  });
  it('a Running row without one is unchanged', () => {
    render(<RuntimeRow runtime={running(null)} selected={false} onSelect={() => {}} />);
    expect(screen.getByText(/RW-5/).textContent).not.toContain('RS-');
  });
  it('a History row shows the schedule label when present', () => {
    render(<HistoryList rows={[history('RS-12 / occurrence 7')]} onSelect={() => {}} now={new Date('2026-11-08T12:00:00Z')} />);
    expect(screen.getByText(/RW-4 · RS-12 \/ occurrence 7 · finished/)).toBeInTheDocument();
  });
  it('a History row without one is unchanged', () => {
    render(<HistoryList rows={[history(null)]} onSelect={() => {}} now={new Date('2026-11-08T12:00:00Z')} />);
    expect(screen.getByText(/RW-4 · finished/)).toBeInTheDocument();
  });
  it('a schedule pass row names the schedule and its result, and opens through onSelectPass', () => {
    const onSelect = vi.fn(); const onSelectPass = vi.fn();
    const pass = {
      kind: 'schedule', id: 'p1', scheduleLabel: 'RS-3', scheduleName: 'Fire alarm', runOnce: true, occurrenceNumber: 1,
      startedAt: '2026-11-08T10:00:00Z', finishedAt: '2026-11-08T10:30:00Z', counts: { ran: 2, completed: 1, problems: 1, notStarted: 0 },
    } as unknown as HistoryEntry;
    render(<HistoryList rows={[pass]} onSelect={onSelect} onSelectPass={onSelectPass} now={new Date('2026-11-08T12:00:00Z')} />);
    const row = screen.getByRole('option', { name: 'Schedule pass RS-3 Run Once' });
    expect(row.textContent).toContain('Fire alarm');
    expect(row.textContent).toContain('Problems');
    expect(row.textContent).toContain('1 completed, 1 with problems');
    fireEvent.click(row);
    expect(onSelectPass).toHaveBeenCalledWith('p1');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
