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
import { PARAMETERIZED_TYPES } from '../NodeInlineEditor'

/**
 * The properties panel renders InputsEditor and OutputsEditor for any
 * nodeType in PARAMETERIZED_TYPES. Yes/No step needs to be in this list
 * so users can attach input/output parameters to it (parity with the
 * User Interaction step). See docs/superpowers/specs/2026-04-17-yes-no-step-inputs-outputs-design.md.
 */
describe('NodeInlineEditor PARAMETERIZED_TYPES', () => {
  it('includes yesNoStep so Inputs/Outputs editors render for it', () => {
    expect(PARAMETERIZED_TYPES).toContain('yesNoStep')
  })

  it('still includes the original four parameterized types', () => {
    expect(PARAMETERIZED_TYPES).toEqual(
      expect.arrayContaining(['actionProxyWait', 'workflowProxy', 'scriptStep', 'userInteractionStep']),
    )
  })

  it('includes select1 so a routed Action Property can be added as an input (spec 2026-09-04 §5.2.4)', () => {
    expect(PARAMETERIZED_TYPES).toContain('select1')
  })
})
