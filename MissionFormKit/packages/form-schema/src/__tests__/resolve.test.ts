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
import { resolveAt, resolveSize } from '../resolve'

describe('resolveAt — desktop-base cascade (phone ?? tablet ?? base)', () => {
  it('returns base at every breakpoint when no overrides exist', () => {
    expect(resolveAt({ base: 12 }, 'base', 0)).toBe(12)
    expect(resolveAt({ base: 12 }, 'tablet', 0)).toBe(12)
    expect(resolveAt({ base: 12 }, 'phone', 0)).toBe(12)
  })

  it('tablet override applies at tablet AND cascades down to phone', () => {
    const v = { base: 6, tablet: 12 }
    expect(resolveAt(v, 'base', 0)).toBe(6)
    expect(resolveAt(v, 'tablet', 0)).toBe(12)
    expect(resolveAt(v, 'phone', 0)).toBe(12)
  })

  it('phone override wins over tablet override at phone only', () => {
    const v = { base: 6, tablet: 4, phone: 12 }
    expect(resolveAt(v, 'base', 0)).toBe(6)
    expect(resolveAt(v, 'tablet', 0)).toBe(4)
    expect(resolveAt(v, 'phone', 0)).toBe(12)
  })

  it('phone override without tablet override skips straight past base at phone', () => {
    const v = { base: 6, phone: 12 }
    expect(resolveAt(v, 'tablet', 0)).toBe(6)
    expect(resolveAt(v, 'phone', 0)).toBe(12)
  })

  it('returns the fallback when the whole value is undefined', () => {
    expect(resolveAt<number>(undefined, 'phone', 12)).toBe(12)
  })

  it('does not treat false as absent (visibility use-case)', () => {
    expect(resolveAt({ base: true, phone: false }, 'phone', true)).toBe(false)
  })
})

describe('resolveSize', () => {
  it('uses the desktop size when there is no override', () => {
    expect(resolveSize('lg', undefined, 'phone', 'md')).toBe('lg')
  })
  it('phone inherits the tablet override', () => {
    expect(resolveSize('lg', { tablet: 'sm' }, 'phone', 'md')).toBe('sm')
  })
  it('falls back when nothing is set at the breakpoint', () => {
    expect(resolveSize(undefined, { phone: 'xs' }, 'base', 'md')).toBe('md')
    expect(resolveSize(undefined, { phone: 'xs' }, 'phone', 'md')).toBe('xs')
  })
})
