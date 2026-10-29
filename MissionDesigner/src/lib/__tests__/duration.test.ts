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
import { joinDuration, splitDuration, formatDuration, MAX_DELAY_SECONDS } from '@/lib/duration'

describe('duration', () => {
  it('joins any combination of units, blanks = 0', () => {
    expect(joinDuration({ hours: 2, minutes: 10, seconds: 20 })).toBe(7820)
    expect(joinDuration({ minutes: 90 })).toBe(5400)
    expect(joinDuration({ weeks: 1, days: 1 })).toBe(691_200)
    expect(joinDuration(undefined)).toBe(0)
    expect(joinDuration({})).toBe(0)
  })
  it('splits seconds into the largest units', () => {
    expect(splitDuration(7820)).toEqual({ weeks: 0, days: 0, hours: 2, minutes: 10, seconds: 20 })
    expect(splitDuration(MAX_DELAY_SECONDS)).toEqual({ weeks: 52, days: 0, hours: 0, minutes: 0, seconds: 0 })
  })
  it('formats every non-zero unit', () => {
    expect(formatDuration(7820)).toBe('2 h 10 min 20 s')
    expect(formatDuration(5400)).toBe('1 h 30 min')
    expect(formatDuration(240)).toBe('4 min')
    expect(formatDuration(0)).toBe('0 s')
  })
})
