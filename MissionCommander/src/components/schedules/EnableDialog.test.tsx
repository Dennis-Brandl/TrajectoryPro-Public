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
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/api/schedules', () => ({ schedules: { previewEnable: vi.fn(), enable: vi.fn() } }));
import { schedules } from '@/lib/api/schedules';
import { ApiError } from '@/lib/api/client';
import type { MasterScheduleView } from '@/lib/api/types';
import { EnableDialog } from './EnableDialog';

const master = { id: 'm1', workCenterId: 'w1', name: 'Day Production' } as MasterScheduleView;
const TIMES = ['2026-11-09T12:00:00Z', '2026-11-09T20:00:00Z', '2026-11-10T12:00:00Z'];
const onClose = vi.fn();
const onEnabled = vi.fn();
const renderDialog = () => render(<EnableDialog master={master} onClose={onClose} onEnabled={onEnabled} />);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(schedules.previewEnable).mockResolvedValue({ problems: [], warnings: [], nextFireTimes: TIMES, timeZone: 'UTC' });
  vi.mocked(schedules.enable).mockResolvedValue({ runtime: { id: 'r1', label: 'RS-3' }, warnings: [] } as never);
});
afterEach(cleanup);

describe('EnableDialog', () => {
  it('shows the first three fire times and enables', async () => {
    renderDialog();
    const list = await screen.findByRole('list', { name: 'First fire times' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Mon Nov 9, 12:00');
    await userEvent.click(screen.getByRole('button', { name: 'Enable Recurrence' }));
    await waitFor(() => expect(onEnabled).toHaveBeenCalledWith(expect.objectContaining({ runtime: expect.objectContaining({ label: 'RS-3' }) })));
    expect(schedules.enable).toHaveBeenCalledWith('m1');
  });

  it('lists the warnings, such as a workflow that is not Effective', async () => {
    vi.mocked(schedules.previewEnable).mockResolvedValue({ problems: [], warnings: ['"Pack" version 1.0.0 is Draft, not Effective'], nextFireTimes: TIMES });
    renderDialog();
    expect(await screen.findByText('"Pack" version 1.0.0 is Draft, not Effective')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable Recurrence' })).toBeEnabled();
  });

  it('problems found by the preview are listed and Enable is not offered', async () => {
    vi.mocked(schedules.previewEnable).mockResolvedValue({
      problems: [{ path: 'items[0].workflow', code: 'WORKFLOW_NOT_FOUND', message: 'No workflow named "Gone"' }], warnings: [], nextFireTimes: [],
    });
    renderDialog();
    expect(await screen.findByText(/No workflow named "Gone"/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable Recurrence' })).toBeDisabled();
  });

  it('a 422 lists every problem and keeps the dialog open', async () => {
    vi.mocked(schedules.enable).mockRejectedValue(new ApiError(422, 'validation', 'The schedule cannot be enabled', {
      error: { details: [
        { path: 'items[0].workflow', code: 'WORKFLOW_NOT_FOUND', message: 'No workflow named "Gone"' },
        { path: 'items[1].chain[0].params.Lot', code: 'PARAM_UNKNOWN', message: 'Pack has no parameter Lot' },
      ] },
    }));
    renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: 'Enable Recurrence' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/No workflow named "Gone"/)).toBeInTheDocument();
    expect(within(alert).getByText(/Pack has no parameter Lot/)).toBeInTheDocument();
    expect(onEnabled).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
