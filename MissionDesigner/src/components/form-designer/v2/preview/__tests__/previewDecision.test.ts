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
import type { FormDocument } from '@mission/form-schema'
import { derivePreviewDecision, withSignatureLabels } from '../previewDecision'

const data = (d: Partial<StepNodeData>) => d as Pick<StepNodeData, 'uiParameters' | 'yesNoYesValue' | 'yesNoNoValue'>

describe('derivePreviewDecision', () => {
  it('yesNoStep: labels from YesNoButtons uiParameter, values from yesNo*Value', () => {
    const d = derivePreviewDecision(
      'yesNoStep',
      data({
        uiParameters: [{ id: 'p', type: 'YesNoButtons', value: 'Approve', value2: 'Reject' }],
        yesNoYesValue: 'ok',
        yesNoNoValue: 'bad',
      }),
    )
    expect(d).toEqual({ kind: 'yesno', yes: { label: 'Approve', value: 'ok' }, no: { label: 'Reject', value: 'bad' } })
  })

  it('yesNoStep: falls back to Yes/No + true/false', () => {
    const d = derivePreviewDecision('yesNoStep', data({}))
    expect(d).toEqual({ kind: 'yesno', yes: { label: 'Yes', value: 'true' }, no: { label: 'No', value: 'false' } })
  })

  it('userInteractionStep: Continue label from a Button uiParameter', () => {
    const d = derivePreviewDecision(
      'userInteractionStep',
      data({ uiParameters: [{ id: 'p', type: 'Button', value: 'Submit' }] }),
    )
    expect(d).toEqual({ kind: 'continue', label: 'Submit' })
  })

  it('userInteractionStep: defaults to Continue', () => {
    expect(derivePreviewDecision('userInteractionStep', data({}))).toEqual({ kind: 'continue', label: 'Continue' })
  })

  it('withSignatureLabels prefixes the signing chrome only when an e-signature block is present', () => {
    const cont = { kind: 'continue' as const, label: 'Continue' }
    expect(withSignatureLabels(cont, false)).toEqual(cont)
    expect(withSignatureLabels(cont, true)).toEqual({ kind: 'continue', label: 'Sign & Continue' })
    const yn = {
      kind: 'yesno' as const,
      yes: { label: 'Approve', value: 'true' },
      no: { label: 'Reject', value: 'false' },
    }
    expect(withSignatureLabels(yn, true)).toEqual({ ...yn, yes: { label: 'Sign & Approve', value: 'true' } })
  })

  it('withSignatureLabels never doubles the word: "Sign and Save" stays "Sign and Save"', () => {
    const yn = {
      kind: 'yesno' as const,
      yes: { label: 'Sign and Save', value: 'true' },
      no: { label: 'Cancel Signing', value: 'false' },
    }
    expect(withSignatureLabels(yn, true)).toEqual(yn)
    expect(withSignatureLabels({ kind: 'continue', label: 'Sign off' }, true)).toEqual({
      kind: 'continue',
      label: 'Sign off',
    })
  })
})

describe("derivePreviewDecision — a form's own Continue button (same rule as Pilot)", () => {
  const doc = (label: string) =>
    ({
      version: 2,
      sections: [
        {
          id: 's',
          role: 'content',
          rows: [{ id: 'r', blocks: [{ id: 'b', type: 'button', label, outputValue: 'continue' }] }],
        },
      ],
    }) as unknown as FormDocument

  it("uses the form's Continue button label when the step has no Button uiParameter", () => {
    expect(derivePreviewDecision('userInteractionStep', data({}), doc('Keep Going'))).toEqual({
      kind: 'continue',
      label: 'Keep Going',
    })
  })

  it('the Button uiParameter still wins', () => {
    const d = derivePreviewDecision(
      'userInteractionStep',
      data({ uiParameters: [{ id: 'p', type: 'Button', value: 'Done' }] }),
      doc('Keep Going'),
    )
    expect(d).toEqual({ kind: 'continue', label: 'Done' })
  })
})
