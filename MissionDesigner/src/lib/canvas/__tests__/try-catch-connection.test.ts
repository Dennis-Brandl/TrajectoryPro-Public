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
import { isTryCatchConnectionValid } from '../try-catch-connection'
import type { WorkflowNode } from '@/types/nodes'

const nodes = [
  { id: 's1', type: 'start', data: { label: 'S', stepType: 'start' }, position: { x: 0, y: 0 } },
  { id: 's2', type: 'end', data: { label: 'E', stepType: 'end' }, position: { x: 0, y: 0 } },
  { id: 'c1', type: 'catch', data: { label: 'C', stepType: 'catch', catchId: 'C1' }, position: { x: 0, y: 0 } },
  {
    id: 'r1',
    type: 'return',
    data: { label: 'R', stepType: 'return', returnConfig: { command: 'ABANDON' } },
    position: { x: 0, y: 0 },
  },
] as unknown as WorkflowNode[]
const edges = [
  { id: 'e1', source: 's1', target: 's2' },
  { id: 'e2', source: 'c1', target: 'r1' },
]

describe('isTryCatchConnectionValid', () => {
  it('rejects incoming to CATCH', () =>
    expect(isTryCatchConnectionValid({ source: 's1', target: 'c1' }, nodes, edges)).toBe(false))
  it('rejects outgoing from RETURN', () =>
    expect(isTryCatchConnectionValid({ source: 'r1', target: 's2' }, nodes, edges)).toBe(false))
  it('rejects cross-network edge', () =>
    expect(isTryCatchConnectionValid({ source: 's2', target: 'r1' }, nodes, edges)).toBe(false))
  it('allows a main-flow edge', () =>
    expect(isTryCatchConnectionValid({ source: 's1', target: 's2' }, nodes, edges)).toBe(true))
  it('allows an in-catch edge', () =>
    expect(isTryCatchConnectionValid({ source: 'c1', target: 'r1' }, nodes, edges)).toBe(true))
})

// Incremental-build scenario: a SELECT 1 lives inside a catch network (one branch
// already reaches a RETURN), and the user adds a NEW branch to a freshly-placed
// step that has no edges yet. The new step is only "main flow" because it isn't
// reachable from the CATCH *until this very edge is added* — so the rule must
// evaluate the partition WITH the proposed edge, or it wrongly blocks the branch.
const catchNetNodes = [
  { id: 'c1', type: 'catch', data: { label: 'C', stepType: 'catch', catchId: 'C1' }, position: { x: 0, y: 0 } },
  { id: 'sel', type: 'select1', data: { label: 'Sel', stepType: 'select1' }, position: { x: 0, y: 0 } },
  {
    id: 'r1',
    type: 'return',
    data: { label: 'R', stepType: 'return', returnConfig: { command: 'ABANDON' } },
    position: { x: 0, y: 0 },
  },
  { id: 'x1', type: 'actionProxyWait', data: { label: 'X', stepType: 'actionProxyWait' }, position: { x: 0, y: 0 } },
] as unknown as WorkflowNode[]
const catchNetEdges = [
  { id: 'e1', source: 'c1', target: 'sel' },
  { id: 'e2', source: 'sel', target: 'r1' },
]

describe('isTryCatchConnectionValid — extending a catch network during incremental editing', () => {
  it('allows a SELECT 1 inside a catch network to branch to a new step (the edge extends the network)', () =>
    expect(isTryCatchConnectionValid({ source: 'sel', target: 'x1' }, catchNetNodes, catchNetEdges)).toBe(true))

  it('still blocks wiring a main-flow node INTO a catch network node (true cross-network edge)', () => {
    const withMain = [
      ...catchNetNodes,
      {
        id: 'm1',
        type: 'actionProxyWait',
        data: { label: 'M', stepType: 'actionProxyWait' },
        position: { x: 0, y: 0 },
      },
    ] as unknown as WorkflowNode[]
    expect(isTryCatchConnectionValid({ source: 'm1', target: 'sel' }, withMain, catchNetEdges)).toBe(false)
  })
})
