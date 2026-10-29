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
import { SessionsTab } from './SessionsTab';

const { useSessionMock, listUserSessions, revokeUserSession, revokeUserSessions } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  listUserSessions: vi.fn(),
  revokeUserSession: vi.fn(),
  revokeUserSessions: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth/auth-client', () => ({
  authClient: {
    useSession: () => useSessionMock(),
    admin: { listUserSessions, revokeUserSession, revokeUserSessions },
  },
}));

const ROW = { id: 's1', token: 'tok-1', createdAt: '2026-07-12T00:00:00Z', expiresAt: '2026-07-19T00:00:00Z' };

beforeEach(() => {
  useSessionMock.mockReturnValue({ data: null });
  listUserSessions.mockResolvedValue({ data: { sessions: [ROW] }, error: null });
  revokeUserSession.mockResolvedValue({ data: { success: true }, error: null });
  revokeUserSessions.mockResolvedValue({ data: { success: true }, error: null });
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

describe('SessionsTab', () => {
  it('lists sessions and revokes one by token', async () => {
    render(<SessionsTab userId="u1" />);
    await screen.findByText(/expires/i);
    await userEvent.click(screen.getByRole('button', { name: /revoke session/i }));
    await waitFor(() => expect(revokeUserSession).toHaveBeenCalledWith({ sessionToken: 'tok-1' }));
  });

  // Spec §7.2: the row whose token matches the live session's token is the caller's
  // own session — mark it so an admin doesn't accidentally revoke their own access.
  it('marks the row whose token matches the live session as Current', async () => {
    useSessionMock.mockReturnValue({ data: { session: { token: 'tok-1' } } });
    render(<SessionsTab userId="u1" />);
    await screen.findByText(/expires/i);
    expect(screen.getByText('Current')).toBeVisible();
  });

  it('does not mark any row Current when the live token matches none of the rows', async () => {
    useSessionMock.mockReturnValue({ data: { session: { token: 'some-other-token' } } });
    render(<SessionsTab userId="u1" />);
    await screen.findByText(/expires/i);
    expect(screen.queryByText('Current')).toBeNull();
  });

  it('shows a distinct failure state on error, and Retry re-fetches', async () => {
    listUserSessions.mockResolvedValue({ data: null, error: { message: 'boom' } });
    render(<SessionsTab userId="u1" />);
    expect(await screen.findByText('Failed to load sessions')).toBeVisible();
    expect(screen.queryByText('No active sessions')).toBeNull();

    listUserSessions.mockResolvedValue({ data: { sessions: [ROW] }, error: null });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(listUserSessions).toHaveBeenCalledTimes(2));
    await screen.findByText(/expires/i);
    expect(screen.queryByText('Failed to load sessions')).toBeNull();
  });

  it('marks no row Current when there is no live session (data: null)', async () => {
    useSessionMock.mockReturnValue({ data: null }); // currentToken undefined
    render(<SessionsTab userId="u1" />);
    await screen.findByText(/expires/i);
    expect(screen.queryByText('Current')).toBeNull();
  });

  // Fencing: switching userId mid-load must not let the first (stale) response paint over
  // the second. Held-open promises resolve out of order; the reqId guard drops the stale one.
  it('drops a superseded load when userId changes mid-flight', async () => {
    let resolveFirst!: (v: { data: { sessions: typeof ROW[] }; error: null }) => void;
    let resolveSecond!: (v: { data: { sessions: typeof ROW[] }; error: null }) => void;
    listUserSessions
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockReturnValueOnce(new Promise((r) => { resolveSecond = r; }));
    const { rerender } = render(<SessionsTab userId="u1" />);
    rerender(<SessionsTab userId="u2" />); // second load in flight
    const SECOND = { ...ROW, id: 's2', token: 'tok-2' };
    await act(async () => resolveSecond({ data: { sessions: [SECOND] }, error: null }));
    await act(async () => resolveFirst({ data: { sessions: [ROW] }, error: null })); // stale — ignored
    await screen.findByText(/expires/i);
    expect(screen.getByRole('button', { name: 'Revoke session s2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke session s1' })).toBeNull();
  });
});
