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

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUserName, usePrincipalStore } from '@/stores/principalStore'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'

beforeEach(() => usePrincipalStore.getState().clearPrincipal())

describe('useUserName', () => {
  it("returns 'Unknown' when there is no principal", () => {
    const { result } = renderHook(() => useUserName())
    expect(result.current).toBe('Unknown')
  })

  it("returns the principal's name", () => {
    usePrincipalStore.setState({ principal: { name: 'Ada Lovelace' } as MePrincipal })
    const { result } = renderHook(() => useUserName())
    expect(result.current).toBe('Ada Lovelace')
  })

  it("falls back to 'Unknown' when name is null", () => {
    usePrincipalStore.setState({ principal: { name: null } as MePrincipal })
    const { result } = renderHook(() => useUserName())
    expect(result.current).toBe('Unknown')
  })
})
