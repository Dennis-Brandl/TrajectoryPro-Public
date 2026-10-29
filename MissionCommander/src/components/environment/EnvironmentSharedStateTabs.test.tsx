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
import { environments } from '@/lib/api/environments';
import { ApiError } from '@/lib/api/client';
import { toast } from 'sonner';
import type { SharedResourceView, SharedValuePropertyView } from '@/lib/api/types';
import * as wcApi from '@/lib/api/work-centers';
import { usePrincipalStore } from '@/stores/principalStore';
import { EnvironmentResourcesTab, EnvironmentValuePropertiesTab } from './EnvironmentSharedStateTabs';

vi.mock('@/lib/api/environments', () => ({ environments: { resources: vi.fn(), valueProperties: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PRINTER: SharedResourceView = {
  workCenterId: 'wc1', name: 'Printer', resourceType: 'binary exclusive use', description: null,
  useLimit: null, poolNames: [], availableNames: [], inUse: 0,
  summary: { total: 1, inUse: 0, available: 1, queued: 0, state: 'Free' },
  unaccounted: 0, ledgerMismatch: false, overCommitted: false, holders: [], waiters: [],
  definedBy: { envSpecId: 'e1', name: 'Kitchen', version: '1.0.0', state: 'Effective' }, orphaned: false, updatedAt: '2026-09-01T00:00:00Z',
};
const SIZE: SharedValuePropertyView = {
  workCenterId: 'wc1', propertyName: 'Batch', entryName: 'Size', value: '5', annotation: false,
  definedByEnvSpecId: 'e1', orphaned: false, updatedAt: '2026-09-01T00:00:00Z', updatedByName: null,
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('EnvironmentResourcesTab', () => {
  it('renders the registry rows for the spec', async () => {
    vi.mocked(environments.resources).mockResolvedValue({ workCenterId: 'wc1', resources: [PRINTER], unregistered: [] });
    render(<EnvironmentResourcesTab envId="e1" />);
    expect(await screen.findByRole('cell', { name: 'Printer' })).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(environments.resources).toHaveBeenCalledWith('e1');
  });

  it('names declared-but-unregistered resources and tells the operator to re-load', async () => {
    vi.mocked(environments.resources).mockResolvedValue({ workCenterId: 'wc1', resources: [], unregistered: ['Ghost', 'Oven'] });
    render(<EnvironmentResourcesTab envId="e1" />);
    expect(await screen.findByRole('status')).toHaveTextContent('Declared but not registered: Ghost, Oven. Re-load this environment spec to register them.');
    expect(screen.getByText('No registered resources yet')).toBeInTheDocument();
    expect(screen.queryByText('This environment declares no resources')).toBeNull();
  });

  it('shows the spec empty state when nothing is declared, and the failure slot with a toast', async () => {
    vi.mocked(environments.resources).mockResolvedValue({ workCenterId: 'wc1', resources: [], unregistered: [] });
    render(<EnvironmentResourcesTab envId="e1" />);
    expect(await screen.findByText('This environment declares no resources')).toBeInTheDocument();
    cleanup();
    vi.mocked(environments.resources).mockRejectedValue(new ApiError(500, 'internal', 'boom'));
    render(<EnvironmentResourcesTab envId="e1" />);
    expect(await screen.findByText('Failed to load resources')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith('boom');
  });
});

describe('EnvironmentValuePropertiesTab', () => {
  it('renders grouped entries and the unregistered pairs', async () => {
    vi.mocked(environments.valueProperties).mockResolvedValue({
      workCenterId: 'wc1', values: [SIZE], unregistered: [{ propertyName: 'Batch', entryName: 'Missing' }],
    });
    render(<EnvironmentValuePropertiesTab envId="e1" />);
    expect(await screen.findByRole('row', { name: /Size/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Declared but not registered: Batch.Missing.');
  });

  it('shows the spec empty state when nothing is declared', async () => {
    vi.mocked(environments.valueProperties).mockResolvedValue({ workCenterId: 'wc1', values: [], unregistered: [] });
    render(<EnvironmentValuePropertiesTab envId="e1" />);
    expect(await screen.findByText('This environment declares no value properties')).toBeInTheDocument();
  });
});

function setPrincipal(systemCommanderOf: string[]) {
  usePrincipalStore.getState().setPrincipal({
    id: 'me', email: '', loginName: 'admin', displayName: 'Me', accessLevel: 'steward',
    isAdministrator: false, rights: ['environment:read'], missionSystemCommanderOf: systemCommanderOf,
  });
}
const HELD: SharedResourceView = {
  ...PRINTER, inUse: 1, summary: { total: 1, inUse: 1, available: 0, queued: 0, state: 'In use' },
  holders: [{ id: 4, instanceId: 'rw7', runtimeNumber: 7, runtimeLabel: 'MIX-20261007-001', masterName: 'Fill', stepOid: 's-mix', stepName: 'Mix Step', amount: 1, heldName: null, acquiredAt: '2026-09-01T00:00:00Z' }],
};

describe('Environment pane actions (Phase 4b)', () => {
  it('a commander releases a holder through the WORK-CENTER route, gets a toast, and the tab refetches', async () => {
    setPrincipal(['wc1']);
    vi.mocked(environments.resources).mockResolvedValue({ workCenterId: 'wc1', resources: [HELD], unregistered: [] });
    const verb = vi.spyOn(wcApi.workCenters, 'resourceVerb').mockResolvedValue({ ok: true, summary: 'release-holder "Printer"' });
    render(<EnvironmentResourcesTab envId="e1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Release Printer' }));
    // Clear right before the action whose refresh we're counting — the real 2s poll would otherwise
    // race an exact count on a slow run.
    vi.mocked(environments.resources).mockClear();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Release holder MIX-20261007-001 · Mix Step' }));
    await waitFor(() => expect(verb).toHaveBeenCalledWith('wc1', 'release-holder', { name: 'Printer', holderId: 4 }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Released a hold on “Printer”'));
    await waitFor(() => expect(environments.resources).toHaveBeenCalledTimes(1)); // the refresh
    verb.mockRestore();
  });

  it('a non-commander sees the disabled control; a server 409 toasts its message and still refreshes', async () => {
    setPrincipal([]);
    vi.mocked(environments.resources).mockResolvedValue({ workCenterId: 'wc1', resources: [HELD], unregistered: [] });
    render(<EnvironmentResourcesTab envId="e1" />);
    expect(await screen.findByRole('button', { name: 'Reset Printer' })).toBeDisabled();
    cleanup();
    // the first render's fetch is not this assertion's subject: count only the commander render + the failure refresh
    vi.mocked(environments.resources).mockClear();
    setPrincipal(['wc1']);
    const verb = vi.spyOn(wcApi.workCenters, 'resourceVerb').mockRejectedValue(new ApiError(409, 'conflict', 'nothing to release'));
    render(<EnvironmentResourcesTab envId="e1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reset Printer' }));
    // Clear right before the action whose refresh we're counting (the failure still triggers one).
    vi.mocked(environments.resources).mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('nothing to release'));
    await waitFor(() => expect(environments.resources).toHaveBeenCalledTimes(1));
    verb.mockRestore();
  });

  it('a value edit posts to the work-center value route', async () => {
    setPrincipal(['wc1']);
    vi.mocked(environments.valueProperties).mockResolvedValue({ workCenterId: 'wc1', values: [SIZE], unregistered: [] });
    const setValue = vi.spyOn(wcApi.workCenters, 'setValue').mockResolvedValue({ ok: true, summary: 'set' });
    render(<EnvironmentValuePropertiesTab envId="e1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Batch.Size' }));
    const input = screen.getByRole('textbox', { name: 'New value for Batch.Size' });
    await userEvent.clear(input);
    await userEvent.type(input, '7');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setValue).toHaveBeenCalledWith('wc1', { propertyName: 'Batch', entryName: 'Size', value: '7' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Updated Batch.Size'));
    setValue.mockRestore();
  });
});
