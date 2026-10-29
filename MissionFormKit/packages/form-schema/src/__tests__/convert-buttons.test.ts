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
import { convertButtons as fromIndex } from '../index'
import { convertButtons } from '../convert-buttons'
import type { Block, ButtonBlock, FormDocument, Section } from '../types'

function counter() {
  let n = 0
  return () => `n${++n}`
}
function b(id: string, outputValue: string, label = 'X', extra: Partial<ButtonBlock> = {}): ButtonBlock {
  return { id, type: 'button', label, outputValue, ...extra }
}
function doc(...blocks: Block[]): FormDocument {
  return { version: 2, sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }] }
}
function buttons(d: FormDocument): ButtonBlock[] {
  return d.sections.flatMap((s) => s.rows.flatMap((r) => r.blocks.filter((x): x is ButtonBlock => x.type === 'button')))
}

describe('convertButtons', () => {
  it('is exported from the package index', () => {
    expect(fromIndex).toBe(convertButtons)
  })

  it('maps continue / true / false and never mutates the input', () => {
    const d = doc(b('a', 'continue', 'Go'))
    const snap = JSON.stringify(d)
    const r = convertButtons(d, 'continue', counter())
    expect(buttons(r.document)[0]!.job).toBe('continue')
    expect(JSON.stringify(d)).toBe(snap)
    expect(r.changed).toBe(true)
    expect(r.changes).toEqual(['Button "Go" is now a Continue button.'])
    expect(r.problems).toEqual([])

    const y = convertButtons(doc(b('t', 'true', 'Yep'), b('f', 'false', 'Nope')), 'yesno', counter())
    expect(buttons(y.document).map((x) => x.job)).toEqual(['yes', 'no'])
    expect(y.problems).toEqual([])
    expect(y.document.sections).toHaveLength(1)
  })

  it('maps a job-less approve to continue on a continue step, label kept', () => {
    const r = convertButtons(doc(b('a', 'approve', 'Approve')), 'continue', counter())
    const x = buttons(r.document)[0]!
    expect(x.job).toBe('continue')
    expect(x.label).toBe('Approve')
    expect(r.problems).toEqual([])
  })

  it('leaves approve job-less on a yesno step and reports it', () => {
    const r = convertButtons(doc(b('a', 'approve', 'Approve')), 'yesno', counter())
    expect(buttons(r.document)[0]!.job).toBeUndefined()
    expect(r.needsJob).toEqual(['a'])
    expect(r.changes).toContain('Button "Approve" needs a job — pick Yes or No.')
    expect(buttons(r.document).filter((x) => x.job).map((x) => x.job)).toEqual(['yes', 'no'])
    expect(r.problems).toEqual([])
  })

  it('blanks default labels, keeps others and styling', () => {
    const r = convertButtons(
      doc(
        b('c', 'continue', 'Continue', { color: 'red', emphasis: 'secondary', layout: { span: { base: 3 } } as never }),
        b('f', 'continue', 'Finish'),
      ),
      'continue',
      counter(),
    )
    const [c, f] = buttons(r.document) as [ButtonBlock, ButtonBlock]
    expect(c.label).toBe('')
    expect(c.color).toBe('red')
    expect(c.emphasis).toBe('secondary')
    expect(c.layout).toEqual({ span: { base: 3 } })
    expect(f.label).toBe('Finish')
    const y = convertButtons(doc(b('y', 'true', 'Yes'), b('n', 'false', 'No')), 'yesno', counter())
    expect(buttons(y.document).map((x) => x.label)).toEqual(['', ''])
  })

  it('keeps buttons where they were', () => {
    const d: FormDocument = {
      version: 2,
      sections: [
        { id: 's1', role: 'content', rows: [{ id: 'r1', blocks: [b('a', 'continue')] }] },
        { id: 'f', role: 'footer', rows: [{ id: 'fr', blocks: [b('y', 'true'), b('n', 'false')] }] },
      ],
    }
    const r = convertButtons(d, 'yesno', counter())
    expect(r.document.sections[0]!.rows[0]!.blocks.map((x) => x.id)).toEqual(['a'])
    expect(r.document.sections[1]!.rows[0]!.blocks.map((x) => x.id)).toEqual(['y', 'n'])
    expect(r.document.sections).toHaveLength(2)
  })

  it('adds a Continue button in a new footer when there are none', () => {
    const d = doc({ id: 't', type: 'text', text: 'hi' } as unknown as Block)
    const r = convertButtons(d, 'continue', counter())
    const footer = r.document.sections[1]!
    expect(footer).toEqual({
      id: 'n1',
      role: 'footer',
      rows: [
        { id: 'n2', blocks: [{ id: 'n3', type: 'button', job: 'continue', label: '', outputValue: 'continue', emphasis: 'primary' }] },
      ],
    })
    expect(r.changes).toContain('Added a Continue button to the bottom bar.')
    expect(r.problems).toEqual([])
  })

  it('adds Yes then No in one footer row on a yesno step', () => {
    const r = convertButtons({ version: 2, sections: [] }, 'yesno', counter())
    expect(r.document.sections).toHaveLength(1)
    expect(r.document.sections[0]!.rows).toHaveLength(1)
    expect(buttons(r.document).map((x) => x.job)).toEqual(['yes', 'no'])
    expect(r.problems).toEqual([])
  })

  it('appends missing buttons as a new row of an existing footer', () => {
    const footer: Section = { id: 'f', role: 'footer', rows: [{ id: 'fr', blocks: [b('t', 'true')] }] }
    const r = convertButtons({ version: 2, sections: [footer] }, 'yesno', counter())
    expect(r.document.sections).toHaveLength(1)
    expect(r.document.sections[0]!.rows).toHaveLength(2)
    expect(r.document.sections[0]!.rows[1]!.blocks.map((x) => (x as ButtonBlock).job)).toEqual(['no'])
    expect(r.document.sections[0]!.rows[1]!.id).toBe('n1')
    expect(r.problems).toEqual([])
  })

  it('is idempotent', () => {
    const first = convertButtons(doc(b('a', 'true', 'Yes')), 'yesno', counter())
    const second = convertButtons(first.document, 'yesno', counter())
    expect(second.changed).toBe(false)
    expect(second.document).toBe(first.document)
    expect(second.changes).toEqual([])
  })
})
