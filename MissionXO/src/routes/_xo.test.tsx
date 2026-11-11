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
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { isRedirect } from '@tanstack/react-router';

const { invalidate, navigate } = vi.hoisted(() => ({ invalidate: vi.fn(), navigate: vi.fn() }));
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>();
  return { ...actual, Outlet: () => <div>outlet content</div>, useRouter: () => ({ invalidate }), useNavigate: () => navigate };
});
vi.mock('~/lib/auth-client', () => ({ authClient: { getSession: vi.fn() }, signOut: vi.fn() }));
vi.mock('@/lib/api/me', () => ({ me: vi.fn() }));

import { XoLayout, XoUnreachable, Route } from './_xo';
import { SwitcherButton } from '~/components/shell/WorkCenterSwitcher';
import { authClient } from '~/lib/auth-client';
import { me as fetchMe } from '@/lib/api/me';
import { useMeStore } from '~/stores/meStore';
import { useWorkCenterStore } from '~/stores/workCenterStore';
import { usePrincipalStore } from '@/stores/principalStore';
import type { MePrincipal } from '@/lib/api/types';

const person = (accessLevel: string) => ({
  displayName: 'Sam', accessLevel, isAdministrator: accessLevel === 'administrator',
  rights: [], missionSystemCommanderOf: [],
}) as unknown as MePrincipal;

const beforeLoad = Route.options.beforeLoad as unknown as () => Promise<unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  useMeStore.setState({ me: null });
  usePrincipalStore.setState({ principal: null });
});
afterEach(cleanup);

describe('_xo layout', () => {
  it('redirects to /login with no session', async () => {
    vi.mocked(authClient.getSession).mockResolvedValue({ data: null } as never);
    let thrown: unknown;
    try { await beforeLoad(); } catch (e) { thrown = e; }
    expect(isRedirect(thrown)).toBe(true);
  });

  it('loads me into both stores', async () => {
    vi.mocked(authClient.getSession).mockResolvedValue({ data: { user: {} } } as never);
    vi.mocked(fetchMe).mockResolvedValue(person('steward'));
    await beforeLoad();
    expect(useMeStore.getState().me?.displayName).toBe('Sam');
    expect(usePrincipalStore.getState().principal?.displayName).toBe('Sam');
  });

  it('does not block navigation on the network once me is loaded', async () => {
    useMeStore.getState().setMe(person('steward'));
    vi.mocked(fetchMe).mockReturnValue(new Promise(() => {}));
    await expect(beforeLoad()).resolves.toBeUndefined();
    expect(authClient.getSession).not.toHaveBeenCalled();
    expect(fetchMe).toHaveBeenCalled(); // refreshed in the background
  });

  it('keeps the screen when the background refresh fails (lost connection)', async () => {
    useMeStore.getState().setMe(person('steward'));
    vi.mocked(authClient.getSession).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(fetchMe).mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(beforeLoad()).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(useMeStore.getState().me?.displayName).toBe('Sam');
  });

  it('shows only the refusal and Sign out for a viewer', () => {
    useMeStore.getState().setMe(person('viewer'));
    render(<XoLayout />);
    expect(screen.getByText('Mission XO is for Stewards and Administrators')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(screen.queryByText('outlet content')).toBeNull();
  });

  it('renders the outlet and header for a steward', () => {
    useMeStore.getState().setMe(person('steward'));
    render(<XoLayout />);
    expect(screen.getByText('outlet content')).toBeInTheDocument();
    expect(screen.getByText('Mission XO')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
  });

  it('puts the work-center switcher in the top bar on a wide screen, not on a phone', () => {
    const original = window.matchMedia;
    const atWidth = (px: number) => {
      window.matchMedia = ((query: string) => ({
        matches: px >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0), media: query, onchange: null,
        addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    };
    try {
      useMeStore.getState().setMe(person('steward'));
      useWorkCenterStore.setState({ name: 'Alpha' });
      atWidth(1440);
      render(<XoLayout />);
      expect(screen.getByRole('button', { name: /alpha/i })).toBeInTheDocument();
      cleanup();
      atWidth(390); // the phone row in WorkCenterShell carries it instead
      render(<XoLayout />);
      expect(screen.queryByRole('button', { name: /alpha/i })).toBeNull();
    } finally {
      window.matchMedia = original;
      useWorkCenterStore.setState({ name: null });
    }
  });

  it('does not redirect when me() fails with a session present; offers Retry', async () => {
    vi.mocked(authClient.getSession).mockResolvedValue({ data: { user: {} } } as never);
    vi.mocked(fetchMe).mockRejectedValue(new Error('500'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let thrown: unknown;
    try { await beforeLoad(); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Error);
    expect(isRedirect(thrown)).toBe(false);
    render(<XoUnreachable />);
    expect(screen.getByText("Can't reach Mission Control")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(invalidate).toHaveBeenCalled();
  });
});

describe('work-center switcher', () => {
  it('returns to the picker with pick set', () => {
    render(<SwitcherButton name="Alpha" />);
    fireEvent.click(screen.getByRole('button', { name: /alpha/i }));
    expect(navigate).toHaveBeenCalledWith({ to: '/', search: { pick: true } });
  });
});
