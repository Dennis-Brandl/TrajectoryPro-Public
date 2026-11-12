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
import { validateWorkflow } from '@/lib/export/workflow-validation'
import { collectFixedBarWarnings } from '@/lib/export/fixed-bar-checks'

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const chain = (...ids: string[]): Edge[] => ids.slice(1).map((t, i) => ({ id: 'e' + i, source: ids[i], target: t }))

describe('fixed bar export checks', () => {
  const routed = (condition: string, data: Record<string, unknown> = {}) => {
    const edges: Edge[] = [
      { id: 'e0', source: 's', target: 'u' },
      { id: 'e1', source: 'u', target: 'e', data: { condition } },
    ]
    const nodes = [node('s', 'start'), node('u', 'userInteractionStep', { buttonBar: {}, ...data }), node('e', 'end')]
    return validateWorkflow(nodes, edges).filter((e) => e.nodeId === 'u')
  }
  const routedMessage = (c: string) =>
    `This step routed on which button was pressed ("${c}"). Make it a Yes/No step or add a decision step after it.`

  it('export blocks a fixed UI step whose connection has a condition, with no stored marker', () => {
    const errors = routed('left')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe(routedMessage('left'))
  })

  it('blocks whatever the case of the condition (the engine matches case-insensitively)', () => {
    const errors = routed('Left', { routingProblem: 'This step routed on which button', routingValues: ['left'] })
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe(routedMessage('Left'))
  })

  it('passes once the condition is removed', () => {
    expect(routed('', { routingProblem: 'This step routed on which button', routingValues: ['left'] })).toEqual([])
    expect(routed('   ')).toEqual([])
  })

  it('a legacy UI step (no buttonBar) may still route on a condition', () => {
    const edges: Edge[] = [
      { id: 'e0', source: 's', target: 'u' },
      { id: 'e1', source: 'u', target: 'e', data: { condition: 'left' } },
    ]
    const nodes = [node('s', 'start'), node('u', 'userInteractionStep'), node('e', 'end')]
    expect(validateWorkflow(nodes, edges).filter((e) => e.message.includes('routed on which button'))).toEqual([])
  })

  it('a fixed Yes/No step is unaffected by conditions on its connections', () => {
    const edges: Edge[] = [
      { id: 'e0', source: 's', target: 'y' },
      { id: 'e1', source: 'y', target: 'e', sourceHandle: 'yes', data: { condition: 'Yes' } },
      { id: 'e2', source: 'y', target: 'e', sourceHandle: 'no', data: { condition: 'maybe' } },
    ]
    const nodes = [node('s', 'start'), node('y', 'yesNoStep', { buttonBar: {} }), node('e', 'end')]
    expect(validateWorkflow(nodes, edges).filter((e) => e.nodeId === 'y')).toEqual([])
  })

  it('a step without a routing problem passes', () => {
    const errors = validateWorkflow(
      [node('s', 'start'), node('u', 'userInteractionStep', { buttonBar: {} }), node('e', 'end')],
      chain('s', 'u', 'e'),
    )
    expect(errors).toEqual([])
  })

  it('warns when Back can never be available', () => {
    const w = collectFixedBarWarnings(
      [node('s', 'start'), node('a', 'userInteractionStep', { buttonBar: {}, allowBack: true }), node('e', 'end')],
      chain('s', 'a', 'e'),
    )
    expect(w).toEqual(['a: Back will never be available here'])
  })

  it('does not warn when a screen step is upstream', () => {
    const w = collectFixedBarWarnings(
      [
        node('s', 'start'),
        node('a', 'userInteractionStep', { buttonBar: {} }),
        node('b', 'userInteractionStep', { buttonBar: {}, allowBack: true }),
        node('e', 'end'),
      ],
      chain('s', 'a', 'b', 'e'),
    )
    expect(w).toEqual([])
  })

  it('warns when Back passes a resource step', () => {
    const w = collectFixedBarWarnings(
      [
        node('s', 'start'),
        node('a', 'userInteractionStep', { buttonBar: {} }),
        node('r', 'scriptStep', {
          resourceCommands: [{ id: 'c', resourceName: 'Oven', commandType: 'Acquire', count: 1 }],
        }),
        node('b', 'userInteractionStep', { buttonBar: {}, allowBack: true }),
        node('e', 'end'),
      ],
      chain('s', 'a', 'r', 'b', 'e'),
    )
    expect(w).toEqual(['b: Going back here acquires «Oven» again when the operator moves forward'])
  })

  it('says releases for a Release command', () => {
    const w = collectFixedBarWarnings(
      [
        node('s', 'start'),
        node('a', 'userInteractionStep', { buttonBar: {} }),
        node('r', 'scriptStep', {
          resourceCommands: [{ id: 'c', resourceName: 'Oven', commandType: 'Release', count: 1 }],
        }),
        node('b', 'userInteractionStep', { buttonBar: {}, allowBack: true }),
      ],
      chain('s', 'a', 'r', 'b'),
    )
    expect(w[0]).toBe('b: Going back here releases «Oven» again when the operator moves forward')
  })

  it.each(['parallel', 'waitAll', 'waitAny', 'workflowProxy'])('Back stops at a %s barrier', (barrier) => {
    const w = collectFixedBarWarnings(
      [
        node('s', 'start'),
        node('a', 'userInteractionStep', { buttonBar: {} }),
        node('p', barrier),
        node('b', 'userInteractionStep', { buttonBar: {}, allowBack: true }),
      ],
      chain('s', 'a', 'p', 'b'),
    )
    expect(w).toEqual(['b: Back will never be available here'])
  })

  it('ignores resource steps on paths that end at a barrier', () => {
    const acq = { resourceCommands: [{ id: 'c', resourceName: 'Oven', commandType: 'Acquire', count: 1 }] }
    const w = collectFixedBarWarnings(
      [
        node('s', 'start'),
        node('a', 'userInteractionStep', { buttonBar: {} }),
        node('x', 'scriptStep', {}),
        node('p', 'parallel'),
        node('r', 'scriptStep', acq),
        node('b', 'userInteractionStep', { buttonBar: {}, allowBack: true }),
      ],
      [...chain('s', 'a', 'x', 'b'), ...chain('s', 'p', 'r', 'b')],
    )
    expect(w).toEqual([])
  })
})
