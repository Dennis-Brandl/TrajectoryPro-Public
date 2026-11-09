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
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api/schedules', () => ({ schedules: { previewRunOnce: vi.fn(), runOnce: vi.fn(), clock: vi.fn() } }));
vi.mock('@/lib/api/work-centers', () => ({ workCenters: { update: vi.fn() } }));
import { schedules } from '@/lib/api/schedules';
import { workCenters } from '@/lib/api/work-centers';
import { ApiError } from '@/lib/api/client';
import type { MasterScheduleView } from '@/lib/api/types';
import { RunOnceDialog, runOnceMessage } from './RunOnceDialog';
import { ScheduleClockNote } from './ScheduleClockNote';
import { view } from './fixtures';

const master = {
  id: 'm1', workCenterId: 'w1', name: 'Fire alarm', recurrence: { type: 'manual' },
  items: [{ workflow: { name: 'Evacuate' }, chain: [{ workflow: { name: 'Headcount' }, triggerOn: ['completed'] }] }, { workflow: { name: 'Call Fire Department' } }],
} as unknown as MasterScheduleView;
const onClose = vi.fn();
const onStarted = vi.fn();
const result = { runtime: view({ label: 'RS-3', runOnce: true }), warnings: [] };
const renderDialog = () => render(<RunOnceDialog master={master} onClose={onClose} onStarted={onStarted} />);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(schedules.previewRunOnce).mockResolvedValue({ problems: [], warnings: [], timeZone: 'America/Chicago' });
  vi.mocked(schedules.runOnce).mockResolvedValue(result);
  vi.mocked(schedules.clock).mockResolvedValue({ timeZone: 'America/Chicago', workCenterZoneSet: true });
});
afterEach(cleanup);

describe('RunOnceDialog', () => {
  it('names what will start and starts it now on one click', async () => {
    renderDialog();
    const list = screen.getByRole('list', { name: 'Workflows that start' });
    expect(list.textContent).toContain('Evacuate and its chained workflows');
    expect(list.textContent).toContain('Call Fire Department');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start now' })).toBeEnabled());
    expect(schedules.runOnce).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Start now' }));
    expect(schedules.runOnce).toHaveBeenCalledWith('m1', undefined);
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(result, undefined));
  });

  it('a chosen time needs a value, is sent as typed, and shows the clock', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('radio', { name: 'At a date and time' }));
    await waitFor(() => expect(schedules.previewRunOnce).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Schedule run' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Start date and time'), { target: { value: '2026-11-09T09:50' } });
    expect(await screen.findByText('America/Chicago')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Schedule run' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Schedule run' }));
    expect(schedules.runOnce).toHaveBeenCalledWith('m1', '2026-11-09T09:50');
  });

  it('a preview problem blocks the start and is shown', async () => {
    vi.mocked(schedules.previewRunOnce).mockResolvedValue({
      problems: [{ path: 'items[0].workflow', code: 'WORKFLOW_NOT_FOUND', message: 'No Master Workflow "Evacuate"' }], warnings: [], timeZone: 'UTC',
    });
    renderDialog();
    expect((await screen.findByRole('alert')).textContent).toContain('No Master Workflow "Evacuate"');
    expect(screen.getByRole('button', { name: 'Start now' })).toBeDisabled();
  });

  it('a refused time stays in the dialog with the reason in plain words', async () => {
    vi.mocked(schedules.runOnce).mockRejectedValue(new ApiError(422, 'ENABLE_INVALID', 'The schedule cannot be started', {
      error: { details: [{ path: 'at', code: 'RUN_ONCE_TIME_PASSED', message: '2026-11-09 08:30 has already passed in America/Chicago' }] },
    }));
    renderDialog();
    await userEvent.click(screen.getByRole('radio', { name: 'At a date and time' }));
    fireEvent.change(screen.getByLabelText('Start date and time'), { target: { value: '2026-11-09T08:30' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Schedule run' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Schedule run' }));
    expect((await screen.findByRole('alert')).textContent).toContain('2026-11-09 08:30 has already passed in America/Chicago');
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('words the toast for now and for later', () => {
    expect(runOnceMessage(result.runtime)).toBe('Starting as RS-3');
    expect(runOnceMessage(result.runtime, '2026-11-09T09:00')).toBe('RS-3 will start Mon Nov 9, 09:00');
  });
});

describe('ScheduleClockNote', () => {
  const zone = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions');
  beforeEach(() => { zone.mockReturnValue({ timeZone: 'America/Chicago' } as Intl.ResolvedDateTimeFormatOptions); });

  it('warns when the work center has no zone and the fallback is not yours, and sets yours on request', async () => {
    vi.mocked(schedules.clock).mockResolvedValue({ timeZone: 'UTC', workCenterZoneSet: false });
    vi.mocked(workCenters.update).mockResolvedValue({} as never);
    render(<ScheduleClockNote workCenterId="w1" canSetZone />);
    expect((await screen.findByRole('alert')).textContent).toContain('read as UTC, not your America/Chicago');
    await userEvent.click(screen.getByRole('button', { name: 'Use America/Chicago for this work center' }));
    expect(workCenters.update).toHaveBeenCalledWith('w1', { timeZone: 'America/Chicago' });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText('America/Chicago')).toBeInTheDocument();
  });

  it('offers no button where a person cannot set it, and says when it could not be set', async () => {
    vi.mocked(schedules.clock).mockResolvedValue({ timeZone: 'UTC', workCenterZoneSet: false });
    render(<ScheduleClockNote workCenterId="w1" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    vi.mocked(workCenters.update).mockRejectedValue(new ApiError(403, 'forbidden', 'You cannot edit work centers'));
    render(<ScheduleClockNote workCenterId="w1" canSetZone />);
    await userEvent.click(await screen.findByRole('button', { name: /^Use / }));
    expect(await screen.findByText('You cannot edit work centers')).toBeInTheDocument();
  });

  it('stays quiet about a fallback that already matches you, or a zone the work center chose', async () => {
    vi.mocked(schedules.clock).mockResolvedValue({ timeZone: 'America/Chicago', workCenterZoneSet: false });
    render(<ScheduleClockNote workCenterId="w1" canSetZone />);
    expect(await screen.findByText('America/Chicago')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();
    vi.mocked(schedules.clock).mockResolvedValue({ timeZone: 'Europe/Paris', workCenterZoneSet: true });
    render(<ScheduleClockNote workCenterId="w1" canSetZone />);
    expect(await screen.findByText('Europe/Paris')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
