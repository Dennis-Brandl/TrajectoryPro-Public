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

import { useThemeStore } from '@/stores/themeStore'

// Thin wrapper over themeStore: kept as its own hook so its existing call sites
// (__root.tsx, _authenticated.tsx) and its signature are unchanged. The theme itself lives
// in a zustand store, not a local useState, so every call site reads the SAME value instead
// of each mount getting its own independent state — see themeStore.ts for why that matters.
export function useTheme() {
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)
  return { theme, toggleTheme }
}
