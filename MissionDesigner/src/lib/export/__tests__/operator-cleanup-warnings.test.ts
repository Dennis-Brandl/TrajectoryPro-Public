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
import { collectOperatorCleanupWarnings, formatOperatorCleanupWarnings } from '../operator-cleanup-warnings'
import type { WorkflowNode } from '@/types/nodes'

const n = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const e = (source: string, target: string) => ({ id: `${source}-${target}`, source, target }) as Edge

function network(returnCommand: string, extra: WorkflowNode[] = []) {
  return {
    nodes: [
      n('c', 'catch', { catchId: 'C1' }),
      ...extra,
      n('r', 'return', { label: 'Done', returnConfig: { command: returnCommand } }),
    ],
    edges: [e('c', 'r'), ...extra.map((x) => e('c', x.id))],
  }
}

const remote = () =>
  n('dw', 'actionProxyWait', { label: 'Remote', actionProxyConfig: { environment_oid: 'broker-env' } })

describe('collectOperatorCleanupWarnings', () => {
  it('warns on non-ABANDON RETURN in an Operator cleanup', () => {
    const { nodes, edges } = network('RETRY')
    expect(collectOperatorCleanupWarnings(nodes, edges, [{ mode: 'OPERATOR_STOP', catch_id: 'C1' }])).toEqual([
      'RETURN "Done" is in the Operator Stop cleanup; its RETRY command is treated as finish.',
    ])
  })
  it('uses the Operator Abort label', () => {
    const { nodes, edges } = network('GOTO')
    expect(collectOperatorCleanupWarnings(nodes, edges, [{ mode: 'OPERATOR_ABORT', catch_id: 'C1' }])[0]).toContain(
      'Operator Abort cleanup',
    )
  })
  it('no warning for ABANDON', () => {
    const { nodes, edges } = network('ABANDON')
    expect(collectOperatorCleanupWarnings(nodes, edges, [{ mode: 'OPERATOR_STOP', catch_id: 'C1' }])).toEqual([])
  })
  it('warns on a broker-env step in an Operator cleanup', () => {
    const { nodes, edges } = network('ABANDON', [remote()])
    expect(collectOperatorCleanupWarnings(nodes, edges, [{ mode: 'OPERATOR_ABORT', catch_id: 'C1' }])).toEqual([
      '"Remote" is a Distributed Workflow action; these are not supported in an Operator Abort cleanup.',
    ])
  })
  it('no warning for an ERROR-mode CATCH network', () => {
    const { nodes, edges } = network('RETRY', [remote()])
    expect(collectOperatorCleanupWarnings(nodes, edges, [{ mode: 'ERROR', catch_id: 'C1' }])).toEqual([])
  })
})

describe('formatOperatorCleanupWarnings', () => {
  it('joins warnings with a UTF-8 middle dot separator', () => {
    const msg = formatOperatorCleanupWarnings(['a', 'b'])
    expect(msg).toBe('Operator cleanup: a · b')
    expect(msg).not.toContain('�')
  })
})
