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
import { render, screen, waitFor, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { usePrincipalStore } from '@/stores/principalStore';
import * as clientsApi from '@/lib/api/api-clients';
import type { ApiClientView } from '@/lib/api/api-clients';
import * as wcApi from '@/lib/api/work-centers';
import { copyText } from '@/lib/copy-text';
import { ApiClientsPanel } from './ApiClientsPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/copy-text', () => ({ copyText: vi.fn() }));

const TOKEN = 'mcx_' + 'Zz9'.repeat(14) + 'Z';
const row = (extra: Partial<ApiClientView> = {}): ApiClientView => ({
  id: 'c1', name: 'ERP Scheduler', tokenPrefix: 'mcx_AbCd', scopes: ['schedules:read', 'schedules:write'],
  workCenterIds: ['w1', 'w2'], createdBy: 'u1', createdAt: '2026-11-01T00:00:00Z', lastUsedAt: null,
  expiresAt: null, revokedAt: null, status: 'active', ...extra,
});

function setPrincipal(isAdministrator: boolean) {
  usePrincipalStore.getState().setPrincipal({
    id: 'a', email: '', loginName: 'a', displayName: 'A', accessLevel: isAdministrator ? 'administrator' : 'steward',
    isAdministrator, rights: [], missionSystemCommanderOf: [],
  });
}

beforeEach(() => {
  setPrincipal(true);
  vi.spyOn(wcApi.workCenters, 'list').mockResolvedValue({
    nodes: [
      { id: 'w1', name: 'Line 1', parentWorkCenterId: null, depth: 0, typeName: null },
      { id: 'w2', name: 'Line 2', parentWorkCenterId: null, depth: 0, typeName: null },
      { id: 'w3', name: 'Line 3', parentWorkCenterId: null, depth: 0, typeName: null },
    ],
  });
  vi.spyOn(clientsApi.apiClients, 'list').mockResolvedValue([row()]);
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

describe('ApiClientsPanel', () => {
  it('renders nothing for a non-administrator and does not fetch', () => {
    setPrincipal(false);
    const { container } = render(<ApiClientsPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(clientsApi.apiClients.list).not.toHaveBeenCalled();
  });

  it('lists name, prefix, scopes, work centers, last used, expires and status', async () => {
    vi.mocked(clientsApi.apiClients.list).mockResolvedValue([
      row(),
      row({ id: 'c2', name: 'Old', status: 'revoked', revokedAt: '2026-11-02T00:00:00Z', workCenterIds: ['w3'] }),
    ]);
    render(<ApiClientsPanel />);
    const first = (await screen.findByText('ERP Scheduler')).closest('tr')!;
    expect(within(first).getByText('mcx_AbCd')).toBeInTheDocument();
    expect(within(first).getByText(/schedules:read/)).toBeInTheDocument();
    expect(within(first).getByText(/Line 1, Line 2/)).toBeInTheDocument();
    expect(within(first).getAllByText('Never')).toHaveLength(2); // last used, expires
    expect(within(first).getByText('Active')).toBeInTheDocument();
    const second = screen.getByText('Old').closest('tr')!;
    expect(within(second).getByText('Revoked')).toBeInTheDocument();
    expect(within(second).queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('creates a client, shows the token once with a warning and a Copy button', async () => {
    const create = vi.spyOn(clientsApi.apiClients, 'create').mockResolvedValue({ client: row({ id: 'c9', name: 'New one' }), token: TOKEN });
    vi.mocked(copyText).mockResolvedValue(true);
    const user = userEvent.setup();
    render(<ApiClientsPanel />);
    await screen.findByText('ERP Scheduler');
    await user.click(screen.getByRole('button', { name: 'New client' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), '  New one ');
    await user.click(within(dialog).getByLabelText('schedules:read'));
    await user.click(within(dialog).getByLabelText('Line 3'));
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'New one', scopes: ['schedules:read'], workCenterIds: ['w3'] }));
    const shown = await screen.findByRole('dialog');
    expect(within(shown).getByText("Copy this token now. It won't be shown again.")).toBeInTheDocument();
    expect(within(shown).getByDisplayValue(TOKEN)).toBeInTheDocument();
    await user.click(within(shown).getByRole('button', { name: 'Copy' }));
    expect(copyText).toHaveBeenCalledWith(TOKEN);
    expect(toast.success).toHaveBeenCalledWith('Token copied');

    await user.click(within(shown).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(clientsApi.apiClients.list).toHaveBeenCalledTimes(2); // reloaded after create
  });

  it('Escape and a click outside do not close the token dialog; only Done does', async () => {
    vi.spyOn(clientsApi.apiClients, 'create').mockResolvedValue({ client: row({ id: 'c9' }), token: TOKEN });
    const user = userEvent.setup();
    render(<ApiClientsPanel />);
    await screen.findByText('ERP Scheduler');
    await user.click(screen.getByRole('button', { name: 'New client' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'N');
    await user.click(within(dialog).getByLabelText('schedules:read'));
    await user.click(within(dialog).getByLabelText('Line 1'));
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await screen.findByDisplayValue(TOKEN);

    await user.keyboard('{Escape}');
    expect(screen.getByDisplayValue(TOKEN)).toBeInTheDocument();
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    fireEvent.pointerDown(overlay!);
    fireEvent.pointerUp(overlay!);
    fireEvent.click(overlay!);
    expect(screen.getByDisplayValue(TOKEN)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByDisplayValue(TOKEN)).toBeNull());
  });

  it('shows an error when the work centers fail to load', async () => {
    vi.mocked(wcApi.workCenters.list).mockRejectedValue(new Error('down'));
    render(<ApiClientsPanel />);
    expect(await screen.findByText(/Failed to load work centers/)).toBeInTheDocument();
  });

  it('will not create without a name, a scope and a work center', async () => {
    const create = vi.spyOn(clientsApi.apiClients, 'create');
    const user = userEvent.setup();
    render(<ApiClientsPanel />);
    await screen.findByText('ERP Scheduler');
    await user.click(screen.getByRole('button', { name: 'New client' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Name'), 'X');
    await user.click(within(dialog).getByLabelText('schedules:read'));
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    await user.click(within(dialog).getByLabelText('Line 1'));
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeEnabled();
    expect(create).not.toHaveBeenCalled();
  });

  it('revokes only after confirmation', async () => {
    const revoke = vi.spyOn(clientsApi.apiClients, 'revoke').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ApiClientsPanel />);
    await screen.findByText('ERP Scheduler');
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(revoke).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(revoke).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(clientsApi.apiClients.list).toHaveBeenCalledTimes(2));
  });
});
