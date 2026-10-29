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
import { scriptDetailLines } from '../pdf-step-pages'

const script = (extra: Partial<StepNodeData>): StepNodeData => ({ label: 'S', stepType: 'scriptStep', ...extra })

describe('scriptDetailLines (spec 2026-10-13 §6.6)', () => {
  it('a one-shot script adds no lines', () => {
    expect(scriptDetailLines(script({}))).toEqual([])
  })
  it('a repeating script states its cycle, and its limit when it has one', () => {
    expect(scriptDetailLines(script({ scriptRepeat: true }))).toEqual(['Repeat until done, checking every 5 seconds'])
    expect(
      scriptDetailLines(
        script({
          scriptRepeat: true,
          scriptCycleSeconds: 2,
          scriptTimeLimit: { hours: 2 },
          scriptOnTimeLimit: 'complete',
        }),
      ),
    ).toEqual(['Repeat until done, checking every 2 seconds', 'Time limit: 2 h, then complete with current outputs'])
    expect(scriptDetailLines(script({ scriptRepeat: true, scriptTimeLimit: { minutes: 4 } }))[1]).toBe(
      'Time limit: 4 min, then fail the step',
    )
  })
})
