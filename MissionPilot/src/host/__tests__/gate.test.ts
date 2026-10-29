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
import { seedDefaults, EMPTY_TIMERS } from '../gate'

function doc(blocks: FormDocument['sections'][number]['rows'][number]['blocks']): FormDocument {
  return {
    version: 2,
    sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }],
  }
}

describe('seedDefaults', () => {
  it('picks a literal (mode: static) default by fieldName', () => {
    const document = doc([
      {
        id: 'b1',
        type: 'textInput',
        fieldName: 'name',
        defaultSource: { mode: 'static', value: 'Ada' },
      },
    ])

    expect(seedDefaults(document)).toEqual({ name: 'Ada' })
  })

  it('does not resolve a property-reference default (V1 boundary) — omits the field entirely', () => {
    const document = doc([
      {
        id: 'b1',
        type: 'textInput',
        fieldName: 'name',
        defaultSource: { mode: 'property', value: 'some.property.path' },
      },
    ])

    expect(seedDefaults(document)).toEqual({})
  })

  it('a block with no defaultSource at all contributes nothing', () => {
    const document = doc([{ id: 'b1', type: 'textInput', fieldName: 'name' }])

    expect(seedDefaults(document)).toEqual({})
  })

  it('a block type with no fieldName (e.g. text) is skipped without error', () => {
    const document = doc([{ id: 'b1', type: 'text', content: 'hello' }])

    expect(seedDefaults(document)).toEqual({})
  })

  it('collects literal defaults from multiple blocks across rows and sections', () => {
    const document: FormDocument = {
      version: 2,
      sections: [
        {
          id: 's1',
          role: 'content',
          rows: [
            {
              id: 'r1',
              blocks: [
                { id: 'b1', type: 'textInput', fieldName: 'a', defaultSource: { mode: 'static', value: '1' } },
                { id: 'b2', type: 'textarea', fieldName: 'b', defaultSource: { mode: 'static', value: '2' } },
              ],
            },
          ],
        },
        {
          id: 's2',
          role: 'footer',
          rows: [
            {
              id: 'r2',
              blocks: [{ id: 'b3', type: 'timer', fieldName: 'c', label: 'Timer', durationSeconds: 10, direction: 'countdown', defaultSource: { mode: 'static', value: '5' } }],
            },
          ],
        },
      ],
    }

    expect(seedDefaults(document)).toEqual({ a: '1', b: '2', c: '5' })
  })

  it('an empty document yields an empty seed', () => {
    expect(seedDefaults({ version: 2, sections: [] })).toEqual({})
  })
})

describe('EMPTY_TIMERS', () => {
  it('is an empty set', () => {
    expect(EMPTY_TIMERS.size).toBe(0)
  })
})
