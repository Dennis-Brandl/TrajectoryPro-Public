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
import { SetPasswordDialog } from './SetPasswordDialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

describe('SetPasswordDialog', () => {
  it('sets a password when both fields match and are long enough', async () => {
    const spy = vi.spyOn(usersApi.users, 'setPassword').mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<SetPasswordDialog open onOpenChange={() => {}} userId="u1" onDone={onDone} />);
    await userEvent.type(screen.getByLabelText('New password'), 'brand-new-1');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'brand-new-1');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('u1', 'brand-new-1'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('blocks mismatched confirmation', async () => {
    const spy = vi.spyOn(usersApi.users, 'setPassword');
    render(<SetPasswordDialog open onOpenChange={() => {}} userId="u1" onDone={() => {}} />);
    await userEvent.type(screen.getByLabelText('New password'), 'brand-new-1');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different-9');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByText(/do not match/i)).toBeVisible();
    expect(spy).not.toHaveBeenCalled();
  });
});
