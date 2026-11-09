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
import { detail, item } from './fixtures';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/schedules', () => ({
  schedules: {
    getRuntime: vi.fn(), occurrences: vi.fn(), events: vi.fn(), setItemDisabled: vi.fn().mockResolvedValue(undefined),
    acknowledge: vi.fn().mockResolvedValue({ dismissed: 1 }), pause: vi.fn(), resume: vi.fn(), resumePreview: vi.fn(), cancel: vi.fn(),
  },
}));
import { schedules } from '@/lib/api/schedules';
import { RuntimeScheduleDetail } from './RuntimeScheduleDetail';

const run = (over = {}) => ({ id: 'run1', itemId: 'i1', parentRunId: null, runtimeLabel: 'RW-101', status: 'finished', finalState: 'completed', detail: null, acknowledgedAt: null, open: null, itemName: 'Mix Batch', ...over });
const page = (runs: unknown[]) => ({ total: 1, rows: [{ id: 'o7', number: 7, scheduledAt: '2026-11-09T15:00:00Z', firedAt: '2026-11-09T15:00:02Z', origin: 'on_time', runs }] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(schedules.getRuntime).mockResolvedValue(detail({
    masterChanged: true,
    items: [item({ id: 'i1', masterName: 'Mix Batch', newerVersionAvailable: true, children: [
      item({ id: 'i2', masterName: 'Move Material', triggerOn: ['completed'], disabled: true, children: [
        item({ id: 'i3', masterName: 'Lab Test', masterState: 'draft', triggerOn: ['completed'] }),
      ] }),
    ] })],
  }));
  vi.mocked(schedules.occurrences).mockResolvedValue(page([run()]) as never);
  vi.mocked(schedules.events).mockResolvedValue({ rows: [], total: 0 });
});
afterEach(cleanup);

