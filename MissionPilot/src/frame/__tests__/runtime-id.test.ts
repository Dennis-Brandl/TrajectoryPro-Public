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
import { splitRuntimeId, instanceStripe } from '../runtime-id'

describe('splitRuntimeId (spec §4: never truncate a runtime ID from the end)', () => {
  it('splits after the last separator, so the distinguishing segment stays whole', () => {
    expect(splitRuntimeId('MIX-20261009-0002')).toEqual(['MIX-20261009-', '0002'])
    expect(splitRuntimeId('RW-69')).toEqual(['RW-', '69'])
    expect(splitRuntimeId('LOT_2026.07/A12')).toEqual(['LOT_2026.07/', 'A12'])
  })

  it('without a separator keeps the last four characters; short and odd IDs survive', () => {
    expect(splitRuntimeId('BATCH0001234')).toEqual(['BATCH000', '1234'])
    expect(splitRuntimeId('AB')).toEqual(['', 'AB'])
    expect(splitRuntimeId('LOT-7-')).toEqual(['LOT-', '7-'])
    expect(splitRuntimeId('')).toEqual(['', ''])
  })
})

describe('instanceStripe (spec §5.2)', () => {
  it('is deterministic and always one of the six stripe colours', () => {
    for (const label of ['RW-1', 'MIX-20261009-0002', '', 'x'.repeat(300)]) {
      const n = instanceStripe(label)
      expect(instanceStripe(label)).toBe(n)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(6)
    }
  })

  it('spreads consecutive batch IDs across all six colours', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `MIX-20261009-${String(i + 1).padStart(4, '0')}`)
    expect(new Set(ids.map(instanceStripe)).size).toBe(6)
  })
})
