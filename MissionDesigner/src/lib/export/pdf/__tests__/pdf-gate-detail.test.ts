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
import type { StepNodeData } from '@/types/nodes'
import { gateDetailLines } from '../pdf-step-pages'

const gate = (extra: Partial<StepNodeData>): StepNodeData => ({ label: 'G', stepType: 'gateStep', ...extra })

describe('gateDetailLines (spec 2026-10-13 §4.4)', () => {
  it('a plain condition gate keeps the original single cycle-time line', () => {
    expect(gateDetailLines(gate({}))).toEqual(['Cycle time: 5 seconds'])
    expect(gateDetailLines(gate({ gateMode: 'condition', gateCycleSeconds: 12 }))).toEqual(['Cycle time: 12 seconds'])
  })

  it('a timer gate shows the mode and delay, no cycle time', () => {
    const lines = gateDetailLines(gate({ gateMode: 'timer', gateDelay: { hours: 2, minutes: 10, seconds: 20 } }))
    expect(lines).toEqual(['Mode: Timer, delay 2 h 10 min 20 s'])
    expect(lines.join(' | ')).not.toContain('Cycle time')
  })

  it('a condition_or_timer gate shows both the delay and the cycle', () => {
    expect(gateDetailLines(gate({ gateMode: 'condition_or_timer', gateDelay: { minutes: 4 } }))).toEqual([
      'Mode: Condition with timeout, delay 4 min',
      'Cycle time: 5 seconds',
    ])
  })
})
