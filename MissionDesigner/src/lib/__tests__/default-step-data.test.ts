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
import { defaultStepData } from '../default-step-data'

describe('defaultStepData', () => {
  it('gives a freshly-created RETURN node the default ABANDON command', () => {
    expect(defaultStepData('return', 'RETURN').returnConfig).toEqual({ command: 'ABANDON' })
  })
  it('does not add returnConfig to non-RETURN nodes', () => {
    expect(defaultStepData('start', 'Start').returnConfig).toBeUndefined()
    expect(defaultStepData('actionProxyWait', 'Action').returnConfig).toBeUndefined()
  })
  it('preserves the provided label and stepType', () => {
    const d = defaultStepData('return', 'My Return')
    expect(d.label).toBe('My Return')
    expect(d.stepType).toBe('return')
  })
})
