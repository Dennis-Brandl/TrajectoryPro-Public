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
import { render, screen, cleanup, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { runBoot } from '@/lib/auth/boot';
import { usePrincipalStore } from '@/stores/principalStore';
import { useSelectionStore } from '@/stores/selectionStore';
import * as usersApi from '@/lib/api/users';
import * as rolesApi from '@/lib/api/roles';
import * as wcApi from '@/lib/api/work-centers';
import type { WorkCenterView } from '@/lib/api/types';
import { UserDetail } from './UserDetail';

const { navigateSpy, impersonateUserSpy, listUserSessionsSpy } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  impersonateUserSpy: vi.fn(async () => ({ data: { session: {}, user: {} }, error: null })),
  listUserSessionsSpy: vi.fn(async () => ({ data: { sessions: [] }, error: null })),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth/boot', () => ({ runBoot: vi.fn(async () => ({ ok: true })) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateSpy }));
vi.mock('@/lib/auth/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: null }),
    admin: {
      impersonateUser: impersonateUserSpy,
      listUserSessions: listUserSessionsSpy,
      revokeUserSession: vi.fn(async () => ({ data: { success: true }, error: null })),
      revokeUserSessions: vi.fn(async () => ({ data: { success: true }, error: null })),
    },
  },
}));

const VIEW = {
  user: { id: 'u1', email: 'a@x.io', loginName: 'alice', displayName: 'Alice', status: 'active', accessLevel: 'steward' },
  workCenters: [{
    workCenter: { id: 'w1', name: 'Line 1', description: null, parentWorkCenterId: null, sortOrder: 0, dispatchPolicy: 'least_queued_steps', autoClaim: false, runtimeIdTemplate: null, typeName: null, createdAt: '', updatedAt: '' },
    missionSystemCommander: true,
    roles: [{ id: 'r1', name: 'Operator', description: null }],
  }],
};
beforeEach(() => {
  useSelectionStore.setState({ selectedUserId: 'u1', activeHierarchy: 'user' });
  usePrincipalStore.getState().setPrincipal({ id: 'admin', email: '', loginName: 'admin', displayName: 'Admin', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [] });
  vi.spyOn(usersApi.users, 'get').mockResolvedValue(VIEW as never);
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

describe('UserDetail', () => {
  it('renders header with login name, and the read-only Work Centers tab with commander flag and roles', async () => {
    render(<UserDetail />);
    expect(await screen.findByRole('heading', { name: 'Alice' })).toBeVisible();
    expect(screen.getByText('a@x.io · alice')).toBeVisible();
    // Work Centers is the default tab.
    expect(screen.getByText('Line 1')).toBeVisible();
    expect(screen.getByText('Operator')).toBeVisible();
    expect(screen.getByRole('cell', { name: 'Yes' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Roles' })).toBeNull();
    // 2026-09-09: roles are editable per work center from here too (the row's Add Role).
    expect(screen.getByRole('button', { name: 'Add Role in Line 1' })).toBeEnabled();
    expect(screen.getByText('Membership and Mission System Commander are edited from the work center.')).toBeVisible();
  });

  it('Edit dialog seeds display name + login name and submits both through users.update', async () => {
    const spy = vi.spyOn(usersApi.users, 'update').mockResolvedValue({ ...VIEW, user: { ...VIEW.user, displayName: 'Alicia', loginName: 'alicia' } } as never);
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Display name')).toHaveValue('Alice');
    expect(screen.getByLabelText('Login name')).toHaveValue('alice');
    await userEvent.clear(screen.getByLabelText('Display name'));
    await userEvent.type(screen.getByLabelText('Display name'), 'Alicia');
    await userEvent.clear(screen.getByLabelText('Login name'));
    await userEvent.type(screen.getByLabelText('Login name'), ' ALICIA ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('u1', { displayName: 'Alicia', loginName: 'alicia' }));
    expect(await screen.findByRole('heading', { name: 'Alicia' })).toBeVisible();
    expect(toast.success).toHaveBeenCalledWith('User updated');
  });

  it('Edit dialog rejects an invalid login name client-side', async () => {
    const spy = vi.spyOn(usersApi.users, 'update');
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.clear(screen.getByLabelText('Login name'));
    await userEvent.type(screen.getByLabelText('Login name'), 'bad name!');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText(/lowercase letters, digits/i)).toBeVisible();
    expect(spy).not.toHaveBeenCalled();
  });

  it('Edit dialog changes the email (sent lowercased only when changed) and blocks an invalid one', async () => {
    const spy = vi.spyOn(usersApi.users, 'update').mockResolvedValue({ ...VIEW, user: { ...VIEW.user, email: 'new@x.io' } } as never);
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const email = screen.getByLabelText('Email');
    expect(email).toHaveValue('a@x.io');
    await userEvent.clear(email);
    await userEvent.type(email, 'not-an-email');
    expect(screen.getByText('Enter a valid email')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.clear(email);
    await userEvent.type(email, ' New@X.io ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('u1', { displayName: 'Alice', loginName: 'alice', email: 'new@x.io' }));
    expect(await screen.findByText('new@x.io · alice')).toBeVisible();
  });

  it('Edit dialog locks the email without access:edit', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 's', email: '', loginName: 'admin', displayName: 'S', accessLevel: 'steward', isAdministrator: false, rights: ['user:read', 'user:edit'], missionSystemCommanderOf: [] });
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByText(/changing it requires access:edit/)).toBeVisible();
  });

  it('disables the Edit control for a steward (no user:edit)', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 's', email: '', loginName: 'admin', displayName: 'S', accessLevel: 'steward', isAdministrator: false, rights: ['user:read', 'role:read'], missionSystemCommanderOf: [] });
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
  });

  // Task 9: pins the error && !view branch — an initial load failure has no stale
  // view to fall back to, so it must still take the full-panel error slot (only a
  // same-id refresh failure with a surviving view gets the banner treatment).
  it('shows the full-panel error slot when the initial load fails (no stale view)', async () => {
    const { ApiError } = await import('@/lib/api/client');
    vi.spyOn(usersApi.users, 'get').mockRejectedValue(new ApiError(500, 'internal', 'boom'));
    render(<UserDetail />);
    expect(await screen.findByText('Failed to load user')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('UserDetail admin actions', () => {
  it('disables Set password / Disable and shows the read-only access level for a steward', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 's', email: '', loginName: 'admin', displayName: 'S', accessLevel: 'steward', isAdministrator: false, rights: ['user:read', 'role:read', 'user:edit'], missionSystemCommanderOf: [] });
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Disable|Enable/ })).toBeDisabled();
    expect(screen.getByLabelText('Access level')).toHaveTextContent('steward');
  });

  it('disabling a user applies the refreshed view (server truth)', async () => {
    const disabled = { ...VIEW, user: { ...VIEW.user, status: 'disabled' } };
    const spy = vi.spyOn(usersApi.users, 'setStatus').mockResolvedValue(disabled as never);
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('u1', 'disabled'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enable' })).toBeVisible());
  });

  it('surfaces a guard-rail rejection (403) as an error toast without changing the view', async () => {
    const { ApiError } = await import('@/lib/api/client');
    vi.spyOn(usersApi.users, 'setStatus').mockRejectedValue(new ApiError(403, 'forbidden', 'You cannot disable your own account'));
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You cannot disable your own account'));
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull(); // unchanged
  });

  // Spec §7.2: on your own user, demote/disable are pre-disabled client-side (both
  // are ALWAYS a server 403, unlike last-admin which stays server-truth-only). This
  // is race-free — no last-admin computation involved.
  it('pre-disables the access Select and Disable button when viewing your own user', async () => {
    vi.spyOn(usersApi.users, 'get').mockResolvedValue({ ...VIEW, user: { ...VIEW.user, id: 'admin' } } as never);
    useSelectionStore.setState({ selectedUserId: 'admin' });
    usePrincipalStore.getState().setPrincipal({ id: 'admin', email: '', loginName: 'admin', displayName: 'Admin', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [] });
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    expect(screen.getByRole('combobox', { name: 'Access level' })).toBeDisabled();
    const disableButton = screen.getByRole('button', { name: 'Disable' });
    expect(disableButton).toBeDisabled();
    expect(disableButton).toHaveAttribute('title', 'You cannot disable your own account');
  });
});

