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
import { render, screen, waitFor, cleanup, renderHook, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSelectionStore } from '@/stores/selectionStore';
import { usePrincipalStore } from '@/stores/principalStore';
import * as wc from '@/lib/api/work-centers';
import * as loadApi from '@/lib/api/load';
import * as pickersApi from '@/lib/api/pickers';
import * as runtimeWorkflowsApi from '@/lib/api/runtime-workflows';
import * as runtimeHistoryApi from '@/lib/api/runtime-history';
import * as environmentBindingsApi from '@/lib/api/environment-bindings';
import { ApiError } from '@/lib/api/client';
import type { WorkCenterView } from '@/lib/api/types';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The detail view imports refreshTree() (a real module-level export) purely to trigger it
// as a side effect; this test only cares that the wiring calls it, not that the tree itself
// re-renders, so replace the whole module (the tree component is never mounted here).
vi.mock('@/components/work-center/WorkCenterTree', () => ({ refreshTree: vi.fn() }));
// Same stance for the workflow tree: the per-row delete must refresh it, and this test only
// cares that the wiring fires.
vi.mock('@/components/workflow/WorkflowTree', () => ({ refreshWorkflowTree: vi.fn() }));

import { toast } from 'sonner';
import * as workflowsApi from '@/lib/api/workflows';
import * as rolesApi from '@/lib/api/roles';
import { refreshWorkflowTree } from '@/components/workflow/WorkflowTree';
import { WorkCenterDetail } from './WorkCenterDetail';
import { useWorkCenterView } from './useWorkCenterView';

// M6: workflows/environments are plain owned rows — no linkId, no per-link dispatchPolicy.
const VIEW = {
  workCenter: { id: 'w1', name: 'Assembly', description: null, parentWorkCenterId: null, sortOrder: 0, dispatchPolicy: 'least_queued_steps', autoClaim: false, runtimeIdTemplate: null, typeName: null, createdAt: '', updatedAt: '' },
  subtree: [], roles: [{ id: 'ro1', name: 'Operator', description: null }],
  workflows: [{ id: 'wf1', oid: 'o', name: 'Mix', workCenterId: 'w1', workCenterName: 'Assembly', version: '1.0.0', state: 'effective', effectiveFrom: null, dispatchPolicy: null, autoClaim: null, typeName: null, sourceLibraryName: null, sourceLibraryOid: null, allowedRoleCount: 1 }],
  users: [{ id: 'u1', email: 'u@x', loginName: 'uma', displayName: 'Uma', status: 'active', accessLevel: 'viewer', missionSystemCommander: false, roles: [] }],
  environments: [{ id: 'e1', oid: 'e', name: 'Line A', workCenterId: 'w1', workCenterName: 'Assembly', version: '1.0.0', state: 'effective', effectiveFrom: null, sourceLibraryName: null, sourceLibraryOid: null }],
} satisfies WorkCenterView;

// Capability gating disables Load/Edit/Delete/New Child/Assign for a principal lacking the
// right, so these mutation-flow tests seed a fully-permissioned principal — they exercise
// the wiring itself, not rights granularity (that's gating.test.tsx).
beforeEach(() => {
  useSelectionStore.setState({ selectedWorkCenterId: 'w1' });
  usePrincipalStore.getState().setPrincipal({
    id: 'a', email: 'a@x', loginName: 'admin', displayName: 'Admin', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [],
  });
});
// This config does not enable Vitest globals, so @testing-library/react cannot auto-register
// its afterEach(cleanup). Without this, each render() leaks its DOM into document.body and
// later getByRole/getByText calls match duplicates.
afterEach(cleanup);
// vi.spyOn returns the SAME mock instance when re-spying an already-spied method, so call
// counts would accumulate across tests without a restore.
afterEach(() => vi.restoreAllMocks());

