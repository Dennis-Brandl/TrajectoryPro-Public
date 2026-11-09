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
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/runtime-history', () => ({ runtimeHistory: { passDetail: vi.fn(), removePass: vi.fn() } }));
const principal = vi.hoisted(() => ({ admin: false, commander: false }));
vi.mock('@/stores/principalStore', () => ({
  usePrincipalStore: (pick: (s: { principal: { isAdministrator: boolean } }) => unknown) => pick({ principal: { isAdministrator: principal.admin } }),
  useMissionSystemCommander: () => principal.commander,
}));
import { runtimeHistory } from '@/lib/api/runtime-history';
import type { HistoryEntry, ScheduleHistoryDetail } from '@/lib/api/types';
import { ScheduleHistoryDialog } from './ScheduleHistoryDialog';
import { HistoryTable } from './HistoryTable';
import { passOutcome, workflowResult } from './ScheduleHistoryRecord';

const wf = (over: Partial<ScheduleHistoryDetail['workflows'][number]>) => ({
  runId: 'r1', parentRunId: null, name: 'Blend', version: '1.0.0', status: 'finished', finalState: 'completed',
  runtimeLabel: 'RW-4', workflowInstanceId: 'i1', startedAt: '2026-11-09T15:00:05Z', finishedAt: '2026-11-09T15:10:00Z',
  startingValues: { BatchId: 'B-7', Size: '' }, detail: null, historyId: 'h4', ...over,
}) as ScheduleHistoryDetail['workflows'][number];

const PASS: ScheduleHistoryDetail = {
  id: 'p1', workCenterId: 'w1', workCenterName: 'Line 1', scheduleLabel: 'RS-3', scheduleName: 'Nightly', runOnce: false,
  occurrenceNumber: 2, scheduledAt: '2026-11-09T15:00:00Z', startedAt: '2026-11-09T15:00:05Z', finishedAt: '2026-11-09T15:30:00Z',
  timeZone: 'America/Chicago', origin: 'on_time', runtimeScheduleId: 'rs3',
  counts: { ran: 2, completed: 1, problems: 1, notStarted: 1 },
  workflows: [
    wf({}),
    wf({ runId: 'r2', parentRunId: 'r1', name: 'Move', runtimeLabel: 'RW-5', finalState: 'aborted', historyId: null, startingValues: { BatchId: 'B-7' } }),
    wf({ runId: 'r3', parentRunId: 'r1', name: 'Lab', status: 'not_triggered', finalState: null, runtimeLabel: null, workflowInstanceId: null, startedAt: null, finishedAt: null, startingValues: null, historyId: null }),
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  principal.admin = false; principal.commander = false;
  vi.mocked(runtimeHistory.passDetail).mockResolvedValue(PASS);
  vi.mocked(runtimeHistory.removePass).mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('ScheduleHistoryDialog', () => {
  it('lists each workflow with its label, result, times and starting values, chains marked under their parent', async () => {
    const onOpenRun = vi.fn();
    render(<ScheduleHistoryDialog id="p1" onClose={() => {}} onDeleted={() => {}} onOpenRun={onOpenRun} />);
    expect(await screen.findByRole('heading', { name: 'RS-3 pass 2' })).toBeInTheDocument();
    expect(screen.getByText('Times are in America/Chicago.')).toBeInTheDocument();
    expect(screen.getByText('1 completed, 1 with problems, 1 not started')).toBeInTheDocument();
    const blend = screen.getByRole('listitem', { name: 'Workflow Blend' });
    expect(within(blend).getByText('Completed')).toBeInTheDocument();
    const values = within(blend).getByLabelText('Starting values of Blend');
    expect(values.textContent).toContain('BatchId');
    expect(values.textContent).toContain('B-7');
    expect(within(screen.getByRole('listitem', { name: 'Workflow Move' })).getByText('RW-5').tagName).not.toBe('BUTTON');
    expect(within(screen.getByRole('listitem', { name: 'Workflow Lab' })).getByText('Not triggered')).toBeInTheDocument();
    await userEvent.click(within(blend).getByRole('button', { name: 'Open RW-4' }));
    expect(onOpenRun).toHaveBeenCalledWith('h4');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('a Mission System Commander deletes after confirming', async () => {
    principal.commander = true;
    const onDeleted = vi.fn(); const onClose = vi.fn();
    render(<ScheduleHistoryDialog id="p1" onClose={onClose} onDeleted={onDeleted} onOpenRun={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(runtimeHistory.removePass).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete pass' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(runtimeHistory.removePass).toHaveBeenCalledWith('p1');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('HistoryTable with schedule passes', () => {
  it('a pass row says what ran and opens through onOpenPass', async () => {
    const onOpen = vi.fn(); const onOpenPass = vi.fn();
    const { id: _i, workflows: _w, origin: _o, runtimeScheduleId: _r, ...summary } = PASS;
    const rows: HistoryEntry[] = [{ kind: 'schedule', id: 'p1', ...summary }];
    render(<HistoryTable rows={rows} onOpen={onOpen} onOpenPass={onOpenPass} />);
    const row = screen.getByRole('button', { name: 'Schedule pass RS-3 pass 2' });
    expect(row.textContent).toContain('Nightly');
    expect(row.textContent).toContain('1 completed, 1 with problems');
    await userEvent.click(row);
    expect(onOpenPass).toHaveBeenCalledWith('p1');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('words results and outcomes', () => {
    expect(workflowResult({ status: 'finished', finalState: 'errored' })).toBe('Errored');
    expect(workflowResult({ status: 'failed_to_start', finalState: null })).toBe('Failed to start');
    expect(passOutcome({ ran: 3, completed: 3, problems: 0, notStarted: 0 })).toBe('3 completed');
  });
});
