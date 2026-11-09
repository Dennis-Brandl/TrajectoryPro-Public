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
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { detail, view } from '@/components/schedules/fixtures';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/schedules', () => ({
  schedules: {
    listRuntimes: vi.fn(), listMasters: vi.fn(), getRuntime: vi.fn(), occurrences: vi.fn(), events: vi.fn(),
  },
}));
// The dialog stack is the navigation both the Runtime and History tabs use; this test only needs
// to know which target it was opened with.
vi.mock('@/components/runtime/RuntimeDialogStack', () => ({
  RuntimeDialogStack: ({ initial }: { initial: { kind: string; id: string } }) => <div>{`stack ${initial.kind} ${initial.id}`}</div>,
}));
import { schedules } from '@/lib/api/schedules';
import { SchedulesPane } from './SchedulesPane';

const run = (id: string, label: string, open: unknown) =>
  ({ id, itemId: 'i1', parentRunId: null, runtimeLabel: label, status: 'finished', finalState: 'completed', detail: null, acknowledgedAt: null, open, itemName: 'Mix Batch' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(schedules.listRuntimes).mockResolvedValue([view()]);
  vi.mocked(schedules.listMasters).mockResolvedValue([]);
  vi.mocked(schedules.getRuntime).mockResolvedValue(detail());
  vi.mocked(schedules.events).mockResolvedValue({ rows: [], total: 0 });
  vi.mocked(schedules.occurrences).mockResolvedValue({ total: 1, rows: [{
    id: 'o1', number: 1, scheduledAt: '2026-11-09T15:00:00Z', firedAt: null, origin: 'on_time',
    runs: [run('a', 'RW-LIVE', { kind: 'live', id: 'inst-live' }), run('b', 'RW-DONE', { kind: 'history', id: 'hist-1' }), run('c', 'RW-GONE', null)],
  }] } as never);
});
afterEach(cleanup);

describe('SchedulesPane run links', () => {
  it('opens a live run in the Runtime dialog, a finished one in History, and leaves an unreachable one as text', async () => {
    render(<SchedulesPane workCenterId="w1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'RS-12' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open RW-LIVE' }));
    expect(await screen.findByText('stack live inst-live')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open RW-GONE' })).toBeNull();
    expect(screen.getByText('RW-GONE')).toBeInTheDocument();
    cleanup();

    render(<SchedulesPane workCenterId="w1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'RS-12' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open RW-DONE' }));
    expect(await screen.findByText('stack history hist-1')).toBeInTheDocument();
  });
});
