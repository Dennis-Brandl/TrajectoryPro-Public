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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/stores/principalStore', () => ({
  useMissionSystemCommander: () => true,
  usePrincipalStore: (pick: (s: { principal: { loginName: string } }) => unknown) => pick({ principal: { loginName: 'una' } }),
}));
vi.mock('@/lib/api/schedules', () => ({ schedules: { listRuntimes: vi.fn(), listMasters: vi.fn() } }));
vi.mock('@/components/runtime/RuntimeDialogStack', () => ({ RuntimeDialogStack: () => null }));
vi.mock('@/components/schedules/MasterScheduleEditor', () => ({
  MasterScheduleEditor: ({ master, onClose }: { master: { name: string } | null; onClose: () => void }) => (
    <div>{`editor ${master?.name ?? 'new'}`}<button type="button" onClick={onClose}>Close editor</button></div>
  ),
}));
vi.mock('@/components/schedules/EnableDialog', () => ({
  EnableDialog: ({ master }: { master: { name: string } }) => <div>{`enable ${master.name}`}</div>,
}));
import { schedules } from '@/lib/api/schedules';
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
    await userEvent.click(await screen.findByRole('button', { name: 'Enable Recurrence Day Production' }));
    expect(screen.getByText('enable Day Production')).toBeInTheDocument();
  });
});
