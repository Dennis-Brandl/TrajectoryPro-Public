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
import { toast } from 'sonner';
import { usePrincipalStore } from '@/stores/principalStore';
import * as systemSettingsApi from '@/lib/api/system-settings';
import { SettingsPanel } from './SettingsPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Default principal: a steward (holds settings:edit) who is NOT an administrator — the
// realistic persona finding #6 is about (a steward can flip action matching, but the
// action-server trust mode + allowlist require an administrator). Tests that need to
// exercise the admin-only controls upgrade the principal locally.
beforeEach(() => {
  usePrincipalStore.getState().setPrincipal({
    id: 's', email: '', loginName: 'admin', displayName: 'S', accessLevel: 'steward', isAdministrator: false,
    rights: ['settings:read', 'settings:edit'], missionSystemCommanderOf: [],
  });
  vi.spyOn(systemSettingsApi.systemSettings, 'get').mockResolvedValue({ actionMatching: 'loose', actionServerTrust: 'strict', actionServerAllowlist: ['http://mission-autopilot-server:3002'] });
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

function setAdmin() {
  usePrincipalStore.getState().setPrincipal({
    id: 'a', email: '', loginName: 'admin', displayName: 'A', accessLevel: 'administrator', isAdministrator: true,
    rights: [], missionSystemCommanderOf: [],
  });
}

describe('SettingsPanel', () => {
  it('renders Loose checked from the current setting', async () => {
    render(<SettingsPanel />);
    const loose = await screen.findByRole('radio', { name: /Loose \(default\)/ });
    const matchingGroup = screen.getByRole('radiogroup', { name: 'Action matching' });
    const strict = within(matchingGroup).getByRole('radio', { name: /Strict/ });
    expect(loose).toBeChecked();
    expect(strict).not.toBeChecked();
    expect(matchingGroup).toBeInTheDocument();
  });

  it('selecting Strict and saving PUTs the new mode and shows a success toast', async () => {
    const spy = vi.spyOn(systemSettingsApi.systemSettings, 'update').mockResolvedValue({ actionMatching: 'strict', actionServerTrust: 'strict', actionServerAllowlist: [] });
    render(<SettingsPanel />);
    await screen.findByRole('radio', { name: /Loose \(default\)/ });
    const matchingGroup = screen.getByRole('radiogroup', { name: 'Action matching' });
    await userEvent.click(within(matchingGroup).getByRole('radio', { name: /Strict/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ actionMatching: 'strict' })));
    expect(toast.success).toHaveBeenCalledWith('Settings saved');
  });

  it('disables Save without settings:edit', async () => {
    usePrincipalStore.getState().setPrincipal({
      id: 'v', email: '', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false,
      rights: ['settings:read'], missionSystemCommanderOf: [],
    });
    render(<SettingsPanel />);
    await screen.findByRole('radio', { name: /Loose \(default\)/ });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('renders the action-server trust section from the current settings', async () => {
    render(<SettingsPanel />);
    const group = await screen.findByRole('radiogroup', { name: 'Action server trust' });
    expect(within(group).getByRole('radio', { name: /Strict \(default\)/ })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Allowed action servers' })).toHaveValue('http://mission-autopilot-server:3002');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('selecting Loose shows the warning', async () => {
    setAdmin();
    render(<SettingsPanel />);
    const group = await screen.findByRole('radiogroup', { name: 'Action server trust' });
    // Scoped to the trust group: its "Loose" radio's accessible name is its full label text
    // ("Loose The engine contacts…"), which is why /^Loose$/ (an exact match) can't be used
    // here — the Action matching group's "Loose (default)" radio is out of this scope, so a
    // startsWith match is unambiguous.
    await userEvent.click(within(group).getByRole('radio', { name: /^Loose/ }));
    // getByText, not getByRole('alert'): the load-error banner (Critical #1) also carries
    // role="alert", so a bare getByRole('alert') is ambiguous once a load error is possible
    // on the page at the same time as this warning (not in this test, but the query should
    // stay unambiguous regardless of what else is rendered).
    expect(screen.getByText(/Loose disables/)).toBeInTheDocument();
  });

  it('an invalid allowlist line blocks Save with an inline message and sends nothing', async () => {
    setAdmin();
    const spy = vi.spyOn(systemSettingsApi.systemSettings, 'update');
    render(<SettingsPanel />);
    const box = await screen.findByRole('textbox', { name: 'Allowed action servers' });
    await userEvent.clear(box);
    await userEvent.type(box, 'http://a:1{enter}ftp://nope');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText(/Line 2:/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('Save sends all three keys with the allowlist split by line', async () => {
    setAdmin();
    const spy = vi.spyOn(systemSettingsApi.systemSettings, 'update').mockResolvedValue({ actionMatching: 'loose', actionServerTrust: 'loose', actionServerAllowlist: ['http://a:1', 'http://b:2'] });
    render(<SettingsPanel />);
    const box = await screen.findByRole('textbox', { name: 'Allowed action servers' });
    await userEvent.clear(box);
    await userEvent.type(box, 'http://a:1{enter}{enter}  http://b:2  ');
    const trustGroup = screen.getByRole('radiogroup', { name: 'Action server trust' });
    await userEvent.click(within(trustGroup).getByRole('radio', { name: /^Loose/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ actionMatching: 'loose', actionServerTrust: 'loose', actionServerAllowlist: ['http://a:1', 'http://b:2'] }));
  });

  // Finding #6 (Important): the allowlist and the trust mode are administrator-only. A
  // steward (settings:edit, not an administrator — the default principal above) must see
  // the section disabled and must never have their Save accidentally 403 by sending keys
  // they aren't allowed to write.
  it('a steward sees the action-server trust section disabled and Save sends only actionMatching', async () => {
    const spy = vi.spyOn(systemSettingsApi.systemSettings, 'update').mockResolvedValue({ actionMatching: 'loose', actionServerTrust: 'strict', actionServerAllowlist: ['http://mission-autopilot-server:3002'] });
    render(<SettingsPanel />);
    const group = await screen.findByRole('radiogroup', { name: 'Action server trust' });
    expect(group).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Allowed action servers' })).toBeDisabled();
    expect(screen.getByText('Requires an administrator')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ actionMatching: 'loose' }));
  });

  // Critical #1: a failed initial GET must never leave Save enabled at the (default) form
  // values — an unnoticed click would PUT the defaults over whatever the fleet actually has.
  it('a failed load disables Save and shows the error', async () => {
    vi.mocked(systemSettingsApi.systemSettings.get).mockRejectedValue(new Error('network down'));
    const spy = vi.spyOn(systemSettingsApi.systemSettings, 'update');
    render(<SettingsPanel />);
    expect(await screen.findByText('Failed to load settings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('Save is disabled until the settings have loaded', async () => {
    vi.mocked(systemSettingsApi.systemSettings.get).mockReturnValue(new Promise(() => {}));
    render(<SettingsPanel />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
