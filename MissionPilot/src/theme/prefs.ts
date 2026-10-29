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

import { useCallback, useEffect, useState } from 'react'

// Operator-local display preferences (spec §8.2, §16): light/dark/system, text size and layout.
// They live outside the `pilot:snapshot:` sign-out sweep, so a shared terminal keeps
// its display set-up across operators. public/theme-boot.js applies the same rules
// before first paint — keep the two in step (theme-boot.test.ts checks parity).
export type PilotMode = 'light' | 'dark' | 'system'
export const TEXT_SCALES = [0.9, 1, 1.15, 1.3] as const
export type TextScale = (typeof TEXT_SCALES)[number]
/** Spec §16: per device, never the default (R8). Not a theme field. */
export type PilotLayout = 'standard' | 'workstation'

export interface PilotPrefs {
  /** null = no choice made: follow the theme's defaultMode (light when no theme is cached). */
  mode: PilotMode | null
  textScale: TextScale
  layout: PilotLayout
}

export const PREFS_KEY = 'pilot:prefs'
export const DEFAULT_MODE: 'light' | 'dark' = 'light'
export const DEFAULT_PREFS: PilotPrefs = { mode: null, textScale: 1, layout: 'standard' }
const DARK_QUERY = '(prefers-color-scheme: dark)'
const MODES: readonly string[] = ['light', 'dark', 'system']

export function parsePrefs(raw: string | null): PilotPrefs {
  let value: unknown
  try {
    value = JSON.parse(raw ?? 'null')
  } catch {
    return DEFAULT_PREFS
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFS
  const { mode, textScale, layout } = value as { mode?: unknown; textScale?: unknown; layout?: unknown }
  return {
    mode: typeof mode === 'string' && MODES.includes(mode) ? (mode as PilotMode) : null,
    textScale: TEXT_SCALES.find((s) => s === textScale) ?? 1,
    layout: layout === 'workstation' ? 'workstation' : 'standard',
  }
}

export function readPrefs(): PilotPrefs {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY))
  } catch {
    return DEFAULT_PREFS
  }
}

export function writePrefs(prefs: PilotPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage blocked: the choice still applies for this page's lifetime.
  }
}

function prefersDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches
  } catch {
    return false
  }
}

export function resolveMode(mode: PilotMode | null, dark: boolean, fallback: PilotMode = DEFAULT_MODE): 'light' | 'dark' {
  const m = mode ?? fallback
  return m === 'system' ? (dark ? 'dark' : 'light') : m
}

export function applyPrefs(
  prefs: PilotPrefs,
  root: HTMLElement = document.documentElement,
  dark = prefersDark(),
  fallback: PilotMode = DEFAULT_MODE,
): void {
  root.setAttribute('data-pilot-mode', resolveMode(prefs.mode, dark, fallback))
  root.style.setProperty('--pilot-text-scale', String(prefs.textScale))
}

/** `fallback` is the theme's defaultMode (spec §7): it applies until the operator chooses. */
export function usePilotPrefs(fallback: PilotMode = DEFAULT_MODE): [PilotPrefs, (next: PilotPrefs) => void] {
  const [prefs, setPrefs] = useState(readPrefs)

  useEffect(() => {
    applyPrefs(prefs, document.documentElement, prefersDark(), fallback)
    if ((prefs.mode ?? fallback) !== 'system') return
    let media: MediaQueryList
    try {
      media = window.matchMedia(DARK_QUERY)
    } catch {
      return
    }
    const onChange = () => applyPrefs(prefs, document.documentElement, prefersDark(), fallback)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [prefs, fallback])

  const update = useCallback((next: PilotPrefs) => {
    writePrefs(next)
    setPrefs(next)
  }, [])

  return [prefs, update]
}
