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
import { describeSelect1Option } from '../select1-condition'
import type { StepNodeData } from '@/types/nodes'

const mk = (over: Partial<StepNodeData>): StepNodeData => ({ label: 'S', ...over }) as StepNodeData

describe('describeSelect1Option', () => {
  const opt = (o: Record<string, unknown>) => ({
    id: 'h1',
    label: '',
    operator: '==',
    value: '',
    valueType: 'literal',
    isDefault: false,
    ...o,
  })

  it.each([
    ['==', '='],
    ['!=', '≠'],
    ['<', '<'],
    ['>', '>'],
    ['<=', '≤'],
    ['>=', '≥'],
    ['Contains', '∋'],
    ['Not Contains', '∌'],
  ])('operator %s renders as %s', (operator, sym) => {
    const d = mk({ select1InputName: 'x', select1Options: [opt({ operator, value: '5', label: 'A' })] as never })
    expect(describeSelect1Option(d, 'h1')).toEqual({ kind: 'condition', text: `x ${sym} 5`, label: 'A' })
  })

  it('uses ? when input name is missing', () => {
    const d = mk({ select1Options: [opt({ value: '5' })] as never })
    expect(describeSelect1Option(d, 'h1').text).toBe('? = 5')
  })

  it('default option', () => {
    const d = mk({ select1Options: [opt({ isDefault: true })] as never })
    expect(describeSelect1Option(d, 'h1')).toEqual({ kind: 'default', text: '[default]', label: '' })
    const d2 = mk({ select1Options: [opt({ isDefault: true, label: 'Else' })] as never })
    expect(describeSelect1Option(d2, 'h1')).toEqual({ kind: 'default', text: 'Else', label: 'Else' })
  })

  it('unconfigured option uses label or 1-based index', () => {
    const d = mk({ select1Options: [opt({ id: 'a' }), opt({ id: 'b', value: '  ' })] as never })
    expect(describeSelect1Option(d, 'b')).toEqual({ kind: 'unconfigured', text: '2', label: '' })
    const d2 = mk({ select1Options: [opt({ label: 'Low' })] as never })
    expect(describeSelect1Option(d2, 'h1')).toEqual({ kind: 'unconfigured', text: 'Low', label: 'Low' })
  })

  it('missing when no option matches', () => {
    const d = mk({ select1Options: [opt({})] as never })
    expect(describeSelect1Option(d, 'zzz')).toEqual({ kind: 'missing', text: '', label: '' })
    expect(describeSelect1Option(d, null).kind).toBe('missing')
    expect(describeSelect1Option(mk({}), 'h1').kind).toBe('missing')
  })

  it('keeps property valueType display text unchanged', () => {
    const d = mk({ select1InputName: 'x', select1Options: [opt({ value: 'limit', valueType: 'property' })] as never })
    expect(describeSelect1Option(d, 'h1').text).toBe('x = limit')
  })
})
