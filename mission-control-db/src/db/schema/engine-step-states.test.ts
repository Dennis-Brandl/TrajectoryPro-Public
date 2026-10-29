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

import { describe, expect, it } from 'vitest'
import { ENGINE_STEP_STATES } from './execution.js'

describe('ENGINE_STEP_STATES', () => {
  it('contains WAITING_GATE between WAITING_USER and PAUSED (GATE spec 2026-08-29 §6.1)', () => {
    const i = ENGINE_STEP_STATES.indexOf('WAITING_GATE' as (typeof ENGINE_STEP_STATES)[number])
    expect(i).toBeGreaterThan(ENGINE_STEP_STATES.indexOf('WAITING_USER'))
    expect(i).toBeLessThan(ENGINE_STEP_STATES.indexOf('PAUSED'))
  })

  it('contains WAITING_PROPERTIES between WAITING_GATE and PAUSED (spec 2026-09-04 §5.4.1)', () => {
    const i = ENGINE_STEP_STATES.indexOf('WAITING_PROPERTIES' as (typeof ENGINE_STEP_STATES)[number])
    expect(i).toBeGreaterThan(ENGINE_STEP_STATES.indexOf('WAITING_GATE'))
    expect(i).toBeLessThan(ENGINE_STEP_STATES.indexOf('PAUSED'))
  })
})