describe('RuntimeScheduleDetail', () => {
  it('draws the chain tree with depth, state badges and notices', async () => {
    render(<RuntimeScheduleDetail runtimeId="r1" canControl onBack={() => {}} />);
    expect(await screen.findByText('Mix Batch')).toBeInTheDocument();
    const depth = (name: string) => screen.getByText(name).closest('li')!.getAttribute('data-depth');
    expect([depth('Mix Batch'), depth('Move Material'), depth('Lab Test')]).toEqual(['0', '1', '2']);
    expect(screen.getByText('newer version available')).toBeInTheDocument();
    expect(screen.getByText('Master changed since Enable')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-enable Move Material' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable Mix Batch' })).toBeInTheDocument();
  });

  it('Disable toggles an item', async () => {
    render(<RuntimeScheduleDetail runtimeId="r1" canControl onBack={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Disable Mix Batch' }));
    await waitFor(() => expect(schedules.setItemDisabled).toHaveBeenCalledWith('r1', 'i1', true));
    await userEvent.click(screen.getByRole('button', { name: 'Re-enable Move Material' }));
    await waitFor(() => expect(schedules.setItemDisabled).toHaveBeenCalledWith('r1', 'i2', false));
  });

  it('canControl false hides the toggles and the controls', async () => {
    render(<RuntimeScheduleDetail runtimeId="r1" canControl={false} onBack={() => {}} />);
    await screen.findByText('Mix Batch');
    expect(screen.queryByRole('button', { name: /^(Disable|Re-enable|Pause|Cancel|Dismiss)/ })).toBeNull();
  });

  it('lists occurrences with the run outcome', async () => {
    render(<RuntimeScheduleDetail runtimeId="r1" canControl onBack={() => {}} />);
    const occ = await screen.findByText(/Occurrence 7/);
    const row = occ.closest('li')!;
    expect(within(row).getByText('RW-101')).toBeInTheDocument();
    expect(within(row).getByText(/Mon Nov 9, 09:00/)).toBeInTheDocument();
  });

  it('shows the event log newest first in plain words', async () => {
    const ev = (id: string, action: string, actorKind: string, actorName: string | null, detail: unknown, at: string) =>
      ({ id, action, actorKind, actorName, detail, at });
    vi.mocked(schedules.events).mockResolvedValue({ total: 4, rows: [
      ev('e4', 'resumed', 'user', 'jsmith', { missedCount: 97, startedSlots: 2, skippedSlots: 95, startedChains: 0, skippedChains: 0 }, '2026-11-09T16:00:00Z'),
      ev('e3', 'paused', 'user', 'jsmith', null, '2026-11-09T15:30:00Z'),
      ev('e2', 'item_disabled', 'api_client', 'MES', { name: 'Lab Test' }, '2026-11-09T15:00:00Z'),
      ev('e1', 'slot_fired', 'system', null, { number: 7, scheduledAt: '2026-11-09T15:00:00Z', started: 2, failed: 1 }, '2026-11-09T15:00:01Z'),
    ] } as never);
    render(<RuntimeScheduleDetail runtimeId="r1" canControl onBack={() => {}} />);
    expect(await screen.findByText('Resumed by jsmith: started 2 of 97 missed, skipped 95')).toBeInTheDocument();
    expect(screen.getByText('Paused by jsmith')).toBeInTheDocument();
    expect(screen.getByText('Disabled Lab Test by MES')).toBeInTheDocument();
    expect(screen.getByText(/Occurrence 7 started .*: 2 started, 1 failed/)).toBeInTheDocument();
    expect(schedules.events).toHaveBeenCalledWith('r1', { limit: 10, offset: 0 });
  });

  it('draws the run label with renderRunLink when given', async () => {
    const open = { kind: 'live', id: 'inst1' };
    vi.mocked(schedules.occurrences).mockResolvedValue(page([run({ open })]) as never);
    const renderRunLink = vi.fn((r: { runtimeLabel: string | null }) => <button type="button">{`link to ${r.runtimeLabel}`}</button>);
    render(<RuntimeScheduleDetail runtimeId="r1" canControl onBack={() => {}} renderRunLink={renderRunLink} />);
    expect(await screen.findByRole('button', { name: 'link to RW-101' })).toBeInTheDocument();
    expect(renderRunLink).toHaveBeenCalledWith(expect.objectContaining({ id: 'run1', open }));
  });

  it('without renderRunLink the run label is plain text', async () => {
    render(<RuntimeScheduleDetail runtimeId="r1" canControl onBack={() => {}} />);
    const label = await screen.findByText('RW-101');
    expect(label.closest('button')).toBeNull();
  });

  it('names a run from its frozen item name, or says the item was removed', async () => {
    vi.mocked(schedules.occurrences).mockResolvedValue(page([
      run({ id: 'a', itemId: 'gone', itemName: 'Old Workflow' }),
      run({ id: 'b', itemId: 'gone2', itemName: null }),
    ]) as never);
    render(<RuntimeScheduleDetail runtimeId="r1" canControl onBack={() => {}} />);
    expect(await screen.findByText('Old Workflow')).toBeInTheDocument();
    expect(screen.getByText('(removed item)')).toBeInTheDocument();
    expect(screen.queryByText('Item')).toBeNull();
  });

  it('Dismiss on a failed or lost item acknowledges it', async () => {
    vi.mocked(schedules.occurrences).mockResolvedValue(page([
      run({ id: 'f1', status: 'failed_to_start', runtimeLabel: null, finalState: null, detail: 'No role' }),
      run({ id: 'l1', status: 'lost', finalState: null }),
    ]) as never);
    render(<RuntimeScheduleDetail runtimeId="r1" canControl onBack={() => {}} />);
    const buttons = await screen.findAllByRole('button', { name: /^Dismiss Mix Batch/ });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[0]);
    await waitFor(() => expect(schedules.acknowledge).toHaveBeenCalledWith('r1', ['f1']));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss all' }));
    await waitFor(() => expect(schedules.acknowledge).toHaveBeenCalledWith('r1', 'all'));
  });
});
