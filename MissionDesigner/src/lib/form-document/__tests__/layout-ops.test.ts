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
import { resolveBp, setBp, clearBp, isOverridden, sizePatchAt, clearSizeAt } from '../layout-ops'

describe('layout-ops per-breakpoint helpers', () => {
  it('resolveBp cascades phone -> base', () => {
    expect(resolveBp({ base: 12 }, 'phone', 6)).toBe(12)
    expect(resolveBp({ base: 12, phone: 4 }, 'phone', 6)).toBe(4)
    expect(resolveBp(undefined, 'base', 6)).toBe(6)
  })

  it('resolveBp cascades tablet -> phone (3-level)', () => {
    expect(resolveBp({ base: 6, tablet: 12 }, 'phone', 0)).toBe(12)
    expect(resolveBp({ base: 6, tablet: 12 }, 'tablet', 0)).toBe(12)
  })

  it('resolveBp preserves falsy overrides (false / 0 are NOT treated as unset)', () => {
    expect(resolveBp({ base: true, phone: false }, 'phone', true)).toBe(false)
    expect(resolveBp({ base: 5, phone: 0 }, 'phone', 9)).toBe(0)
  })

  it('setBp writes the breakpoint key without dropping base', () => {
    expect(setBp({ base: 12 }, 12, 'tablet', 6)).toEqual({ base: 12, tablet: 6 })
    expect(setBp(undefined, 12, 'base', 8)).toEqual({ base: 8 })
  })

  it('clearBp removes an override but never base', () => {
    expect(clearBp({ base: 12, phone: 4 }, 12, 'phone')).toEqual({ base: 12 })
    expect(clearBp({ base: 12 }, 12, 'base')).toEqual({ base: 12 })
  })

  it('isOverridden is true for base and for a set breakpoint key', () => {
    expect(isOverridden({ base: 12 }, 'base')).toBe(true)
    expect(isOverridden({ base: 12 }, 'phone')).toBe(false)
    expect(isOverridden({ base: 12, phone: 4 }, 'phone')).toBe(true)
  })
})

describe('sizePatchAt / clearSizeAt', () => {
  it('a desktop edit writes size and leaves sizeAt alone', () => {
    expect(sizePatchAt({ size: 'md', sizeAt: { phone: 'sm' } }, 'base', 'xl')).toEqual({ size: 'xl' })
  })
  it('a phone edit with no sizeAt creates {phone}', () => {
    expect(sizePatchAt({}, 'phone', 'sm')).toEqual({ sizeAt: { phone: 'sm' } })
  })
  it('a tablet edit keeps the phone override', () => {
    expect(sizePatchAt({ sizeAt: { phone: 'xs' } }, 'tablet', 'lg')).toEqual({ sizeAt: { phone: 'xs', tablet: 'lg' } })
  })
  it('clearing one override keeps the other', () => {
    expect(clearSizeAt({ sizeAt: { tablet: 'lg', phone: 'xs' } }, 'phone')).toEqual({ sizeAt: { tablet: 'lg' } })
  })
  it('clearing the last override removes sizeAt', () => {
    const r = clearSizeAt({ size: 'md', sizeAt: { phone: 'xs' } }, 'phone')
    expect(r.sizeAt).toBeUndefined()
    expect(r.size).toBe('md')
  })
})
