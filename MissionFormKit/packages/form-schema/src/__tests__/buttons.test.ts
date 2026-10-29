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
import * as entry from '../index'
import type { Block, ButtonBlock, FormDocument } from '../types'
import { checkNeverStuck, hasJobButtons, jobButtons, JOB_DEFAULT_LABEL, JOB_OUTPUT_VALUE } from '../buttons'

function doc(...blocks: Block[]): FormDocument {
  return { version: 2, sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }] }
}
function btn(id: string, job: ButtonBlock['job'], layout?: ButtonBlock['layout']): ButtonBlock {
  return { id, type: 'button', label: '', outputValue: job ? JOB_OUTPUT_VALUE[job] : 'x', job, layout }
}

describe('job constants', () => {
  it('has the default labels and output values', () => {
    expect(JOB_DEFAULT_LABEL).toEqual({ continue: 'Continue', yes: 'Yes', no: 'No' })
    expect(JOB_OUTPUT_VALUE).toEqual({ continue: 'continue', yes: 'true', no: 'false' })
  })
})

describe('jobButtons / hasJobButtons', () => {
  it('returns job buttons in document order across sections', () => {
    const d: FormDocument = {
      version: 2,
      sections: [
        { id: 's1', role: 'content', rows: [{ id: 'r1', blocks: [btn('a', 'yes'), btn('plain', undefined)] }] },
        { id: 's2', role: 'footer', rows: [{ id: 'r2', blocks: [btn('b', 'no')] }] },
      ],
    }
    expect(jobButtons(d).map((b) => b.id)).toEqual(['a', 'b'])
    expect(hasJobButtons(d)).toBe(true)
    expect(hasJobButtons(doc(btn('plain', undefined)))).toBe(false)
  })
})

describe('checkNeverStuck', () => {
  it('is empty when there are no buttons or only job-less buttons', () => {
    expect(checkNeverStuck(doc(), 'continue')).toEqual([])
    expect(checkNeverStuck(doc(btn('p', undefined)), 'yesno')).toEqual([])
  })

  it('is empty for a visible Continue button on a continue step', () => {
    expect(checkNeverStuck(doc(btn('c', 'continue')), 'continue')).toEqual([])
  })

  it('reports Continue hidden on phone', () => {
    const p = checkNeverStuck(doc(btn('c', 'continue', { visible: { base: true, phone: false } })), 'continue')
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ breakpoint: 'phone', message: 'No Continue button is visible on Phone.' })
  })

  it('reports a missing No on every breakpoint', () => {
    const p = checkNeverStuck(doc(btn('y', 'yes')), 'yesno')
    expect(p.map((x) => [x.breakpoint, x.message])).toEqual([
      ['base', 'No "No" button is visible on Desktop.'],
      ['tablet', 'No "No" button is visible on Tablet.'],
      ['phone', 'No "No" button is visible on Phone.'],
    ])
  })

  it('phone inherits a tablet-hidden No', () => {
    const p = checkNeverStuck(
      doc(btn('y', 'yes'), btn('n', 'no', { visible: { base: true, tablet: false } })),
      'yesno',
    )
    expect(p.map((x) => x.breakpoint)).toEqual(['tablet', 'phone'])
  })

  it('flags wrong-job buttons once per block', () => {
    const y = checkNeverStuck(doc(btn('y', 'yes'), btn('c', 'continue')), 'continue')
    expect(y).toContainEqual({ breakpoint: null, blockId: 'y', message: 'A Yes button only works on a Yes/No step.' })
    const c = checkNeverStuck(doc(btn('c', 'continue'), btn('y', 'yes'), btn('n', 'no')), 'yesno')
    expect(c).toContainEqual({
      breakpoint: null,
      blockId: 'c',
      message: 'A Continue button does not work on a Yes/No step — use Yes and No.',
    })
    expect(c.filter((x) => x.breakpoint === null)).toHaveLength(1)
  })

  it('counts a footer job button', () => {
    const d = doc()
    d.sections.push({ id: 's2', role: 'footer', rows: [{ id: 'r2', blocks: [btn('c', 'continue')] }] })
    expect(checkNeverStuck(d, 'continue')).toEqual([])
  })
})

describe('package entry', () => {
  it('exports the button helpers', () => {
    expect(entry.checkNeverStuck).toBe(checkNeverStuck)
    expect(entry.JOB_OUTPUT_VALUE.yes).toBe('true')
  })
})
