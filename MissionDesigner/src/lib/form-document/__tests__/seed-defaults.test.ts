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
import { seedStaticDefaults } from '../seed-defaults'

function docWithFields(blocks: unknown[]): FormDocument {
  return {
    version: 2,
    sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks: blocks as never }] }],
  } as FormDocument
}

describe('seedStaticDefaults', () => {
  it('seeds a static defaultSource literal', () => {
    const doc = docWithFields([
      { id: 'b1', type: 'textInput', fieldName: 'serial', defaultSource: { mode: 'static', value: 'SN-0' } },
    ])
    expect(seedStaticDefaults(doc)).toEqual({ serial: 'SN-0' })
  })

  it('does NOT seed property/input references (unresolved at design time)', () => {
    const doc = docWithFields([
      { id: 'b1', type: 'textInput', fieldName: 'a', defaultSource: { mode: 'property', value: 'P.x' } },
      { id: 'b2', type: 'textInput', fieldName: 'b', defaultSource: { mode: 'input', value: 'IN.y' } },
    ])
    expect(seedStaticDefaults(doc)).toEqual({})
  })

  it('ignores blocks with no fieldName or no defaultSource', () => {
    const doc = docWithFields([
      { id: 'b1', type: 'text', content: 'hi' },
      { id: 'b2', type: 'textInput', fieldName: 'c' },
    ])
    expect(seedStaticDefaults(doc)).toEqual({})
  })

  it('seeds across sections and rows', () => {
    const doc: FormDocument = {
      version: 2,
      sections: [
        {
          id: 's1',
          role: 'content',
          rows: [
            {
              id: 'r1',
              blocks: [
                { id: 'b1', type: 'textInput', fieldName: 'x', defaultSource: { mode: 'static', value: '1' } },
              ] as never,
            },
          ],
        },
        {
          id: 's2',
          role: 'footer',
          rows: [
            {
              id: 'r2',
              blocks: [
                { id: 'b2', type: 'textInput', fieldName: 'y', defaultSource: { mode: 'static', value: '2' } },
              ] as never,
            },
          ],
        },
      ],
    } as FormDocument
    expect(seedStaticDefaults(doc)).toEqual({ x: '1', y: '2' })
  })
})
