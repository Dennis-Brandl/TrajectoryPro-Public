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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTheme } from './useTheme';
import { __resetThemeStoreForTest } from '@/stores/themeStore';

function Probe() {
  const { theme, toggleTheme } = useTheme();
  return <button onClick={toggleTheme}>theme:{theme}</button>;
}

function setPrefersDark(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    ((query: string) => ({ matches, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false })) as unknown as typeof window.matchMedia,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

describe('useTheme', () => {
  // themeStore is a zustand singleton created once at module import, so its initial state
  // was already resolved before this test's localStorage/matchMedia setup ran. Every test
  // below that depends on the INITIAL value therefore has to force a fresh read via
  // __resetThemeStoreForTest — a real page load would re-run this same resolution, this
  // just does it without a reload. See themeStore.ts for the full reasoning.
  it('starts dark when localStorage is empty, even on a light OS', () => {
    setPrefersDark(false);
    __resetThemeStoreForTest();
    render(<Probe />);
    expect(screen.getByRole('button')).toHaveTextContent('theme:dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('prefers a stored value over the dark default', () => {
    setPrefersDark(true);
    localStorage.setItem('mission-theme', 'light');
    __resetThemeStoreForTest();
    render(<Probe />);
    expect(screen.getByRole('button')).toHaveTextContent('theme:light');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('ignores a garbage stored value and starts dark', () => {
    setPrefersDark(false);
    localStorage.setItem('mission-theme', 'chartreuse');
    __resetThemeStoreForTest();
    render(<Probe />);
    expect(screen.getByRole('button')).toHaveTextContent('theme:dark');
  });

  it('toggling flips the class and persists the new value', async () => {
    localStorage.setItem('mission-theme', 'light');
    __resetThemeStoreForTest();
    render(<Probe />);
    expect(document.documentElement).not.toHaveClass('dark');
    await act(async () => { await userEvent.click(screen.getByRole('button')); });
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('mission-theme')).toBe('dark');
    await act(async () => { await userEvent.click(screen.getByRole('button')); });
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('mission-theme')).toBe('light');
  });

  // A browser with site data blocked throws SecurityError from localStorage — at MODULE
  // scope, before React mounts, so ErrorPane cannot catch it. __resetThemeStoreForTest
  // re-runs the same resolveTheme/applyTheme pair the module runs at import, so it is an
  // honest proxy for that path.
  it('starts dark when localStorage reads throw', () => {
    setPrefersDark(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => __resetThemeStoreForTest()).not.toThrow();
    render(<Probe />);
    expect(screen.getByRole('button')).toHaveTextContent('theme:dark');
  });

  it('still toggles the class when localStorage writes throw', async () => {
    localStorage.setItem('mission-theme', 'light');
    __resetThemeStoreForTest();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    render(<Probe />);
    await act(async () => { await userEvent.click(screen.getByRole('button')); });
    // Persistence is impossible, but the visual theme must still change.
    expect(document.documentElement).toHaveClass('dark');
    expect(screen.getByRole('button')).toHaveTextContent('theme:dark');
  });
});

import { RootLayout } from '@/routes/__root';
import { Toaster } from 'sonner';

vi.mock('sonner', () => ({ Toaster: vi.fn(() => null) }));
vi.mock('@tanstack/react-router', () => ({
  createRootRoute: (opts: unknown) => opts,
  Outlet: () => null,
}));

describe('RootLayout', () => {
  it('applies the theme app-wide and passes it to the Toaster', () => {
    localStorage.setItem('mission-theme', 'dark');
    __resetThemeStoreForTest();
    render(<RootLayout />);
    expect(document.documentElement).toHaveClass('dark');
    expect(vi.mocked(Toaster).mock.calls[0][0]).toMatchObject({ theme: 'dark' });
  });
});

// A second, independent consumer of useTheme — stands in for _authenticated.tsx's header
// toggle without pulling in its whole route (auth mocks, principalStore, etc). Rendered
// alongside the real RootLayout, this is the only kind of test that can catch a regression
// back to one useState per call site: AuthenticatedLayout.test.tsx renders in isolation, so
// it never sees RootLayout's Toaster at all, and would stay green even if the two states
// went fully independent again.
function OtherConsumer() {
  const { toggleTheme } = useTheme();
  return <button onClick={toggleTheme}>toggle-elsewhere</button>;
}

describe('theme stays in sync across independent useTheme call sites', () => {
  it("toggling from a second consumer updates RootLayout's Toaster prop, with no reload", async () => {
    localStorage.setItem('mission-theme', 'light');
    __resetThemeStoreForTest();
    render(
      <>
        <RootLayout />
        <OtherConsumer />
      </>,
    );
    expect(vi.mocked(Toaster).mock.calls.at(-1)?.[0]).toMatchObject({ theme: 'light' });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'toggle-elsewhere' }));
    });

    expect(vi.mocked(Toaster).mock.calls.at(-1)?.[0]).toMatchObject({ theme: 'dark' });
  });
});
