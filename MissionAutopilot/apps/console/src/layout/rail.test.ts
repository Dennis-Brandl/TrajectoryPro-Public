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
import { paneVisible, railActiveId } from './rail'

describe('railActiveId', () => {
  it('maps paths to rail items', () => {
    expect(railActiveId('/', null)).toBe('dashboard')
    expect(railActiveId('/environments', 'explorer')).toBe('environments')
    expect(railActiveId('/environments/abc', null)).toBe('environments')
    expect(railActiveId('/actions/x/code/EXECUTING', null)).toBe('environments')
    expect(railActiveId('/instances', 'instances')).toBe('instances')
    expect(railActiveId('/instances/7', null)).toBe('instances')
    expect(railActiveId('/log', null)).toBe('log')
  })
  it('has no active item on settings', () => {
    expect(railActiveId('/settings', null)).toBeNull()
  })
  it('search wins on any path when its panel is open', () => {
    expect(railActiveId('/', 'search')).toBe('search')
    expect(railActiveId('/environments', 'search')).toBe('search')
    expect(railActiveId('/settings', 'search')).toBe('search')
  })
})

describe('paneVisible', () => {
  it('shows nothing without a panel', () => {
    expect(paneVisible('/environments', null)).toBe(false)
  })
  it('ties explorer to environments and actions only', () => {
    expect(paneVisible('/environments/abc', 'explorer')).toBe(true)
    expect(paneVisible('/actions/x/code/EXECUTING', 'explorer')).toBe(true)
    expect(paneVisible('/instances/x', 'explorer')).toBe(false)
    expect(paneVisible('/', 'explorer')).toBe(false)
  })
  it('ties instances to /instances only', () => {
    expect(paneVisible('/instances', 'instances')).toBe(true)
    expect(paneVisible('/instances/x', 'instances')).toBe(true)
    expect(paneVisible('/environments', 'instances')).toBe(false)
  })
  it('shows search anywhere', () => {
    expect(paneVisible('/', 'search')).toBe(true)
    expect(paneVisible('/settings', 'search')).toBe(true)
  })
})
