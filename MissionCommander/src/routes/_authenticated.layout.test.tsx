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
  ImpersonationBanner: () => null,
}));
vi.mock('@/stores/principalStore', () => ({
  usePrincipalStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ principal: { displayName: 'Dennis' } }),
    { getState: () => ({ clearPrincipal: vi.fn() }) },
  ),
}));

import { AuthenticatedLayout } from './_authenticated';
import { __resetThemeStoreForTest } from '@/stores/themeStore';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});
afterEach(() => { cleanup(); });

describe('AuthenticatedLayout title line', () => {
  // The banner is a diagram carrying real meaning (environments and workflows load into
  // work centers; users are assigned to work centers and given roles), so it must be a
  // described image, not an alt="" decoration a screen reader skips.
  it('renders the banner with descriptive alternative text', () => {
    render(<AuthenticatedLayout />);
    const banner = screen.getByRole('img', { name: /work center/i });
    expect(banner).toBeInTheDocument();
    expect(banner.getAttribute('alt')).not.toBe('');
  });

  it('places the banner inside the title line, not the panes below it', () => {
    render(<AuthenticatedLayout />);
    const banner = screen.getByRole('img', { name: /work center/i });
    expect(banner.closest('header')).not.toBeNull();
  });

  // The banner is an addition to the title line, not a replacement for what was there.
  it('keeps the product name and the session controls', () => {
    render(<AuthenticatedLayout />);
    expect(screen.getByText('Mission Commander')).toBeInTheDocument();
    expect(screen.getByText('Dennis')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  // True centring needs the two outer cells to be equal-width tracks; with a plain
  // justify-between flex the banner would sit wherever the differing left/right widths
  // pushed it, which is visibly off-centre and drifts as the display name changes length.
  it('centres the banner independently of the left and right content widths', () => {
    render(<AuthenticatedLayout />);
    const header = screen.getByRole('img', { name: /work center/i }).closest('header')!;
    expect(header.className).toContain('grid-cols-[1fr_auto_1fr]');
  });

  // themeStore is a zustand singleton created once at module import (when this file's
  // top-level `import { AuthenticatedLayout } from './_authenticated'` first pulled it in),
  // so setting localStorage here alone would not affect the already-resolved state.
  // __resetThemeStoreForTest forces a fresh read, the same way a real page load would.
  it('renders the dark banner and a "switch to light" toggle in dark mode', async () => {
    localStorage.setItem('mission-theme', 'dark');
    __resetThemeStoreForTest();
    render(<AuthenticatedLayout />);
    expect(await screen.findByRole('img')).toHaveAttribute(
      'src', expect.stringContaining('mission-commander-dark'),
    );
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeVisible();
  });

  it('renders the light banner and a "switch to dark" toggle in light mode', async () => {
    localStorage.setItem('mission-theme', 'light');
    __resetThemeStoreForTest();
    render(<AuthenticatedLayout />);
    const img = await screen.findByRole('img');
    expect(img.getAttribute('src')).not.toContain('mission-commander-dark');
    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeVisible();
  });
});
