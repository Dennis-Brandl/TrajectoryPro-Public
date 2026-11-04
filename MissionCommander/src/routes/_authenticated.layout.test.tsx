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
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

// Same partial-mock shape as login.test.tsx: keep createFileRoute real so the route
// still builds, but replace useNavigate — rendering the layout bare would otherwise
// call useRouter() with no <RouterProvider>.
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => navigate, Outlet: () => <div>outlet</div> };
});
vi.mock('@/lib/auth/auth-client', () => ({
  authClient: { getSession: vi.fn() }, signOut: vi.fn(),
}));
vi.mock('@/lib/auth/setupClient', () => ({ getSetupStatus: vi.fn() }));
vi.mock('@/lib/auth/boot', () => ({ runBoot: vi.fn() }));
vi.mock('@/components/shell/ImpersonationBanner', () => ({
  ImpersonationBanner: () => <div data-testid="impersonation-banner" />,
}));
vi.mock('@/stores/principalStore', () => ({
  usePrincipalStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ principal: { displayName: 'Dennis' } }),
    { getState: () => ({ clearPrincipal: vi.fn() }) },
  ),
}));

import { AuthenticatedLayout } from './_authenticated';
import { __resetThemeStoreForTest } from '@/stores/themeStore';
import { useSelectionStore } from '@/stores/selectionStore';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});
afterEach(() => { cleanup(); });

describe('AuthenticatedLayout shared header', () => {
  it('opens About for Mission Commander with its build and tagline', async () => {
    render(<AuthenticatedLayout />);
    await userEvent.click(screen.getByRole('button', { name: 'About Mission Commander' }));
    expect(await screen.findByText(`Mission Commander build ${__APP_VERSION__}`)).toBeInTheDocument();
    expect(screen.getByText('Runs workflows in work centers')).toBeInTheDocument();
  });

  it('shows the suite version in the bar and no diagram image in the header', () => {
    render(<AuthenticatedLayout />);
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    const header = screen.getByRole('banner');
    expect(header.querySelector('img[alt]:not([alt=""])')).toBeNull();
  });

  it('keeps the product name, display name and Sign out', () => {
    render(<AuthenticatedLayout />);
    expect(screen.getByText('Mission Commander')).toBeInTheDocument();
    expect(screen.getByText('Dennis')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('Settings in the header selects the settings hierarchy and shows pressed', async () => {
    useSelectionStore.setState({ activeHierarchy: 'work_center' });
    render(<AuthenticatedLayout />);
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(useSelectionStore.getState().activeHierarchy).toBe('settings');
    expect(await screen.findByRole('button', { name: 'Settings', pressed: true })).toBeInTheDocument();
  });

  it('puts Help in the header, opening the guide in a new tab', () => {
    render(<AuthenticatedLayout />);
    const help = screen.getByRole('link', { name: 'Help' });
    expect(help).toHaveAttribute('href', '/help.html');
    expect(help).toHaveAttribute('target', '_blank');
    expect(help.closest('header')).not.toBeNull();
  });

  it('renders the impersonation banner directly under the header', () => {
    render(<AuthenticatedLayout />);
    const header = screen.getByRole('banner');
    expect(header.nextElementSibling).toBe(screen.getByTestId('impersonation-banner'));
  });

  it('offers the theme toggle in the header', () => {
    localStorage.setItem('mission-theme', 'dark');
    __resetThemeStoreForTest();
    render(<AuthenticatedLayout />);
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeVisible();
  });
});
