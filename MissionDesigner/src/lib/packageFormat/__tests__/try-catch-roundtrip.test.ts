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
import { exportWorkflow } from '../workflow-exporters'
import { importWorkflow } from '../../import/workflow-importers'
import type { WorkflowNode } from '@/types/nodes'
import type { Specification } from '@/types/library'
import type { Edge } from '@xyflow/react'

const spec: Specification = {
  id: 'wf-rt',
  libraryId: 'lib',
  name: 'RT',
  description: null,
  version: '1.0.0',
  state: 'Draft',
  data: {},
  history: [],
  createdAt: 0,
  updatedAt: 0,
}

const nodes = [
  { id: 's1', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start', stepType: 'start' } },
  {
    id: 's2',
    type: 'actionProxyWait',
    position: { x: 0, y: 80 },
    data: {
      label: 'Action',
      stepType: 'actionProxyWait',
      actionProxyConfig: { action_oid: 'act-1', environment_oid: 'env-1' },
      trySpecifications: [{ mode: 'ERROR', catch_id: 'C1', release_on_catch: true }],
    },
  },
  { id: 's3', type: 'end', position: { x: 0, y: 160 }, data: { label: 'End', stepType: 'end' } },
  {
    id: 'c1',
    type: 'catch',
    position: { x: 200, y: 0 },
    data: { label: 'Recover', stepType: 'catch', catchId: 'C1' },
  },
  {
    id: 'r1',
    type: 'return',
    position: { x: 200, y: 80 },
    data: { label: 'Done', stepType: 'return', returnConfig: { command: 'ABANDON' } },
  },
] as unknown as WorkflowNode[]

const edges = [
  { id: 'e1', source: 's1', target: 's2' },
  { id: 'e2', source: 's2', target: 's3' },
  { id: 'e3', source: 'c1', target: 'r1' },
] as unknown as Edge[]

describe('TRY/CATCH/RETURN export → import round-trip', () => {
  it('preserves trySpecifications, catchId, returnConfig', () => {
    const exported = exportWorkflow(spec, nodes, edges)
    const result = importWorkflow(exported)
    if ('error' in result) throw new Error(result.error)
    const find = (id: string) => result.nodes.find((n) => n.id === id)!
    expect((find('s2').data as { trySpecifications?: unknown }).trySpecifications).toEqual([
      { mode: 'ERROR', catch_id: 'C1', release_on_catch: true },
    ])
    expect((find('c1').data as { catchId?: string }).catchId).toBe('C1')
    expect((find('r1').data as { returnConfig?: unknown }).returnConfig).toEqual({ command: 'ABANDON' })
  })
})
