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
 * Verifies the workflow-level TRY fallback (spec 2026-08-22):
 *  - workflow-level `workflowTrySpecifications` exports as `try_specifications`
 *    on the root spec, on children, and round-trips through import.
 *  - the standing silent-drop bug — step-level `try_specifications` only ever
 *    emitted for actionProxyWait, even though scriptStep/userInteractionStep/
 *    yesNoStep/workflowProxy can all carry trySpecifications in the UI — is fixed
 *    for all TRY-capable node types.
 */

import { describe, it, expect } from 'vitest'
import { exportWorkflow } from '../workflow-exporters'
import { importWorkflow, importWorkflowSpecToInternal } from '../../import/workflow-importers'
import type { WorkflowNode, StepNodeData } from '@/types/nodes'
import type { Specification, ChildSpecification } from '@/types/library'
import type { MasterWorkflowSpecification } from '../export-types'
import type { Edge } from '@xyflow/react'
import type { ConditionalEdgeData } from '@/types/edges'

// =============================================================================
// Helpers (mirrored from try-catch-roundtrip.test.ts / try-catch-child-export.test.ts)
// =============================================================================

function makeSpec(id: string, data: Record<string, unknown> = {}): Specification {
  return {
    id,
    libraryId: 'lib',
    name: 'RT',
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data,
    history: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

function makeNode(id: string, type: StepNodeData['stepType'], extra: Partial<StepNodeData> = {}): WorkflowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      label: id,
      stepType: type,
      ...extra,
    },
  } as WorkflowNode
}

const baseNodes: WorkflowNode[] = [
  { id: 's1', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start', stepType: 'start' } } as WorkflowNode,
  { id: 's3', type: 'end', position: { x: 0, y: 160 }, data: { label: 'End', stepType: 'end' } } as WorkflowNode,
]
const baseEdges: Edge[] = []

// =============================================================================
// 1. Workflow-level export
// =============================================================================

describe('workflow-level try_specifications export', () => {
  it('exports data.workflowTrySpecifications as result.try_specifications (exportWorkflow path)', () => {
    const spec = makeSpec('wf-root', { workflowTrySpecifications: [{ mode: 'ERROR', catch_id: 'WF' }] })
    const result = exportWorkflow(spec, baseNodes, baseEdges)
    expect(result.try_specifications).toEqual([{ mode: 'ERROR', catch_id: 'WF' }])
  })

  it('omits try_specifications when workflowTrySpecifications is empty', () => {
    const spec = makeSpec('wf-root-empty', { workflowTrySpecifications: [] })
    const result = exportWorkflow(spec, baseNodes, baseEdges)
    // Matches the established pattern for sibling optional fields (catch_id, return_config,
    // action_visibility, etc.): the key is always assigned, undefined when absent, and
    // JSON.stringify drops undefined-valued keys downstream — so "no key in the wire format"
    // means "value is undefined" here, not "key absent from the JS object".
    expect(result.try_specifications).toBeUndefined()
    expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('try_specifications')
  })
})

// =============================================================================
// 2. Silent-drop fix: step-level try_specifications for all TRY-capable types
// =============================================================================

describe('step-level try_specifications silent-drop fix', () => {
  const tryRow = [{ mode: 'ERROR' as const, catch_id: 'C1' }]

  it.each([
    ['scriptStep', 'scriptStep'],
    ['userInteractionStep', 'userInteractionStep'],
    ['yesNoStep', 'yesNoStep'],
    ['workflowProxy', 'workflowProxy'],
  ])('emits try_specifications for a %s node', (_label, stepType) => {
    const node = makeNode('n1', stepType as StepNodeData['stepType'], { trySpecifications: tryRow })
    const spec = makeSpec('wf-drop')
    const result = exportWorkflow(spec, [node], baseEdges)
    const step = result.steps.find((s) => s.oid === 'n1')!
    expect(step).toBeDefined()
    expect(step.try_specifications).toEqual(tryRow)
  })
})

// =============================================================================
// 3. Workflow-level import round-trip
// =============================================================================

describe('workflow-level try_specifications import', () => {
  it('round-trips try_specifications into workflowTrySpecifications via importWorkflow', () => {
    const minimalSpec = {
      schemaVersion: '5.0',
      local_id: 'WF',
      oid: 'wf-1',
      version: '1.0.0',
      last_modified_date: new Date(0).toISOString(),
      steps: [],
      connections: [],
      try_specifications: [{ mode: 'ERROR', catch_id: 'WF' }],
    }
    const result = importWorkflow(minimalSpec)
    if ('error' in result) throw new Error(result.error)
    expect(result.workflowTrySpecifications).toEqual([{ mode: 'ERROR', catch_id: 'WF' }])
  })

  it('round-trips try_specifications into workflowTrySpecifications via importWorkflowSpecToInternal (child path)', () => {
    const minimalSpec = {
      local_id: 'Child',
      oid: 'wf-child-1',
      version: '1.0.0',
      last_modified_date: new Date(0).toISOString(),
      steps: [],
      connections: [],
      try_specifications: [{ mode: 'ABORT', catch_id: 'C2' }],
    } as unknown as MasterWorkflowSpecification
    const result = importWorkflowSpecToInternal(minimalSpec, 0)
    expect((result.data as { workflowTrySpecifications?: unknown }).workflowTrySpecifications).toEqual([
      { mode: 'ABORT', catch_id: 'C2' },
    ])
  })
})

// =============================================================================
// 4. Child export
// =============================================================================

describe('child workflow export — workflow-level try_specifications', () => {
  function makeChildSpecWithWorkflowTry(id: string, parentChildSpecId: string | null = null): ChildSpecification {
    return {
      id,
      parentSpecificationId: 'root-spec',
      parentChildSpecId,
      name: 'ChildWithWorkflowTry',
      description: null,
      data: {
        nodes: [makeNode('start-1', 'start', { label: 'START' }), makeNode('end-1', 'end', { label: 'END' })],
        edges: [{ id: 'e1', source: 'start-1', target: 'end-1' }] as Edge<ConditionalEdgeData>[],
        workflowTrySpecifications: [{ mode: 'TIMEOUT', catch_id: 'CHILD_C' }],
      },
      depth: 1,
      createdAt: 0,
      updatedAt: 0,
    }
  }

  it('emits try_specifications on the child entry', () => {
    const rootSpec = makeSpec('root-spec')
    const rootNodes = [makeNode('root-start', 'start', { label: 'START' })]
    const childSpec = makeChildSpecWithWorkflowTry('child-1')
    const result = exportWorkflow(rootSpec, rootNodes, baseEdges, undefined, [], [], undefined, [childSpec])
    const child = result.children![0]
    expect(child.try_specifications).toEqual([{ mode: 'TIMEOUT', catch_id: 'CHILD_C' }])
  })
})
