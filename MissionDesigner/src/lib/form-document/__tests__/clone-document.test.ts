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
import { cloneFormDocument } from '../clone-document'

const source: FormDocument = {
  version: 2,
  sections: [
    {
      id: 'content',
      role: 'content',
      rows: [
        {
          id: 'r1',
          blocks: [
            { id: 'b1', type: 'textInput', fieldName: 'Text_abc123', label: 'Name' },
            { id: 'b2', type: 'image', src: 'photo.png', imageOid: 'OLDOID', layout: { aspectRatio: '16/9' } },
          ],
        },
      ],
    },
  ],
}

describe('cloneFormDocument', () => {
  it('regenerates every section/row/block id and image imageOid', () => {
    const clone = cloneFormDocument(source)
    expect(clone.sections[0].id).not.toBe('content')
    expect(clone.sections[0].rows[0].id).not.toBe('r1')
    const [b1, b2] = clone.sections[0].rows[0].blocks
    expect(b1.id).not.toBe('b1')
    expect(b2.id).not.toBe('b2')
    expect((b2 as { imageOid?: string }).imageOid).not.toBe('OLDOID')
  })
  it('KEEPS fieldNames (v1 cloneFormLayouts parity) and all other content', () => {
    const clone = cloneFormDocument(source)
    const b1 = clone.sections[0].rows[0].blocks[0] as { fieldName: string; label?: string }
    expect(b1.fieldName).toBe('Text_abc123')
    expect(b1.label).toBe('Name')
    expect((clone.sections[0].rows[0].blocks[1] as { src: string }).src).toBe('photo.png')
  })
  it('does not mutate the source', () => {
    const before = JSON.stringify(source)
    cloneFormDocument(source)
    expect(JSON.stringify(source)).toBe(before)
  })
  it('leaves a converted-from-v1 image block with no imageOid still without one (no phantom OID minted)', () => {
    const noOidSource: FormDocument = {
      version: 2,
      sections: [
        {
          id: 'content',
          role: 'content',
          rows: [
            {
              id: 'r1',
              blocks: [{ id: 'b1', type: 'image', src: 'photo.png', layout: { aspectRatio: '16/9' } }],
            },
          ],
        },
      ],
    }
    const clone = cloneFormDocument(noOidSource)
    const b1 = clone.sections[0].rows[0].blocks[0] as { imageOid?: string }
    expect(b1.imageOid).toBeUndefined()
    expect('imageOid' in b1).toBe(false)
  })
})
