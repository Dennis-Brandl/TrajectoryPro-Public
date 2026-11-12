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
import type { FormDocument } from '../types'
import { barStyleOf, isFixedBar, stripButtonBlocks } from '../step-bar'

describe('stripButtonBlocks', () => {
  it('removes buttons and empty footers, never mutating the input', () => {
    const doc: FormDocument = {
      version: 2,
      sections: [
        {
          id: 'body',
          rows: [
            { id: 'r1', blocks: [{ id: 't', type: 'text', content: 'hi' }] },
            { id: 'r2', blocks: [{ id: 'mid', type: 'button', job: 'continue', label: 'Go' }] },
          ],
        },
        {
          id: 'foot',
          role: 'footer',
          rows: [
            {
              id: 'r3',
              blocks: [
                { id: 'y', type: 'button', job: 'yes', label: 'Yes' },
                { id: 'n', type: 'button', job: 'no', label: 'No' },
              ],
            },
          ],
        },
      ],
    } as FormDocument
    const before = structuredClone(doc)
    const out = stripButtonBlocks(doc)
    expect(doc).toEqual(before)
    expect(out.sections).toHaveLength(1)
    expect(out.sections[0]!.rows).toHaveLength(1)
    expect(out.sections[0]!.rows[0]!.blocks.map((b) => b.id)).toEqual(['t'])
  })
})

describe('isFixedBar / barStyleOf', () => {
  it('is true only for { format: "fixed" }', () => {
    expect(isFixedBar({ button_bar: { format: 'fixed' } })).toBe(true)
    expect(isFixedBar({})).toBe(false)
    expect(isFixedBar({ button_bar: {} })).toBe(false)
    expect(isFixedBar({ button_bar: 'fixed' })).toBe(false)
    expect(isFixedBar(undefined)).toBe(false)
    expect(isFixedBar(null)).toBe(false)
  })
  it('maps snake_case to camelCase, null when not fixed', () => {
    expect(barStyleOf({ button_bar: { format: 'fixed', size: 'lg', color: '#0a0', yes_color: '#1', no_color: '#2' } })).toEqual({
      size: 'lg', color: '#0a0', yesColor: '#1', noColor: '#2',
    })
    expect(barStyleOf({ button_bar: { format: 'fixed' } })).toEqual({})
    expect(barStyleOf({})).toBeNull()
  })
})