describe('WorkCenterDetail', () => {
  it('the Branding tab shows the work-center branding editor', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    vi.spyOn(wc.workCenters, 'pilotTheme').mockResolvedValue({ rev: 0, site: { schema: 1 }, chain: [{ id: VIEW.workCenter.id, name: VIEW.workCenter.name, theme: { schema: 1 } }] });
    render(<WorkCenterDetail />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Branding' }));
    expect(await screen.findByRole('region', { name: 'Work-center branding' })).toBeInTheDocument();
  });

  it('shows the Type line when set and omits it when null', async () => {
    const get = vi.spyOn(wc.workCenters, 'get').mockResolvedValue({ ...VIEW, workCenter: { ...VIEW.workCenter, typeName: 'Production Line' } });
    const { container, unmount } = render(<WorkCenterDetail />);
    await screen.findByText('Assembly');
    expect(container.textContent).toContain('Type: Production Line');
    unmount();
    get.mockResolvedValue(VIEW);
    const second = render(<WorkCenterDetail />);
    await screen.findByText('Assembly');
    expect(second.container.textContent).not.toContain('Type:');
  });

  it('renders the title, tabs, and tab contents', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    expect(screen.getByText('Mix')).toBeInTheDocument();                 // Workflows tab (default)
    await userEvent.click(screen.getByRole('tab', { name: /users/i }));
    expect(await screen.findByText('Uma')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /roles/i }));
    expect(await screen.findByText('Operator')).toBeInTheDocument();
    // 2026-09-09: the tab says what its list IS (the work_center_role view, not membership).
    expect(screen.getByText('This is the list of roles used in workflows for this work center.')).toBeInTheDocument();
  });

  // 2026-08-11 user-testing ticket: workflows are deletable straight from the Workflows tab
  // via a per-row trash can — same confirm dialog, API, and post-delete wiring as
  // WorkflowDetail's header Delete (workflows.remove + refreshWorkflowTree + clear a stale
  // workflow selection), plus a refresh of this work-center view so the row disappears.
  it('deletes a workflow from its row: confirm dialog -> workflows.remove, tree refresh, selection cleared, view refetched', async () => {
    const getSpy = vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    vi.spyOn(workflowsApi.workflows, 'remove').mockResolvedValue(undefined);
    useSelectionStore.setState({ selectedWorkflowId: 'wf1' }); // the doomed workflow is also selected in the Workflows hierarchy
    render(<WorkCenterDetail />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Mix' }));
    // Two Delete-named buttons exist once the dialog opens (row trigger + confirm) — scope.
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(workflowsApi.workflows.remove).toHaveBeenCalledWith('wf1'));
    expect(toast.success).toHaveBeenCalledWith('Deleted Mix');
    expect(refreshWorkflowTree).toHaveBeenCalled();
    await waitFor(() => expect(useSelectionStore.getState().selectedWorkflowId).toBeNull());
    await waitFor(() => expect(getSpy.mock.calls.length).toBeGreaterThanOrEqual(2)); // view refetched
  });

  it('toasts the server message and shows the inline error when the fetch fails', async () => {
    vi.spyOn(wc.workCenters, 'get').mockRejectedValue(new ApiError(500, 'internal', 'boom'));
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Failed to load work center')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  it('has no artifact link pickers — loading is the linking step', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    // EnvironmentsTab now fetches its own bindings on mount (task 19) — this test opens
    // that tab, so it needs its own stub or the mount fires a real, unmocked fetch.
    vi.spyOn(environmentBindingsApi.environmentBindings, 'list').mockResolvedValue([]);
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /link workflow/i })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /env specs/i }));
    expect(screen.queryByRole('button', { name: /link environment/i })).toBeNull();
    // Nor an unlink on either artifact tab — an entry is removed from its own detail panel.
    expect(screen.queryByRole('button', { name: /unlink/i })).toBeNull();
  });

  it('lists loaded workflows read-only, with no dispatch editor', async () => {
    // dispatch_policy lost its only DAO writer in M6 (the deleted link DAO), so an editor
    // here would post to a route that does not exist.
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Mix')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /dispatch/i })).toBeNull();
    // The per-workflow allowed-roles editor survives.
    expect(screen.getByRole('button', { name: 'Roles for Mix' })).toBeInTheDocument();
  });

  it('shows the distinct role count per workflow, including zero', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({
      ...VIEW,
      workflows: [
        { id: 'w1', oid: 'o1', name: 'Has roles', workCenterId: 'wc1', workCenterName: 'WC',
          version: '1.0.0', state: 'Draft', effectiveFrom: null, dispatchPolicy: null, autoClaim: null, typeName: null,
          sourceLibraryName: null, sourceLibraryOid: null, allowedRoleCount: 2 },
        { id: 'w2', oid: 'o2', name: 'No roles', workCenterId: 'wc1', workCenterName: 'WC',
          version: '1.0.0', state: 'Draft', effectiveFrom: null, dispatchPolicy: null, autoClaim: null, typeName: null,
          sourceLibraryName: null, sourceLibraryOid: null, allowedRoleCount: 0 },
      ],
    });
    render(<WorkCenterDetail />);
    const hasRoles = (await screen.findByText('Has roles')).closest('tr')!;
    expect(within(hasRoles).getByText('2')).toBeVisible();
    const noRoles = screen.getByText('No roles').closest('tr')!;
    expect(within(noRoles).getByText('0')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Roles' })).toBeVisible();
  });

  // 2026-08-17 user feedback: these settings existed ONLY inside the Edit dialog — invisible
  // until you opened it. The detail page now shows them read-only; editing stays in the dialog.
  it('shows the dispatch policy and auto-claim settings without opening the Edit dialog', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    render(<WorkCenterDetail />);
    expect(await screen.findByText(/Dispatch policy:/)).toBeInTheDocument();
    expect(screen.getByText('least_queued_steps')).toBeInTheDocument();
    expect(screen.getByText(/Auto-claim follow-on steps:/)).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('renders auto-claim On when the work center opted in', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({
      ...VIEW, workCenter: { ...VIEW.workCenter, autoClaim: true },
    });
    render(<WorkCenterDetail />);
    expect(await screen.findByText(/Auto-claim follow-on steps:/)).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
  });

  // spec §10's read-only echo: the format set in the Edit dialog is otherwise invisible
  // until the dialog is reopened.
  it('echoes the runtime ID format read-only, and names the default when unset', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({
      ...VIEW, workCenter: { ...VIEW.workCenter, runtimeIdTemplate: null },
    });
    render(<WorkCenterDetail />);
    expect(await screen.findByText(/RW-n \(default\)/)).toBeInTheDocument();
  });

  it('echoes a configured runtime ID format read-only', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({
      ...VIEW, workCenter: { ...VIEW.workCenter, runtimeIdTemplate: 'MIX-{YYYY}-{SEQ:3}' },
    });
    render(<WorkCenterDetail />);
    expect(await screen.findByText('MIX-{YYYY}-{SEQ:3}')).toBeInTheDocument();
  });

  it('keeps the users picker — user assignment survived M6', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    vi.spyOn(pickersApi.pickers, 'users').mockResolvedValue({
      users: [{ id: 'u2', email: 'n@x', loginName: 'nia', displayName: 'Nia', status: 'active', accessLevel: 'viewer' }],
    });
    const assigned = { ...VIEW, users: [...VIEW.users, { id: 'u2', email: 'n@x', loginName: 'nia', displayName: 'Nia', status: 'active', accessLevel: 'viewer', missionSystemCommander: false, roles: [] }] } satisfies WorkCenterView;
    const assignSpy = vi.spyOn(wc.workCenters, 'assignUser').mockResolvedValue(assigned);

    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /users/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Add user' }));
    expect(await screen.findByText('Nia')).toBeInTheDocument();          // picker's fetched item
    await userEvent.click(screen.getByRole('button', { name: 'Link' })); // the picker row's action
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('w1', 'u2'));
    await waitFor(() => expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith('Assigned');
    expect(screen.getByText('Nia')).toBeInTheDocument();                 // returned view applied
  });

  it('unassigns a user and refetches the view', async () => {
    const getSpy = vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    const unassignSpy = vi.spyOn(wc.workCenters, 'unassignUser').mockResolvedValue(undefined);
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /users/i }));
    expect(await screen.findByText('Uma')).toBeInTheDocument();
    getSpy.mockClear(); // isolate the refresh() call from the initial mount fetch
    await userEvent.click(screen.getByRole('button', { name: 'Unassign Uma' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Unassign' }));
    await waitFor(() => expect(unassignSpy).toHaveBeenCalledWith('w1', 'u1'));
    expect(getSpy).toHaveBeenCalled(); // refresh() re-fetched the view
    expect(toast.success).toHaveBeenCalledWith('Unassigned');
  });

  it('unassign asks first; Cancel keeps the user', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    const unassignSpy = vi.spyOn(wc.workCenters, 'unassignUser').mockResolvedValue(undefined);
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /users/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Unassign Uma' }));
    expect(await screen.findByText('Unassign Uma from Assembly?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Unassign Uma from Assembly?')).not.toBeInTheDocument());
    expect(unassignSpy).not.toHaveBeenCalled();
  });

  it('unassign dialog lists the roles', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({
      ...VIEW, users: [{ ...VIEW.users[0], roles: [
        { id: 'r1', name: 'Operator', description: null }, { id: 'r2', name: 'Supervisor', description: null },
      ] }],
    });
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /users/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Unassign Uma' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Their roles in this work center will be removed too: Operator, Supervisor.');
  });

  it('unassign dialog for a user with no roles has no roles sentence', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({
      ...VIEW, users: [{ ...VIEW.users[0], roles: [] }],
    });
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /users/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Unassign Uma' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toHaveTextContent('Their roles in this work center will be removed too');
  });

  it('failed unassign keeps the dialog open', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    vi.spyOn(wc.workCenters, 'unassignUser').mockRejectedValue(new ApiError(500, 'internal', 'nope'));
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /users/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Unassign Uma' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Unassign' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('nope'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('toggles Mission System Commander for a user, applies the flipped flag, and toasts', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    const assignSpy = vi.spyOn(wc.workCenters, 'assignUser').mockResolvedValue({
      ...VIEW, users: [{ ...VIEW.users[0], missionSystemCommander: true }],
    });
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /users/i }));
    const toggle = await screen.findByRole('checkbox', { name: 'Mission System Commander for Uma' });
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('w1', 'u1', { missionSystemCommander: true }));
    expect(toast.success).toHaveBeenCalledWith('Mission System Commander granted');
    expect(await screen.findByRole('checkbox', { name: 'Mission System Commander for Uma' })).toBeChecked();
  });

  it('revoking Mission System Commander toasts the revoked message', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({
      ...VIEW, users: [{ ...VIEW.users[0], missionSystemCommander: true }],
    });
    const assignSpy = vi.spyOn(wc.workCenters, 'assignUser').mockResolvedValue({
      ...VIEW, users: [{ ...VIEW.users[0], missionSystemCommander: false }],
    });
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /users/i }));
    const toggle = await screen.findByRole('checkbox', { name: 'Mission System Commander for Uma' });
    expect(toggle).toBeChecked();

    await userEvent.click(toggle);
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('w1', 'u1', { missionSystemCommander: false }));
    expect(toast.success).toHaveBeenCalledWith('Mission System Commander revoked');
  });

  // Mirrors the Diagram tab rule (DiagramTab.tsx / WorkflowDetail.test.tsx): RuntimeTab is a
  // child of TabsContent, so Radix's own unmount-when-inactive is all the gating needed — a
  // steward who never opens Runtime should never trigger, or toast a failure for, that fetch.
  it('does not fetch runtime workflows until the Runtime tab is opened', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    const listSpy = vi.spyOn(runtimeWorkflowsApi.runtimeWorkflows, 'list').mockResolvedValue({ runtimeWorkflows: [], total: 0, page: 1, pageSize: 24 });
    vi.spyOn(runtimeWorkflowsApi.runtimeWorkflows, 'presence').mockResolvedValue({ presence: [] });
    render(<WorkCenterDetail />);
    await screen.findByRole('tab', { name: 'Runtime' });
    expect(listSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('tab', { name: 'Runtime' }));
    // Phase-6 default filter is 'active' (task-10 brief), not the old table's 'all'.
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('w1', { filter: 'active', page: 1 }));
    expect(await screen.findByText('No runtime workflows')).toBeInTheDocument();
  });

  // Same DiagramTab/RuntimeTab rule applied to the sixth tab (phase 7): HistoryTab is a
  // child of TabsContent, so it must not fetch until a steward actually opens History.
  it('does not fetch history until the History tab is opened', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    const listSpy = vi.spyOn(runtimeHistoryApi.runtimeHistory, 'listForWorkCenter')
      .mockResolvedValue({ history: [], total: 0, page: 1, pageSize: 50 });
    render(<WorkCenterDetail />);
    await screen.findByRole('tab', { name: 'History' });
    expect(listSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('tab', { name: 'History' }));
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('w1', { page: 1 }));
    expect(await screen.findByText('No history')).toBeInTheDocument();
  });

  it('does not fetch shared state until the Env Resources tab is opened', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    const resSpy = vi.spyOn(wc.workCenters, 'resources').mockResolvedValue({ resources: [] });
    vi.spyOn(wc.workCenters, 'valueProperties').mockResolvedValue({ values: [] });
    render(<WorkCenterDetail />);
    await screen.findByRole('tab', { name: 'Env Resources' });
    expect(resSpy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('tab', { name: 'Env Resources' }));
    await waitFor(() => expect(resSpy).toHaveBeenCalledWith('w1'));
    expect(await screen.findByText('No shared resources in this work center')).toBeInTheDocument();
  });

  it('opens the Load dialog from the header', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({ nodes: [] });
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /load packages/i }));
    expect(await screen.findByText('Load packages into Assembly')).toBeInTheDocument();
  });

  it('shows the results dialog and refreshes the view after a successful load', async () => {
    const getSpy = vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({ nodes: [] });
    vi.spyOn(loadApi.load, 'load').mockResolvedValue({ results: [
      { filename: 'bottle.WFmasterX', workCenterId: 'w1', kind: 'workflow', status: 'loaded',
        name: 'Bottle Fill', version: '1.0.0', state: 'Draft' },
    ] });

    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    getSpy.mockClear();

    await userEvent.click(screen.getByRole('button', { name: /load packages/i }));
    await userEvent.upload(await screen.findByLabelText('Packages'),
      new File([new Uint8Array([1])], 'bottle.WFmasterX'));
    await userEvent.click(screen.getByRole('button', { name: /^load$/i }));

    // The results dialog replaces the load dialog, and the view re-fetches — a steward must
    // see the new entry without a manual refresh.
    expect(await screen.findByText('Load results')).toBeInTheDocument();
    expect(screen.getByText('Bottle Fill')).toBeInTheDocument();
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
  });

  // Regression: unassign's refresh() must NOT bounce the detail through the full-page
  // "Loading…" gate — that unmounts the uncontrolled <Tabs defaultValue="workflows">, which
  // remounts reset to the Workflows tab. The stale view stays mounted while the same-id
  // refetch is in flight, so the active tab survives. The refetch is a HELD-OPEN promise:
  // an instantly-resolving mock would let React batch straight past the in-flight commit
  // and the regression would never render.
  it('unassigning on the Users tab keeps the Users tab selected through the refetch', async () => {
    const getSpy = vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    const unassignSpy = vi.spyOn(wc.workCenters, 'unassignUser').mockResolvedValue(undefined);
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /users/i }));
    expect(await screen.findByText('Uma')).toBeInTheDocument();
    let resolveRefetch!: (v: WorkCenterView) => void;
    getSpy.mockImplementation(() => new Promise<WorkCenterView>((res) => { resolveRefetch = res; }));
    await userEvent.click(screen.getByRole('button', { name: 'Unassign Uma' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Unassign' }));
    await waitFor(() => expect(unassignSpy).toHaveBeenCalledWith('w1', 'u1'));
    // Mid-refetch: no full-page "Loading…" — the (stale) view and its tabs stay mounted.
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /users/i })).toHaveAttribute('aria-selected', 'true');
    await act(async () => resolveRefetch({ ...VIEW, users: [] } as WorkCenterView));
    await waitFor(() => expect(screen.queryByText('Uma')).not.toBeInTheDocument()); // refetched view applied
    expect(screen.getByRole('tab', { name: /users/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No assigned users')).toBeInTheDocument(); // still ON the Users tab
  });

  // A same-id refresh() that fails must NOT bounce the panel to the full-page error slot —
  // the hook keeps the stale view mounted on error by design, so the fix is an inline
  // banner, not a swap. mockRejectedValueOnce is queued AFTER the mount fetch resolved.
  it('shows a refresh-error banner over the stale view when a same-id refresh fails', async () => {
    const getSpy = vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
    const unassignSpy = vi.spyOn(wc.workCenters, 'unassignUser').mockResolvedValue(undefined);
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /users/i }));
    expect(await screen.findByText('Uma')).toBeInTheDocument();
    getSpy.mockRejectedValueOnce(new ApiError(500, 'internal', 'boom'));
    await userEvent.click(screen.getByRole('button', { name: 'Unassign Uma' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Unassign' }));
    await waitFor(() => expect(unassignSpy).toHaveBeenCalledWith('w1', 'u1'));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't refresh — showing the last loaded data");
    // Stale view (heading + tabs) stays mounted — no full-panel bounce.
    expect(screen.getByText('Assembly')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /workflows/i })).toBeInTheDocument();
  });

  it('lists a member\'s roles and opens the roles dialog; saving applies the returned view', async () => {
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({
      ...VIEW, users: [{ ...VIEW.users[0], roles: [{ id: 'r1', name: 'Operator', description: null }] }],
    });
    vi.spyOn(rolesApi.roles, 'list').mockResolvedValue({ roles: [
      { id: 'r1', name: 'Operator', description: null }, { id: 'r2', name: 'Supervisor', description: null },
    ] });
    const setSpy = vi.spyOn(wc.workCenters, 'setUserRoles').mockResolvedValue({
      ...VIEW, users: [{ ...VIEW.users[0], roles: [
        { id: 'r1', name: 'Operator', description: null }, { id: 'r2', name: 'Supervisor', description: null },
      ] }],
    });
    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /users/i }));
    expect(await screen.findByText('Operator')).toBeInTheDocument();          // Roles cell
    expect(screen.getByText('uma')).toBeInTheDocument();                       // Login cell
    await userEvent.click(screen.getByRole('button', { name: 'Edit roles for Uma' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Supervisor' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setSpy).toHaveBeenCalledWith('w1', 'u1', ['r1', 'r2']));
    expect(await screen.findByText('Operator, Supervisor')).toBeInTheDocument(); // returned view applied
    expect(toast.success).toHaveBeenCalledWith('Roles updated');
  });
});

