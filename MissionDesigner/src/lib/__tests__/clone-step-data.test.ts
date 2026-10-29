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
import type { FormDocument } from '@mission/form-schema'
import type { StepNodeData } from '@/types/nodes'
import { cloneStepData } from '../clone-step-data'

/** A minimal StepNodeData carrying a v2 formDocument: one content section, one row,
 *  one textInput block (fieldName) and one image block (imageOid). */
function stepDataWithFormDocument(): StepNodeData {
  const formDocument: FormDocument = {
    version: 2,
    sections: [
      {
        id: 'sec-1',
        role: 'content',
        rows: [
          {
            id: 'row-1',
            blocks: [
              { id: 'block-text', type: 'textInput', fieldName: 'Text_abc123', label: 'Name' },
              {
                id: 'block-img',
                type: 'image',
                src: 'photo.png',
                imageOid: 'OLDOID',
                layout: { aspectRatio: '16/9' },
              },
            ],
          },
        ],
      },
    ],
  }
  return { label: 'Test', stepType: 'userInteractionStep', formDocument }
}

// Real-wiring coverage: exercises cloneStepData itself (not cloneFormDocument directly), so
// this test goes RED if the `if (cloned.formDocument) …` guard in clone-step-data.ts is ever
// removed — the exact regression clone-document.test.ts's unit tests cannot catch, since those
// call cloneFormDocument directly and know nothing about whether cloneStepData wires it in.
describe('cloneStepData — formDocument wiring', () => {
  it('regenerates every section/row/block id and image imageOid via the real cloneStepData, and keeps fieldNames', () => {
    const data = stepDataWithFormDocument()
    const sourceDoc = data.formDocument as FormDocument

    const cloned = cloneStepData(data)
    const doc = cloned.formDocument as FormDocument

    expect(doc).not.toBe(sourceDoc)
    expect(doc.sections[0].id).not.toBe(sourceDoc.sections[0].id)
    expect(doc.sections[0].rows[0].id).not.toBe(sourceDoc.sections[0].rows[0].id)

    const [text, img] = doc.sections[0].rows[0].blocks
    expect(text.id).not.toBe('block-text')
    expect(img.id).not.toBe('block-img')
    expect((img as { imageOid?: string }).imageOid).not.toBe('OLDOID')

    // fieldNames are KEPT — v1 cloneFormLayouts parity (see clone-document.ts)
    expect((text as { fieldName: string }).fieldName).toBe('Text_abc123')
  })

  it('does not mutate the source StepNodeData.formDocument', () => {
    const data = stepDataWithFormDocument()
    const before = JSON.parse(JSON.stringify(data.formDocument))

    cloneStepData(data)

    expect(data.formDocument).toEqual(before)
  })
})
