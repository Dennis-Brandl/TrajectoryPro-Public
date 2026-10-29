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
import { useNow } from '../useNow'

afterEach(() => {
  vi.useRealTimers()
})

describe('useNow', () => {
  it('starts at the current time and moves on every interval', () => {
    vi.useFakeTimers({ now: 1_000 })
    const { result } = renderHook(() => useNow(60_000))
    expect(result.current).toBe(1_000)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current).toBe(61_000)
  })
})
