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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { parsePrefs, readPrefs, resolveMode, applyPrefs, usePilotPrefs, PREFS_KEY, DEFAULT_PREFS } from '../prefs'

const root = document.documentElement

function mockMatchMedia(initialDark: boolean) {
  let listener: (() => void) | null = null
  const mql = {
    matches: initialDark,
    addEventListener: vi.fn((_: string, l: () => void) => { listener = l }),
    removeEventListener: vi.fn(() => { listener = null }),
  }
  window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia
  return {
    flip(dark: boolean) {
      mql.matches = dark
      listener?.()
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  root.removeAttribute('data-pilot-mode')
  root.style.removeProperty('--pilot-text-scale')
})

afterEach(() => {
  // jsdom has no matchMedia; tests that mock it must not leak it to the next file.
  delete (window as { matchMedia?: unknown }).matchMedia
  vi.restoreAllMocks()
})

describe('parsePrefs', () => {
  it('keeps a valid stored value', () => {
    expect(parsePrefs(JSON.stringify({ mode: 'dark', textScale: 1.15 }))).toEqual({ mode: 'dark', textScale: 1.15, layout: 'standard' })
  })

  it('falls back per field on foreign or corrupt values, never throwing', () => {
    expect(parsePrefs('{not json')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(parsePrefs(JSON.stringify({ mode: 'purple', textScale: 5 }))).toEqual(DEFAULT_PREFS)
    expect(parsePrefs(JSON.stringify({ mode: 'system', textScale: '1.3' }))).toEqual({ mode: 'system', textScale: 1, layout: 'standard' })
    expect(parsePrefs('42')).toEqual(DEFAULT_PREFS)
  })

  it('layout: workstation is kept, anything else falls back to standard (spec §16, R8)', () => {
    expect(parsePrefs(JSON.stringify({ mode: null, textScale: 1, layout: 'workstation' })).layout).toBe('workstation')
    expect(parsePrefs(JSON.stringify({ mode: null, textScale: 1, layout: 'split' })).layout).toBe('standard')
    expect(parsePrefs(JSON.stringify({ mode: 'dark', textScale: 1 })).layout).toBe('standard')
    expect(DEFAULT_PREFS.layout).toBe('standard')
  })
})

describe('readPrefs', () => {
  it('storage that throws (private window) reads as the defaults', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(readPrefs()).toEqual(DEFAULT_PREFS)
  })
})

describe('resolveMode / applyPrefs', () => {
  it('null follows the default (light); system follows the OS', () => {
    expect(resolveMode(null, true)).toBe('light')
    expect(resolveMode('system', true)).toBe('dark')
    expect(resolveMode('system', false)).toBe('light')
    expect(resolveMode('dark', false)).toBe('dark')
  })

  it('sets data-pilot-mode and the text scale on <html>', () => {
    applyPrefs({ mode: 'dark', textScale: 1.3, layout: 'standard' }, root, false)
    expect(root.getAttribute('data-pilot-mode')).toBe('dark')
    expect(root.style.getPropertyValue('--pilot-text-scale')).toBe('1.3')
  })
})

describe('usePilotPrefs', () => {
  it('a change is stored and applied at once', () => {
    const { result } = renderHook(() => usePilotPrefs())
    expect(root.getAttribute('data-pilot-mode')).toBe('light')

    act(() => result.current[1]({ mode: 'dark', textScale: 1.15, layout: 'standard' }))

    expect(root.getAttribute('data-pilot-mode')).toBe('dark')
    expect(root.style.getPropertyValue('--pilot-text-scale')).toBe('1.15')
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!)).toEqual({ mode: 'dark', textScale: 1.15, layout: 'standard' })
  })

  it('"system" follows the OS switching theme mid-shift, without a reload', () => {
    const media = mockMatchMedia(false)
    localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: 'system', textScale: 1 }))
    renderHook(() => usePilotPrefs())
    expect(root.getAttribute('data-pilot-mode')).toBe('light')

    act(() => media.flip(true))
    expect(root.getAttribute('data-pilot-mode')).toBe('dark')
  })
})
