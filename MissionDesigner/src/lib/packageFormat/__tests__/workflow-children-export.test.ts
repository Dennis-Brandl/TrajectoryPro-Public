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
import type { Specification, ChildSpecification } from '@/types/library'
import type { WorkflowNode, StepNodeData } from '@/types/nodes'
import type { Edge } from '@xyflow/react'
import type { ConditionalEdgeData } from '@/types/edges'
import { exportWorkflow } from '../workflow-exporters'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockSpec(name: string, id = 'spec-123'): Specification {
  return {
    id,
    libraryId: 'lib-456',
    name,
    description: 'Test workflow',
    data: {},
    version: '1.0.0',
    state: 'Draft' as const,
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function createNode(id: string, type: StepNodeData['stepType'], data: Partial<StepNodeData> = {}): WorkflowNode {
  return {
    id,
    type,
    position: { x: 100, y: 100 },
    data: {
      label: data.label || 'Test Node',
      stepType: type,
      ...data,
    },
  }
}

function createChildSpec(overrides: Partial<ChildSpecification> = {}): ChildSpecification {
  return {
    id: 'child-1',
    parentSpecificationId: 'spec-123',
    parentChildSpecId: null,
    name: 'ChildWorkflow',
    description: null,
    data: {
      nodes: [createNode('child-start', 'start', { label: 'START' }), createNode('child-end', 'end', { label: 'END' })],
      edges: [{ id: 'e1', source: 'child-start', target: 'child-end' }],
    },
    depth: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function createGrandchildSpec(parentChildId: string): ChildSpecification {
  return {
    id: 'grandchild-1',
    parentSpecificationId: 'spec-123',
    parentChildSpecId: parentChildId,
    name: 'GrandchildWorkflow',
    description: null,
    data: {
      nodes: [createNode('gc-start', 'start', { label: 'START' }), createNode('gc-end', 'end', { label: 'END' })],
      edges: [{ id: 'e2', source: 'gc-start', target: 'gc-end' }],
    },
    depth: 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

// =============================================================================
// exportWorkflow - children assembly
// =============================================================================

describe('exportWorkflow - children assembly', () => {
  const edges: Edge<ConditionalEdgeData>[] = []

  it('includes children array when childTree is provided with entries', () => {
    const spec = createMockSpec('ParentWorkflow')
    const nodes = [
      createNode('n1', 'start', { label: 'START' }),
      createNode('n2', 'workflowProxy', {
        label: 'ChildWorkflow',
        subWorkflowMode: 'embedded',
        embeddedWorkflowSpecId: 'child-1',
      } as Partial<StepNodeData>),
      createNode('n3', 'end', { label: 'END' }),
    ]
    const childTree = [createChildSpec()]

    const result = exportWorkflow(spec, nodes, edges, undefined, [], [], undefined, childTree)

    expect(result.children).toBeDefined()
    expect(result.children).toHaveLength(1)
    expect(result.children![0].oid).toBe('child-1')
    expect(result.children![0].local_id).toBe('ChildWorkflow')
  })

  it('omits children field when childTree is undefined', () => {
    const spec = createMockSpec('ParentWorkflow')
    const nodes = [createNode('n1', 'start', { label: 'START' })]

    const result = exportWorkflow(spec, nodes, edges)

    expect(result.children).toBeUndefined()
  })

  it('omits children field when childTree is empty', () => {
    const spec = createMockSpec('ParentWorkflow')
    const nodes = [createNode('n1', 'start', { label: 'START' })]

    const result = exportWorkflow(spec, nodes, edges, undefined, [], [], undefined, [])

    expect(result.children).toBeUndefined()
  })

  it('nests grandchildren under their parent child', () => {
    const spec = createMockSpec('ParentWorkflow')
    const nodes = [
      createNode('n1', 'start', { label: 'START' }),
      createNode('n2', 'workflowProxy', {
        label: 'ChildWorkflow',
        subWorkflowMode: 'embedded',
        embeddedWorkflowSpecId: 'child-1',
      } as Partial<StepNodeData>),
      createNode('n3', 'end', { label: 'END' }),
    ]
    const childSpec = createChildSpec()
    const grandchildSpec = createGrandchildSpec('child-1')
    const childTree = [childSpec, grandchildSpec]

    const result = exportWorkflow(spec, nodes, edges, undefined, [], [], undefined, childTree)

    expect(result.children).toHaveLength(1)
    const child = result.children![0]
    expect(child.oid).toBe('child-1')
    expect(child.children).toBeDefined()
    expect(child.children).toHaveLength(1)
    expect(child.children![0].oid).toBe('grandchild-1')
    expect(child.children![0].local_id).toBe('GrandchildWorkflow')
  })

  it('includes multiple children at the same level', () => {
    const spec = createMockSpec('ParentWorkflow')
    const nodes = [createNode('n1', 'start', { label: 'START' })]
    const child1 = createChildSpec({ id: 'child-1', name: 'First' })
    const child2 = createChildSpec({ id: 'child-2', name: 'Second' })
    const childTree = [child1, child2]

    const result = exportWorkflow(spec, nodes, edges, undefined, [], [], undefined, childTree)

    expect(result.children).toHaveLength(2)
    expect(result.children![0].local_id).toBe('First')
    expect(result.children![1].local_id).toBe('Second')
  })

  it('exports child step nodes and connections', () => {
    const spec = createMockSpec('ParentWorkflow')
    const nodes = [createNode('n1', 'start', { label: 'START' })]
    const childSpec = createChildSpec()
    const childTree = [childSpec]

    const result = exportWorkflow(spec, nodes, edges, undefined, [], [], undefined, childTree)

    const child = result.children![0]
    expect(child.steps).toBeDefined()
    expect(child.steps.length).toBeGreaterThanOrEqual(2) // at least start + end
    expect(child.connections).toBeDefined()
  })

  it('preserves notation in display_style when provided', () => {
    const spec = createMockSpec('ParentWorkflow')
    const nodes = [createNode('n1', 'start', { label: 'START' })]

    const result = exportWorkflow(spec, nodes, edges, undefined, [], [], 'bpmn', [])

    expect(result.display_style).toBe('bpmn')
  })

  it("resolves a child step's resource_source_oid to the child's own runtime oid", () => {
    // The editor stored a stale resourceSourceOid (e.g., from a deep-copied
    // library step or a renamed spec). The export must rewrite it to the
    // child's current id, since `oid` on the exported child = child.id and
    // resource_source_oid must point at the workflow that DECLARES the resource.
    const spec = createMockSpec('ParentWorkflow')
    const nodes = [createNode('n1', 'start', { label: 'START' })]

    const childWithResource: ChildSpecification = {
      id: 'child-with-resources',
      parentSpecificationId: 'spec-123',
      parentChildSpecId: null,
      name: 'ChildWithResources',
      description: null,
      data: {
        nodes: [
          createNode('cs-step', 'actionProxyWait', {
            label: 'AcquireBot',
            resourceCommands: [
              {
                id: 'cmd-1',
                resourceName: 'Robots',
                resourceSourceType: 'workflow',
                resourceSourceOid: 'STALE-EDITOR-ID', // wrong on purpose
                commandType: 'Acquire',
                count: 1,
              },
            ],
          } as Partial<StepNodeData>),
        ],
        edges: [],
        workflowResources: [{ id: 'r1', name: 'Robots', resourceType: 'Named', count: 1, names: ['R1'] }],
      },
      depth: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const result = exportWorkflow(spec, nodes, edges, undefined, [], [], undefined, [childWithResource])

    const exportedChild = result.children![0]
    const stepWithCmd = exportedChild.steps.find((s) => s.local_id === 'AcquireBot')!
    const cmd = stepWithCmd.resource_command_specifications![0]
    expect(cmd.resource_source_type).toBe('workflow')
    expect(cmd.resource_source_oid).toBe('child-with-resources')
    expect(cmd.resource_source_oid).not.toBe('STALE-EDITOR-ID')
  })
})
