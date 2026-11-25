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
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const SAVED = vi.hoisted(() => ({ id: 'm1', workCenterId: 'w1', name: 'Day Production', revision: 2 }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/stores/principalStore', () => ({
  useMissionSystemCommander: () => true,
  usePrincipalStore: (pick: (s: { principal: { loginName: string } }) => unknown) => pick({ principal: { loginName: 'una' } }),
}));
vi.mock('@/lib/api/schedules', () => ({ schedules: { listRuntimes: vi.fn(), listMasters: vi.fn(), enable: vi.fn() } }));
vi.mock('@/components/runtime/RuntimeDialogStack', () => ({ RuntimeDialogStack: () => null }));
vi.mock('@/components/schedules/MasterScheduleEditor', () => ({
  MasterScheduleEditor: ({ master, onClose, onSaved }: {
    master: { name: string } | null; onClose: () => void;
    onSaved: (saved: unknown, then?: { enable: true; reason: string; saved: boolean }) => void;
  }) => (
    <div>{`editor ${master?.name ?? 'new'}`}<button type="button" onClick={onClose}>Close editor</button>
      <button type="button" onClick={() => onSaved(SAVED, { enable: true, reason: 'New time', saved: true })}>Stub save and enable</button>
      <button type="button" onClick={() => onSaved(SAVED, { enable: true, reason: '', saved: false })}>Stub enable unchanged</button>
      <button type="button" onClick={() => onSaved(SAVED)}>Stub save</button></div>
  ),
}));
vi.mock('@/components/schedules/EnableDialog', () => ({
  EnableDialog: ({ master, reason }: { master: { name: string }; reason?: string }) => <div>{`enable ${master.name}${reason ? ` reason=${reason}` : ''}`}</div>,
}));
import { toast } from 'sonner';
import { schedules } from '@/lib/api/schedules';
import { ApiError } from '@/lib/api/client';
import { SchedulesPane } from './SchedulesPane';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(schedules.listRuntimes).mockResolvedValue([]);
  vi.mocked(schedules.listMasters).mockResolvedValue([{ id: 'm1', workCenterId: 'w1', name: 'Day Production', source: 'commander', recurrence: { type: 'daily' }, recurrenceText: 'Daily', items: [] }] as never);
});
afterEach(cleanup);

describe('SchedulesPane Master Schedule editing', () => {
  it('New and Edit open the editor in place of the tab, and closing returns to it', async () => {
    render(<SchedulesPane workCenterId="w1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'New Master Schedule' }));
    expect(screen.getByText('editor new')).toBeInTheDocument();
    expect(screen.queryByText('Runtime Schedules')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Day Production' }));
    expect(screen.getByText('editor Day Production')).toBeInTheDocument();
  });

  it('Enable opens the Enable dialog for that Master Schedule', async () => {
    render(<SchedulesPane workCenterId="w1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Enable Schedule Day Production' }));
    expect(screen.getByText('enable Day Production')).toBeInTheDocument();
  });

  const openEditorAnd = async (button: string) => {
    render(<SchedulesPane workCenterId="w1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Day Production' }));
    await userEvent.click(screen.getByRole('button', { name: button }));
  };

  it('Save and Enable enables the saved Master and says so', async () => {
    vi.mocked(schedules.enable).mockResolvedValue({ runtime: { label: 'RS-1' }, warnings: [] } as never);
    await openEditorAnd('Stub save and enable');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved and enabled as RS-1'));
    expect(schedules.enable).toHaveBeenCalledWith('m1');
    expect(screen.queryByText('editor Day Production')).toBeNull();
  });

  it('Save and Enable refused (422) keeps the save and opens the Enable dialog to show why', async () => {
    vi.mocked(schedules.enable).mockRejectedValue(new ApiError(422, 'validation', 'The schedule cannot be enabled', { error: { details: [] } }));
    await openEditorAnd('Stub save and enable');
    expect(await screen.findByText('enable Day Production reason=New time')).toBeInTheDocument();
    expect(screen.queryByText('editor Day Production')).toBeNull();
  });

  it('Save and Enable while a copy is on (409) opens the Enable dialog with the change reason', async () => {
    vi.mocked(schedules.enable).mockRejectedValue(new ApiError(409, 'conflict', 'RS-1 is already on'));
    await openEditorAnd('Stub save and enable');
    expect(await screen.findByText('enable Day Production reason=New time')).toBeInTheDocument();
  });

  it('plain Save does not enable', async () => {
    await openEditorAnd('Stub save');
    expect(toast.success).toHaveBeenCalledWith('Saved "Day Production"');
    expect(schedules.enable).not.toHaveBeenCalled();
  });

  it('Save and Enable with nothing edited says only "Enabled", and only "Enable failed"', async () => {
    vi.mocked(schedules.enable).mockResolvedValueOnce({ runtime: { label: 'RS-1' }, warnings: [] } as never);
    await openEditorAnd('Stub enable unchanged');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Enabled as RS-1'));
    cleanup();
    vi.mocked(schedules.enable).mockRejectedValueOnce(new Error('boom'));
    await openEditorAnd('Stub enable unchanged');
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls[0]![0]).not.toMatch(/Saved/);
  });
});
