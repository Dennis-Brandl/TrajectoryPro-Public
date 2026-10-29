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

/**
 * signature-diff.test.ts — the pure comparison behind the import's
 * "signature changed" flag. Only parameter ids and value types count;
 * defaults, descriptions and output target wiring are not part of the
 * signature the author's code depends on.
 */
import { describe, it, expect } from 'vitest'
import { diffSignature } from '../lib/signature-diff.js'

const inputs = (...specs: Array<Record<string, unknown>>) => specs
const count = { id: 'count', value_type: 'integer', default_value: '1', description: 'n' }
const unit = { id: 'unit', value_type: 'string', default_value: '', description: null }
const result = {
  id: 'result',
  value_type: 'string',
  default_value: '',
  target_property_name: null,
  target_entry_name: null,
  description: null,
}

describe('diffSignature', () => {
  it('returns no changes for identical signatures', () => {
    expect(diffSignature(inputs(count), inputs(result), inputs(count), inputs(result))).toEqual([])
  })

  it('ignores defaults, descriptions and output target wiring', () => {
    const next = [{ ...count, default_value: '99', description: 'changed' }]
    const nextOut = [{ ...result, target_property_name: 'Prop', target_entry_name: 'E' }]
    expect(diffSignature([count], [result], next, nextOut)).toEqual([])
  })

  it('reports added and removed inputs and outputs', () => {
    expect(diffSignature([count], [result], [count, unit], [])).toEqual([
      'input `unit` added (string)',
      'output `result` removed',
    ])
  })

  it('reports a value type change', () => {
    expect(diffSignature([count], [], [{ ...count, value_type: 'number' }], [])).toEqual([
      'input `count` type integer → number',
    ])
  })

  it('lists incoming-order additions and type changes before removals', () => {
    const prev = [count, unit]
    const next = [
      { id: 'flag', value_type: 'boolean' },
      { ...count, value_type: 'number' },
    ]
    expect(diffSignature(prev, [], next, [])).toEqual([
      'input `flag` added (boolean)',
      'input `count` type integer → number',
      'input `unit` removed',
    ])
  })

  it('tolerates malformed specs and non-array inputs', () => {
    expect(diffSignature(undefined, null, [{ nope: 1 }, 'x'], [count])).toEqual([
      'output `count` added (integer)',
    ])
  })
})
