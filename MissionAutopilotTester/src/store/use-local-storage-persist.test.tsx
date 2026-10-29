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

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { loadLocalStorage, useLocalStoragePersist } from './use-local-storage-persist'

describe('loadLocalStorage', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('returns the fallback when the key is missing', () => {
    expect(loadLocalStorage('missing', { foo: 'bar' })).toEqual({ foo: 'bar' })
  })

  it('returns the stored value when the key exists and parses', () => {
    localStorage.setItem('present', JSON.stringify({ foo: 'baz' }))
    expect(loadLocalStorage('present', { foo: 'bar' })).toEqual({ foo: 'baz' })
  })

  it('returns the fallback when stored JSON is malformed', () => {
    localStorage.setItem('garbled', '{this is not json')
    expect(loadLocalStorage('garbled', { foo: 'bar' })).toEqual({ foo: 'bar' })
  })
})

describe('useLocalStoragePersist', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('writes the current value on mount', () => {
    renderHook(() => useLocalStoragePersist('mount-key', { n: 1 }))
    expect(JSON.parse(localStorage.getItem('mount-key') ?? 'null')).toEqual({ n: 1 })
  })

  it('writes the new value when it changes', () => {
    const { rerender } = renderHook(({ v }: { v: number }) => useLocalStoragePersist('change-key', { n: v }), {
      initialProps: { v: 1 },
    })
    rerender({ v: 2 })
    expect(JSON.parse(localStorage.getItem('change-key') ?? 'null')).toEqual({ n: 2 })
  })

  it('swallows errors when localStorage throws', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('quota exceeded')
    }
    try {
      // Should not throw.
      renderHook(() => useLocalStoragePersist('throw-key', { n: 1 }))
    } finally {
      Storage.prototype.setItem = original
    }
  })
})
