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

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const STORAGE_KEY = 'mission-spec-expansion'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('useSpecExpansion', () => {
  it('returns false for unknown ids by default', async () => {
    const { useSpecExpansion } = await import('../useSpecExpansion')
    const { result } = renderHook(() => useSpecExpansion())
    expect(result.current.isExpanded('spec-a')).toBe(false)
  })

  it('toggle flips the state', async () => {
    const { useSpecExpansion } = await import('../useSpecExpansion')
    const { result } = renderHook(() => useSpecExpansion())
    act(() => {
      result.current.toggle('spec-a')
    })
    expect(result.current.isExpanded('spec-a')).toBe(true)
    act(() => {
      result.current.toggle('spec-a')
    })
    expect(result.current.isExpanded('spec-a')).toBe(false)
  })

  it('setExpanded sets explicit value', async () => {
    const { useSpecExpansion } = await import('../useSpecExpansion')
    const { result } = renderHook(() => useSpecExpansion())
    act(() => {
      result.current.setExpanded('spec-a', true)
    })
    expect(result.current.isExpanded('spec-a')).toBe(true)
    act(() => {
      result.current.setExpanded('spec-a', false)
    })
    expect(result.current.isExpanded('spec-a')).toBe(false)
  })

  it('persists to localStorage under the mission-spec-expansion key', async () => {
    vi.useFakeTimers()
    const { useSpecExpansion } = await import('../useSpecExpansion')
    const { result } = renderHook(() => useSpecExpansion())
    act(() => {
      result.current.setExpanded('spec-a', true)
    })
    vi.advanceTimersByTime(350) // past the 300 ms debounce
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as string[]
    expect(parsed).toContain('spec-a')
    vi.useRealTimers()
  })

  it('hydrates from localStorage on first use', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['spec-a', 'spec-b']))
    const { useSpecExpansion } = await import('../useSpecExpansion')
    const { result } = renderHook(() => useSpecExpansion())
    expect(result.current.isExpanded('spec-a')).toBe(true)
    expect(result.current.isExpanded('spec-b')).toBe(true)
    expect(result.current.isExpanded('spec-c')).toBe(false)
  })

  it('ignores malformed localStorage contents', async () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')
    const { useSpecExpansion } = await import('../useSpecExpansion')
    const { result } = renderHook(() => useSpecExpansion())
    expect(result.current.isExpanded('anything')).toBe(false)
  })

  it('selector overload returns the projected slice', async () => {
    const { useSpecExpansion } = await import('../useSpecExpansion')
    const { result } = renderHook(() => useSpecExpansion((s) => s.ids.has('spec-a')))
    expect(result.current).toBe(false)
  })
})
