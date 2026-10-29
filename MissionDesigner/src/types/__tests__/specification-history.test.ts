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
import {
  parseHistory,
  serializeHistory,
  createCreatedEntry,
  createStateChangeEntry,
  createNewVersionEntry,
} from '@/types/specification-history'

describe('specification-history', () => {
  it('parseHistory returns [] for null/undefined/invalid', () => {
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory(undefined)).toEqual([])
    expect(parseHistory('')).toEqual([])
    expect(parseHistory('not-json')).toEqual([])
    expect(parseHistory('{}')).toEqual([])
  })

  it('parseHistory round-trips a serialized array', () => {
    const entry = createCreatedEntry({ account: 'a@b.com', version: '1.0.0' })
    const serialized = serializeHistory([entry])
    expect(parseHistory(serialized)).toEqual([entry])
  })

  it('createStateChangeEntry sets fields and ISO timestamp', () => {
    const e = createStateChangeEntry({
      account: 'a@b.com',
      version: '1.0.0',
      fromState: 'Draft',
      toState: 'Effective',
      reason: 'ready',
    })
    expect(e.type).toBe('state_change')
    expect(e.fromState).toBe('Draft')
    expect(e.toState).toBe('Effective')
    expect(e.reason).toBe('ready')
    expect(typeof e.at).toBe('string')
    expect(() => new Date(e.at).toISOString()).not.toThrow()
  })

  it('createNewVersionEntry includes fromVersion and fromSpecId', () => {
    const e = createNewVersionEntry({
      account: 'a@b.com',
      version: '1.1.0',
      fromVersion: '1.0.0',
      fromSpecId: 'spec-old',
    })
    expect(e.type).toBe('new_version')
    expect(e.fromVersion).toBe('1.0.0')
    expect(e.fromSpecId).toBe('spec-old')
  })
})

describe('createStateChangeEntry — Phase 3 optional flags', () => {
  const base = {
    account: 'u1',
    version: '1.0.0',
    fromState: 'Draft' as const,
    toState: 'InReview' as const,
    reason: 'r',
  }

  it('omits the optional keys when not supplied', () => {
    const e = createStateChangeEntry(base)
    expect('adminOverride' in e).toBe(false)
    expect('system' in e).toBe(false)
    expect('effectiveFrom' in e).toBe(false)
  })

  it('records adminOverride / system / effectiveFrom when supplied', () => {
    const e = createStateChangeEntry({ ...base, adminOverride: true, system: true, effectiveFrom: 1750000000000 })
    expect(e.adminOverride).toBe(true)
    expect(e.system).toBe(true)
    expect(e.effectiveFrom).toBe(1750000000000)
  })

  it('round-trips through serialize/parse', () => {
    const e = createStateChangeEntry({ ...base, effectiveFrom: 1750000000000 })
    const [back] = parseHistory(serializeHistory([e]))
    expect(back).toEqual(e)
  })
})
