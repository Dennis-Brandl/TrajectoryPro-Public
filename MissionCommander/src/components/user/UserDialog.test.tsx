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
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as usersApi from '@/lib/api/users';
import { UserDialog } from './UserDialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

const CREATED = { user: { id: 'u9', email: 'new@x.io', loginName: 'new.user', displayName: 'New', status: 'active', accessLevel: 'viewer' }, workCenters: [] };

describe('UserDialog (create)', () => {
  it('submits email/displayName/password/accessLevel and reports the created view', async () => {
    const spy = vi.spyOn(usersApi.users, 'create').mockResolvedValue(CREATED as never);
    const onSaved = vi.fn();
    render(<UserDialog open onOpenChange={() => {}} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText('Email'), 'new@x.io');
    await userEvent.type(screen.getByLabelText('Display name'), 'New');
    await userEvent.type(screen.getByLabelText('Login name'), 'New.User');
    await userEvent.type(screen.getByLabelText('Initial password'), 'first-pass-1');
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@x.io', displayName: 'New', password: 'first-pass-1', loginName: 'new.user' })));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(CREATED));
  });

  it('rejects a short password before calling the API', async () => {
    const spy = vi.spyOn(usersApi.users, 'create');
    render(<UserDialog open onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText('Email'), 'new@x.io');
    await userEvent.type(screen.getByLabelText('Display name'), 'New');
    await userEvent.type(screen.getByLabelText('Login name'), 'New.User');
    await userEvent.type(screen.getByLabelText('Initial password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }));
    expect(await screen.findByText(/at least 8/i)).toBeVisible();
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects an invalid login name before calling the API', async () => {
    const spy = vi.spyOn(usersApi.users, 'create');
    render(<UserDialog open onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText('Email'), 'new@x.io');
    await userEvent.type(screen.getByLabelText('Display name'), 'New');
    await userEvent.type(screen.getByLabelText('Login name'), 'has space');
    await userEvent.type(screen.getByLabelText('Initial password'), 'first-pass-1');
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }));
    expect(await screen.findByText(/lowercase letters, digits/i)).toBeVisible();
    expect(spy).not.toHaveBeenCalled();
  });
});
