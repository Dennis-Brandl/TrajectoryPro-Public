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
 * Verifies that try_specifications, catch_id, and return_config are emitted
 * on every export path — specifically the child/nested workflow path
 * (buildNestedChildExport, reached via exportWorkflow with a childTree arg)
 * and the library/spec path (exportWorkflowSpec, reached via exportWorkflowLibrary).
 */

import { describe, it, expect } from 'vitest'
import type { Specification, ChildSpecification } from '@/types/library'
import type { WorkflowNode, StepNodeData } from '@/types/nodes'
import type { Edge } from '@xyflow/react'
import type { ConditionalEdgeData } from '@/types/edges'
import { exportWorkflow, exportWorkflowSpec } from '../workflow-exporters'

// =============================================================================
// Helpers
// =============================================================================

function makeSpec(id: string, name = 'RootWorkflow'): Specification {
  return {
    id,
    libraryId: 'lib-1',
    name,
    description: null,
    data: {},
    version: '1.0.0',
    state: 'Draft' as const,
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
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

/**
 * Builds a ChildSpecification whose node list contains:
 *  - an actionProxyWait step with trySpecifications
 *  - a catch step with catchId
 *  - a return step with returnConfig
 */
function makeTryCatchChildSpec(id: string, parentChildSpecId: string | null = null): ChildSpecification {
  return {
    id,
    parentSpecificationId: 'root-spec',
    parentChildSpecId,
    name: 'ChildWithTryCatch',
    description: null,
    data: {
      nodes: [
        makeNode('start-1', 'start', { label: 'START' }),
        makeNode('proxy-1', 'actionProxyWait', {
          label: 'RunAction',
          actionProxyConfig: { action_oid: 'act-1', environment_oid: 'env-1' },
          trySpecifications: [{ mode: 'ERROR', catch_id: 'CATCH_A', release_on_catch: true }],
        } as Partial<StepNodeData>),
        makeNode('catch-1', 'catch', {
          label: 'Recover',
          catchId: 'CATCH_A',
        } as Partial<StepNodeData>),
        makeNode('return-1', 'return', {
          label: 'Done',
          returnConfig: { command: 'ABANDON' },
        } as Partial<StepNodeData>),
        makeNode('end-1', 'end', { label: 'END' }),
      ] as WorkflowNode[],
      edges: [
        { id: 'e1', source: 'start-1', target: 'proxy-1' },
        { id: 'e2', source: 'proxy-1', target: 'end-1' },
        { id: 'e3', source: 'catch-1', target: 'return-1' },
      ] as Edge<ConditionalEdgeData>[],
    },
    depth: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

// =============================================================================
// Tests: buildNestedChildExport path (via exportWorkflow + childTree)
// =============================================================================

describe('child workflow export (buildNestedChildExport path) — TRY/CATCH/RETURN fields', () => {
  const rootSpec = makeSpec('root-spec')
  const rootNodes = [makeNode('root-start', 'start', { label: 'START' })]
  const rootEdges: Edge<ConditionalEdgeData>[] = []
  const childSpec = makeTryCatchChildSpec('child-1')

  it('emits try_specifications on an actionProxyWait step inside a child workflow', () => {
    const result = exportWorkflow(rootSpec, rootNodes, rootEdges, undefined, [], [], undefined, [childSpec])
    const child = result.children![0]
    // Steps are found by oid (= node.id); local_id = node.data.label
    const proxyStep = child.steps.find((s) => s.oid === 'proxy-1')!
    expect(proxyStep).toBeDefined()
    expect(proxyStep.try_specifications).toEqual([{ mode: 'ERROR', catch_id: 'CATCH_A', release_on_catch: true }])
  })

  it('emits catch_id on a catch step inside a child workflow', () => {
    const result = exportWorkflow(rootSpec, rootNodes, rootEdges, undefined, [], [], undefined, [childSpec])
    const child = result.children![0]
    const catchStep = child.steps.find((s) => s.oid === 'catch-1')!
    expect(catchStep).toBeDefined()
    expect(catchStep.catch_id).toBe('CATCH_A')
  })

  it('emits return_config on a return step inside a child workflow', () => {
    const result = exportWorkflow(rootSpec, rootNodes, rootEdges, undefined, [], [], undefined, [childSpec])
    const child = result.children![0]
    const returnStep = child.steps.find((s) => s.oid === 'return-1')!
    expect(returnStep).toBeDefined()
    expect(returnStep.return_config).toEqual({ command: 'ABANDON' })
  })

  it('does NOT emit try_specifications/catch_id/return_config on unrelated step types', () => {
    const result = exportWorkflow(rootSpec, rootNodes, rootEdges, undefined, [], [], undefined, [childSpec])
    const child = result.children![0]
    const startStep = child.steps.find((s) => s.oid === 'start-1')!
    expect(startStep).toBeDefined()
    expect(startStep.try_specifications).toBeUndefined()
    expect(startStep.catch_id).toBeUndefined()
    expect(startStep.return_config).toBeUndefined()
  })

  it('emits all three fields in a grandchild workflow too', () => {
    const grandchildSpec = makeTryCatchChildSpec('grandchild-1', 'child-1')
    const result = exportWorkflow(rootSpec, rootNodes, rootEdges, undefined, [], [], undefined, [
      childSpec,
      grandchildSpec,
    ])
    const grandchild = result.children![0].children![0]
    expect(grandchild).toBeDefined()
    const proxyStep = grandchild.steps.find((s) => s.oid === 'proxy-1')!
    const catchStep = grandchild.steps.find((s) => s.oid === 'catch-1')!
    const returnStep = grandchild.steps.find((s) => s.oid === 'return-1')!
    expect(proxyStep).toBeDefined()
    expect(catchStep).toBeDefined()
    expect(returnStep).toBeDefined()
    expect(proxyStep.try_specifications).toEqual([{ mode: 'ERROR', catch_id: 'CATCH_A', release_on_catch: true }])
    expect(catchStep.catch_id).toBe('CATCH_A')
    expect(returnStep.return_config).toEqual({ command: 'ABANDON' })
  })
})

// =============================================================================
// Tests: exportWorkflowSpec path (library export — legacy parentSpecificationId path)
// =============================================================================

describe('exportWorkflowSpec — TRY/CATCH/RETURN fields', () => {
  /**
   * Build a Specification that contains a try/catch/return node set in its data.
   * exportWorkflowSpec reads spec.data.nodes directly for the root step emit.
   */
  function makeSpecWithTryCatch(id: string): Specification {
    return {
      id,
      libraryId: 'lib-1',
      name: 'WorkflowWithTryCatch',
      description: null,
      version: '1.0.0',
      state: 'Draft' as const,
      history: [],
      data: {
        nodes: [
          makeNode('start-2', 'start', { label: 'START' }),
          makeNode('proxy-2', 'actionProxyWait', {
            label: 'RunAction2',
            actionProxyConfig: { action_oid: 'act-2', environment_oid: 'env-2' },
            trySpecifications: [{ mode: 'ERROR', catch_id: 'CATCH_B', release_on_catch: false }],
          } as Partial<StepNodeData>),
          makeNode('catch-2', 'catch', {
            label: 'Recover2',
            catchId: 'CATCH_B',
          } as Partial<StepNodeData>),
          makeNode('return-2', 'return', {
            label: 'Done2',
            returnConfig: { command: 'RESTART', restart_mode: 'CLEAN' },
          } as Partial<StepNodeData>),
          makeNode('end-2', 'end', { label: 'END' }),
        ] as WorkflowNode[],
        edges: [] as Edge<ConditionalEdgeData>[],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  it('emits try_specifications on actionProxyWait in exportWorkflowSpec', () => {
    const spec = makeSpecWithTryCatch('spec-2')
    const result = exportWorkflowSpec(spec, [spec])
    // oid = node.id, local_id = node.data.label
    const proxyStep = result.steps.find((s) => s.oid === 'proxy-2')!
    expect(proxyStep).toBeDefined()
    expect(proxyStep.try_specifications).toEqual([{ mode: 'ERROR', catch_id: 'CATCH_B', release_on_catch: false }])
  })

  it('emits catch_id on catch step in exportWorkflowSpec', () => {
    const spec = makeSpecWithTryCatch('spec-2')
    const result = exportWorkflowSpec(spec, [spec])
    const catchStep = result.steps.find((s) => s.oid === 'catch-2')!
    expect(catchStep).toBeDefined()
    expect(catchStep.catch_id).toBe('CATCH_B')
  })

  it('emits return_config on return step in exportWorkflowSpec', () => {
    const spec = makeSpecWithTryCatch('spec-2')
    const result = exportWorkflowSpec(spec, [spec])
    const returnStep = result.steps.find((s) => s.oid === 'return-2')!
    expect(returnStep).toBeDefined()
    expect(returnStep.return_config).toEqual({ command: 'RESTART', restart_mode: 'CLEAN' })
  })
})
