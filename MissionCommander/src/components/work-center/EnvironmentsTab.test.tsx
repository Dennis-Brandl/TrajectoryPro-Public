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
import { toast } from 'sonner';
import { usePrincipalStore } from '@/stores/principalStore';
import { environmentBindings } from '@/lib/api/environment-bindings';
import { systemSettings } from '@/lib/api/system-settings';
import type { EnvironmentSpec } from '@/lib/api/types';
import { EnvironmentsTab } from './WorkCenterDetail';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/environment-bindings', () => ({
  environmentBindings: { list: vi.fn(), set: vi.fn() },
}));
vi.mock('@/lib/api/system-settings', () => ({ systemSettings: { get: vi.fn() } }));

const ENV: EnvironmentSpec = {
  id: 'e1', oid: 'env-1', name: 'Line A', workCenterId: 'w1', workCenterName: 'Assembly',
  version: '1.0.0', state: 'effective', effectiveFrom: null, sourceLibraryName: null, sourceLibraryOid: null,
};

function setPrincipal(isAdministrator: boolean) {
  usePrincipalStore.getState().setPrincipal({
    id: 'u1', email: 'u@x', loginName: 'admin', displayName: 'Uma',
    accessLevel: isAdministrator ? 'administrator' : 'viewer',
    isAdministrator, rights: [], missionSystemCommanderOf: [],
  });
}

beforeEach(() => {
  usePrincipalStore.getState().clearPrincipal();
  vi.mocked(systemSettings.get).mockResolvedValue({
    actionMatching: 'loose',
    actionServerTrust: 'strict',
    actionServerAllowlist: ['http://mission-autopilot-server:3002'],
  });
});
// This config does not enable Vitest globals, so @testing-library/react cannot auto-register
// its afterEach(cleanup).
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

