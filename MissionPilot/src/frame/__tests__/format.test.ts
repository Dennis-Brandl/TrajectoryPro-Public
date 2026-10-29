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
import { formatClock } from '../format'

describe('formatClock', () => {
  it('is 24-hour, zero-padded local HH:MM', () => {
    expect(formatClock(new Date(2026, 9, 9, 7, 5))).toBe('07:05')
    expect(formatClock(new Date(2026, 9, 9, 23, 59))).toBe('23:59')
    expect(formatClock(new Date(2026, 9, 9, 0, 0))).toBe('00:00')
  })
})
