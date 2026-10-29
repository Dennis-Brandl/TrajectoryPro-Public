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
import type { Edge } from '@xyflow/react'
import type { WorkflowNode } from '@/types/nodes'
import { validateWorkflow, scriptInputNameProblem } from '@/lib/export/workflow-validation'

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edges: Edge[] = [
  { id: 'e1', source: 's', target: 'st' },
  { id: 'e2', source: 'st', target: 'e' },
]
const inputs = (...names: string[]) =>
  names.map((name, i) => ({ id: `p${i}`, name, value: 'Tank.Level', valueType: 'property' }))
const messagesFor = (type: string, data: Record<string, unknown>) =>
  validateWorkflow([node('s', 'start'), node('st', type, data), node('e', 'end')], edges)
    .filter((e) => e.nodeId === 'st')
    .map((e) => e.message)

describe('Script and Gate input names must be script variable names', () => {
  it('accepts ordinary names, including non-English letters, _ and $', () => {
    for (const name of ['level', 'tankLevel2', '_raw', '$v', 'température', 'let', 'await']) {
      expect(scriptInputNameProblem(name)).toBeNull()
    }
  })
  it('rejects names with spaces, dashes or dots, a leading digit, or a blank name', () => {
    for (const name of ['my-in', 'tank level', 'Tank.Level', '2nd', '']) {
      expect(scriptInputNameProblem(name)).toMatch(/is not a valid script variable name/)
    }
  })
  it('rejects reserved words', () => {
    expect(scriptInputNameProblem('class')).toBe('Input parameter "class" is a reserved JavaScript word; rename it')
    expect(scriptInputNameProblem('new')).toMatch(/reserved/)
  })
  it('flags each bad input on a Script step', () => {
    expect(
      messagesFor('scriptStep', { scriptSource: 'output.x = 1;', inputs: inputs('ok', 'my-in', 'class') }),
    ).toEqual([
      'Input parameter "my-in" is not a valid script variable name: use letters, digits, _ or $, and do not start with a digit',
      'Input parameter "class" is a reserved JavaScript word; rename it',
    ])
  })
  it('flags bad inputs on condition gates, but not on a timer-only gate', () => {
    expect(messagesFor('gateStep', { inputs: inputs('my-in') })).toHaveLength(1)
    expect(
      messagesFor('gateStep', { gateMode: 'condition_or_timer', gateDelay: { minutes: 1 }, inputs: inputs('my-in') }),
    ).toHaveLength(1)
    expect(messagesFor('gateStep', { gateMode: 'timer', gateDelay: { minutes: 1 }, inputs: inputs('my-in') })).toEqual(
      [],
    )
  })
  it('does not check inputs on other step types', () => {
    expect(messagesFor('userInteractionStep', { inputs: inputs('my-in') })).toEqual([])
  })
})
