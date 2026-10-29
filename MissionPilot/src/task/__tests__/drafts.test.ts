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
import { typedValues, readDraft, writeDraft, draftCount, clearDraft, clearAllDrafts } from '../drafts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('typedValues', () => {
  it('keeps only what the operator changed from the defaults, a cleared default included', () => {
    expect(typedValues({ a: 'x', b: 'hi', c: ['1'] }, { a: 'x', b: '' })).toEqual({ b: 'hi', c: ['1'] })
    expect(typedValues({ a: '' }, { a: 'x' })).toEqual({ a: '' })
    expect(typedValues({}, { a: 'x' })).toEqual({ a: '' })
    expect(typedValues({ a: 'x' }, { a: 'x' })).toEqual({})
  })
})

describe('drafts in sessionStorage (spec §5.7)', () => {
  it('reads back what was written for the same step instance only; an empty draft removes the key', () => {
    writeDraft('a1', 'si1', { lot: 'L-7' })
    expect(readDraft('a1', 'si1')).toEqual({ lot: 'L-7' })
    expect(readDraft('a1', 'si2')).toBeNull()
    expect(readDraft('a2', 'si1')).toBeNull()
    writeDraft('a1', 'si1', {})
    expect(sessionStorage.getItem('pilot:draft:a1')).toBeNull()
  })

  it('counts the entered values', () => {
    expect(draftCount('a1')).toBe(0)
    writeDraft('a1', 'si1', { lot: 'L-7', qty: '3' })
    expect(draftCount('a1')).toBe(2)
  })

  it('clearDraft drops one task; clearAllDrafts drops every draft and nothing else', () => {
    writeDraft('a1', 'si1', { x: '1' })
    writeDraft('a2', 'si2', { y: '2' })
    sessionStorage.setItem('other', 'keep')
    clearDraft('a1')
    expect(readDraft('a1', 'si1')).toBeNull()
    expect(readDraft('a2', 'si2')).toEqual({ y: '2' })
    clearAllDrafts()
    expect(readDraft('a2', 'si2')).toBeNull()
    expect(sessionStorage.getItem('other')).toBe('keep')
  })

  it('a corrupt entry reads as no draft', () => {
    sessionStorage.setItem('pilot:draft:a1', '{not json')
    expect(readDraft('a1', 'si1')).toBeNull()
    sessionStorage.setItem('pilot:draft:a1', JSON.stringify({ values: { x: '1' } }))
    expect(readDraft('a1', 'si1')).toBeNull()
  })

  it('storage that refuses writes never breaks the form', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => writeDraft('a1', 'si1', { x: '1' })).not.toThrow()
  })
})
