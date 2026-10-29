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
import { actionSignatureDiff, mergeActionSignature, summarizeSignatureDiff } from '@/lib/action-proxy/signature-sync'
import type { ParameterSpec } from '@/types/nodes'

const p = (id: string, name: string, over: Partial<ParameterSpec> = {}): ParameterSpec => ({ id, name, ...over })
/** ValueSpec-shaped row (ActionDetailView migrates action rows to this shape). */
const v = (id: string, name: string, description = '', value = ''): ParameterSpec => ({
  id,
  name,
  entries: [
    { id: `${id}-v`, name: 'Value', value },
    { id: `${id}-d`, name: 'Description', value: description },
  ],
})

describe('actionSignatureDiff (spec 2026-09-04 §6.2)', () => {
  it('returns null when names and descriptions match, regardless of order or row shape', () => {
    const node = { inputs: [p('a', 'temp', { description: 'Target' }), p('b', 'time')], outputs: [p('o', 'done')] }
    const action = { inputs: [v('b2', 'time'), v('a2', 'temp', 'Target')], outputs: [v('o2', 'done')] }
    expect(actionSignatureDiff(node, action)).toBeNull()
  })

  it('reports added, removed and changed by name (schema counts for inputs only)', () => {
    const node = {
      inputs: [p('a', 'temp', { description: 'old', schema: '{}' }), p('b', 'gone')],
      outputs: [p('o', 'done', { description: 'x' })],
    }
    const action = {
      inputs: [p('a', 'temp', { description: 'new', schema: '{}' }), p('c', 'added')],
      outputs: [p('o', 'done', { description: 'x' }), p('o2', 'extra')],
    }
    expect(actionSignatureDiff(node, action)).toEqual({
      inputs: { added: ['added'], removed: ['gone'], changed: ['temp'] },
      outputs: { added: ['extra'], removed: [], changed: [] },
    })
  })

  it('a schema-only change on an input is a change; on an output it is not', () => {
    expect(
      actionSignatureDiff({ inputs: [p('a', 'x', { schema: '1' })] }, { inputs: [p('a', 'x', { schema: '2' })] })
        ?.inputs.changed,
    ).toEqual(['x'])
    expect(
      actionSignatureDiff({ outputs: [p('a', 'x', { schema: '1' })] }, { outputs: [p('a', 'x', { schema: '2' })] }),
    ).toBeNull()
  })

  it('ignores unnamed rows and treats missing arrays as empty', () => {
    expect(actionSignatureDiff({ inputs: [p('a', '')] }, {})).toBeNull()
    expect(actionSignatureDiff({}, { outputs: [p('o', 'done')] })?.outputs.added).toEqual(['done'])
  })
})

describe('mergeActionSignature (D8)', () => {
  it("takes the action's rows, order and ids; keeps the node's value/valueType (inputs) and target (outputs) by name; drops rows the action lost", () => {
    const node = {
      inputs: [p('n1', 'temp', { value: '180', valueType: 'property' }), p('n2', 'gone', { value: 'x' })],
      outputs: [p('n3', 'done', { target: 'Oven.Done' })],
    }
    const action = {
      inputs: [p('a2', 'time', { description: 'Minutes' }), p('a1', 'temp', { description: 'Target' })],
      outputs: [p('a3', 'done', { description: 'Flag' }), p('a4', 'temp_reached')],
    }
    expect(mergeActionSignature(node, action)).toEqual({
      inputs: [
        p('a2', 'time', { description: 'Minutes' }),
        p('a1', 'temp', { description: 'Target', value: '180', valueType: 'property' }),
      ],
      outputs: [p('a3', 'done', { description: 'Flag', target: 'Oven.Done' }), p('a4', 'temp_reached')],
    })
  })

  it('does not mutate the action rows and clones entries', () => {
    const action = { inputs: [v('a', 'temp', 'Target')], outputs: [] }
    const merged = mergeActionSignature({ inputs: [p('n', 'temp', { value: '1' })] }, action)
    expect(merged.inputs[0]).not.toBe(action.inputs[0])
    expect(merged.inputs[0].entries).not.toBe(action.inputs[0].entries)
    expect(action.inputs[0]).not.toHaveProperty('value')
  })
})

describe('summarizeSignatureDiff', () => {
  it('omits zero terms and empty sides; uses U+2212 for removed and ~ for changed', () => {
    expect(
      summarizeSignatureDiff({
        inputs: { added: ['a', 'b'], removed: ['c'], changed: ['d'] },
        outputs: { added: ['e'], removed: [], changed: [] },
      }),
    ).toBe('Inputs: +2 −1 ~1 · Outputs: +1')
    expect(
      summarizeSignatureDiff({
        inputs: { added: [], removed: [], changed: [] },
        outputs: { added: [], removed: ['x'], changed: [] },
      }),
    ).toBe('Outputs: −1')
  })
})
