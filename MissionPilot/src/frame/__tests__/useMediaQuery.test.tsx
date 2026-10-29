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
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMediaQuery } from '../useMediaQuery'

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('useMediaQuery', () => {
  it('false where matchMedia is missing (jsdom, very old browsers)', () => {
    const { result } = renderHook(() => useMediaQuery('(min-width: 1280px)'))
    expect(result.current).toBe(false)
  })

  it('follows the query live', () => {
    let listener: (() => void) | undefined
    const mql = {
      matches: true,
      addEventListener: vi.fn((_: string, l: () => void) => (listener = l)),
      removeEventListener: vi.fn(),
    }
    window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia
    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 1280px)'))
    expect(result.current).toBe(true)
    mql.matches = false
    act(() => listener!())
    expect(result.current).toBe(false)
    unmount()
    expect(mql.removeEventListener).toHaveBeenCalled()
  })
})
