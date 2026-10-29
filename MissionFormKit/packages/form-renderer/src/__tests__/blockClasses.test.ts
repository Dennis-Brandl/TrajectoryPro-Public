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
import { blockLayoutClasses } from '../blockClasses'

describe('blockLayoutClasses', () => {
  it('defaults to span 12 at every breakpoint when layout is undefined', () => {
    expect(blockLayoutClasses(undefined)).toBe('tfk-block tfk-span-base-12 tfk-span-tablet-12 tfk-span-phone-12')
  })

  it('resolves spans through the cascade (phone ?? tablet ?? base)', () => {
    const cls = blockLayoutClasses({ span: { base: 6, phone: 12 } })
    expect(cls).toContain('tfk-span-base-6')
    expect(cls).toContain('tfk-span-tablet-6')
    expect(cls).toContain('tfk-span-phone-12')
  })

  it('emits hide classes only where resolved visibility is false', () => {
    const cls = blockLayoutClasses({ visible: { base: true, phone: false } })
    expect(cls).not.toContain('tfk-hide-base')
    expect(cls).not.toContain('tfk-hide-tablet')
    expect(cls).toContain('tfk-hide-phone')
  })

  it('emits order classes only where an order is set', () => {
    const cls = blockLayoutClasses({ order: { base: 2, phone: 1 } })
    expect(cls).toContain('tfk-order-base-2')
    expect(cls).toContain('tfk-order-tablet-2')
    expect(cls).toContain('tfk-order-phone-1')
  })

  it('emits align class when set', () => {
    expect(blockLayoutClasses({ align: 'center' })).toContain('tfk-align-center')
  })

  it('is deterministic (same input, same string)', () => {
    const layout = { span: { base: 4 as const }, align: 'end' as const }
    expect(blockLayoutClasses(layout)).toBe(blockLayoutClasses(layout))
  })
})
