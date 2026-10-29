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
import { toast } from 'sonner';
import { usePrincipalStore } from '@/stores/principalStore';
import { useSelectionStore } from '@/stores/selectionStore';
import * as rolesApi from '@/lib/api/roles';
import { RoleDetail } from './RoleDetail';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const VIEW = {
  role: { id: 'r1', name: 'Operator', description: 'ops' },
  members: [{
    workCenter: { id: 'w1', name: 'Line 1', description: null, parentWorkCenterId: null, sortOrder: 0, dispatchPolicy: 'least_queued_steps', autoClaim: false, runtimeIdTemplate: null, typeName: null, createdAt: '', updatedAt: '' },
    users: [{ id: 'u1', email: 'a@x.io', loginName: 'alice', displayName: 'Alice', status: 'active', accessLevel: 'viewer' }],
  }],
  workflows: [{ id: 'wf1', oid: 'o', name: 'Mix', version: '1.0.0', state: 'effective', libraryId: 'lib1', libraryName: 'Default', effectiveFrom: null }],
};
beforeEach(() => {
  useSelectionStore.setState({ selectedRoleId: 'r1', activeHierarchy: 'role' });
  usePrincipalStore.getState().setPrincipal({ id: 's', email: '', loginName: 'admin', displayName: 'S', accessLevel: 'steward', isAdministrator: false, rights: ['role:read', 'role:edit', 'role:delete', 'user:read'], missionSystemCommanderOf: [] });
  vi.spyOn(rolesApi.roles, 'get').mockResolvedValue(VIEW as never);
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

describe('RoleDetail', () => {
  it('renders header, members grouped by work center (read-only), and read-only workflows', async () => {
    render(<RoleDetail />);
    expect(await screen.findByRole('heading', { name: 'Operator' })).toBeVisible();
    expect(screen.getByText('Line 1')).toBeVisible();
    expect(screen.getByText('Alice (alice)')).toBeVisible();
    expect(screen.queryByRole('button', { name: /add member/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
    expect(screen.getByText('Roles are assigned to users from the work center.')).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'Workflows' }));
    expect(await screen.findByText('Mix')).toBeVisible();
  });

  it('shows the empty state when nobody holds the role', async () => {
    vi.spyOn(rolesApi.roles, 'get').mockResolvedValue({ ...VIEW, members: [] } as never);
    render(<RoleDetail />);
    await screen.findByRole('heading', { name: 'Operator' });
    expect(screen.getByText('No members')).toBeVisible();
  });

  it('clicking Delete opens a confirmation dialog without deleting yet', async () => {
    const spy = vi.spyOn(rolesApi.roles, 'remove').mockResolvedValue(undefined);
    render(<RoleDetail />);
    await screen.findByRole('heading', { name: 'Operator' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete role?')).toBeVisible();
    expect(screen.getByText(/every work-center member/i)).toBeVisible();
    expect(spy).not.toHaveBeenCalled();
  });

  it('confirming the dialog deletes the role, refreshes the tree, and clears selection', async () => {
    const spy = vi.spyOn(rolesApi.roles, 'remove').mockResolvedValue(undefined);
    render(<RoleDetail />);
    await screen.findByRole('heading', { name: 'Operator' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('r1'));
    expect(toast.success).toHaveBeenCalledWith('Role deleted');
    // onDeleted (refreshRoleTree + selectRole(null)) ran: the real selectionStore
    // reflects the cleared selection, and the (now id-less) detail view unmounts.
    expect(useSelectionStore.getState().selectedRoleId).toBeNull();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Operator' })).toBeNull());
  });

  it('surfaces a ROLE_IN_USE 409 on delete as a toast and keeps the dialog open', async () => {
    const { ApiError } = await import('@/lib/api/client');
    vi.spyOn(rolesApi.roles, 'remove').mockRejectedValue(new ApiError(409, 'conflict', 'Role is referenced by allowed-role assignments'));
    render(<RoleDetail />);
    await screen.findByRole('heading', { name: 'Operator' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Role is referenced by allowed-role assignments'));
    expect(screen.getByRole('dialog')).toBeVisible(); // stays open
    expect(useSelectionStore.getState().selectedRoleId).toBe('r1'); // selection unchanged
  });

  // Task 9: pins the error && !view branch — an initial load failure has no stale
  // view to fall back to, so it must still take the full-panel error slot (only a
  // same-id refresh failure with a surviving view gets the banner treatment).
  it('shows the full-panel error slot when the initial load fails (no stale view)', async () => {
    const { ApiError } = await import('@/lib/api/client');
    vi.spyOn(rolesApi.roles, 'get').mockRejectedValue(new ApiError(500, 'internal', 'boom'));
    render(<RoleDetail />);
    expect(await screen.findByText('Failed to load role')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
