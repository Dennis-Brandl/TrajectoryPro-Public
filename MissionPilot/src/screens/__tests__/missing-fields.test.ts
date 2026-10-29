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
import type { FormDocument } from '@mission/form-schema'
import { missingFieldLabels, missingItems } from '../missing-fields'

const DOC: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's1',
      role: 'content',
      rows: [
        {
          id: 'r1',
          blocks: [
            { id: 'b1', type: 'textInput', fieldName: 'weight', label: 'Batch weight', required: true },
            { id: 'b2', type: 'textInput', fieldName: 'lot', label: '   ', required: true },
            { id: 'b3', type: 'textInput', fieldName: 'note', required: true },
            { id: 'b4', type: 'esignature', fieldName: 'approval' },
            { id: 'b5', type: 'esignature', fieldName: 'qa', label: 'QA approval' },
          ],
        },
      ],
    },
  ],
}

describe('missingFieldLabels', () => {
  it('maps field names to author labels, in the order given', () => {
    expect(missingFieldLabels(DOC, ['note', 'weight'])).toEqual(['note', 'Batch weight'])
  })

  it('falls back to the field name when the label is absent or blank', () => {
    expect(missingFieldLabels(DOC, ['lot', 'note'])).toEqual(['lot', 'note'])
  })

  it('an unlabelled e-signature reads "Signature"; a labelled one keeps its label', () => {
    expect(missingFieldLabels(DOC, ['approval', 'qa'])).toEqual(['Signature', 'QA approval'])
  })

  it('a name the document does not contain is shown as-is', () => {
    expect(missingFieldLabels(DOC, ['ghost'])).toEqual(['ghost'])
  })

  it('no document means no labels to look up', () => {
    expect(missingFieldLabels(null, ['x'])).toEqual(['x'])
  })
})

describe('missingItems', () => {
  it('carries each block id and tells fields, signatures and timers apart', () => {
    const timerDoc: FormDocument = {
      version: 2,
      sections: [
        {
          id: 's1',
          role: 'content',
          rows: [
            {
              id: 'r1',
              blocks: [{ id: 't1', type: 'timer', label: 'Cure time', fieldName: 'cure', durationSeconds: 60, direction: 'countdown', blockDone: true }],
            },
          ],
        },
      ],
    }
    expect(missingItems(DOC, ['weight', 'approval', 'ghost'])).toEqual([
      { fieldName: 'weight', label: 'Batch weight', blockId: 'b1', kind: 'field' },
      { fieldName: 'approval', label: 'Signature', blockId: 'b4', kind: 'signature' },
      { fieldName: 'ghost', label: 'ghost', blockId: null, kind: 'field' },
    ])
    expect(missingItems(timerDoc, ['cure'])).toEqual([{ fieldName: 'cure', label: 'Cure time', blockId: 't1', kind: 'timer' }])
  })
})