describe('UserDetail impersonation visibility', () => {
  it('shows Impersonate for an admin viewing an active non-admin', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'admin', email: '', loginName: 'admin', displayName: 'Admin', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [] });
    render(<UserDetail />); // VIEW.user is a steward, active, id u1 (not the admin)
    await screen.findByRole('heading', { name: 'Alice' });
    expect(screen.getByRole('button', { name: 'Impersonate' })).toBeVisible();
  });

  it('hides Impersonate when the target is an administrator', async () => {
    vi.spyOn(usersApi.users, 'get').mockResolvedValue({ ...VIEW, user: { ...VIEW.user, accessLevel: 'administrator' } } as never);
    usePrincipalStore.getState().setPrincipal({ id: 'admin', email: '', loginName: 'admin', displayName: 'Admin', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [] });
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    expect(screen.queryByRole('button', { name: 'Impersonate' })).toBeNull();
  });

  it('hides Impersonate when viewing yourself', async () => {
    vi.spyOn(usersApi.users, 'get').mockResolvedValue({ ...VIEW, user: { ...VIEW.user, id: 'admin' } } as never);
    useSelectionStore.setState({ selectedUserId: 'admin' });
    usePrincipalStore.getState().setPrincipal({ id: 'admin', email: '', loginName: 'admin', displayName: 'Admin', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [] });
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    expect(screen.queryByRole('button', { name: 'Impersonate' })).toBeNull();
  });

  it('hides Impersonate when the target user is disabled', async () => {
    vi.spyOn(usersApi.users, 'get').mockResolvedValue({ ...VIEW, user: { ...VIEW.user, status: 'disabled' } } as never);
    usePrincipalStore.getState().setPrincipal({ id: 'admin', email: '', loginName: 'admin', displayName: 'Admin', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [] });
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    expect(screen.queryByRole('button', { name: 'Impersonate' })).toBeNull();
  });

  it('does not navigate when impersonation returns an error', async () => {
    const { authClient } = await import('@/lib/auth/auth-client');
    vi.mocked(authClient.admin.impersonateUser).mockResolvedValueOnce({ data: null, error: { message: 'nope' } } as never);
    usePrincipalStore.getState().setPrincipal({ id: 'admin', email: '', loginName: 'admin', displayName: 'Admin', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [] });
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    navigateSpy.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Impersonate' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  // Impersonation itself succeeded (the target session was created); a failed
  // reboot only means this tab's principalStore is stale, not that impersonation
  // failed. The route guard's own beforeLoad re-runs runBoot on the next
  // navigation, so still navigating home is the chosen (self-healing) behavior —
  // the toast just tells the admin why the UI may look momentarily unchanged.
  it('still navigates when impersonation succeeds but the reboot fails (route guard re-boots)', async () => {
    vi.mocked(runBoot).mockResolvedValueOnce({ ok: false, error: 'me' });
    usePrincipalStore.getState().setPrincipal({ id: 'admin', email: '', loginName: 'admin', displayName: 'Admin', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [] });
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    navigateSpy.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Impersonate' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/' });
  });

  // Task 7 (post-merge): Impersonate must guard against a double-click — disabled while the
  // impersonateUser call is in flight. The held-open mock keeps the first call pending so the
  // disabled state is observable before it resolves.
  it('disables Impersonate while impersonation is in flight', async () => {
    let resolveImp!: (v: { data: { session: object; user: object }; error: null }) => void;
    impersonateUserSpy.mockImplementation(() => new Promise((r) => { resolveImp = r; }));
    render(<UserDetail />);
    const btn = await screen.findByRole('button', { name: 'Impersonate' });
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    await act(async () => resolveImp({ data: { session: {}, user: {} }, error: null }));
  });
});

