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
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { usePrincipalStore } from '@/stores/principalStore';
import { ImpersonationBanner } from './ImpersonationBanner';

// A spy for the navigate function returned by useNavigate. Hoisted so the
// vi.mock factory below (itself hoisted above imports) can close over it, and
// so tests can assert on it — an inline `useNavigate: () => vi.fn()` factory
// hands back a fresh, unassertable spy on every render (see login.test.tsx).
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

const useSessionMock = vi.fn();
const stopImpersonating = vi.fn(async () => ({ data: {}, error: null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth/auth-client', () => ({
  authClient: { useSession: () => useSessionMock(), admin: { stopImpersonating: () => stopImpersonating() } },
}));
vi.mock('@/lib/auth/boot', () => ({ runBoot: vi.fn(async () => ({ ok: true })) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

describe('ImpersonationBanner', () => {
  it('renders nothing when not impersonating', () => {
    useSessionMock.mockReturnValue({ data: { session: { impersonatedBy: null } } });
    const { container } = render(<ImpersonationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the banner and stops impersonation on click', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'v', email: '', loginName: 'admin', displayName: 'Viewer Vic', accessLevel: 'viewer', isAdministrator: false, rights: [], missionSystemCommanderOf: [] });
    useSessionMock.mockReturnValue({ data: { session: { impersonatedBy: 'admin-id' } } });
    render(<ImpersonationBanner />);
    expect(screen.getByText(/Impersonating Viewer Vic/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(stopImpersonating).toHaveBeenCalled());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }));
  });

  it('surfaces a stopImpersonating error via toast, skips navigation, and re-enables Stop', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'v', email: '', loginName: 'admin', displayName: 'Viewer Vic', accessLevel: 'viewer', isAdministrator: false, rights: [], missionSystemCommanderOf: [] });
    useSessionMock.mockReturnValue({ data: { session: { impersonatedBy: 'admin-id' } } });
    stopImpersonating.mockResolvedValueOnce({ data: null, error: { message: 'nope' } } as never);
    render(<ImpersonationBanner />);
    const stopButton = screen.getByRole('button', { name: /stop/i });
    await userEvent.click(stopButton);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('nope'));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText(/Impersonating Viewer Vic/)).toBeVisible();
    expect(stopButton).not.toBeDisabled();
  });

  // Task 11-style in-flight guard: a manually-resolved promise lets the assertion
  // run WHILE the stop request is still pending, before it's ever resolved.
  it('disables Stop while the stop request is in flight', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'v', email: '', loginName: 'admin', displayName: 'Viewer Vic', accessLevel: 'viewer', isAdministrator: false, rights: [], missionSystemCommanderOf: [] });
    useSessionMock.mockReturnValue({ data: { session: { impersonatedBy: 'admin-id' } } });
    const STOP_OK = { data: {}, error: null };
    let resolveStop!: (v: typeof STOP_OK) => void;
    stopImpersonating.mockImplementationOnce(() => new Promise((resolve) => { resolveStop = resolve; }));
    render(<ImpersonationBanner />);
    const stopButton = screen.getByRole('button', { name: /stop/i });
    await userEvent.click(stopButton);
    expect(stopButton).toBeDisabled();
    await act(async () => resolveStop(STOP_OK));
    await waitFor(() => expect(stopButton).not.toBeDisabled());
  });
});
