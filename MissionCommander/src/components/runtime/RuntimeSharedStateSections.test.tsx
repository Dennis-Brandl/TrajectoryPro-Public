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
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '@/lib/api/runtime-workflows';
import * as wcApi from '@/lib/api/work-centers';
import { ApiError } from '@/lib/api/client';
import type { InstanceResourcesView, InstanceValuePropertiesView } from '@/lib/api/types';
import { usePrincipalStore } from '@/stores/principalStore';
import { toast } from 'sonner';
import { RuntimeResourcesSection, RuntimeValuePropertiesSection } from './RuntimeSharedStateSections';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const RESOURCES: InstanceResourcesView = {
  instanceId: 'rw1', runtimeNumber: 12, runtimeLabel: 'MIX-20261007-001', masterName: 'Mix',
  workflow: [{ key: 'wf-1:Lock', ownerOid: 'wf-1', name: 'Lock', resourceType: 'binary exclusive use',
    summary: { total: 1, inUse: 1, available: 0, queued: 1, state: 'In use' },
    queuedSteps: [{ stepOid: 's-pack', stepName: 'Pack', kind: 'acquire' }] }],
  environment: [{
    workCenterId: 'wc1', name: 'Printer', resourceType: 'binary exclusive use', description: null,
    useLimit: null, poolNames: [], availableNames: [], inUse: 1,
    summary: { total: 1, inUse: 1, available: 0, queued: 0, state: 'In use' },
    unaccounted: 0, ledgerMismatch: false, overCommitted: false,
    holders: [{ id: 1, instanceId: 'rw1', runtimeNumber: 12, runtimeLabel: 'MIX-20261007-001', masterName: 'Mix', stepOid: 's-mix', stepName: 'Mix Step', amount: 1, heldName: null, acquiredAt: '2026-09-01T00:00:00Z' }],
    waiters: [],
    definedBy: { envSpecId: 'e1', name: 'Kitchen', version: '1.0.0', state: 'Effective' }, orphaned: false, updatedAt: '2026-09-01T00:00:00Z',
  }],
};
const VALUES: InstanceValuePropertiesView = {
  instanceId: 'rw1', root: { 'Batch.Size': '5' },
  children: [{ childOid: 'c1', childName: 'Sub', values: { 'Sub.X': '1' } }],
  shared: [{ workCenterId: 'wc1', propertyName: 'Env', entryName: 'Temp', value: '70', annotation: false, definedByEnvSpecId: 'e1', orphaned: false, updatedAt: '2026-09-01T00:00:00Z', updatedByName: null }],
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('RuntimeResourcesSection', () => {
  it('lists workflow-scoped and environment rows with scope chips; env rows keep their contention picture', async () => {
    vi.spyOn(api.runtimeWorkflows, 'resources').mockResolvedValue(RESOURCES);
    render(<RuntimeResourcesSection instanceId="rw1" workCenterId="wc1" />);
    const lockCell = await screen.findByRole('cell', { name: /Lock/ });
    const printerCell = screen.getByRole('cell', { name: /Printer/ });
    expect(lockCell).toBeInTheDocument();
    expect(printerCell).toBeInTheDocument();
    // Spec §6.5 / the brief's row order: workflow-scoped rows before environment rows.
    expect(lockCell.compareDocumentPosition(printerCell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('workflow')).toBeInTheDocument();
    expect(screen.getByText('environment')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MIX-20261007-001 · Pack' })).toBeInTheDocument();     // own queued step
    expect(screen.getByRole('button', { name: 'MIX-20261007-001 · Mix Step' })).toBeInTheDocument(); // env holder
    expect(screen.getByRole('button', { name: 'Kitchen v1.0.0 (Effective)' })).toBeInTheDocument(); // cross-link
  });

  it('a failure shows the section slot only', async () => {
    vi.spyOn(api.runtimeWorkflows, 'resources').mockRejectedValue(new ApiError(500, 'internal', 'boom'));
    render(<RuntimeResourcesSection instanceId="rw1" workCenterId="wc1" />);
    expect(await screen.findByText('Failed to load resources')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Resources' })).toBeInTheDocument();
  });
});

describe('RuntimeValuePropertiesSection', () => {
  it('renders the workflow store, each child store by name, and the shared group, in that document order', async () => {
    vi.spyOn(api.runtimeWorkflows, 'valueProperties').mockResolvedValue(VALUES);
    render(<RuntimeValuePropertiesSection instanceId="rw1" workCenterId="wc1" />);
    const workflowHeading = await screen.findByRole('heading', { name: 'Workflow' });
    const childHeading = screen.getByRole('heading', { name: 'Child · Sub' });
    const sharedHeading = screen.getByRole('heading', { name: 'Shared (environment)' });
    expect(workflowHeading).toBeInTheDocument();
    expect(childHeading).toBeInTheDocument();
    expect(sharedHeading).toBeInTheDocument();
    // Spec §6.5's fixed order: root store, then each child store, then the shared group.
    expect(workflowHeading.compareDocumentPosition(childHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(childHeading.compareDocumentPosition(sharedHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /Size/ })).getByText('5')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Temp/ })).getByText('70')).toBeInTheDocument();
  });

  it('empty stores render their empty texts', async () => {
    vi.spyOn(api.runtimeWorkflows, 'valueProperties').mockResolvedValue({ instanceId: 'rw1', root: {}, children: [], shared: [] });
    render(<RuntimeValuePropertiesSection instanceId="rw1" workCenterId="wc1" />);
    expect(await screen.findByText('No workflow value properties')).toBeInTheDocument();
    expect(screen.getByText('No shared value properties in this work center')).toBeInTheDocument();
  });
});

function setPrincipal(systemCommanderOf: string[]) {
  usePrincipalStore.getState().setPrincipal({
    id: 'me', email: '', loginName: 'admin', displayName: 'Me', accessLevel: 'steward',
    isAdministrator: false, rights: ['work_center:read'], missionSystemCommanderOf: systemCommanderOf,
  });
}
const RESOURCES_WITH_IDS: InstanceResourcesView = {
  ...RESOURCES,
  environment: [{ ...RESOURCES.environment[0], holders: [{ ...RESOURCES.environment[0].holders[0], id: 4 }] }],
};

describe('Runtime pane actions (Phase 4b)', () => {
  it('a workflow-scoped waiter cancels through the INSTANCE route with the step oid; an environment holder releases through the WORK-CENTER route', async () => {
    setPrincipal(['wc1']);
    vi.spyOn(api.runtimeWorkflows, 'resources').mockResolvedValue(RESOURCES_WITH_IDS);
    const instanceVerb = vi.spyOn(api.runtimeWorkflows, 'resourceVerb').mockResolvedValue({ ok: true, summary: 'ok' });
    const wcVerb = vi.spyOn(wcApi.workCenters, 'resourceVerb').mockResolvedValue({ ok: true, summary: 'ok' });
    render(<RuntimeResourcesSection instanceId="rw1" workCenterId="wc1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel wait MIX-20261007-001 · Pack on Lock' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(instanceVerb).toHaveBeenCalledWith('rw1', 'cancel-waiter', { resourceKey: 'wf-1:Lock', waiterId: 's-pack' }));
    expect(wcVerb).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Reset Printer' }));
    expect(screen.getByText(/Reset “Printer”/)).toHaveTextContent('This acts on the whole work center');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(wcVerb).toHaveBeenCalledWith('wc1', 'reset', { name: 'Printer' }));
    expect(instanceVerb).toHaveBeenCalledTimes(1);
  });

  it('value edits route by ownership: root → instance route, child → instance route with specOid, shared → work-center route under the note', async () => {
    setPrincipal(['wc1']);
    vi.spyOn(api.runtimeWorkflows, 'valueProperties').mockResolvedValue(VALUES);
    const setInstance = vi.spyOn(api.runtimeWorkflows, 'setValue').mockResolvedValue({ ok: true, summary: 'ok' });
    const setShared = vi.spyOn(wcApi.workCenters, 'setValue').mockResolvedValue({ ok: true, summary: 'ok' });
    render(<RuntimeValuePropertiesSection instanceId="rw1" workCenterId="wc1" />);
    expect(await screen.findByText('Shared with the work center — an edit here changes the value every running workflow reads.')).toBeInTheDocument();

    const edit = async (name: string, value: string) => {
      await userEvent.click(screen.getByRole('button', { name: `Edit ${name}` }));
      const input = screen.getByRole('textbox', { name: `New value for ${name}` });
      await userEvent.clear(input);
      await userEvent.type(input, value);
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    };
    await edit('Batch.Size', '7');
    await waitFor(() => expect(setInstance).toHaveBeenLastCalledWith('rw1', { key: 'Batch.Size', value: '7' }));
    await edit('Sub.X', '2');
    await waitFor(() => expect(setInstance).toHaveBeenLastCalledWith('rw1', { specOid: 'c1', key: 'Sub.X', value: '2' }));
    await edit('Env.Temp', '72');
    await waitFor(() => expect(setShared).toHaveBeenCalledWith('wc1', { propertyName: 'Env', entryName: 'Temp', value: '72' }));
    await waitFor(() => expect(toast.success).toHaveBeenLastCalledWith('Updated Env.Temp'));
  });

  it('a non-commander sees every control disabled', async () => {
    setPrincipal([]);
    vi.spyOn(api.runtimeWorkflows, 'resources').mockResolvedValue(RESOURCES_WITH_IDS);
    render(<RuntimeResourcesSection instanceId="rw1" workCenterId="wc1" />);
    expect(await screen.findByRole('button', { name: 'Reset Lock' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Release Printer' })).toBeDisabled();
  });
});
