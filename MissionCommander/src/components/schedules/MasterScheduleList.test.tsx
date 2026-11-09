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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/schedules', () => ({ schedules: { listMasters: vi.fn(), deleteMaster: vi.fn().mockResolvedValue(undefined) } }));
import { schedules } from '@/lib/api/schedules';
import { MasterScheduleList } from './MasterScheduleList';

const master = (over = {}) => ({
  id: 'm1', workCenterId: 'w1', name: 'Day Production', source: 'commander', externalKey: null, revision: 1,
  recurrenceText: 'Weekdays at 06:00, 14:00', updatedAt: '2026-11-01T00:00:00Z', recurrence: {}, items: [], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(schedules.listMasters).mockResolvedValue([master(), master({ id: 'm2', name: 'From API', source: 'api', recurrenceText: 'Every day at 01:00' })] as never);
});
afterEach(cleanup);

describe('MasterScheduleList', () => {
  it('shows name, recurrence in words and a source badge', async () => {
    render(<MasterScheduleList workCenterId="w1" canControl />);
    expect(await screen.findByText('Day Production')).toBeInTheDocument();
    expect(screen.getByText('Weekdays at 06:00, 14:00')).toBeInTheDocument();
    expect(screen.getByText('Commander')).toBeInTheDocument();
    expect(screen.getByText('API')).toBeInTheDocument();
  });

  it('Enable and Edit call back, and are not shown when the prop is absent', async () => {
    const onEnable = vi.fn(); const onEdit = vi.fn();
    const { rerender } = render(<MasterScheduleList workCenterId="w1" canControl onEnable={onEnable} onEdit={onEdit} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Enable Recurrence Day Production' }));
    expect(onEnable).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Day Production' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    rerender(<MasterScheduleList workCenterId="w1" canControl />);
    expect(screen.queryByRole('button', { name: /^(Enable|Edit)/ })).toBeNull();
  });

  it('Run Once comes first and calls back; a Manual schedule cannot Enable Recurrence and says why', async () => {
    const onRunOnce = vi.fn(); const onEnable = vi.fn();
    vi.mocked(schedules.listMasters).mockResolvedValue([master({ recurrence: { type: 'manual' } })] as never);
    render(<MasterScheduleList workCenterId="w1" canControl onRunOnce={onRunOnce} onEnable={onEnable} />);
    const run = await screen.findByRole('button', { name: 'Run Once Day Production' });
    const enable = screen.getByRole('button', { name: 'Enable Recurrence Day Production' });
    expect(run.compareDocumentPosition(enable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(enable).toBeDisabled();
    expect(enable).toHaveAttribute('title', 'A Manual schedule has no recurrence. Use Run Once.');
    await userEvent.click(run);
    expect(onRunOnce).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
  });

  it("'disabled' renders a disabled button", async () => {
    render(<MasterScheduleList workCenterId="w1" canControl onEnable="disabled" onEdit="disabled" />);
    expect(await screen.findByRole('button', { name: 'Enable Recurrence Day Production' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Day Production' })).toBeDisabled();
  });

  it('shows each version, and Export PDF sits after Edit, for readers too', async () => {
    const onExportPdf = vi.fn(); const onEdit = vi.fn();
    vi.mocked(schedules.listMasters).mockResolvedValue([master({ revision: 4 })] as never);
    const { unmount } = render(<MasterScheduleList workCenterId="w1" canControl onEdit={onEdit} onExportPdf={onExportPdf} />);
    expect(await screen.findByRole('columnheader', { name: 'Version' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '4' })).toBeInTheDocument();
    const edit = screen.getByRole('button', { name: 'Edit Day Production' });
    const pdf = screen.getByRole('button', { name: 'Export PDF Day Production' });
    expect(edit.compareDocumentPosition(pdf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(pdf);
    expect(onExportPdf).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    unmount();
    render(<MasterScheduleList workCenterId="w1" canControl={false} onEdit={onEdit} onExportPdf={onExportPdf} />);
    expect(await screen.findByRole('button', { name: 'Export PDF Day Production' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Edit|Delete|Run Once|Enable)/ })).toBeNull();
  });

  it('Delete confirms first', async () => {
    render(<MasterScheduleList workCenterId="w1" canControl />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Day Production' }));
    expect(schedules.deleteMaster).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete Master Schedule' }));
    await waitFor(() => expect(schedules.deleteMaster).toHaveBeenCalledWith('m1'));
  });

  it('canControl false hides everything that changes things', async () => {
    render(<MasterScheduleList workCenterId="w1" canControl={false} onEnable={vi.fn()} onEdit={vi.fn()} />);
    await screen.findByText('Day Production');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
