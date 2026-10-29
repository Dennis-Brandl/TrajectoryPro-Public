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
import { WorkflowDetail } from './WorkflowDetail';
import { workflows, patchWorkflowDispatchPolicy, patchWorkflowAutoClaim } from '@/lib/api/workflows';
import * as workflowsApi from '@/lib/api/workflows';
import { toast } from 'sonner';
import { useSelectionStore } from '@/stores/selectionStore';
import { usePrincipalStore } from '@/stores/principalStore';

vi.mock('@/lib/api/workflows', () => ({
  workflows: { get: vi.fn(), remove: vi.fn(), diagram: vi.fn() },
  patchWorkflowDispatchPolicy: vi.fn(),
  patchWorkflowAutoClaim: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wf = { id: 'wf1', oid: 'o-wf1', name: 'Mix', workCenterId: 'wc1', workCenterName: 'Line 1', version: '2', state: 'released', effectiveFrom: null, dispatchPolicy: null, autoClaim: null, typeName: null, sourceLibraryName: null, sourceLibraryOid: null };
const env = { id: 'e1', oid: 'o-e1', name: 'Kitchen', workCenterId: 'wc1', workCenterName: 'Line 1', version: '1', state: 'released', effectiveFrom: null, sourceLibraryName: null, sourceLibraryOid: null };
const wc = { id: 'wc1', name: 'Line 1', description: null, parentWorkCenterId: null, sortOrder: 0, dispatchPolicy: 'manual', autoClaim: false, runtimeIdTemplate: null, typeName: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
// M6: singular owner, not a list.
const VIEW = { workflow: wf, workCenter: wc, environments: [env] };

const asSteward = () => usePrincipalStore.getState().setPrincipal({
  id: 'u1', email: 's@x.io', loginName: 'admin', displayName: 'S', accessLevel: 'steward',
  isAdministrator: false,
  // Real stewards hold 'workflow:edit' too (dao/access.ts TIER_RIGHTS: a steward gets every
  // non-access:* right); listed explicitly here since this fixture hand-builds the rights set.
  rights: ['workflow:read', 'workflow:delete', 'workflow:edit', 'work_center:link', 'environment:read'],
  missionSystemCommanderOf: [],
});
const asViewer = () => usePrincipalStore.getState().setPrincipal({
  id: 'u2', email: 'v@x.io', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false, rights: ['workflow:read'], missionSystemCommanderOf: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  usePrincipalStore.getState().clearPrincipal();
  useSelectionStore.setState({ selectedWorkflowId: 'wf1', activeHierarchy: 'workflow', selectedEnvironmentId: null });
  vi.mocked(workflows.diagram).mockResolvedValue({
    workflowId: 'wf1',
    root: { oid: 'root', name: 'Root', version: '1.0.0', state: 'Draft', notation: 'flowchart', steps: [], connections: [], children: [] },
  } as never);
});
afterEach(cleanup);

describe('WorkflowDetail', () => {
  it('renders the overview naming the singular owning work center', async () => {
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    render(<WorkflowDetail />);
    expect(await screen.findByRole('heading', { name: 'Mix' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Line 1' })).toBeInTheDocument();
  });

  it('shows the workflow Type line when set, and omits it otherwise', async () => {
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue({ ...VIEW, workflow: { ...wf, typeName: 'Operation' } });
    const { container, unmount } = render(<WorkflowDetail />);
    await screen.findByRole('heading', { name: 'Mix' });
    expect(container.textContent).toContain('Type: Operation');
    unmount();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    const second = render(<WorkflowDetail />);
    await second.findByRole('heading', { name: 'Mix' });
    expect(second.container.textContent).not.toContain('Type:');
  });

  it('has no Work Centers tab', async () => {
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    render(<WorkflowDetail />);
    expect(await screen.findByRole('heading', { name: 'Mix' })).toBeInTheDocument();
    // Both the tab and every link affordance it carried are gone: an artifact belongs to
    // exactly one work center, and linking is retired because loading IS the linking step.
    expect(screen.queryByRole('tab', { name: 'Work Centers' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Link work center' })).toBeNull();
  });

  it('navigates to the Work Center hierarchy when the owner is clicked', async () => {
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    render(<WorkflowDetail />);
    await userEvent.click(await screen.findByRole('button', { name: 'Line 1' }));
    // BOTH store fields must change - a nav that set only one would strand the user.
    expect(useSelectionStore.getState().activeHierarchy).toBe('work_center');
    expect(useSelectionStore.getState().selectedWorkCenterId).toBe('wc1');
  });

  it('shows Mission Designer provenance as display-only, with no link affordance', async () => {
    asSteward();
    // sourceLibraryName is traceability only (spec D9) - it must never look navigable.
    vi.mocked(workflows.get).mockResolvedValue({ ...VIEW, workflow: { ...wf, sourceLibraryName: 'KitchenLib', sourceLibraryOid: 'lib-oid-1' } });
    render(<WorkflowDetail />);
    expect(await screen.findByText('KitchenLib')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'KitchenLib' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'KitchenLib' })).toBeNull();
  });

  it('omits the provenance block when Mission Designer sent none', async () => {
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue(VIEW); // sourceLibraryName: null
    render(<WorkflowDetail />);
    expect(await screen.findByRole('heading', { name: 'Mix' })).toBeInTheDocument();
    expect(screen.queryByText(/mission designer provenance/i)).toBeNull();
  });

  it('gates Delete on workflow:delete', async () => {
    asViewer();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    render(<WorkflowDetail />);
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeDisabled();
    cleanup();
    asSteward();
    render(<WorkflowDetail />);
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('gates the dispatch-policy Select on workflow:edit', async () => {
    asViewer();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    render(<WorkflowDetail />);
    expect(await screen.findByRole('combobox', { name: 'Dispatch policy' })).toBeDisabled();
    cleanup();
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    render(<WorkflowDetail />);
    expect(await screen.findByRole('combobox', { name: 'Dispatch policy' })).toBeEnabled();
  });

  it('shows the helper text verbatim and the current dispatch policy (Inherit when null)', async () => {
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue(VIEW); // dispatchPolicy: null
    render(<WorkflowDetail />);
    expect(await screen.findByRole('combobox', { name: 'Dispatch policy' })).toHaveTextContent('Inherit work-center default');
    expect(screen.getByText('Suggests tasks to operators; any eligible operator may claim')).toBeInTheDocument();
  });

  it('saves a changed dispatch policy and refreshes the view', async () => {
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    vi.mocked(patchWorkflowDispatchPolicy).mockResolvedValue(undefined);
    render(<WorkflowDetail />);
    const select = await screen.findByRole('combobox', { name: 'Dispatch policy' });
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole('option', { name: 'Manual (pull only)' }));
    await waitFor(() => expect(patchWorkflowDispatchPolicy).toHaveBeenCalledWith('wf1', 'manual'));
    expect(toast.success).toHaveBeenCalledWith('Dispatch policy saved');
    // refresh() re-fetches the same view — the initial mount call plus this one.
    await waitFor(() => expect(workflows.get).toHaveBeenCalledTimes(2));
  });

  it('gates the auto-claim Select on workflow:edit and shows Inherit for null', async () => {
    asViewer();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    render(<WorkflowDetail />);
    expect(await screen.findByRole('combobox', { name: 'Auto-claim follow-on steps' })).toBeDisabled();
    cleanup();
    asSteward();
    render(<WorkflowDetail />);
    const select = await screen.findByRole('combobox', { name: 'Auto-claim follow-on steps' });
    expect(select).toBeEnabled();
    expect(select).toHaveTextContent('Inherit work-center default'); // autoClaim: null
  });

  it('saves a changed auto-claim override and refreshes the view', async () => {
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    vi.mocked(patchWorkflowAutoClaim).mockResolvedValue(undefined);
    render(<WorkflowDetail />);
    const select = await screen.findByRole('combobox', { name: 'Auto-claim follow-on steps' });
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole('option', { name: 'On' }));
    await waitFor(() => expect(patchWorkflowAutoClaim).toHaveBeenCalledWith('wf1', true));
    expect(toast.success).toHaveBeenCalledWith('Auto-claim saved');
    await waitFor(() => expect(workflows.get).toHaveBeenCalledTimes(2));
  });

  it('toasts and does not crash when saving the dispatch policy fails', async () => {
    const { ApiError } = await import('@/lib/api/client');
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    vi.mocked(patchWorkflowDispatchPolicy).mockRejectedValue(new ApiError(400, 'bad_request', 'Unknown dispatch policy'));
    render(<WorkflowDetail />);
    const select = await screen.findByRole('combobox', { name: 'Dispatch policy' });
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole('option', { name: 'Manual (pull only)' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Unknown dispatch policy'));
  });

  // Create Runtime Workflow… gates on Mission System Commander of the workflow's OWN work center
  // (wc1, per VIEW above) — a static right like workflow:read/delete is irrelevant here.
  it('gates Create Runtime Workflow… on Mission System Commander of the workflow\'s work center', async () => {
    asSteward(); // steward rights, but missionSystemCommanderOf: []
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    render(<WorkflowDetail />);
    expect(await screen.findByRole('button', { name: 'Create Runtime Workflow…' })).toBeDisabled();
    cleanup();
    usePrincipalStore.getState().setPrincipal({
      id: 'u3', email: 'm@x.io', loginName: 'admin', displayName: 'M', accessLevel: 'steward',
      isAdministrator: false, rights: ['workflow:read'], missionSystemCommanderOf: ['wc1'],
    });
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    render(<WorkflowDetail />);
    expect(await screen.findByRole('button', { name: 'Create Runtime Workflow…' })).toBeEnabled();
  });

  // The gap the P7 final review flagged: link/unlink and gating were covered, but nothing
  // exercised the delete integration seam itself — that clicking Delete actually calls
  // workflows.remove with the right id and clears the selection afterward. Mirrors
  // LibraryDetail.test.tsx / RoleDetail.test.tsx's confirm-dialog disambiguation convention.
  it('deletes the workflow via the confirm dialog and clears the selection', async () => {
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    vi.mocked(workflows.remove).mockResolvedValue(undefined);
    render(<WorkflowDetail />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    // Once the dialog is open there are TWO "Delete" buttons (the header's and the
    // dialog's confirm) — scope to the dialog rather than the ambiguous top-level query.
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(workflows.remove).toHaveBeenCalledWith('wf1'));
    expect(toast.success).toHaveBeenCalledWith('Deleted Mix');
    // onDeleted (refreshWorkflowTree + selectWorkflow(null)) ran: the real selectionStore
    // reflects the cleared selection — a dropped selectWorkflow(null) would leave 'wf1' here.
    await waitFor(() => expect(useSelectionStore.getState().selectedWorkflowId).toBeNull());
  });

  it('navigates to the Environment hierarchy when an embedded env spec is clicked', async () => {
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    render(<WorkflowDetail />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Environments' }));
    await userEvent.click(await screen.findByRole('button', { name: /Kitchen/ }));
    // BOTH store fields must change — a nav that set only one would strand the user.
    expect(useSelectionStore.getState().activeHierarchy).toBe('environment');
    expect(useSelectionStore.getState().selectedEnvironmentId).toBe('e1');
  });

  it('does not fetch the diagram until the Diagram tab is opened', async () => {
    // Eager fetching meant a diagram failure toasted for a tab the user never opened, and
    // one network blip produced two toasts (this fetch plus the workflow view's).
    vi.mocked(workflows.get).mockResolvedValue(VIEW as never);
    render(<WorkflowDetail />);
    await screen.findByRole('tab', { name: 'Diagram' });
    expect(workflows.diagram).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('tab', { name: 'Diagram' }));
    await waitFor(() => expect(workflows.diagram).toHaveBeenCalledTimes(1));
  });

  it('shows a Diagram tab instead of Nodes, and renders the root spec', async () => {
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    vi.spyOn(workflowsApi.workflows, 'diagram').mockResolvedValue({
      workflowId: 'wf1',
      root: {
        oid: 'root', name: 'Root', version: '1.0.0', state: 'Draft', notation: 'flowchart',
        steps: [{ oid: 's0', name: 'Begin', stepType: 'START', x: 0, y: 0, childSpecOid: null }],
        connections: [], children: [],
      },
    } as never);
    render(<WorkflowDetail />);
    expect(await screen.findByRole('tab', { name: 'Diagram' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Nodes' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Diagram' }));
    expect(await screen.findByText('Begin')).toBeInTheDocument();
  });

  it('surfaces a diagram fetch failure without blanking the panel', async () => {
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    vi.spyOn(workflowsApi.workflows, 'diagram').mockRejectedValue(new Error('boom'));
    render(<WorkflowDetail />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Diagram' }));
    expect(await screen.findByText('Failed to load diagram')).toBeVisible();
  });

  it('groups the dispatch controls under a visible "Operator dispatch" heading', async () => {
    asSteward();
    vi.mocked(workflows.get).mockResolvedValue(VIEW);
    render(<WorkflowDetail />);
    expect(await screen.findByRole('heading', { name: 'Operator dispatch' })).toBeInTheDocument();
    // Both controls live under it, unchanged.
    expect(screen.getByRole('combobox', { name: 'Dispatch policy' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Auto-claim follow-on steps' })).toBeInTheDocument();
  });
});
