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
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import * as rolesApi from '@/lib/api/roles';
import { ApiError } from '@/lib/api/client';
import type { Role } from '@/lib/api/types';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { DeleteRoleDialog } from './DeleteRoleDialog';

const ROLE: Role = { id: 'r1', name: 'Operator', description: null };

beforeEach(() => vi.clearAllMocks());
// This config does not enable Vitest globals, so @testing-library/react cannot
// auto-register its afterEach(cleanup). Without this, each render() leaks its DOM
// into document.body and later getByRole/getByText calls match duplicates.
afterEach(cleanup);
// vi.spyOn returns the SAME mock instance when re-spying an already-spied method,
// so call counts would accumulate across tests without a restore — breaking the
// exactly-once assertions below.
afterEach(() => vi.restoreAllMocks());

describe('DeleteRoleDialog', () => {
  it('removes the role, toasts success, and closes', async () => {
    const removeSpy = vi.spyOn(rolesApi.roles, 'remove').mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DeleteRoleDialog open role={ROLE} onOpenChange={onOpenChange} onDeleted={onDeleted} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith('r1'));
    expect(toast.success).toHaveBeenCalledWith('Role deleted');
    expect(onDeleted).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('cancel does not remove the role', async () => {
    const removeSpy = vi.spyOn(rolesApi.roles, 'remove').mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DeleteRoleDialog open role={ROLE} onOpenChange={onOpenChange} onDeleted={onDeleted} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(removeSpy).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('surfaces a 409 conflict as a toast and keeps the dialog open', async () => {
    vi.spyOn(rolesApi.roles, 'remove').mockRejectedValue(new ApiError(409, 'conflict', 'Role is referenced by allowed-role assignments'));
    const onDeleted = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DeleteRoleDialog open role={ROLE} onOpenChange={onOpenChange} onDeleted={onDeleted} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Role is referenced by allowed-role assignments'));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
