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

import { describe, it, expect } from 'vitest'
import { createEntriesFromValueType, isReservedValueTypeEntryName } from '@/lib/value-utils'
import type { ValueTypeSpec } from '@/types/nodes'

const customerInfo: ValueTypeSpec = {
  id: 'vt-1',
  name: 'CustomerInfo',
  description: 'Standard customer record',
  entries: [
    { id: 'e-1', name: 'Name', defaultValue: '' },
    { id: 'e-2', name: 'Address' },
    { id: 'e-3', name: 'Country', defaultValue: 'USA' },
  ],
}

describe('createEntriesFromValueType', () => {
  it('copies one entry per template entry plus the protected Description entry', () => {
    const entries = createEntriesFromValueType(customerInfo)
    expect(entries.map((e) => e.name)).toEqual(['Name', 'Address', 'Country', 'Description'])
  })

  it('carries default values (missing default becomes empty string)', () => {
    const entries = createEntriesFromValueType(customerInfo)
    expect(entries.find((e) => e.name === 'Country')?.value).toBe('USA')
    expect(entries.find((e) => e.name === 'Address')?.value).toBe('')
    expect(entries.find((e) => e.name === 'Description')?.value).toBe('')
  })

  it('generates fresh unique ids (never reuses template entry ids)', () => {
    const entries = createEntriesFromValueType(customerInfo)
    const ids = entries.map((e) => e.id)
    expect(new Set(ids).size).toBe(entries.length)
    expect(ids).not.toContain('e-1')
  })

  it('defensively skips reserved-named template entries', () => {
    const bad: ValueTypeSpec = {
      id: 'vt-2',
      name: 'Bad',
      entries: [
        { id: 'e-1', name: 'Name' },
        { id: 'e-2', name: 'description' },
      ],
    }
    const entries = createEntriesFromValueType(bad)
    // one Name + the single protected Description appended by the factory
    expect(entries.map((e) => e.name)).toEqual(['Name', 'Description'])
  })

  it('defensively skips blank-named template entries', () => {
    const withBlank: ValueTypeSpec = {
      id: 'vt-3',
      name: 'WithBlank',
      entries: [
        { id: 'e-1', name: 'Name' },
        { id: 'e-2', name: '  ' },
      ],
    }
    const entries = createEntriesFromValueType(withBlank)
    // one Name + the single protected Description appended by the factory
    expect(entries.map((e) => e.name)).toEqual(['Name', 'Description'])
  })
})

describe('isReservedValueTypeEntryName', () => {
  it('reserves Description case-insensitively, trimmed', () => {
    expect(isReservedValueTypeEntryName('Description')).toBe(true)
    expect(isReservedValueTypeEntryName('  description ')).toBe(true)
    expect(isReservedValueTypeEntryName('DESCRIPTION')).toBe(true)
    expect(isReservedValueTypeEntryName('Desc')).toBe(false)
    expect(isReservedValueTypeEntryName('Value')).toBe(false)
  })
})
