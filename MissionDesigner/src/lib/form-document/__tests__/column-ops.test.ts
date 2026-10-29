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
import { moveBlock } from '../structural-ops'
import { arrangeColumns, ownRowTarget, rowAboveTarget } from '../column-ops'

/** rows: one string per row, e.g. ['A', 'BC'] = row 1 holds A, row 2 holds B and C. */
function docOf(rows: string[]): FormDocument {
  return {
    version: 2,
    sections: [
      {
        id: 's',
        role: 'content',
        rows: rows.map((r, i) => ({
          id: `r${i}`,
          blocks: [...r].map((id) => ({ id, type: 'text', content: id, layout: { span: { base: 12 / r.length } } })),
        })),
      },
    ],
  } as unknown as FormDocument
}
const shape = (d: FormDocument) => d.sections[0].rows.map((r) => r.blocks.map((b) => b.id).join(''))
const spans = (d: FormDocument) => d.sections[0].rows.map((r) => r.blocks.map((b) => b.layout?.span?.base))

describe('rowAboveTarget — "Move into row above"', () => {
  it('appends the element to the end of the previous row', () => {
    const d = docOf(['A', 'B', 'C'])
    const out = moveBlock(d, 'B', rowAboveTarget(d, 'B')!)
    expect(shape(out)).toEqual(['AB', 'C'])
    expect(spans(out)[0]).toEqual([6, 6])
  })

  it('is unavailable for the first row, or when the row above is full', () => {
    expect(rowAboveTarget(docOf(['A', 'B']), 'A')).toBeNull()
    expect(rowAboveTarget(docOf(['ABCDEFGHIJKL', 'M']), 'M')).toBeNull()
  })
})

describe('ownRowTarget — "Move to its own row"', () => {
  it('puts the element on a new row just below its row', () => {
    const d = docOf(['ABC', 'D'])
    const out = moveBlock(d, 'B', ownRowTarget(d, 'B')!)
    expect(shape(out)).toEqual(['AC', 'B', 'D'])
    expect(spans(out)[1]).toEqual([12])
  })

  it('is unavailable when the element is already alone', () => {
    expect(ownRowTarget(docOf(['A', 'B']), 'A')).toBeNull()
  })
})

describe('arrangeColumns — "Arrange in N columns"', () => {
  it('pulls elements up from the following rows until the row holds N', () => {
    const out = arrangeColumns(docOf(['A', 'B', 'C', 'D']), 'A', 3)
    expect(shape(out)).toEqual(['ABC', 'D'])
    expect(spans(out)[0]).toEqual([4, 4, 4])
  })

  it('takes elements one at a time from a following row that holds several', () => {
    expect(shape(arrangeColumns(docOf(['A', 'BCD', 'E']), 'A', 2))).toEqual(['AB', 'CD', 'E'])
  })

  it('pushes extra elements onto a new row just below', () => {
    const out = arrangeColumns(docOf(['ABCD', 'E']), 'C', 2)
    expect(shape(out)).toEqual(['AB', 'CD', 'E'])
    expect(spans(out)[1]).toEqual([6, 6])
  })

  it('1 column puts every element on its own row', () => {
    expect(shape(arrangeColumns(docOf(['ABC']), 'A', 1))).toEqual(['A', 'B', 'C'])
  })

  it('returns the same document when nothing changes or nothing more can be pulled', () => {
    const d = docOf(['AB', 'C'])
    expect(arrangeColumns(d, 'A', 2)).toBe(d)
    const last = docOf(['A'])
    expect(arrangeColumns(last, 'A', 3)).toBe(last)
  })
})
