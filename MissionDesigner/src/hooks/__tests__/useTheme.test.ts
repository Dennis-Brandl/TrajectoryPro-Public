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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { applyInitialTheme, useTheme } from '@/hooks/useTheme'

function setPrefersDark(matches: boolean) {
  // jsdom has no matchMedia; define it so the OS preference is a known value.
  vi.stubGlobal('matchMedia', ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia)
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})
afterEach(() => vi.unstubAllGlobals())

describe('useTheme', () => {
  it('starts dark when nothing is saved, even on a light OS', () => {
    setPrefersDark(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('a saved light choice wins over the dark default', () => {
    setPrefersDark(true)
    localStorage.setItem('mission-theme', 'light')
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('ignores a garbage saved value and starts dark', () => {
    setPrefersDark(false)
    localStorage.setItem('mission-theme', 'chartreuse')
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
  })

  it('applyInitialTheme sets the page dark before anything renders', () => {
    applyInitialTheme()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    localStorage.setItem('mission-theme', 'light')
    applyInitialTheme()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('toggling saves the new choice', () => {
    setPrefersDark(false)
    const { result } = renderHook(() => useTheme())
    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('light')
    expect(localStorage.getItem('mission-theme')).toBe('light')
  })
})
