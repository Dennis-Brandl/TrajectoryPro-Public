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
import { initials } from '../initials'

describe('initials', () => {
  it('takes the first letter of the first and last words, upper-cased', () => {
    expect(initials('Ann Baker')).toBe('AB')
    expect(initials('ann marie baker')).toBe('AB')
    expect(initials('  ann   baker ')).toBe('AB')
  })

  it('one word gives one letter; empty gives ?', () => {
    expect(initials('ann')).toBe('A')
    expect(initials('')).toBe('?')
    expect(initials('   ')).toBe('?')
  })
})
