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
import * as usersApi from '@/lib/api/users';
import { UserTree } from './UserTree';

beforeEach(() => {
  usePrincipalStore.getState().clearPrincipal();
  useSelectionStore.setState({ selectedUserId: null });
  vi.spyOn(usersApi.users, 'list').mockResolvedValue({
    users: [
      { id: 'u2', email: 'z@x.io', loginName: 'z', displayName: 'Zoe', status: 'active', accessLevel: 'viewer' },
      { id: 'u1', email: 'a@x.io', loginName: 'a', displayName: 'Alice', status: 'active', accessLevel: 'steward' },
    ],
  });
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

describe('UserTree', () => {
  it('renders users name-sorted and selects on click', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'me', email: '', loginName: 'admin', displayName: 'Me', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [] });
    render(<UserTree onCreateUser={() => {}} />);
    const buttons = await screen.findAllByRole('button', { name: /Alice|Zoe/ });
    expect(buttons.map((b) => b.textContent)).toEqual(['Alice', 'Zoe']); // sorted
    await userEvent.click(screen.getByRole('button', { name: 'Alice' }));
    expect(useSelectionStore.getState().selectedUserId).toBe('u1');
  });

  it('disables New user for a non-admin', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'v', email: '', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false, rights: ['user:read'], missionSystemCommanderOf: [] });
    render(<UserTree onCreateUser={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'New user' })).toBeDisabled());
  });
});
