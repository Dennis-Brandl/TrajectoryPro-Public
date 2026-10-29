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
import { usePrincipalStore } from '@/stores/principalStore';
import { useSelectionStore } from '@/stores/selectionStore';
import * as rolesApi from '@/lib/api/roles';
import { RoleTree } from './RoleTree';

beforeEach(() => {
  usePrincipalStore.getState().clearPrincipal();
  useSelectionStore.setState({ selectedRoleId: null });
  vi.spyOn(rolesApi.roles, 'list').mockResolvedValue({
    roles: [
      { id: 'r2', name: 'Supervisor', description: null },
      { id: 'r1', name: 'Operator', description: 'ops' },
    ],
  });
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

describe('RoleTree', () => {
  it('renders roles name-sorted and selects on click', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'me', email: '', loginName: 'admin', displayName: 'Me', accessLevel: 'steward', isAdministrator: false, rights: ['role:read', 'role:create'], missionSystemCommanderOf: [] });
    render(<RoleTree onCreateRole={() => {}} />);
    const buttons = await screen.findAllByRole('button', { name: /Operator|Supervisor/ });
    expect(buttons.map((b) => b.textContent)).toEqual(['Operator', 'Supervisor']);
    await userEvent.click(screen.getByRole('button', { name: 'Operator' }));
    expect(useSelectionStore.getState().selectedRoleId).toBe('r1');
  });

  it('enables New role for a steward (role:create), disables for a viewer', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 's', email: '', loginName: 'admin', displayName: 'S', accessLevel: 'steward', isAdministrator: false, rights: ['role:read', 'role:create'], missionSystemCommanderOf: [] });
    render(<RoleTree onCreateRole={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'New role' })).toBeEnabled());

    usePrincipalStore.getState().setPrincipal({ id: 'v', email: '', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false, rights: ['role:read'], missionSystemCommanderOf: [] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'New role' })).toBeDisabled());
  });
});
