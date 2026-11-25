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
import { useSelectionStore } from '@/stores/selectionStore';
import { schedules } from '@/lib/api/schedules';
import type { LiveRuntimeScheduleLeaf } from '@/lib/api/types';
import { ScheduleRailTree } from './ScheduleRailTree';

const NODES = [
  { id: 'wc1', name: 'Plant', parentWorkCenterId: null, depth: 0, typeName: null },
  { id: 'wc2', name: 'Line 1', parentWorkCenterId: 'wc1', depth: 1, typeName: null },
  { id: 'wc3', name: 'Kitchen', parentWorkCenterId: null, depth: 0, typeName: null },
];
const leaf = (over: Partial<LiveRuntimeScheduleLeaf>): LiveRuntimeScheduleLeaf => ({
  id: 'r1', label: 'RS-4', name: 'Test Single Step schedule', status: 'active', nextFireAt: '2026-11-25T19:06:00Z',
  timeZone: 'America/New_York', masterScheduleId: 'm1', masterChanged: false, runOnce: false,
  needsAttention: { failed: 0, lost: 0, missedWindow: false }, workCenterId: 'wc2', ...over,
} as LiveRuntimeScheduleLeaf);
const LEAVES = [leaf({}), leaf({ id: 'r2', label: 'RS-2', name: 'Lunch Precook', status: 'paused', nextFireAt: null, workCenterId: 'wc3' })];

beforeEach(() => {
  useSelectionStore.setState({ activeHierarchy: 'schedule', selectedRuntimeSchedule: null });
  vi.spyOn(schedules, 'liveTree').mockResolvedValue({ nodes: NODES, runtimeSchedules: LEAVES });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ScheduleRailTree', () => {
  it('lists every work center with the schedules that are on, the next start or Paused, and a dash when none', async () => {
    render(<ScheduleRailTree />);
    expect(await screen.findByText('Schedules')).toBeInTheDocument();
    const active = await screen.findByRole('button', { name: /RS-4 · Test Single Step schedule/ });
    expect(active).toHaveTextContent('next Wed Nov 25, 14:06');
    expect(screen.getByRole('button', { name: /RS-2 · Lunch Precook/ })).toHaveTextContent('Paused');
    expect(screen.getByLabelText('No schedules on in Plant')).toBeInTheDocument();
  });

  it('selecting a schedule puts it and its work center in the store', async () => {
    render(<ScheduleRailTree />);
    await userEvent.click(await screen.findByRole('button', { name: /RS-2 · Lunch Precook/ }));
    expect(useSelectionStore.getState().selectedRuntimeSchedule).toEqual({ id: 'r2', workCenterId: 'wc3' });
  });
});
