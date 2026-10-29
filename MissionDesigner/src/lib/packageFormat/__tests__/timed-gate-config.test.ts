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
import { extractGateConfig } from '@/lib/packageFormat/step-extractors'

describe('extractGateConfig — timed gates (spec 2026-10-13 §4.2)', () => {
  it('a plain gate exports exactly as before (no mode, no delay)', () => {
    expect(extractGateConfig({ gateCycleSeconds: 5, scriptSource: 'return true;' })).toEqual({
      cycle_seconds: 5,
      source: 'return true;',
    })
    expect(extractGateConfig({ gateCycleSeconds: 5, gateMode: 'condition', gateDelay: { minutes: 4 } })).toEqual({
      cycle_seconds: 5,
    })
    const plain = extractGateConfig({ gateCycleSeconds: 5, gateMode: 'condition', gateDelay: { minutes: 4 } })
    expect(Object.keys(plain ?? {})).toEqual(['cycle_seconds'])
  })
  it('timer and condition_or_timer export mode + total seconds', () => {
    expect(extractGateConfig({ gateMode: 'timer', gateDelay: { hours: 2, minutes: 10, seconds: 20 } })).toEqual({
      mode: 'timer',
      delay_seconds: 7820,
    })
    expect(
      extractGateConfig({
        gateCycleSeconds: 3,
        scriptSource: 'return x;',
        gateMode: 'condition_or_timer',
        gateDelay: { minutes: 4 },
      }),
    ).toEqual({ cycle_seconds: 3, source: 'return x;', mode: 'condition_or_timer', delay_seconds: 240 })
  })
})