describe('useWorkCenterView', () => {
  // Regression: fast selection changes (select A, quickly select B; A's response arrives
  // after B's) must not let the superseded response clobber the newer view.
  it('ignores a stale response that settles after a newer request', async () => {
    const pending = new Map<string, (v: WorkCenterView) => void>();
    vi.spyOn(wc.workCenters, 'get').mockImplementation(
      (id) => new Promise<WorkCenterView>((resolve) => { pending.set(id, resolve); }),
    );
    const { result, rerender } = renderHook(({ id }) => useWorkCenterView(id), {
      initialProps: { id: 'w1' },
    });
    rerender({ id: 'w2' }); // w1's fetch is still in flight
    // The newer request (w2) resolves first…
    const W2 = { ...VIEW, workCenter: { ...VIEW.workCenter, id: 'w2', name: 'Packaging' } };
    await act(async () => pending.get('w2')!(W2));
    expect(result.current.view?.workCenter.name).toBe('Packaging');
    expect(result.current.loading).toBe(false);
    // …then w1's stale response arrives late: it must be dropped, not applied.
    await act(async () => pending.get('w1')!(VIEW));
    expect(result.current.view?.workCenter.name).toBe('Packaging');
    expect(result.current.loading).toBe(false);
  });

  it('an assign result that lands after switching work centers is ignored', async () => {
    const VIEW_B = { ...VIEW, workCenter: { ...VIEW.workCenter, id: 'w2', name: 'Packaging' }, users: [], workflows: [], environments: [] } satisfies WorkCenterView;
    vi.spyOn(wc.workCenters, 'get').mockImplementation(async (id: string) => (id === 'w2' ? VIEW_B : VIEW));
    vi.spyOn(pickersApi.pickers, 'users').mockResolvedValue({
      users: [{ id: 'u2', email: 'n@x', loginName: 'nia', displayName: 'Nia', status: 'active', accessLevel: 'viewer' }],
    });
    let resolveAssign!: (v: WorkCenterView) => void;
    vi.spyOn(wc.workCenters, 'assignUser').mockReturnValue(new Promise((res) => { resolveAssign = res; }));

    render(<WorkCenterDetail />);
    expect(await screen.findByText('Assembly')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /users/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Add user' }));
    expect(await screen.findByText('Nia')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));

    act(() => useSelectionStore.setState({ selectedWorkCenterId: 'w2' }));
    expect(await screen.findByText('Packaging')).toBeInTheDocument();
    await act(async () => resolveAssign({ ...VIEW, users: [...VIEW.users] }));

    expect(screen.getByText('Packaging')).toBeInTheDocument();
    expect(screen.queryByText('Assembly')).not.toBeInTheDocument();
  });
});
