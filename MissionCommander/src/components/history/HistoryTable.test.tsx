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
import type { RuntimeHistorySummary } from '@/lib/api/types';
import { HistoryTable } from './HistoryTable';

afterEach(cleanup);

const ROW: RuntimeHistorySummary = {
  id: 'h1', workflowInstanceId: 'wi1', workCenterId: 'w1', workCenterName: 'Assembly',
  runtimeNumber: 7, runtimeLabel: 'RW-7', masterName: 'Bottle Fill', masterOid: 'o1', masterVersion: '1.0.0', masterState: 'released',
  finalState: 'completed', startedAt: '2026-08-01T00:00:00.000Z', finishedAt: '2026-08-01T00:04:32.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
};

describe('HistoryTable', () => {
  it('shows the empty state when there are no rows', () => {
    render(<HistoryTable rows={[]} onOpen={vi.fn()} />);
    expect(screen.getByText('No history')).toBeInTheDocument();
  });

  it('renders RW number, workflow name+version, status, started/finished, and duration', () => {
    render(<HistoryTable rows={[ROW]} onOpen={vi.fn()} />);
    expect(screen.getByText('RW-7')).toBeInTheDocument();
    expect(screen.getByText('Bottle Fill')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByText(new Date(ROW.startedAt!).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText(new Date(ROW.finishedAt).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText('4m 32s')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument(); // RuntimeStatusBadge label
  });

  it('omits the work-center column by default and shows it when showWorkCenter is set', () => {
    render(<HistoryTable rows={[ROW]} onOpen={vi.fn()} />);
    expect(screen.queryByText('Assembly')).not.toBeInTheDocument();
    cleanup();
    render(<HistoryTable rows={[ROW]} onOpen={vi.fn()} showWorkCenter />);
    expect(screen.getByText('Assembly')).toBeInTheDocument();
  });

  it('opens the row with an accessible "History RW-{n}" name and calls onOpen with the row id', async () => {
    const onOpen = vi.fn();
    render(<HistoryTable rows={[ROW]} onOpen={onOpen} />);
    const row = screen.getByRole('button', { name: 'History RW-7' });
    await userEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith('h1');
  });

  it('opens the row via keyboard (Enter)', async () => {
    const onOpen = vi.fn();
    render(<HistoryTable rows={[ROW]} onOpen={onOpen} />);
    const row = screen.getByRole('button', { name: 'History RW-7' });
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith('h1');
  });
});
