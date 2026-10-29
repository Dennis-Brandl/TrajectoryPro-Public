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

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyPrefs, parsePrefs, PREFS_KEY, DEFAULT_MODE } from '../prefs'
import { applyTheme, applyThemeColor, parseThemePayload, THEME_LAST_KEY } from '../site-theme'
import { resolveTheme, themePayload } from 'mission-control-db/src/dao/pilot-theme'

const BOOT = readFileSync(join(process.cwd(), 'public/theme-boot.js'), 'utf8')
const root = document.documentElement

function snapshot() {
  return {
    mode: root.getAttribute('data-pilot-mode'),
    scale: root.style.getPropertyValue('--pilot-text-scale') || '1',
    theme: root.getAttribute('data-pilot-theme'),
    css: document.getElementById('pilot-theme')?.textContent ?? null,
    color: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
  }
}

function reset() {
  root.setAttribute('data-pilot-mode', 'light')
  root.setAttribute('data-pilot-theme', 'default')
  root.style.removeProperty('--pilot-text-scale')
  document.getElementById('pilot-theme')?.remove()
  document.head.querySelector('meta[name="theme-color"]')?.remove()
  const meta = document.createElement('meta')
  meta.setAttribute('name', 'theme-color')
  meta.setAttribute('content', 'initial')
  document.head.appendChild(meta)
}

/** What the React side applies for the same stored values (useSiteTheme + usePilotPrefs). */
function applyLikeTheApp(prefsRaw: string | null, themeRaw: string | null) {
  const cached = parseThemePayload(themeRaw)
  applyPrefs(parsePrefs(prefsRaw), root, false, cached?.theme.defaultMode ?? DEFAULT_MODE)
  applyTheme(cached)
  if (cached) applyThemeColor(cached)
}

const darkDefault = themePayload(4, resolveTheme([{ schema: 1, defaultMode: 'dark', colors: { light: { brand: '#7c3aed' } } }]))
const systemDefault = themePayload(2, resolveTheme([{ schema: 1, defaultMode: 'system' }]))

const PREFS: Array<string | null> = [
  null,
  JSON.stringify({ mode: 'dark', textScale: 1.3 }),
  JSON.stringify({ mode: 'light', textScale: 0.9 }),
  JSON.stringify({ mode: 'system', textScale: 1.15 }),
  JSON.stringify({ mode: 'purple', textScale: 5 }),
  '{not json',
]

const THEMES: Array<string | null> = [
  null,
  JSON.stringify(darkDefault),
  JSON.stringify(systemDefault),
  JSON.stringify({ ...darkDefault, css: 'body { display: none }' }), // not our CSS: ignored
  JSON.stringify({ ...darkDefault, rev: -1 }),
  JSON.stringify({ ...darkDefault, themeColor: { light: 'red', dark: 'blue' } }),
  JSON.stringify({ ...darkDefault, fontFamily: undefined }),
  JSON.stringify({ ...darkDefault, etag: '"4-0123456789abcdef"' }),
  JSON.stringify({ ...darkDefault, etag: 7 }), // not a validator: rejected by both
  '{not json',
]

beforeEach(() => {
  localStorage.clear()
  reset()
})

describe('public/theme-boot.js', () => {
  it('applies exactly what the app applies, for every pairing of stored prefs and stored theme', () => {
    for (const prefsRaw of PREFS) {
      for (const themeRaw of THEMES) {
        localStorage.clear()
        if (prefsRaw !== null) localStorage.setItem(PREFS_KEY, prefsRaw)
        if (themeRaw !== null) localStorage.setItem(THEME_LAST_KEY, themeRaw)

        reset()
        new Function(BOOT)()
        const boot = snapshot()

        reset()
        applyLikeTheApp(prefsRaw, themeRaw)
        const app = snapshot()

        expect(boot, `prefs=${prefsRaw} theme=${themeRaw?.slice(0, 60)}`).toEqual(app)
      }
    }
  })

  it('with no operator choice the cached theme picks the mode; an operator choice wins', () => {
    localStorage.setItem(THEME_LAST_KEY, JSON.stringify(darkDefault))
    new Function(BOOT)()
    expect(root.getAttribute('data-pilot-mode')).toBe('dark')
    expect(document.getElementById('pilot-theme')?.textContent).toBe(darkDefault.css)
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(darkDefault.themeColor.dark)

    reset()
    localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: 'light', textScale: 1 }))
    new Function(BOOT)()
    expect(root.getAttribute('data-pilot-mode')).toBe('light')
  })

  it('a blocked localStorage leaves the shipped light defaults and throws nothing', () => {
    // jsdom may define localStorage on the prototype rather than on window itself.
    const own = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('blocked') } })
    try {
      expect(() => new Function(BOOT)()).not.toThrow()
      expect(root.getAttribute('data-pilot-mode')).toBe('light')
      expect(document.getElementById('pilot-theme')).toBeNull()
    } finally {
      if (own) Object.defineProperty(window, 'localStorage', own)
      else delete (window as { localStorage?: Storage }).localStorage
    }
  })
})