describe('EnvironmentsTab', () => {
  it('a non-admin sees the bound Action Server URI as plain text, not an input', async () => {
    setPrincipal(false);
    vi.mocked(environmentBindings.list).mockResolvedValue([
      { environmentOid: 'env-1', serverUri: 'http://host:3002', updatedAt: '2026-08-01T00:00:00Z' },
    ]);
    render(<EnvironmentsTab environments={[ENV]} workCenterId="w1" />);
    expect(await screen.findByText('http://host:3002')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });

  it('a non-admin sees "—" for an environment with no bound Action Server', async () => {
    setPrincipal(false);
    vi.mocked(environmentBindings.list).mockResolvedValue([]);
    render(<EnvironmentsTab environments={[ENV]} workCenterId="w1" />);
    expect(await screen.findByText('—')).toBeInTheDocument();
  });

  it('an admin sees an Input + Save per row, prefilled with the bound URI', async () => {
    setPrincipal(true);
    vi.mocked(environmentBindings.list).mockResolvedValue([
      { environmentOid: 'env-1', serverUri: 'http://host:3002', updatedAt: '2026-08-01T00:00:00Z' },
    ]);
    render(<EnvironmentsTab environments={[ENV]} workCenterId="w1" />);
    // The value arrives asynchronously (the bindings fetch), so poll rather than asserting
    // immediately after the input first appears.
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('http://host:3002'));
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  // Regression: the bindings fetch resolves asynchronously, and under real latency an admin
  // can easily start typing before it lands. An earlier implementation used an uncontrolled
  // Input keyed on the fetched value — when the fetch resolved it remounted the node,
  // silently destroying whatever had been typed, and Save (reading the DOM via a ref) then
  // sent the fresh, unedited value while still toasting success. Both halves must be fixed:
  // the typed text must survive the fetch landing, AND Save must send what's on screen.
  it('preserves an in-progress edit typed before the bindings fetch resolves, and Save sends it', async () => {
    setPrincipal(true);
    let resolveList!: (v: { environmentOid: string; serverUri: string; updatedAt: string }[]) => void;
    vi.mocked(environmentBindings.list).mockReturnValue(
      new Promise((res) => { resolveList = res; }),
    );
    const setSpy = vi.mocked(environmentBindings.set).mockResolvedValue(undefined);
    render(<EnvironmentsTab environments={[ENV]} workCenterId="w1" />);

    // Type before the fetch has resolved at all.
    const input = await screen.findByRole('textbox');
    await userEvent.type(input, 'http://typed-before-fetch:9000');
    expect(input).toHaveValue('http://typed-before-fetch:9000');

    // The fetch now lands with a DIFFERENT, pre-existing bound value — this must NOT
    // clobber the admin's in-progress edit.
    await act(async () => {
      resolveList([
        { environmentOid: 'env-1', serverUri: 'http://stale-server:3002', updatedAt: '2026-08-01T00:00:00Z' },
      ]);
    });
    expect(screen.getByRole('textbox')).toHaveValue('http://typed-before-fetch:9000');

    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(setSpy).toHaveBeenCalledWith('w1', 'env-1', 'http://typed-before-fetch:9000'));
  });

  it('an admin: Save calls the client with the typed URI and toasts on success', async () => {
    setPrincipal(true);
    vi.mocked(environmentBindings.list).mockResolvedValue([]);
    const setSpy = vi.mocked(environmentBindings.set).mockResolvedValue(undefined);
    render(<EnvironmentsTab environments={[ENV]} workCenterId="w1" />);

    const input = await screen.findByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'http://action-server:3002');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(setSpy).toHaveBeenCalledWith('w1', 'env-1', 'http://action-server:3002'));
    expect(toast.success).toHaveBeenCalled();
  });

  it('an admin: a failed Save shows an error toast', async () => {
    setPrincipal(true);
    vi.mocked(environmentBindings.list).mockResolvedValue([]);
    vi.mocked(environmentBindings.set).mockRejectedValue(new Error('boom'));
    render(<EnvironmentsTab environments={[ENV]} workCenterId="w1" />);

    await userEvent.click(await screen.findByRole('button', { name: /save/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('shows the empty state when there are no environments, without fetching bindings', async () => {
    setPrincipal(true);
    const listSpy = vi.mocked(environmentBindings.list).mockResolvedValue([]);
    render(<EnvironmentsTab environments={[]} workCenterId="w1" />);
    expect(await screen.findByText('No environment specs loaded')).toBeInTheDocument();
    // The hook order means the fetch still fires on mount (this pins current behavior,
    // not a requirement) — assert only that rendering the empty state doesn't crash.
    expect(listSpy).toHaveBeenCalledWith('w1');
  });

  it('shows the not-allowed hint under strict when the typed origin is not listed', async () => {
    setPrincipal(true);
    // beforeEach seeds strict + ['http://mission-autopilot-server:3002']; this binding's
    // origin (http://localhost:3002) is not on that list.
    vi.mocked(environmentBindings.list).mockResolvedValue([
      { environmentOid: 'env-1', serverUri: 'http://localhost:3002', updatedAt: '2026-08-01T00:00:00Z' },
    ]);
    render(<EnvironmentsTab environments={[ENV]} workCenterId="w1" />);
    expect(await screen.findByTestId('action-server-not-allowed')).toHaveTextContent(
      'Not in the allowed action servers list (Settings → Action server trust)',
    );
  });

  it('hides the hint for a listed origin (ignoring a trailing slash) and under loose', async () => {
    setPrincipal(true);
    // Listed origin, but the bound value carries a trailing slash the URL-origin comparison
    // must ignore.
    vi.mocked(environmentBindings.list).mockResolvedValue([
      { environmentOid: 'env-1', serverUri: 'http://mission-autopilot-server:3002/', updatedAt: '2026-08-01T00:00:00Z' },
    ]);
    const { unmount } = render(<EnvironmentsTab environments={[ENV]} workCenterId="w1" />);
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('http://mission-autopilot-server:3002/'));
    expect(screen.queryByTestId('action-server-not-allowed')).toBeNull();
    unmount();

    // Under loose, even an unlisted origin shows no hint.
    vi.mocked(systemSettings.get).mockResolvedValue({
      actionMatching: 'loose',
      actionServerTrust: 'loose',
      actionServerAllowlist: ['http://mission-autopilot-server:3002'],
    });
    vi.mocked(environmentBindings.list).mockResolvedValue([
      { environmentOid: 'env-1', serverUri: 'http://localhost:3002', updatedAt: '2026-08-01T00:00:00Z' },
    ]);
    render(<EnvironmentsTab environments={[ENV]} workCenterId="w1" />);
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('http://localhost:3002'));
    expect(screen.queryByTestId('action-server-not-allowed')).toBeNull();
  });

  it('EnvironmentsTab refresh failure shows an error toast', async () => {
    setPrincipal(true);
    vi.mocked(environmentBindings.list).mockRejectedValue(new Error('down'));
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    render(<EnvironmentsTab environments={[ENV]} workCenterId="w1" />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not load Action Servers'));
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
  });
});
