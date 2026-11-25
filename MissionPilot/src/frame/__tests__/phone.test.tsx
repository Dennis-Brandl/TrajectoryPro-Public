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
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { PHONE_QUERY, usePhone } from '../phone'

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
})

function stub(answer: (query: string) => boolean) {
  window.matchMedia = ((query: string) => ({
    matches: answer(query),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
}

describe('usePhone', () => {
  it('is true when the phone query matches', () => {
    stub((q) => q === PHONE_QUERY)
    expect(renderHook(() => usePhone()).result.current).toBe(true)
  })

  it('is false when only other queries match', () => {
    stub((q) => q !== PHONE_QUERY)
    expect(renderHook(() => usePhone()).result.current).toBe(false)
  })
})
