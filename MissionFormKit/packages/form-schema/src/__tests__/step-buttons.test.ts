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
import type { ButtonBlock, FormDocument } from '../types'
import { withStepButtons } from '../step-buttons'

const buttons = (d: FormDocument) =>
  d.sections.flatMap((s) => s.rows.flatMap((r) => r.blocks.filter((b): b is ButtonBlock => b.type === 'button')))
const field = { id: 'f', type: 'textInput', fieldName: 'name' } as const

describe('withStepButtons (user ruling 2026-11-10: the form owns the one button)', () => {
  it('no form: one centered Continue (or Yes and No side by side) in a bottom bar', () => {
    const c = withStepButtons(null, 'continue')
    expect(c.sections).toHaveLength(1)
    expect(c.sections[0]!.role).toBe('footer')
    expect(buttons(c)).toEqual([
      expect.objectContaining({ job: 'continue', layout: { span: { base: 12 }, align: 'center' } }),
    ])
    const yn = withStepButtons(null, 'yesno')
    expect(buttons(yn).map((b) => [b.job, b.layout])).toEqual([
      ['yes', { span: { base: 6 }, align: 'center' }],
      ['no', { span: { base: 6 }, align: 'center' }],
    ])
  })

  it('a form with no button gets the Continue on a new bottom row, after its own bottom rows', () => {
    const doc: FormDocument = {
      version: 2,
      sections: [
        { id: 'c', role: 'content', rows: [{ id: 'r1', blocks: [field] }] },
        { id: 'f', role: 'footer', rows: [{ id: 'r2', blocks: [{ id: 't', type: 'text', content: 'note' }] }] },
      ],
    }
    const out = withStepButtons(doc, 'continue')
    expect(out.sections[1]!.rows.map((r) => r.id)).toEqual(['r2', 'pilot-step-button-1'])
    expect(buttons(out)).toHaveLength(1)
  })

  it("a form's own button, job or not, is the step's button: nothing is added", () => {
    const own: FormDocument = {
      version: 2,
      sections: [{ id: 'c', role: 'content', rows: [{ id: 'r', blocks: [{ id: 'b', type: 'button', label: 'Done', outputValue: 'done' }] }] }],
    }
    const out = withStepButtons(own, 'continue')
    expect(buttons(out)).toEqual([expect.objectContaining({ id: 'b', job: 'continue', label: 'Done' })])
    const withJob: FormDocument = {
      version: 2,
      sections: [{ id: 'c', role: 'content', rows: [{ id: 'r', blocks: [{ id: 'b', type: 'button', label: '', outputValue: 'continue', job: 'continue' }] }] }],
    }
    expect(withStepButtons(withJob, 'continue')).toBe(withJob)
  })

  it('a button hidden on some screens gets a stand-in shown only there', () => {
    const doc: FormDocument = {
      version: 2,
      sections: [
        {
          id: 'c',
          role: 'content',
          rows: [
            {
              id: 'r',
              blocks: [
                { id: 'b', type: 'button', label: '', outputValue: 'continue', job: 'continue', layout: { visible: { base: true, tablet: false } } },
              ],
            },
          ],
        },
      ],
    }
    const added = buttons(withStepButtons(doc, 'continue')).filter((b) => b.id !== 'b')
    expect(added).toEqual([
      expect.objectContaining({
        job: 'continue',
        layout: { span: { base: 12 }, align: 'center', visible: { base: false, tablet: true, phone: true } },
      }),
    ])
  })

  it('is stable: the same form gives the same ids', () => {
    expect(withStepButtons(null, 'continue')).toEqual(withStepButtons(null, 'continue'))
  })
})
