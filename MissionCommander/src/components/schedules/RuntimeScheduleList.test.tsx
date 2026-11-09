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
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { ApiError } from '@/lib/api/client';
import userEvent from '@testing-library/user-event';
import { view, preview } from './fixtures';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/schedules', () => ({
  schedules: {
    listRuntimes: vi.fn(), resumePreview: vi.fn(), pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue({}), cancel: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined),
  },
}));
import { schedules } from '@/lib/api/schedules';
import { RuntimeScheduleList } from './RuntimeScheduleList';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(schedules.listRuntimes).mockResolvedValue([
    view(),
    view({ id: 'r2', label: 'RS-13', name: 'Night', status: 'paused', needsAttention: { failed: 1, lost: 0, missedWindow: false } }),
  ]);
});
afterEach(cleanup);

describe('RuntimeScheduleList', () => {
  it('Remove shows only on an ended schedule, confirms first, then removes and refreshes', async () => {
    vi.mocked(schedules.listRuntimes).mockResolvedValue([
      view(), view({ id: 'r2', label: 'RS-13', status: 'finished', nextFireAt: null }), view({ id: 'r3', label: 'RS-14', status: 'cancelled', nextFireAt: null }),
    ]);
    render(<RuntimeScheduleList workCenterId="w1" canControl onOpen={() => {}} />);
    const remove = await screen.findByRole('button', { name: 'Remove RS-13' });
    expect(screen.getByRole('button', { name: 'Remove RS-14' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove RS-12' })).toBeNull();
    await userEvent.click(remove);
    expect(schedules.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').textContent).toContain('History');
    const calls = vi.mocked(schedules.listRuntimes).mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
    expect(schedules.remove).toHaveBeenCalledWith('r2');
    await waitFor(() => expect(vi.mocked(schedules.listRuntimes).mock.calls.length).toBeGreaterThan(calls));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Remove is absent without control, and a refusal is reported and leaves the row', async () => {
    vi.mocked(schedules.listRuntimes).mockResolvedValue([view({ id: 'r2', label: 'RS-13', status: 'cancelled', nextFireAt: null })]);
    const { unmount } = render(<RuntimeScheduleList workCenterId="w1" canControl={false} onOpen={() => {}} />);
    expect(await screen.findByText('RS-13')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove RS-13' })).toBeNull();
    unmount();
    const onError = vi.fn();
    const refusal = new ApiError(409, 'RUNTIME_SCHEDULE_STATE', 'RS-13 still has runs going. Remove it when they have ended.');
    vi.mocked(schedules.remove).mockRejectedValueOnce(refusal);
    render(<RuntimeScheduleList workCenterId="w1" canControl onOpen={() => {}} onError={onError} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove RS-13' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(refusal, 'Remove failed'));
    expect(screen.getByText('RS-13')).toBeInTheDocument();
  });

  it('shows label, status, next fire in the frozen zone, and Needs attention in words', async () => {
    render(<RuntimeScheduleList workCenterId="w1" canControl onOpen={() => {}} />);
    expect(await screen.findByText('RS-12')).toBeInTheDocument();
    expect(screen.getByText('Line 1 Day Production')).toBeInTheDocument();
    expect(screen.getAllByText('Mon Nov 9, 09:00')).toHaveLength(2);
    expect(screen.getAllByText(/America\/Chicago/)).toHaveLength(1); // zone named once, in the header
    expect(screen.getAllByText('Needs attention')).toHaveLength(1);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('canControl false hides every control', async () => {
    render(<RuntimeScheduleList workCenterId="w1" canControl={false} onOpen={() => {}} />);
    await screen.findByText('RS-12');
    for (const n of ['Pause', 'Resume', 'Cancel']) expect(screen.queryByRole('button', { name: new RegExp('^' + n) })).toBeNull();
  });

  it('Pause calls the API', async () => {
    render(<RuntimeScheduleList workCenterId="w1" canControl onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pause RS-12' }));
    await waitFor(() => expect(schedules.pause).toHaveBeenCalledWith('r1'));
  });

  it('Resume with nothing missed calls straight through, with no dialog', async () => {
    vi.mocked(schedules.resumePreview).mockResolvedValue(preview());
    render(<RuntimeScheduleList workCenterId="w1" canControl onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Resume RS-13' }));
    await waitFor(() => expect(schedules.resume).toHaveBeenCalledWith('r2', {}));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Resume with several missed opens the dialog and waits', async () => {
    vi.mocked(schedules.resumePreview).mockResolvedValue(preview({ missedCount: 3, missedFirst: '2026-11-09T16:00:00Z', missedLast: '2026-11-09T18:00:00Z' }));
    render(<RuntimeScheduleList workCenterId="w1" canControl onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Resume RS-13' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(schedules.resume).not.toHaveBeenCalled();
  });

  it('a picked radio survives the list refetching while the dialog is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      vi.mocked(schedules.resumePreview).mockResolvedValue(preview({ missedCount: 3, missedFirst: '2026-11-09T16:00:00Z', missedLast: '2026-11-09T18:00:00Z' }));
      render(<RuntimeScheduleList workCenterId="w1" canControl onOpen={() => {}} />);
      await user.click(await screen.findByRole('button', { name: 'Resume RS-13' }));
      await user.click(await screen.findByRole('radio', { name: 'Skip them all' }));
      const calls = vi.mocked(schedules.listRuntimes).mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
      expect(vi.mocked(schedules.listRuntimes).mock.calls.length).toBeGreaterThan(calls);
      expect(screen.getByRole('radio', { name: 'Skip them all' })).toBeChecked();
    } finally { vi.useRealTimers(); }
  });

  it('Decide missed starts opens the outage form and resumes with the choice', async () => {
    vi.mocked(schedules.listRuntimes).mockResolvedValue([view({ needsAttention: { failed: 0, lost: 0, missedWindow: true } })]);
    vi.mocked(schedules.resumePreview).mockResolvedValue(preview({ missedCount: 2, missedFirst: '2026-11-09T16:00:00Z', missedLast: '2026-11-09T17:00:00Z' }));
    render(<RuntimeScheduleList workCenterId="w1" canControl onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Decide missed starts for RS-12' }));
    expect(await screen.findByRole('heading', { name: /Missed starts for RS-12/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Skip them all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(schedules.resume).toHaveBeenCalledWith('r1', { missed: 'skip', expectedMissedCount: 2 }));
  });

  it('a count that changed under the dialog refreshes the preview, clears the choice and says why', async () => {
    const p = (n: number) => preview({ missedCount: n, missedFirst: '2026-11-09T16:00:00Z', missedLast: '2026-11-09T18:00:00Z' });
    vi.mocked(schedules.resumePreview).mockResolvedValueOnce(p(97)).mockResolvedValueOnce(p(98));
    vi.mocked(schedules.resume).mockRejectedValueOnce(new ApiError(400, 'validation', 'The number of missed starts changed: 98 now.'));
    const onError = vi.fn();
    render(<RuntimeScheduleList workCenterId="w1" canControl onError={onError} onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Resume RS-13' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Start all 97' }));
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(await screen.findByRole('radio', { name: 'Start all 98' })).not.toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent('The number of missed starts changed: 98 now.');
    expect(schedules.resume).toHaveBeenCalledWith('r2', { missed: 'all', expectedMissedCount: 97 });
    expect(onError).not.toHaveBeenCalled();
  });

  it('Cancel needs a reason, then calls the API', async () => {
    render(<RuntimeScheduleList workCenterId="w1" canControl onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel RS-12' }));
    await userEvent.type(screen.getByLabelText('Reason'), 'done');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel Runtime Schedule' }));
    await waitFor(() => expect(schedules.cancel).toHaveBeenCalledWith('r1', 'done'));
  });

  it('reports a failed control through onError', async () => {
    const err = new Error('nope');
    vi.mocked(schedules.pause).mockRejectedValue(err);
    const onError = vi.fn();
    render(<RuntimeScheduleList workCenterId="w1" canControl onError={onError} onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pause RS-12' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(err, 'Pause failed'));
  });
});