// Task 12: the target's sessions are revoked server-side by both the set-password
// route and the disable status change; an open Sessions tab must not keep showing
// now-dead rows, so both success paths bump a `key` that remounts SessionsTab.
describe('UserDetail sessions refresh', () => {
  it('refetches sessions after a successful Set-password (key bump remounts SessionsTab)', async () => {
    vi.spyOn(usersApi.users, 'setPassword').mockResolvedValue({ ok: true } as never);
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    await userEvent.click(screen.getByRole('tab', { name: 'Sessions' }));
    await waitFor(() => expect(listUserSessionsSpy).toHaveBeenCalled());
    const callsBefore = listUserSessionsSpy.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('New password'), 'brand-new-1');
    await userEvent.type(within(dialog).getByLabelText('Confirm password'), 'brand-new-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Set password' }));

    await waitFor(() => expect(listUserSessionsSpy.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('refetches sessions after a successful Disable (key bump remounts SessionsTab)', async () => {
    const disabled = { ...VIEW, user: { ...VIEW.user, status: 'disabled' } };
    vi.spyOn(usersApi.users, 'setStatus').mockResolvedValue(disabled as never);
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    await userEvent.click(screen.getByRole('tab', { name: 'Sessions' }));
    await waitFor(() => expect(listUserSessionsSpy).toHaveBeenCalled());
    const callsBefore = listUserSessionsSpy.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Enable' })).toBeVisible());
    await waitFor(() => expect(listUserSessionsSpy.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});

// The per-row "Add Role" opens the same per-work-center roles dialog the work center's Users
// tab uses, against the same route and right; the row is updated from the returned view.
describe('UserDetail — Add Role per work center', () => {
  const SUPERVISOR = { id: 'r2', name: 'Supervisor', description: null };
  const WC_VIEW = {
    workCenter: { id: 'w1', name: 'Line 1' },
    users: [{ ...VIEW.user, missionSystemCommander: true, roles: [...VIEW.workCenters[0].roles, SUPERVISOR] }],
  } as unknown as WorkCenterView;

  it('opens the dialog for that work center; Save PUTs the whole set and updates the row from the returned view', async () => {
    vi.spyOn(rolesApi.roles, 'list').mockResolvedValue({ roles: [SUPERVISOR, VIEW.workCenters[0].roles[0]] });
    const setSpy = vi.spyOn(wcApi.workCenters, 'setUserRoles').mockResolvedValue(WC_VIEW);
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    await userEvent.click(screen.getByRole('button', { name: 'Add Role in Line 1' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Roles this member holds in Line 1\./)).toBeVisible();
    expect(await within(dialog).findByRole('checkbox', { name: 'Operator' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Supervisor' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setSpy).toHaveBeenCalledWith('w1', 'u1', ['r1', 'r2']));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Operator, Supervisor')).toBeVisible();
    expect(toast.success).toHaveBeenCalledWith('Roles updated');
  });

  it('gates the button on work_center:link, like the work center Users tab', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'v', email: '', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false, rights: ['user:read'], missionSystemCommanderOf: [] });
    render(<UserDetail />);
    await screen.findByRole('heading', { name: 'Alice' });
    const button = screen.getByRole('button', { name: 'Add Role in Line 1' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Requires work_center:link');
  });
});
