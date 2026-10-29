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
import { fillPreviewLists } from '../preview-lists'

const doc = (blocks: Array<Record<string, unknown>>) =>
  ({ version: 2, sections: [{ id: 's', role: 'content', rows: [{ id: 'r', blocks }] }] }) as unknown as FormDocument
const blocksOf = (d: FormDocument) => d.sections[0].rows[0].blocks as unknown as Array<Record<string, unknown>>

const values = [
  {
    id: 'v',
    name: 'ValuesForDropdown',
    entries: [
      { id: '1', name: 'Redder', value: 'Redder' },
      { id: '2', name: 'Description', value: 'White' },
      { id: '3', name: 'Greener', value: 'Greener' },
    ],
  },
]
const inputs = [{ id: 'i', name: 'DropdownList', value: 'ValuesForDropdown', valueType: 'property' as const }]
const items = [
  { label: 'Redder', value: 'Redder' },
  { label: 'Greener', value: 'Greener' },
]

describe('fillPreviewLists — the preview shows what Pilot will list', () => {
  it("fills a list bound to an input parameter from the workflow value property's elements, leaving out Description", () => {
    const d = doc([
      {
        id: 'c',
        type: 'textInput',
        inputMode: 'combobox',
        listItems: [],
        listSource: { mode: 'input', value: 'DropdownList' },
      },
      { id: 'k', type: 'checkbox', options: [], listSource: { mode: 'input', value: 'DropdownList' } },
    ])
    const out = fillPreviewLists(d, inputs, values)
    expect(blocksOf(out)[0].listItems).toEqual(items)
    expect(blocksOf(out)[1].options).toEqual(items)
    expect(blocksOf(d)[0].listItems).toEqual([]) // input untouched
  })

  it('leaves a list alone when the input or property cannot be found, or the source is static', () => {
    const d = doc([
      {
        id: 'a',
        type: 'textInput',
        listItems: [{ label: 'X', value: 'X' }],
        listSource: { mode: 'input', value: 'Nope' },
      },
      { id: 'b', type: 'textInput', listItems: [{ label: 'X', value: 'X' }], listSource: { mode: 'static' } },
    ])
    expect(fillPreviewLists(d, inputs, [])).toEqual(d)
    expect(fillPreviewLists(d, inputs, values)).toEqual(d)
  })
})
