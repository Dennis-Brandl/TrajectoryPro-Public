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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { view, detail } from '@/components/schedules/fixtures';
import type { MasterScheduleView, OccurrencePage } from '@/lib/api/types';

const { api, toast, refresh, navigate, mode } = vi.hoisted(() => ({
  api: {
    listRuntimes: vi.fn(), listMasters: vi.fn(), getRuntime: vi.fn(), occurrences: vi.fn(), events: vi.fn(),
    pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), acknowledge: vi.fn(), setItemDisabled: vi.fn(),
    previewEnable: vi.fn(), enable: vi.fn(), resumePreview: vi.fn(), deleteMaster: vi.fn(),
    previewRunOnce: vi.fn(), runOnce: vi.fn(), clock: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  refresh: vi.fn(),
  navigate: vi.fn(),
  mode: { current: 'full' as 'full' | 'view-only' },
}));
vi.mock('@/lib/api/schedules', () => ({ schedules: api }));
vi.mock('sonner', () => ({ toast }));
vi.mock('~/stores/meStore', () => ({ useMeStore: { getState: () => ({ refresh }) } }));
vi.mock('~/components/shell/WorkCenterShell', () => ({ useWorkCenter: () => ({ id: 'wc1', name: 'Alpha', mode: mode.current }) }));
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => navigate,
    Link: ({ to, params, children, ...rest }: { to: string; params: Record<string, string>; children: React.ReactNode }) =>
      <a href={to.replace(/\$(\w+)/g, (_m, k: string) => params[k])} {...rest}>{children}</a>,
  };
});

import { ApiError } from '@/lib/api/client';
import { VIEW_ONLY_TEXT } from '~/lib/view-only';
import { useScheduleAttentionStore, scheduleAttentionCount } from '~/stores/scheduleAttentionStore';
import { SchedulesView, ScheduleDetailView } from './SchedulesView';

const master = (over: Partial<MasterScheduleView> = {}): MasterScheduleView =>
  ({ id: 'm1', name: 'Weekday batches', recurrence: { type: 'weekly' }, recurrenceText: 'Weekdays at 06:00', source: 'commander', items: [{ workflow: { name: 'Blend' } }], ...over }) as MasterScheduleView;

const page = (runs: OccurrencePage['rows'][number]['runs']): OccurrencePage => ({
  total: 1,
  rows: [{ id: 'o1', number: 7, scheduledAt: '2026-11-09T15:00:00Z', firedAt: null, origin: 'on_time', runs }],
});
const run = (over: Record<string, unknown> = {}) => ({
  id: 'run1', itemId: 'i1', itemName: 'Mix Batch', parentRunId: null, runtimeLabel: 'RW-5', status: 'started',
  finalState: null, detail: null, acknowledgedAt: null, open: { kind: 'live', id: 'rw5' }, ...over,
}) as never;

const count = () => scheduleAttentionCount(useScheduleAttentionStore.getState(), 'wc1');

