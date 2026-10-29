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
import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'mission-theme';

// Both helpers touch APIs that a browser with site data blocked makes THROW rather than
// return empty: localStorage raises SecurityError. This module runs them at import time —
// before React mounts — so an unguarded throw here is a blank page that no error boundary
// can catch, ErrorPane included.
// With no saved choice the app starts dark, whatever the OS prefers.
function resolveTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === 'light' || stored === 'dark') return stored;
    return 'dark';
  } catch {
    return 'dark';
  }
}

// The one place that touches the DOM/localStorage for a theme change. This used to live in
// a useEffect inside useTheme, so every component calling the hook ran its own copy —
// harmless while there was only ever one call site (RootLayout), but _authenticated.tsx now
// calls the hook too, and two independent effects meant two independent `theme` values that
// could (and did) drift: toggling from one call site never touched the other's state, so
// RootLayout's <Toaster theme={...}> went stale until a full reload. Centralizing both the
// state and its side effect in one store means there is exactly one write, no matter how
// many components read `theme`.
function applyTheme(theme: Theme): void {
  // OUTSIDE the try: classList cannot throw, and it is the half that must keep working
  // when storage is blocked — a user who cannot persist a preference should still see the
  // theme they picked for this session.
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Preference cannot be persisted; the applied theme above still stands.
  }
}

type State = { theme: Theme; toggleTheme: () => void };

export const useThemeStore = create<State>((set, get) => ({
  theme: resolveTheme(),
  toggleTheme: () => {
    const next: Theme = get().theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    set({ theme: next });
  },
}));

// Apply the resolved initial theme's side effects once, at module load — mirrors what the
// old hook's mount-time useEffect did, just once for the singleton instead of once per
// mounted component.
applyTheme(useThemeStore.getState().theme);

// Test-only. zustand stores are created once, at import time, so the initial state above is
// fixed the moment this module first loads. principalStore/selectionStore reset cleanly with
// a plain beforeEach setState because their initial state is a fixed literal; this store's
// initial state is DERIVED from localStorage/matchMedia, so a test that changes those inputs
// after import needs a way to force a fresh read — otherwise it observes whatever the
// singleton resolved to on first import, not what it just set up.
export function __resetThemeStoreForTest(): void {
  const theme = resolveTheme();
  applyTheme(theme);
  useThemeStore.setState({ theme });
}
