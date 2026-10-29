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
import { useSpecificationStore, EMPTY_ARRAY } from '../specificationStore'

beforeEach(() => {
  useSpecificationStore.getState()._reset()
})

describe('specificationStore: module-level freeze (§3.13 invariant 14)', () => {
  it('is frozen at module init', () => {
    expect(Object.isFrozen(useSpecificationStore)).toBe(true)
  })

  it('rejects prototype pollution via Object.setPrototypeOf', () => {
    expect(() => {
      Object.setPrototypeOf(useSpecificationStore, { evil: true })
    }).toThrow()
  })

  it('exposes EMPTY_ARRAY as a frozen module-level empty array', () => {
    expect(EMPTY_ARRAY).toEqual([])
    expect(Object.isFrozen(EMPTY_ARRAY)).toBe(true)
  })

  it('initial state has empty maps and sets', () => {
    const s = useSpecificationStore.getState()
    expect(s.specs.size).toBe(0)
    expect(s.libraries.size).toBe(0)
    expect(s.dirtyIds.size).toBe(0)
    expect(s.savingIds.size).toBe(0)
    expect(s.bootPhase).toBe('me-loading')
  })
})
