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
import { computeValidation, isNumberText, isPartialNumberText } from '../validation'
import type { FormDocument } from '../types'

function doc(): FormDocument {
  return {
    version: 2,
    sections: [
      {
        id: 's1',
        role: 'content',
        rows: [
          {
            id: 'r1',
            blocks: [
              { id: 'b1', type: 'textInput', fieldName: 'serial', required: true },
              { id: 'b2', type: 'textInput', fieldName: 'note' },
              { id: 'b3', type: 'checkbox', fieldName: 'checks', required: true, options: [{ label: 'A', value: 'a' }] },
              {
                id: 'b4',
                type: 'timer',
                label: 'Cure',
                fieldName: 'cure',
                durationSeconds: 60,
                direction: 'countdown',
                blockDone: true,
              },
            ],
          },
        ],
      },
    ],
  }
}

describe('computeValidation', () => {
  it('lists required fields with absent/empty values and blockDone timers, in document order', () => {
    const result = computeValidation(doc(), {}, new Set())
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['serial', 'checks', 'cure'])
  })

  it('empty string and empty array count as missing; optional fields never do', () => {
    const result = computeValidation(doc(), { serial: '', checks: [] }, new Set())
    expect(result.missing).toEqual(['serial', 'checks', 'cure'])
  })

  it('filled values and settled timers clear their entries', () => {
    const result = computeValidation(doc(), { serial: 'SN-1', checks: ['a'] }, new Set(['cure']))
    expect(result).toEqual({ ok: true, missing: [] })
  })

  it('a timer without blockDone never gates', () => {
    const d = doc()
    const timer = d.sections[0]!.rows[0]!.blocks[3]!
    ;(timer as { blockDone?: boolean }).blockDone = false
    const result = computeValidation(d, { serial: 'x', checks: ['a'] }, new Set())
    expect(result.ok).toBe(true)
  })

  it('an esignature block is missing until the draft has both fields, via the fourth argument', () => {
    const d = doc()
    d.sections[0]!.rows[0]!.blocks.push({ id: 'b5', type: 'esignature', fieldName: 'approval' })
    const filled = { serial: 'SN-1', checks: ['a'] }
    expect(computeValidation(d, filled, new Set(['cure'])).missing).toEqual(['approval'])
    expect(computeValidation(d, filled, new Set(['cure']), null).missing).toEqual(['approval'])
    expect(computeValidation(d, filled, new Set(['cure']), { loginName: 'jane', password: ' ' }).missing).toEqual(['approval'])
    expect(computeValidation(d, filled, new Set(['cure']), { loginName: 'jane', password: 'pw' })).toEqual({ ok: true, missing: [] })
  })

  it('a number-mode text input holding text that is not a number is missing, required or not', () => {
    const d = doc()
    d.sections[0]!.rows[0]!.blocks.push(
      { id: 'b6', type: 'textInput', fieldName: 'qty', inputMode: 'number' },
      { id: 'b7', type: 'textInput', fieldName: 'temp', inputMode: 'number', required: true },
    )
    const base = { serial: 'SN-1', checks: ['a'] }
    const settled = new Set(['cure'])
    expect(computeValidation(d, { ...base, temp: '12' }, settled)).toEqual({ ok: true, missing: [] })
    expect(computeValidation(d, { ...base, qty: 'abc', temp: '-' }, settled).missing).toEqual(['qty', 'temp'])
    expect(computeValidation(d, { ...base, qty: '', temp: '' }, settled).missing).toEqual(['temp'])
    expect(computeValidation(d, { ...base, qty: ' 3.5 ', temp: '-.5' }, settled)).toEqual({ ok: true, missing: [] })
  })
})

describe('number text', () => {
  it('isNumberText accepts complete decimals only', () => {
    for (const ok of ['0', '12', '-4', '3.', '3.25', '.5', '-0.5', ' 7 ']) expect(isNumberText(ok)).toBe(true)
    for (const bad of ['', '-', '.', '-.', '1.2.3', '12abc', 'abc', '1e5', '+1', '1,000']) expect(isNumberText(bad)).toBe(false)
  })

  it('isPartialNumberText accepts anything that can still become a number', () => {
    for (const ok of ['', '-', '.', '-.', '1.', '12']) expect(isPartialNumberText(ok)).toBe(true)
    for (const bad of ['a', '1a', '--1', '1-', '1..', '1.2.3']) expect(isPartialNumberText(bad)).toBe(false)
  })
})
