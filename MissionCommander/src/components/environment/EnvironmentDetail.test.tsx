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
import { EnvironmentDetail } from './EnvironmentDetail';
import { environments } from '@/lib/api/environments';
import { ApiError } from '@/lib/api/client';
import { toast } from 'sonner';
import { useSelectionStore } from '@/stores/selectionStore';
import { usePrincipalStore } from '@/stores/principalStore';

vi.mock('@/lib/api/environments', () => ({ environments: { get: vi.fn(), remove: vi.fn(), resources: vi.fn(), valueProperties: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wf = { id: 'wf1', oid: 'o-wf1', name: 'Mix', workCenterId: 'wc1', workCenterName: 'Line 1', version: '2', state: 'released', effectiveFrom: null, dispatchPolicy: null, autoClaim: null, typeName: null, sourceLibraryName: null, sourceLibraryOid: null };
const env = { id: 'e1', oid: 'o-e1', name: 'Kitchen', workCenterId: 'wc1', workCenterName: 'Line 1', version: '1', state: 'released', effectiveFrom: null, sourceLibraryName: null, sourceLibraryOid: null };
const wc = { id: 'wc1', name: 'Line 1', description: null, parentWorkCenterId: null, sortOrder: 0, dispatchPolicy: 'manual', autoClaim: false, runtimeIdTemplate: null, typeName: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
// M6: singular owner, not a list.
const VIEW = {
  environmentSpec: env, workCenter: wc, workflows: [wf],
  actions: [
    { name: 'Mix It', library: 'Kitchen', version: '1.0', description: 'Mixes the batter', visibility: 'public', inputs: ['speed', 'time'], outputs: ['done'] },
    { name: 'Legacy', library: null, version: null, description: null, visibility: null, inputs: [], outputs: [] },
  ],
  actionServers: [{ name: 'Main', uri: 'http://srv:8080' }, { name: '', uri: '' }],
  binding: { serverUri: 'http://srv:8080', allowlisted: true } as { serverUri: string; allowlisted: boolean } | null,
};

const asSteward = () => usePrincipalStore.getState().setPrincipal({
  id: 'u1', email: 's@x.io', loginName: 'admin', displayName: 'S', accessLevel: 'steward',
  isAdministrator: false, rights: ['environment:read', 'environment:delete', 'work_center:link', 'workflow:read'], missionSystemCommanderOf: [],
});
const asViewer = () => usePrincipalStore.getState().setPrincipal({
  id: 'u2', email: 'v@x.io', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false, rights: ['environment:read'], missionSystemCommanderOf: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  usePrincipalStore.getState().clearPrincipal();
  useSelectionStore.setState({ selectedEnvironmentId: 'e1', activeHierarchy: 'environment', selectedWorkflowId: null });
});
afterEach(cleanup);

describe('EnvironmentDetail', () => {
  it('renders the overview naming the singular owning work center', async () => {
    asSteward();
    vi.mocked(environments.get).mockResolvedValue(VIEW);
    render(<EnvironmentDetail />);
    expect(await screen.findByRole('heading', { name: 'Kitchen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Line 1' })).toBeInTheDocument();
    // Structural guard: EnvironmentDetail is WorkflowDetail's twin minus the Diagram tab (an
    // environment spec has no step graph of its own - see the file header comment). Nodes was
    // WorkflowDetail's step view before Diagram replaced it (ticket #14); it must not resurface
    // here either.
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Workflows' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Nodes' })).not.toBeInTheDocument();
  });

  it('has no Work Centers tab', async () => {
    asSteward();
    vi.mocked(environments.get).mockResolvedValue(VIEW);
    render(<EnvironmentDetail />);
    expect(await screen.findByRole('heading', { name: 'Kitchen' })).toBeInTheDocument();
    // Both the tab and every link affordance it carried are gone: an artifact belongs to
    // exactly one work center, and linking is retired because loading IS the linking step.
    expect(screen.queryByRole('tab', { name: 'Work Centers' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Link work center' })).toBeNull();
  });

  it('navigates to the Work Center hierarchy when the owner is clicked', async () => {
    asSteward();
    vi.mocked(environments.get).mockResolvedValue(VIEW);
    render(<EnvironmentDetail />);
    await userEvent.click(await screen.findByRole('button', { name: 'Line 1' }));
    // BOTH store fields must change - a nav that set only one would strand the user.
    expect(useSelectionStore.getState().activeHierarchy).toBe('work_center');
    expect(useSelectionStore.getState().selectedWorkCenterId).toBe('wc1');
  });

  it('shows Mission Designer provenance as display-only, with no link affordance', async () => {
    asSteward();
    // sourceLibraryName is traceability only (spec D9) - it must never look navigable.
    vi.mocked(environments.get).mockResolvedValue({ ...VIEW, environmentSpec: { ...env, sourceLibraryName: 'KitchenLib', sourceLibraryOid: 'lib-oid-1' } });
    render(<EnvironmentDetail />);
    expect(await screen.findByText('KitchenLib')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'KitchenLib' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'KitchenLib' })).toBeNull();
  });

  it('omits the provenance block when Mission Designer sent none', async () => {
    asSteward();
    vi.mocked(environments.get).mockResolvedValue(VIEW); // sourceLibraryName: null
    render(<EnvironmentDetail />);
    expect(await screen.findByRole('heading', { name: 'Kitchen' })).toBeInTheDocument();
    expect(screen.queryByText(/mission designer provenance/i)).toBeNull();
  });

  it('gates Delete on environment:delete', async () => {
    asViewer();
    vi.mocked(environments.get).mockResolvedValue(VIEW);
    render(<EnvironmentDetail />);
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeDisabled();
    cleanup();
    asSteward();
    render(<EnvironmentDetail />);
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('deletes the environment spec via the confirm dialog and clears the selection', async () => {
    asSteward();
    vi.mocked(environments.get).mockResolvedValue(VIEW);
    vi.mocked(environments.remove).mockResolvedValue(undefined);
    render(<EnvironmentDetail />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    // Once the dialog is open there are TWO "Delete" buttons (the header's and the
    // dialog's confirm) — scope to the dialog rather than the ambiguous top-level query.
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(environments.remove).toHaveBeenCalledWith('e1'));
    expect(toast.success).toHaveBeenCalledWith('Deleted Kitchen');
    // onDeleted (refreshEnvironmentTree + selectEnvironment(null)) ran: the real
    // selectionStore reflects the cleared selection — a dropped selectEnvironment(null)
    // would leave 'e1' here.
    await waitFor(() => expect(useSelectionStore.getState().selectedEnvironmentId).toBeNull());
  });

  it('navigates to the Workflow hierarchy when a using workflow is clicked', async () => {
    asSteward();
    vi.mocked(environments.get).mockResolvedValue(VIEW);
    render(<EnvironmentDetail />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Workflows' }));
    await userEvent.click(await screen.findByRole('button', { name: /Mix/ }));
    // BOTH store fields must change — a nav that set only one would strand the user.
    expect(useSelectionStore.getState().activeHierarchy).toBe('workflow');
    expect(useSelectionStore.getState().selectedWorkflowId).toBe('wf1');
  });

  // Mirrors the Runtime-tab rule in WorkCenterDetail.test.tsx: the tab body is a child of
  // TabsContent, so Radix's unmount-when-inactive is all the gating — nothing is fetched (or
  // polled) for a tab the operator never opens.
  it('has Resources and Value Properties tabs whose feeds are fetched only when opened', async () => {
    asSteward();
    vi.mocked(environments.get).mockResolvedValue(VIEW);
    vi.mocked(environments.resources).mockResolvedValue({ workCenterId: 'wc1', resources: [], unregistered: [] });
    render(<EnvironmentDetail />);
    expect(await screen.findByRole('tab', { name: 'Resources' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Value Properties' })).toBeInTheDocument();
    expect(environments.resources).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('tab', { name: 'Resources' }));
    await waitFor(() => expect(environments.resources).toHaveBeenCalledWith('e1'));
    expect(await screen.findByText('This environment declares no resources')).toBeInTheDocument();
  });

  it('lists the environment actions on the Actions tab', async () => {
    asSteward();
    vi.mocked(environments.get).mockResolvedValue(VIEW);
    render(<EnvironmentDetail />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Actions' }));
    const row = screen.getByText('Mix It').closest('tr')!;
    expect(within(row).getByText('Kitchen')).toBeInTheDocument();
    expect(within(row).getByText('1.0')).toBeInTheDocument();
    expect(within(row).getByText('speed, time')).toBeInTheDocument();
    expect(within(row).getByText('done')).toBeInTheDocument();
    expect(within(row).getByText('Mixes the batter')).toBeInTheDocument();
    const legacy = screen.getByText('Legacy').closest('tr')!;
    expect(within(legacy).getAllByText('—').length).toBe(4);
  });

  it('shows an empty state when there are no actions', async () => {
    asSteward();
    vi.mocked(environments.get).mockResolvedValue({ ...VIEW, actions: [] });
    render(<EnvironmentDetail />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Actions' }));
    expect(screen.getByText('This environment has no actions')).toBeInTheDocument();
  });

  it('shows the declared server and the binding on the Overview', async () => {
    asSteward();
    vi.mocked(environments.get).mockResolvedValue(VIEW);
    render(<EnvironmentDetail />);
    expect(await screen.findByText('Action server')).toBeInTheDocument();
    expect(screen.getByText('Designer server')).toBeInTheDocument();
    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.getByText('(unnamed)')).toBeInTheDocument();
    expect(screen.getByText('(blank)')).toBeInTheDocument();
    expect(screen.getByText("This work center's binding")).toBeInTheDocument();
    expect(screen.getAllByText('http://srv:8080').length).toBe(2);
    expect(screen.queryByText(/Not on the action-server allowlist/)).toBeNull();
    expect(screen.queryByText(/No action server bound/)).toBeNull();
  });

  it('says None declared when the environment declares no server', async () => {
    asSteward();
    vi.mocked(environments.get).mockResolvedValue({ ...VIEW, actionServers: [] });
    render(<EnvironmentDetail />);
    expect(await screen.findByText('None declared')).toBeInTheDocument();
  });

  it('flags an unbound environment and offers Set binding', async () => {
    asSteward();
    vi.mocked(environments.get).mockResolvedValue({ ...VIEW, binding: null });
    render(<EnvironmentDetail />);
    expect(await screen.findByText('No action server bound in this work center — actions in this environment will fail until one is set.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set binding' }));
    expect(useSelectionStore.getState().activeHierarchy).toBe('work_center');
    expect(useSelectionStore.getState().selectedWorkCenterId).toBe('wc1');
  });

  it('flags a binding that is not on the allowlist', async () => {
    asSteward();
    vi.mocked(environments.get).mockResolvedValue({ ...VIEW, binding: { serverUri: 'http://other:1', allowlisted: false } });
    render(<EnvironmentDetail />);
    expect(await screen.findByText('Not on the action-server allowlist — add it under Settings → Action server trust.')).toBeInTheDocument();
    expect(screen.getByText('http://other:1')).toBeInTheDocument();
  });
});
