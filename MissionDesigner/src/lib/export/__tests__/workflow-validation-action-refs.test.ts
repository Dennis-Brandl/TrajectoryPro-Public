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

/**
 * Tests for the "Action Reference" check added to the export-time workflow
 * validation: every actionProxyWait node must name an action that is exposed
 * by one of the workflow's attached environments (or by an environment
 * inherited from a parent workflow).
 */

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

function actionNode(id: string, label: string, actionLibraryName?: string, actionName?: string): WorkflowNode {
  return {
    id,
    type: 'actionProxyWait',
    position: { x: 0, y: 0 },
    data: { label, stepType: 'actionProxyWait', actionLibraryName, actionName },
  } as unknown as WorkflowNode
}

// Minimal structurally-valid scaffold (start → actionProxyWait → end) so the
// existing structural checks don't flood the result with unrelated errors.
function makeNodes(action: WorkflowNode): WorkflowNode[] {
  return [
    { id: 's', type: 'start', position: { x: 0, y: 0 }, data: { label: 'START', stepType: 'start' } } as WorkflowNode,
    action,
    { id: 'e', type: 'end', position: { x: 0, y: 0 }, data: { label: 'END', stepType: 'end' } } as WorkflowNode,
  ]
}

function makeEdges(): Edge[] {
  return [
    { id: 'e1', source: 's', target: 'act', type: 'default' } as Edge,
    { id: 'e2', source: 'act', target: 'e', type: 'default' } as Edge,
  ]
}

describe('Action Reference validation', () => {
  it('passes when actionProxyWait points at an action listed in an attached env', () => {
    const env = makeSpec({
      id: 'env-1',
      data: { included_actions: [{ action_name: 'Heat', action_library: 'Kitchen Actions' }] },
    })
    const wfSpec = makeSpec({
      id: 'wf-1',
      data: {
        environmentSpecIds: ['env-1'],
        nodes: makeNodes(actionNode('act', 'Heat', 'Kitchen Actions', 'Heat')),
        edges: makeEdges(),
      },
    })
    const errors = validateWorkflowWithChildren(
      wfSpec.data.nodes as WorkflowNode[],
      wfSpec.data.edges as Edge[],
      wfSpec.id,
      [wfSpec, env],
    )
    expect(errors.filter((e) => e.message.toLowerCase().includes('action'))).toEqual([])
  })

  it('flags actionProxyWait whose (library, name) is NOT in any attached env', () => {
    const env = makeSpec({
      id: 'env-1',
      data: { included_actions: [{ action_name: 'Heat', action_library: 'Kitchen Actions' }] },
    })
    const wfSpec = makeSpec({
      id: 'wf-1',
      data: {
        environmentSpecIds: ['env-1'],
        nodes: makeNodes(actionNode('act', 'Bake', 'Kitchen Actions', 'Bake')),
        edges: makeEdges(),
      },
    })
    const errors = validateWorkflowWithChildren(
      wfSpec.data.nodes as WorkflowNode[],
      wfSpec.data.edges as Edge[],
      wfSpec.id,
      [wfSpec, env],
    )
    const refErrors = errors.filter((e) => e.message.includes('Action reference'))
    expect(refErrors).toHaveLength(1)
    expect(refErrors[0].nodeId).toBe('act')
    expect(refErrors[0].message).toContain('"Bake"')
    expect(refErrors[0].message).toContain('"Kitchen Actions"')
  })

  it('flags actionProxyWait with no action selected at all', () => {
    const wfSpec = makeSpec({
      id: 'wf-1',
      data: {
        environmentSpecIds: [],
        nodes: makeNodes(actionNode('act', 'Unset Action')),
        edges: makeEdges(),
      },
    })
    const errors = validateWorkflowWithChildren(
      wfSpec.data.nodes as WorkflowNode[],
      wfSpec.data.edges as Edge[],
      wfSpec.id,
      [wfSpec],
    )
    const unsetErrors = errors.filter((e) => e.message.includes('no action selected'))
    expect(unsetErrors).toHaveLength(1)
    expect(unsetErrors[0].nodeId).toBe('act')
  })

  it('flags actionProxyWait when the workflow has no environment attached at all', () => {
    const wfSpec = makeSpec({
      id: 'wf-1',
      data: {
        environmentSpecIds: [],
        nodes: makeNodes(actionNode('act', 'Heat', 'Kitchen Actions', 'Heat')),
        edges: makeEdges(),
      },
    })
    const errors = validateWorkflowWithChildren(
      wfSpec.data.nodes as WorkflowNode[],
      wfSpec.data.edges as Edge[],
      wfSpec.id,
      [wfSpec],
    )
    expect(errors.filter((e) => e.message.includes('not provided by any attached environment'))).toHaveLength(1)
  })

  it('tolerates camelCase variants (includedActions / actionLibrary) in env data', () => {
    const env = makeSpec({
      id: 'env-1',
      data: { includedActions: [{ actionName: 'Heat', actionLibrary: 'Kitchen Actions' }] },
    })
    const wfSpec = makeSpec({
      id: 'wf-1',
      data: {
        environmentSpecIds: ['env-1'],
        nodes: makeNodes(actionNode('act', 'Heat', 'Kitchen Actions', 'Heat')),
        edges: makeEdges(),
      },
    })
    const errors = validateWorkflowWithChildren(
      wfSpec.data.nodes as WorkflowNode[],
      wfSpec.data.edges as Edge[],
      wfSpec.id,
      [wfSpec, env],
    )
    expect(errors.filter((e) => e.message.toLowerCase().includes('action'))).toEqual([])
  })

  it('inherits environments from the parent workflow chain', () => {
    const env = makeSpec({
      id: 'env-1',
      data: { included_actions: [{ action_name: 'Heat', action_library: 'Kitchen Actions' }] },
    })
    const parent = makeSpec({
      id: 'parent-1',
      data: { environmentSpecIds: ['env-1'], nodes: [], edges: [] },
    })
    // Child workflow has NO env of its own; it should inherit env-1 from parent.
    const child = makeSpec({
      id: 'child-1',
      data: {
        parentSpecificationId: 'parent-1',
        environmentSpecIds: [],
        nodes: makeNodes(actionNode('act', 'Heat', 'Kitchen Actions', 'Heat')),
        edges: makeEdges(),
      },
    })
    const errors = validateWorkflowWithChildren(
      child.data.nodes as WorkflowNode[],
      child.data.edges as Edge[],
      child.id,
      [parent, child, env],
    )
    expect(errors.filter((e) => e.message.includes('Action reference'))).toEqual([])
  })
})
