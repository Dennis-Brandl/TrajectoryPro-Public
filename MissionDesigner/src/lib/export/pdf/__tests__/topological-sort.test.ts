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
import { topologicalSort } from '../topological-sort'
import type { WorkflowNode } from '@/types/nodes'
import type { Edge } from '@xyflow/react'

function makeNode(id: string, type: string): WorkflowNode {
  return {
    id,
    type: type as WorkflowNode['type'],
    position: { x: 0, y: 0 },
    data: {
      label: id,
      stepType: type as WorkflowNode['data']['stepType'],
    },
  } as WorkflowNode
}

function makeEdge(source: string, target: string): Edge {
  return {
    id: `${source}->${target}`,
    source,
    target,
  }
}

describe('topologicalSort', () => {
  it('returns [] for empty input', () => {
    expect(topologicalSort([], [])).toEqual([])
  })

  it('orders a linear chain: start -> a -> b -> end', () => {
    const nodes = [
      makeNode('end', 'end'),
      makeNode('b', 'actionProxyWait'),
      makeNode('a', 'actionProxyWait'),
      makeNode('start', 'start'),
    ]
    const edges = [makeEdge('start', 'a'), makeEdge('a', 'b'), makeEdge('b', 'end')]

    const result = topologicalSort(nodes, edges)
    const ids = result.map((n) => n.id)

    expect(ids[0]).toBe('start')
    expect(ids[1]).toBe('a')
    expect(ids[2]).toBe('b')
    expect(ids[3]).toBe('end')
  })

  it('handles parallel branches: start -> parallel -> left/right -> waitAll -> end', () => {
    const nodes = [
      makeNode('start', 'start'),
      makeNode('parallel', 'parallel'),
      makeNode('left', 'actionProxyWait'),
      makeNode('right', 'actionProxyWait'),
      makeNode('waitAll', 'waitAll'),
      makeNode('end', 'end'),
    ]
    const edges = [
      makeEdge('start', 'parallel'),
      makeEdge('parallel', 'left'),
      makeEdge('parallel', 'right'),
      makeEdge('left', 'waitAll'),
      makeEdge('right', 'waitAll'),
      makeEdge('waitAll', 'end'),
    ]

    const result = topologicalSort(nodes, edges)
    const ids = result.map((n) => n.id)

    // start must come first, end must come last
    expect(ids[0]).toBe('start')
    expect(ids[ids.length - 1]).toBe('end')

    // parallel must come before left and right
    expect(ids.indexOf('parallel')).toBeLessThan(ids.indexOf('left'))
    expect(ids.indexOf('parallel')).toBeLessThan(ids.indexOf('right'))

    // left and right must come before waitAll
    expect(ids.indexOf('left')).toBeLessThan(ids.indexOf('waitAll'))
    expect(ids.indexOf('right')).toBeLessThan(ids.indexOf('waitAll'))

    // all 6 nodes present
    expect(result).toHaveLength(6)
  })

  it('falls back to zero-in-degree nodes when no START node is present', () => {
    const nodes = [makeNode('a', 'actionProxyWait'), makeNode('b', 'actionProxyWait'), makeNode('c', 'end')]
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')]

    const result = topologicalSort(nodes, edges)
    const ids = result.map((n) => n.id)

    expect(ids[0]).toBe('a')
    expect(ids[1]).toBe('b')
    expect(ids[2]).toBe('c')
    expect(result).toHaveLength(3)
  })
})
