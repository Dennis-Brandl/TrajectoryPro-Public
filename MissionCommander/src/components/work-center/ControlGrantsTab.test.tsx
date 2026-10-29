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
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ControlGrantsTab } from './ControlGrantsTab';
import { usePrincipalStore } from '@/stores/principalStore';

vi.mock('@/lib/api/control-grants', () => ({
  controlGrants: {
    list: vi.fn().mockResolvedValue({
      outgoing: [{ sourceWorkCenterId: 'a', sourceWorkCenterName: 'Line A', targetWorkCenterId: 'b', targetWorkCenterName: 'Line B', scope: 'own', createdAt: '2026-10-16T00:00:00Z' }],
      incoming: [{ sourceWorkCenterId: 'c', sourceWorkCenterName: 'Packing', targetWorkCenterId: 'a', targetWorkCenterName: 'Line A', scope: 'any', createdAt: '2026-10-16T00:00:00Z' }],
    }),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/lib/api/work-centers', () => ({ workCenters: { list: vi.fn().mockResolvedValue({ nodes: [] }) } }));

import { controlGrants } from '@/lib/api/control-grants';

function setPrincipal(isAdministrator: boolean) {
  usePrincipalStore.getState().setPrincipal({
    id: 'u1', email: 'u@x', loginName: 'admin', displayName: 'Uma',
    accessLevel: isAdministrator ? 'administrator' : 'viewer',
    isAdministrator, rights: [], missionSystemCommanderOf: [],
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ControlGrantsTab', () => {
  it('shows both directions with readable scopes', async () => {
    setPrincipal(false);
    render(<ControlGrantsTab workCenterId="a" />);
    expect(await screen.findByText('Line B')).toBeInTheDocument();
    expect(screen.getByText('Only runtimes it created')).toBeInTheDocument();
    expect(screen.getByText('Packing')).toBeInTheDocument();
    expect(screen.getByText('Any runtime')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove grant for Line B' })).toBeNull();
  });

  it('an administrator can remove a grant', async () => {
    setPrincipal(true);
    render(<ControlGrantsTab workCenterId="a" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove grant for Line B' }));
    await waitFor(() => expect(controlGrants.remove).toHaveBeenCalledWith('a', 'b'));
  });

  it('ControlGrantsTab ignores a refresh that finishes after a newer one', async () => {
    setPrincipal(true);
    const grant = (name: string) => ({ outgoing: [{ sourceWorkCenterId: 'a', sourceWorkCenterName: 'Line A', targetWorkCenterId: 'b', targetWorkCenterName: name, scope: 'own' as const, createdAt: '' }], incoming: [] });
    const resolvers: Array<(v: ReturnType<typeof grant>) => void> = [];
    vi.mocked(controlGrants.list).mockImplementation(() => new Promise((res) => { resolvers.push(res as never); }));
    render(<ControlGrantsTab workCenterId="a" />);
    await waitFor(() => expect(resolvers).toHaveLength(1));
    // A second refresh starts (a grant/remove calls refresh()); trigger it via remove after the first lands.
    vi.mocked(controlGrants.list).mockImplementationOnce(() => new Promise((res) => { resolvers.push(res as never); }));
    await act(async () => resolvers[0](grant('Initial')));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove grant for Initial' }));
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await userEvent.click(screen.getByRole('button', { name: 'Remove grant for Initial' }));
    await waitFor(() => expect(resolvers).toHaveLength(3));
    await act(async () => resolvers[2](grant('Newest')));
    await act(async () => resolvers[1](grant('Older')));
    expect(screen.getByText('Newest')).toBeInTheDocument();
    expect(screen.queryByText('Older')).toBeNull();
  });
});
