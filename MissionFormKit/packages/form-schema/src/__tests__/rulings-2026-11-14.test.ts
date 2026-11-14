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
// User rulings 2026-11-14 (FormKit spec Appendix X): schema side.
import { describe, it, expect } from 'vitest'
import type { Block, FormDocument } from '../types'
import { computeValidation } from '../validation'
import { validateFormDocument } from '../validate'
import { checkJoblessButtons, findDuplicateOptionValues, findHiddenRequired } from '../authoring-checks'
import * as entry from '../index'

function docWith(blocks: Block[]): FormDocument {
  return { version: 2, sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }] }
}
const NONE = new Set<string>()

describe('X.9 / X.14 spaces only is an empty answer', () => {
  it('a required text field of only spaces is missing', () => {
    const d = docWith([{ id: 't', type: 'textInput', fieldName: 'who', required: true }])
    expect(computeValidation(d, { who: '   ' }, NONE)).toEqual({ ok: false, missing: ['who'] })
    expect(computeValidation(d, { who: ' a ' }, NONE)).toEqual({ ok: true, missing: [] })
  })

  it('a required textarea of only spaces and newlines is missing', () => {
    const d = docWith([{ id: 't', type: 'textarea', fieldName: 'notes', required: true }])
    expect(computeValidation(d, { notes: ' \n\t ' }, NONE).ok).toBe(false)
  })

  it('an optional number field of only spaces no longer blocks', () => {
    const d = docWith([{ id: 'n', type: 'textInput', fieldName: 'qty', inputMode: 'number' }])
    expect(computeValidation(d, { qty: '   ' }, NONE)).toEqual({ ok: true, missing: [] })
    expect(computeValidation(d, { qty: '1.' }, NONE)).toEqual({ ok: true, missing: [] })
    expect(computeValidation(d, { qty: '-' }, NONE)).toEqual({ ok: false, missing: ['qty'] })
  })

  it('a required number field of only spaces is missing as empty', () => {
    const d = docWith([{ id: 'n', type: 'textInput', fieldName: 'qty', inputMode: 'number', required: true }])
    expect(computeValidation(d, { qty: '  ' }, NONE)).toEqual({ ok: false, missing: ['qty'] })
  })
})

describe('N2 order 0 is valid', () => {
  it('accepts 0 on every screen type and still refuses 13 and -1', () => {
    const at = (order: object) => validateFormDocument(docWith([{ id: 'x', type: 'text', content: 'x', layout: { order } } as Block]))
    expect(at({ base: 0, tablet: 2 }).ok).toBe(true)
    expect(at({ base: 3, phone: 0 }).ok).toBe(true)
    expect(at({ base: 13 }).ok).toBe(false)
    expect(at({ base: -1 }).ok).toBe(false)
  })
})

describe('X.6 findHiddenRequired', () => {
  it('reports a required field or blockDone timer hidden on a screen type, naming the screens', () => {
    const d = docWith([
      { id: 'a', type: 'textInput', fieldName: 'lot', label: 'Lot', required: true, layout: { visible: { base: true, phone: false } } },
      { id: 'b', type: 'timer', label: 'Cure', fieldName: 'cure', durationSeconds: 5, direction: 'countdown', blockDone: true, layout: { visible: { base: false } } },
      { id: 'c', type: 'textInput', fieldName: 'opt', layout: { visible: { base: false } } },
      { id: 'd', type: 'timer', label: 'Info', fieldName: 'info', durationSeconds: 5, direction: 'countup', layout: { visible: { base: false } } },
      { id: 'e', type: 'checkbox', fieldName: 'ok', required: true, options: [] },
    ])
    expect(findHiddenRequired(d)).toEqual([
      { blockId: 'a', message: '"Lot" is required but is hidden on Phone — show it there or make it optional.' },
      { blockId: 'b', message: '"Cure" must finish before the step completes but is hidden on Desktop and Tablet and Phone — show it there or make it optional.' },
    ])
  })
})

describe('X.10 findDuplicateOptionValues', () => {
  it('reports each repeated value once per block; input-sourced lists are skipped', () => {
    const d = docWith([
      { id: 'r', type: 'radio', fieldName: 'size', label: 'Size', options: [{ label: 'S', value: 's' }, { label: 'Small', value: 's' }, { label: 'S again', value: 's' }] },
      { id: 'c', type: 'checkbox', fieldName: 'opts', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
      { id: 'd', type: 'textInput', fieldName: 'pick', inputMode: 'dropdown', listItems: [{ label: 'X', value: 'x' }, { label: 'X2', value: 'x' }] },
      { id: 'i', type: 'radio', fieldName: 'in', options: [{ label: 'Q', value: 'q' }, { label: 'Q', value: 'q' }], listSource: { mode: 'input', value: 'list' } },
    ])
    expect(findDuplicateOptionValues(d)).toEqual([
      { blockId: 'r', message: '"Size" has more than one option with the value "s" — each option needs its own value.' },
      { blockId: 'd', message: '"pick" has more than one option with the value "x" — each option needs its own value.' },
    ])
  })
})

describe('X.7 checkJoblessButtons', () => {
  const d = docWith([
    { id: 'y', type: 'button', label: 'Yes', outputValue: 'true' },
    { id: 'n', type: 'button', label: '', outputValue: 'false' },
    { id: 'j', type: 'button', label: 'Hold', outputValue: 'hold', job: 'no' },
    { id: 'p', type: 'button', label: 'Approve', outputValue: 'approve' },
    { id: 'q', type: 'button', label: '', outputValue: 'maybe' },
  ])

  it('on a Yes/No step reports job-less buttons that are not true/false', () => {
    expect(checkJoblessButtons(d, 'yesno')).toEqual([
      { blockId: 'p', message: 'Button "Approve" needs a job — pick Yes or No.' },
      { blockId: 'q', message: 'Button "maybe" needs a job — pick Yes or No.' },
    ])
  })

  it('reports nothing on a Continue step', () => {
    expect(checkJoblessButtons(d, 'continue')).toEqual([])
  })
})

it('the checks are exported from the package entry', () => {
  expect(entry.findHiddenRequired).toBe(findHiddenRequired)
  expect(entry.findDuplicateOptionValues).toBe(findDuplicateOptionValues)
  expect(entry.checkJoblessButtons).toBe(checkJoblessButtons)
})
