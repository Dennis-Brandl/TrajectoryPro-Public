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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isRedirect } from '@tanstack/react-router';

vi.mock('@/lib/auth/auth-client', () => ({ authClient: { getSession: vi.fn() }, signOut: vi.fn() }));
vi.mock('@/lib/auth/setupClient', () => ({ getSetupStatus: vi.fn() }));
vi.mock('@/lib/auth/boot', () => ({ runBoot: vi.fn() }));

import { Route } from './_authenticated';
import { authClient } from '@/lib/auth/auth-client';
import { getSetupStatus } from '@/lib/auth/setupClient';
import { runBoot } from '@/lib/auth/boot';

const beforeLoad = Route.options.beforeLoad as unknown as () => Promise<unknown>;
async function thrownBy(fn: () => Promise<unknown>): Promise<unknown> {
  try { await fn(); return undefined; } catch (e) { return e; }
}
const session = { data: { user: { id: 'u1', name: 'Admin', email: 'admin@example.com' } } };

beforeEach(() => vi.clearAllMocks());

describe('_authenticated beforeLoad guard chain', () => {
  it('gate 1 — redirects to /login when there is no session', async () => {
    vi.mocked(authClient.getSession).mockResolvedValue({ data: null } as never);
    const err = await thrownBy(beforeLoad);
    expect(isRedirect(err)).toBe(true);
    expect((err as { options: { to: string } }).options.to).toBe('/login');
  });

  it('gate 2 — redirects to /setup when authenticated but the module is not bootstrapped', async () => {
    vi.mocked(authClient.getSession).mockResolvedValue(session as never);
    vi.mocked(getSetupStatus).mockResolvedValue({ setupComplete: false });
    const err = await thrownBy(beforeLoad);
    expect(isRedirect(err)).toBe(true);
    expect((err as { options: { to: string } }).options.to).toBe('/setup');
  });

  it('gate 3 — redirects to /login when boot (/me) fails', async () => {
    vi.mocked(authClient.getSession).mockResolvedValue(session as never);
    vi.mocked(getSetupStatus).mockResolvedValue({ setupComplete: true });
    vi.mocked(runBoot).mockResolvedValue({ ok: false, error: 'me' });
    const err = await thrownBy(beforeLoad);
    expect(isRedirect(err)).toBe(true);
    expect((err as { options: { to: string } }).options.to).toBe('/login');
  });

  it('passes through (returns the user) when session, setup, and boot all succeed', async () => {
    vi.mocked(authClient.getSession).mockResolvedValue(session as never);
    vi.mocked(getSetupStatus).mockResolvedValue({ setupComplete: true });
    vi.mocked(runBoot).mockResolvedValue({ ok: true });
    await expect(beforeLoad()).resolves.toEqual({ user: session.data.user });
  });

  it('tolerates an unreachable setup-status endpoint (does not redirect to /setup)', async () => {
    vi.mocked(authClient.getSession).mockResolvedValue(session as never);
    vi.mocked(getSetupStatus).mockRejectedValue(new Error('network down'));
    vi.mocked(runBoot).mockResolvedValue({ ok: true });
    await expect(beforeLoad()).resolves.toEqual({ user: session.data.user });
  });
});
