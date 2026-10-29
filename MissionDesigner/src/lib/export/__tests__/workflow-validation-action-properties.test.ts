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
import type { Specification } from '@/types/library'
import { validateWorkflowWithChildren } from '@/lib/export/workflow-validation'

/** Spec 2026-09-04 §5.3 (VERIFY item): an input sourced from an environment Action Property is a
 *  known reference — for the workflow's own environments and for a parent's.
 *
 *  VERIFY finding: `validateWorkflowWithChildren(parentNodes, parentEdges, parentSpecId: string,
 *  allSpecs, parentWorkflowTrySpecs?)` takes the parent SPEC ID, not an inline data object — see
 *  `workflow-validation-action-refs.test.ts`. Each workflow under test is built as a `Specification`
 *  (with its `data` holding nodes/edges/environmentSpecIds/parentSpecificationId) and passed by id,
 *  alongside the env/parent specs, in `allSpecs`. */

function makeSpec(over: Partial<Specification> & { id: string; data: Record<string, unknown> }): Specification {
  return {
    libraryId: 'L1',
    name: over.id,
    description: null,
    version: '1.0.0',
    state: 'Draft',
    history: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as Specification
}

function scriptNode(source: string): WorkflowNode {
  return {
    id: 'sc',
    type: 'scriptStep',
    position: { x: 0, y: 0 },
    data: {
      label: 'Script',
      stepType: 'scriptStep',
      inputs: [{ id: 'i1', name: 'level', valueType: 'property', value: source }],
    },
  } as unknown as WorkflowNode
}

const nodes = (mid: WorkflowNode): WorkflowNode[] => [
  { id: 's', type: 'start', position: { x: 0, y: 0 }, data: { label: 'START', stepType: 'start' } } as WorkflowNode,
  mid,
  { id: 'e', type: 'end', position: { x: 0, y: 0 }, data: { label: 'END', stepType: 'end' } } as WorkflowNode,
]
const edges: Edge[] = [
  { id: 'e1', source: 's', target: 'sc', type: 'default' } as Edge,
  { id: 'e2', source: 'sc', target: 'e', type: 'default' } as Edge,
]
const env = makeSpec({
  id: 'env-1',
  data: { actionProperties: [{ id: 'ap', name: 'Sensor', entries: [{ id: 'x', name: 'Value', value: '' }] }] },
})
const sourceErrors = (r: ReturnType<typeof validateWorkflowWithChildren>) =>
  r.filter((e) => /source ".*" does not resolve/.test(e.message))

describe('Action Property sources in export validation', () => {
  it('accepts Group and Group.Entry from an attached environment', () => {
    for (const src of ['Sensor', 'Sensor.Value']) {
      const wfSpec = makeSpec({
        id: 'wf-1',
        data: { environmentSpecIds: ['env-1'], nodes: nodes(scriptNode(src)), edges },
      })
      const r = validateWorkflowWithChildren(
        wfSpec.data.nodes as WorkflowNode[],
        wfSpec.data.edges as Edge[],
        wfSpec.id,
        [wfSpec, env],
      )
      expect(sourceErrors(r)).toEqual([])
    }
  })

  it("accepts an Action Property from a parent's environment", () => {
    const parent = makeSpec({ id: 'wf-parent', data: { environmentSpecIds: ['env-1'], nodes: [], edges: [] } })
    const wfSpec = makeSpec({
      id: 'wf-child',
      data: { parentSpecificationId: 'wf-parent', nodes: nodes(scriptNode('Sensor.Value')), edges },
    })
    const r = validateWorkflowWithChildren(
      wfSpec.data.nodes as WorkflowNode[],
      wfSpec.data.edges as Edge[],
      wfSpec.id,
      [wfSpec, env, parent],
    )
    expect(sourceErrors(r)).toEqual([])
  })

  it('still rejects an unknown source', () => {
    const wfSpec = makeSpec({
      id: 'wf-1',
      data: { environmentSpecIds: ['env-1'], nodes: nodes(scriptNode('Nope.Value')), edges },
    })
    const r = validateWorkflowWithChildren(
      wfSpec.data.nodes as WorkflowNode[],
      wfSpec.data.edges as Edge[],
      wfSpec.id,
      [wfSpec, env],
    )
    expect(sourceErrors(r)).toHaveLength(1)
  })
})
