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
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { isRedirect } from '@tanstack/react-router';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/lib/auth/setupClient', () => ({ getSetupStatus: vi.fn() }));
vi.mock('@/lib/auth/auth-client', () => ({ signUp: { email: vi.fn() }, authClient: { getSession: vi.fn() } }));
vi.mock('@/lib/api/roles', () => ({ roles: { list: vi.fn(), create: vi.fn() } }));
vi.mock('@/lib/api/work-centers', () => ({ workCenters: { list: vi.fn(), create: vi.fn() } }));

import { SetupPage, Route } from './setup';
import { getSetupStatus } from '@/lib/auth/setupClient';
import { authClient, signUp } from '@/lib/auth/auth-client';
import { roles } from '@/lib/api/roles';
import { workCenters } from '@/lib/api/work-centers';
import { ApiError } from '@/lib/api/client';

const beforeLoad = Route.options.beforeLoad as unknown as () => Promise<unknown>;
async function thrownBy(fn: () => Promise<unknown>): Promise<unknown> {
  try { await fn(); return undefined; } catch (e) { return e; }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(workCenters.list).mockResolvedValue({ nodes: [] });
  vi.mocked(roles.list).mockResolvedValue({ roles: [] });
  vi.mocked(workCenters.create).mockResolvedValue({} as never);
  vi.mocked(roles.create).mockResolvedValue({} as never);
});
afterEach(cleanup);

describe('setup route beforeLoad', () => {
  // Regression guard for the plan's swallow-the-redirect bug: an already-bootstrapped
  // module must bounce away from /setup, not silently render the setup form.
  it('redirects to / when setup is already complete', async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({ setupComplete: true, hasAdmin: true });
    const err = await thrownBy(beforeLoad);
    expect(isRedirect(err)).toBe(true);
    expect((err as { options: { to: string } }).options.to).toBe('/');
  });

  it('renders the first-run form (no redirect) when no administrator exists', async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({ setupComplete: false, hasAdmin: false });
    expect(await thrownBy(beforeLoad)).toBeUndefined();
  });

  it('sends a signed-out visitor to /login when the administrator exists but no role does', async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({ setupComplete: false, hasAdmin: true });
    vi.mocked(authClient.getSession).mockResolvedValue({ data: null } as never);
    const err = await thrownBy(beforeLoad);
    expect(isRedirect(err)).toBe(true);
    expect((err as { options: { to: string } }).options.to).toBe('/login');
  });

  it('lets the signed-in administrator finish setup', async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({ setupComplete: false, hasAdmin: true });
    vi.mocked(authClient.getSession).mockResolvedValue({ data: { user: {} } } as never);
    expect(await thrownBy(beforeLoad)).toBeUndefined();
  });
});

async function createAdmin() {
  await userEvent.type(await screen.findByLabelText('Name'), 'Admin');
  await userEvent.type(screen.getByLabelText('Email'), 'admin@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Create administrator' }));
}

describe('SetupPage — administrator', () => {
  beforeEach(() => vi.mocked(getSetupStatus).mockResolvedValue({ setupComplete: false, hasAdmin: false }));

  it('creates the administrator, then moves on to the work centers screen', async () => {
    vi.mocked(signUp.email).mockResolvedValue({ error: null } as never);
    render(<SetupPage />);
    await createAdmin();
    expect(await screen.findByRole('heading', { name: 'Starting work centers' })).toBeInTheDocument();
    expect(signUp.email).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'password123', name: 'Admin' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('surfaces the server error message as an alert and stays on the form', async () => {
    vi.mocked(signUp.email).mockResolvedValue({ error: { message: 'Email already registered' } } as never);
    render(<SetupPage />);
    await createAdmin();
    expect(await screen.findByRole('alert')).toHaveTextContent('Email already registered');
    expect(screen.queryByRole('heading', { name: 'Starting work centers' })).not.toBeInTheDocument();
  });
});

describe('SetupPage — work centers and roles', () => {
  beforeEach(() => vi.mocked(getSetupStatus).mockResolvedValue({ setupComplete: false, hasAdmin: true }));

  it('creates every work center in a comma-separated list, as top-level work centers', async () => {
    render(<SetupPage />);
    await userEvent.type(await screen.findByLabelText('Work center names'), 'Line 1, Line 2 ,,Warehouse');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    const list = await screen.findByRole('list', { name: 'Created' });
    await waitFor(() => expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Line 1', 'Line 2', 'Warehouse']));
    expect(vi.mocked(workCenters.create).mock.calls.map((c) => c[0])).toEqual([
      { name: 'Line 1', parentWorkCenterId: null },
      { name: 'Line 2', parentWorkCenterId: null },
      { name: 'Warehouse', parentWorkCenterId: null },
    ]);
    expect(screen.getByLabelText('Work center names')).toHaveValue('');
  });

  it('lets the work centers screen be skipped', async () => {
    render(<SetupPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(await screen.findByRole('heading', { name: 'Starting roles' })).toBeInTheDocument();
    expect(workCenters.create).not.toHaveBeenCalled();
  });

  it('requires at least one role before Finish, then goes home', async () => {
    render(<SetupPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    const finish = await screen.findByRole('button', { name: 'Finish' });
    expect(finish).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Role names'), 'Time Sheet Approver, Entry Clerk');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(finish).toBeEnabled());
    expect(vi.mocked(roles.create).mock.calls.map((c) => c[0])).toEqual([{ name: 'Time Sheet Approver' }, { name: 'Entry Clerk' }]);
    await userEvent.click(finish);
    expect(navigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('offers the example roles as one-click chips, hiding each once it exists', async () => {
    render(<SetupPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    for (const ex of ['Time Sheet Approver', 'Entry Clerk', 'Line 2 Operator', 'Warehouse Supervisor']) {
      expect(screen.getByRole('button', { name: `+ ${ex}` })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', { name: '+ Line 2 Operator' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '+ Line 2 Operator' })).not.toBeInTheDocument());
    expect(roles.create).toHaveBeenCalledWith({ name: 'Line 2 Operator' });
  });

  it('on a failure keeps the ones made and leaves the failed name and the rest in the box', async () => {
    vi.mocked(roles.create)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new ApiError(409, 'conflict', 'Role name already in use'));
    render(<SetupPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    await userEvent.type(screen.getByLabelText('Role names'), 'A, B, C');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create "B": Role name already in use');
    expect(screen.getByLabelText('Role names')).toHaveValue('B, C');
    expect(within(screen.getByRole('list', { name: 'Created' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['A']);
    expect(roles.create).toHaveBeenCalledTimes(2);
  });

  it('on resume shows what exists and skips names already created, ignoring case', async () => {
    vi.mocked(workCenters.list).mockResolvedValue({ nodes: [
      { id: '1', name: 'Line 1', parentWorkCenterId: null, depth: 0, typeName: null },
      { id: '2', name: 'Cell A', parentWorkCenterId: '1', depth: 1, typeName: null },
    ] });
    render(<SetupPage />);
    const list = await screen.findByRole('list', { name: 'Created' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Line 1']);
    await userEvent.type(screen.getByLabelText('Work center names'), 'line 1, Line 3');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(workCenters.create).toHaveBeenCalledTimes(1));
    expect(workCenters.create).toHaveBeenCalledWith({ name: 'Line 3', parentWorkCenterId: null });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });
});
