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
import { validateFormDocument } from '@mission/form-schema'
import type { V1FormLayouts } from '@mission/form-schema'
import { convertV1FormLayouts } from '../convert-layouts'
import { applyYesNoLabels } from '@/lib/import/transformers'

function v1WithYesNoPair(yes: string, no: string): V1FormLayouts {
  const mk = () => ({
    canvasWidth: 768,
    canvasHeight: 1024,
    elements: [
      { id: 'e1', type: 'text' as const, x: 40, y: 40, width: 400, height: 30, content: 'Hi' },
      {
        id: 'e2',
        type: 'button' as const,
        x: 200,
        y: 900,
        width: 120,
        height: 44,
        label: yes,
        outputValue: 'true',
        deletable: false,
      },
      {
        id: 'e3',
        type: 'button' as const,
        x: 340,
        y: 900,
        width: 120,
        height: 44,
        label: no,
        outputValue: 'false',
        deletable: false,
      },
    ],
  })
  return { phone: mk(), tablet: mk(), desktop: mk() } as unknown as V1FormLayouts
}

describe('convertV1FormLayouts', () => {
  it('converts and surfaces the dropped Yes/No labels structurally', () => {
    const out = convertV1FormLayouts(v1WithYesNoPair('Proceed', 'Abort'))
    expect(out.document.version).toBe(2)
    expect(out.yesNoLabels).toEqual({ yes: 'Proceed', no: 'Abort' })
    expect(out.report.entries.some((e) => e.kind === 'droppedYesNoButtons')).toBe(true)
  })

  // Ported from the retired src/components/form-designer/__tests__/converter-drift.test.ts
  // (P4.2 Task 5): that test's real value wasn't the Designer-FormLayouts-vs-V1FormLayouts
  // type-compatibility premise (moot once the v1 editor and its FormLayouts authoring
  // surface are gone) but this schema-validation + single-default-button-drop coverage,
  // which the Yes/No-pair case above doesn't exercise.
  it('converts a real Designer FormLayouts into a schema-valid v2 document, dropping a lone default button', () => {
    const realLayouts: V1FormLayouts = {
      phone: { canvasWidth: 360, canvasHeight: 800, elements: [] },
      tablet: { canvasWidth: 1280, canvasHeight: 720, elements: [] },
      desktop: {
        canvasWidth: 1024,
        canvasHeight: 768,
        elements: [
          { id: 'h', type: 'header', x: 40, y: 30, width: 900, height: 40, content: 'Inspection' },
          {
            id: 'serial',
            type: 'textInput',
            x: 40,
            y: 90,
            width: 900,
            height: 44,
            fieldName: 'serial',
            label: 'Serial',
            required: true,
          },
          {
            id: 'go',
            type: 'button',
            x: 452,
            y: 700,
            width: 120,
            height: 44,
            label: 'Continue',
            outputValue: 'continue',
            deletable: false,
          },
        ],
      },
    }

    const out = convertV1FormLayouts(realLayouts)
    expect(validateFormDocument(out.document).ok).toBe(true)
    // the default Continue button is recognized and dropped
    expect(out.report.entries.some((e) => e.kind === 'droppedDefaultButton')).toBe(true)
    expect(out.document.sections.some((s) => s.role === 'footer')).toBe(false)
  })
})

describe('applyYesNoLabels', () => {
  it('upserts value/value2 on an existing YesNoButtons block (form labels win)', () => {
    const params = [{ id: 'p1', type: 'YesNoButtons', value: 'Yes', value2: 'No' }]
    const out = applyYesNoLabels(params as never, { yes: 'Proceed', no: 'Abort' })
    expect(out).toEqual([{ id: 'p1', type: 'YesNoButtons', value: 'Proceed', value2: 'Abort' }])
  })
  it('appends a block when none exists', () => {
    const out = applyYesNoLabels(undefined, { yes: 'Proceed', no: 'Abort' })
    expect(out).toHaveLength(1)
    expect(out![0]).toMatchObject({ type: 'YesNoButtons', value: 'Proceed', value2: 'Abort' })
  })
  it('empty labels never clobber existing values', () => {
    const params = [{ id: 'p1', type: 'YesNoButtons', value: 'Ja', value2: 'Nein' }]
    const out = applyYesNoLabels(params as never, { yes: '', no: '' })
    expect(out).toBe(params)
  })
})
