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
import { applyActionLabels, deriveActionDraft } from '../action-labels'
import type { UIParameterSpec } from '@/types/nodes'

describe('deriveActionDraft', () => {
  it('reads yes/no labels from a YesNoButtons param', () => {
    const data = { uiParameters: [{ id: 'p', type: 'YesNoButtons' as const, value: 'Proceed', value2: 'Abort' }] }
    expect(deriveActionDraft('yesNoStep', data)).toEqual({ kind: 'yesno', yes: 'Proceed', no: 'Abort' })
  })
  it('defaults yes/no when the param is absent', () => {
    expect(deriveActionDraft('yesNoStep', {})).toEqual({ kind: 'yesno', yes: 'Yes', no: 'No' })
  })
  it('reads the Continue label from a Button param, else defaults', () => {
    const data = { uiParameters: [{ id: 'p', type: 'Button' as const, value: 'Next' }] }
    expect(deriveActionDraft('userInteraction', data)).toEqual({ kind: 'continue', label: 'Next' })
    expect(deriveActionDraft('userInteraction', {})).toEqual({ kind: 'continue', label: 'Continue' })
  })
})

describe('applyActionLabels', () => {
  it('updates an existing YesNoButtons param in place, preserving other params', () => {
    const params: UIParameterSpec[] = [
      { id: 'a', type: 'Text', value: 'hi' },
      { id: 'b', type: 'YesNoButtons', value: 'Yes', value2: 'No' },
    ]
    const out = applyActionLabels(params, { kind: 'yesno', yes: 'Proceed', no: 'Abort' })
    expect(out).toEqual([
      { id: 'a', type: 'Text', value: 'hi' },
      { id: 'b', type: 'YesNoButtons', value: 'Proceed', value2: 'Abort' },
    ])
  })
  it('appends a YesNoButtons param when none exists (with an id)', () => {
    const out = applyActionLabels([], { kind: 'yesno', yes: 'Proceed', no: 'Abort' })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'YesNoButtons', value: 'Proceed', value2: 'Abort' })
    expect(typeof out[0].id).toBe('string')
    expect(out[0].id.length).toBeGreaterThan(0)
  })
  it('updates an existing Button param in place', () => {
    const params: UIParameterSpec[] = [{ id: 'b', type: 'Button', value: 'Continue' }]
    expect(applyActionLabels(params, { kind: 'continue', label: 'Next' })).toEqual([
      { id: 'b', type: 'Button', value: 'Next' },
    ])
  })
  it('appends a Button param when none exists', () => {
    const out = applyActionLabels([{ id: 'a', type: 'Text', value: 'hi' }], { kind: 'continue', label: 'Next' })
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ type: 'Button', value: 'Next' })
  })
})
