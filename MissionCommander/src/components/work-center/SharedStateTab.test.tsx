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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as wc from '@/lib/api/work-centers';
import { ApiError } from '@/lib/api/client';
import { toast } from 'sonner';
import type { SharedResourceView, SharedValuePropertyView } from '@/lib/api/types';
import { usePrincipalStore } from '@/stores/principalStore';
import { SharedStateTab } from './SharedStateTab';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORPHAN: SharedResourceView = {
  workCenterId: 'w1', name: 'Orphan', resourceType: 'named pool', description: null,
  useLimit: null, poolNames: ['A'], availableNames: ['A'], inUse: 0,
  summary: { total: 1, inUse: 0, available: 1, queued: 0, state: '1 available, 0 in use' },
  unaccounted: 0, ledgerMismatch: false, overCommitted: false, holders: [], waiters: [],
  definedBy: { envSpecId: null, name: 'Gone', version: '1.0.0', state: 'Effective' }, orphaned: true, updatedAt: '2026-09-01T00:00:00Z',
};
const TEMP: SharedValuePropertyView = {
  workCenterId: 'w1', propertyName: 'Env', entryName: 'Temp', value: '70', annotation: false,
  definedByEnvSpecId: null, orphaned: true, updatedAt: '2026-09-01T00:00:00Z', updatedByName: null,
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('SharedStateTab', () => {
  it('renders both sections from the work-center feeds, orphans included', async () => {
    vi.spyOn(wc.workCenters, 'resources').mockResolvedValue({ resources: [ORPHAN] });
    vi.spyOn(wc.workCenters, 'valueProperties').mockResolvedValue({ values: [TEMP] });
    render(<SharedStateTab workCenterId="w1" />);
    expect(await screen.findByRole('heading', { name: 'Resources' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Value properties' })).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: 'Orphan' })).toBeInTheDocument();
    expect(screen.getAllByText('orphaned')).toHaveLength(2); // one per section
    expect(screen.getByText('70')).toBeInTheDocument();
    expect(wc.workCenters.resources).toHaveBeenCalledWith('w1');
    expect(wc.workCenters.valueProperties).toHaveBeenCalledWith('w1');
  });

  it('shows the empty states and the failure slot', async () => {
    vi.spyOn(wc.workCenters, 'resources').mockResolvedValue({ resources: [] });
    vi.spyOn(wc.workCenters, 'valueProperties').mockResolvedValue({ values: [] });
    render(<SharedStateTab workCenterId="w1" />);
    expect(await screen.findByText('No shared resources in this work center')).toBeInTheDocument();
    expect(screen.getByText('No shared value properties in this work center')).toBeInTheDocument();
    cleanup();
    vi.spyOn(wc.workCenters, 'resources').mockRejectedValue(new ApiError(500, 'internal', 'boom'));
    render(<SharedStateTab workCenterId="w1" />);
    expect(await screen.findByText('Failed to load shared state')).toBeInTheDocument();
  });
});

function setPrincipal(systemCommanderOf: string[]) {
  usePrincipalStore.getState().setPrincipal({
    id: 'me', email: '', loginName: 'admin', displayName: 'Me', accessLevel: 'steward',
    isAdministrator: false, rights: ['work_center:read'], missionSystemCommanderOf: systemCommanderOf,
  });
}

describe('Shared State tab actions (Phase 4b)', () => {
  it('the backstop can reset an orphan (this is the only place an orphan is reachable) and edit an orphaned value', async () => {
    setPrincipal(['w1']);
    vi.spyOn(wc.workCenters, 'resources').mockResolvedValue({ resources: [{ ...ORPHAN, inUse: 1, availableNames: [], unaccounted: 1, summary: { total: 1, inUse: 1, available: 0, queued: 0, state: '0 available, 1 in use' } }] });
    vi.spyOn(wc.workCenters, 'valueProperties').mockResolvedValue({ values: [TEMP] });
    const verb = vi.spyOn(wc.workCenters, 'resourceVerb').mockResolvedValue({ ok: true, summary: 'reset' });
    const setValue = vi.spyOn(wc.workCenters, 'setValue').mockResolvedValue({ ok: true, summary: 'set' });
    render(<SharedStateTab workCenterId="w1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reset Orphan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(verb).toHaveBeenCalledWith('w1', 'reset', { name: 'Orphan' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Reset “Orphan”'));

    await userEvent.click(screen.getByRole('button', { name: 'Release Orphan' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Release untracked name A' }));
    await waitFor(() => expect(verb).toHaveBeenLastCalledWith('w1', 'release', { name: 'Orphan', poolName: 'A' }));

    await userEvent.click(screen.getByRole('button', { name: 'Edit Env.Temp' }));
    const input = screen.getByRole('textbox', { name: 'New value for Env.Temp' });
    await userEvent.clear(input);
    await userEvent.type(input, '72');
    // Both feeds refetch through the ONE hook after an action (spec §6.4: one tab, one poll) — clear
    // just before this last counted action so the count isn't racing the real 2s background poll.
    vi.mocked(wc.workCenters.resources).mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setValue).toHaveBeenCalledWith('w1', { propertyName: 'Env', entryName: 'Temp', value: '72' }));
    await waitFor(() => expect(wc.workCenters.resources).toHaveBeenCalledTimes(1));
  });

  it('a non-commander sees disabled controls', async () => {
    setPrincipal([]);
    vi.spyOn(wc.workCenters, 'resources').mockResolvedValue({ resources: [ORPHAN] });
    vi.spyOn(wc.workCenters, 'valueProperties').mockResolvedValue({ values: [TEMP] });
    render(<SharedStateTab workCenterId="w1" />);
    expect(await screen.findByRole('button', { name: 'Reset Orphan' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Env.Temp' })).toBeDisabled();
  });
});