beforeEach(() => {
  vi.clearAllMocks();
  mode.current = 'full';
  refresh.mockResolvedValue(undefined);
  useScheduleAttentionStore.setState({ wcId: null, flagged: [] });
  api.listRuntimes.mockResolvedValue([view()]);
  api.listMasters.mockResolvedValue([master()]);
  api.getRuntime.mockResolvedValue(detail());
  api.occurrences.mockResolvedValue(page([run()]));
  api.events.mockResolvedValue({ rows: [], total: 0 });
  api.pause.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('SchedulesView', () => {
  it('lists Runtime Schedules first, then a compact Masters list with Enable and no Edit or Delete', async () => {
    render(<SchedulesView wcId="wc1" />);
    const headings = (await screen.findAllByRole('heading')).map((h) => h.textContent);
    expect(headings).toEqual(['Runtime Schedules', 'Master Schedules']);
    expect(await screen.findByRole('button', { name: 'Enable Recurrence Weekday batches' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New Master Schedule' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause RS-12' })).toBeInTheDocument();
  });

  it('opens a Runtime Schedule on its own route', async () => {
    render(<SchedulesView wcId="wc1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'RS-12' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/wc/$wcId/schedules/$runtimeId', params: { wcId: 'wc1', runtimeId: 'r1' } });
  });

  it('Enable shows the confirmation dialog, then enables and says so', async () => {
    api.previewEnable.mockResolvedValue({ problems: [], warnings: [], nextFireTimes: ['2026-11-09T12:00:00Z'], timeZone: 'UTC' });
    api.enable.mockResolvedValue({ runtime: view({ label: 'RS-13' }), warnings: [] });
    render(<SchedulesView wcId="wc1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable Recurrence Weekday batches' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('list', { name: 'First fire times' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enable Recurrence' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Recurrence enabled as RS-13'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Run Once confirms, starts, and says so', async () => {
    api.previewRunOnce.mockResolvedValue({ problems: [], warnings: [], timeZone: 'UTC' });
    api.runOnce.mockResolvedValue({ runtime: view({ label: 'RS-14', runOnce: true }), warnings: [] });
    render(<SchedulesView wcId="wc1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run Once Weekday batches' }));
    const dialog = await screen.findByRole('dialog');
    const start = within(dialog).getByRole('button', { name: 'Start now' });
    await waitFor(() => expect(start).toBeEnabled());
    expect(api.runOnce).not.toHaveBeenCalled();
    fireEvent.click(start);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Starting as RS-14'));
    expect(api.runOnce).toHaveBeenCalledWith('m1', undefined);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('view-only: no controls at all', async () => {
    mode.current = 'view-only';
    render(<SchedulesView wcId="wc1" />);
    await screen.findByRole('button', { name: 'RS-12' });
    expect(screen.queryByRole('button', { name: /^Pause / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cancel / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Enable / })).toBeNull();
  });

  it('a 403 from a control shows the view-only text and re-reads the rights', async () => {
    api.pause.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Forbidden'));
    render(<SchedulesView wcId="wc1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause RS-12' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(VIEW_ONLY_TEXT));
    expect(refresh).toHaveBeenCalled();
  });

  it('feeds the Needs attention count from the polled list', async () => {
    api.listRuntimes.mockResolvedValue([
      view({ id: 'a', label: 'RS-1', needsAttention: { failed: 1, lost: 0, missedWindow: false } }),
      view({ id: 'b', label: 'RS-2' }),
      view({ id: 'c', label: 'RS-3', needsAttention: { failed: 0, lost: 0, missedWindow: true } }),
    ]);
    render(<SchedulesView wcId="wc1" />);
    await screen.findByRole('button', { name: 'RS-1' });
    await waitFor(() => expect(count()).toBe(2));
  });
});

describe('ScheduleDetailView', () => {
  it('links a live run to Running and a finished run to History', async () => {
    api.occurrences.mockResolvedValue(page([run(), run({ id: 'run2', runtimeLabel: 'RW-4', open: { kind: 'history', id: 'h4' } })]));
    render(<ScheduleDetailView wcId="wc1" runtimeId="r1" />);
    const live = await screen.findByRole('link', { name: 'RW-5' });
    expect(live).toHaveAttribute('href', '/wc/$wcId/running/$runtimeId'.replace('$wcId', 'wc1').replace('$runtimeId', 'rw5'));
    expect(screen.getByRole('link', { name: 'RW-4' })).toHaveAttribute('href', '/wc/wc1/history/h4');
  });

  it('Back returns to the schedules list', async () => {
    render(<ScheduleDetailView wcId="wc1" runtimeId="r1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Runtime Schedules' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/wc/$wcId/schedules', params: { wcId: 'wc1' } });
  });

  it('the Needs attention count clears after Dismiss', async () => {
    const flagged = detail({ needsAttention: { failed: 1, lost: 0, missedWindow: false } });
    api.getRuntime.mockResolvedValueOnce(flagged).mockResolvedValue(detail());
    api.occurrences.mockResolvedValue(page([run({ status: 'failed_to_start', open: null })]));
    api.acknowledge.mockResolvedValue({ dismissed: 1 });
    render(<ScheduleDetailView wcId="wc1" runtimeId="r1" />);
    await waitFor(() => expect(count()).toBe(1));
    fireEvent.click(await screen.findByRole('button', { name: /^Dismiss Mix Batch/ }));
    await waitFor(() => expect(api.acknowledge).toHaveBeenCalledWith('r1', ['run1']));
    await waitFor(() => expect(count()).toBe(0));
  });

  it('view-only: no Dismiss, Pause or Disable', async () => {
    mode.current = 'view-only';
    api.occurrences.mockResolvedValue(page([run({ status: 'failed_to_start', open: null })]));
    render(<ScheduleDetailView wcId="wc1" runtimeId="r1" />);
    await screen.findByText('Occurrence 7');
    expect(screen.queryByRole('button', { name: /^Dismiss/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Pause / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Disable / })).toBeNull();
  });
});
