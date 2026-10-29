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
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import * as rolesApi from '@/lib/api/roles';
import * as wc from '@/lib/api/work-centers';
import { ApiError } from '@/lib/api/client';
import type { WorkCenterMember, WorkCenterView } from '@/lib/api/types';
import { WorkCenterUserRolesDialog } from './WorkCenterUserRolesDialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const OPERATOR = { id: 'r1', name: 'Operator', description: null };
const SUPERVISOR = { id: 'r2', name: 'Supervisor', description: null };
const MEMBER: WorkCenterMember = {
  id: 'u1', email: 'u@x', loginName: 'uma', displayName: 'Uma', status: 'active', accessLevel: 'viewer',
  missionSystemCommander: false, roles: [OPERATOR],
};
const VIEW = { workCenter: { id: 'w1' }, users: [{ ...MEMBER, roles: [OPERATOR, SUPERVISOR] }] } as unknown as WorkCenterView;

beforeEach(() => {
  vi.spyOn(rolesApi.roles, 'list').mockResolvedValue({ roles: [SUPERVISOR, OPERATOR] });
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

describe('WorkCenterUserRolesDialog', () => {
  it('lists every role name-sorted, pre-checks the held ones, and Save is disabled until dirty', async () => {
    render(<WorkCenterUserRolesDialog open onOpenChange={() => {}} workCenterId="w1" member={MEMBER} onSaved={() => {}} />);
    expect(await screen.findByRole('checkbox', { name: 'Operator' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Supervisor' })).not.toBeChecked();
    const labels = screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'));
    expect(labels).toEqual(['Operator', 'Supervisor']);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves the whole set in one PUT, applies the returned view, toasts, and closes', async () => {
    const setSpy = vi.spyOn(wc.workCenters, 'setUserRoles').mockResolvedValue(VIEW);
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<WorkCenterUserRolesDialog open onOpenChange={onOpenChange} workCenterId="w1" member={MEMBER} onSaved={onSaved} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Supervisor' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setSpy).toHaveBeenCalledWith('w1', 'u1', ['r1', 'r2']));
    expect(onSaved).toHaveBeenCalledWith(VIEW);
    expect(toast.success).toHaveBeenCalledWith('Roles updated');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('a failed save toasts the server message and keeps the draft open', async () => {
    vi.spyOn(wc.workCenters, 'setUserRoles').mockRejectedValue(new ApiError(404, 'not_found', 'User is not a member of this work center'));
    const onOpenChange = vi.fn();
    render(<WorkCenterUserRolesDialog open onOpenChange={onOpenChange} workCenterId="w1" member={MEMBER} onSaved={() => {}} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Operator' })); // uncheck
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('User is not a member of this work center'));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('checkbox', { name: 'Operator' })).not.toBeChecked(); // draft kept
  });
});
