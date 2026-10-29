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
import { extractOutputParams } from '@/lib/packageFormat/parameter-extractors'
import { transformOutputParams } from '@/lib/import/transformers'
import { defaultCatchOutputs, CATCH_OUTPUT_NAMES } from '@/lib/catch-outputs'
import { exportWorkflow, exportWorkflowSpec } from '@/lib/packageFormat/workflow-exporters'
import type { WorkflowNode, StepNodeData } from '@/types/nodes'
import type { Specification, ChildSpecification } from '@/types/library'
import type { Edge } from '@xyflow/react'

describe('CATCH default outputs export/import round-trip', () => {
  it('exports the four names as output_parameter_specifications ids and imports them back', () => {
    const outputs = defaultCatchOutputs().map((o) => ({ ...o, target: `FailureContext.${o.name}` }))
    const specs = extractOutputParams({ outputs })!
    expect(specs.map((s) => s.id)).toEqual(['Message', 'Reason', 'Step', 'StepID'])
    expect(specs.map((s) => s.target)).toEqual([
      'FailureContext.Message',
      'FailureContext.Reason',
      'FailureContext.Step',
      'FailureContext.StepID',
    ])
    const back = transformOutputParams(specs)!
    expect(back.map((p) => p.name)).toEqual(['Message', 'Reason', 'Step', 'StepID'])
  })
})

// =============================================================================
// Export-time backfill: a CATCH step always exports the four canonical outputs,
// even when the saved node data predates the defaults (outputs empty/missing).
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
    data: { label: id, stepType: type, ...extra },
  } as WorkflowNode
}

const baseEdges: Edge[] = []

describe('CATCH export backfill', () => {
  it('exportWorkflow emits the four canonical outputs for a CATCH with no outputs', () => {
    const nodes = [makeNode('s1', 'start'), makeNode('c1', 'catch', { catchId: 'C1' }), makeNode('e1', 'end')]
    const result = exportWorkflow(makeSpec('wf'), nodes, baseEdges)
    const catchStep = result.steps!.find((s) => s.oid === 'c1')!
    expect(catchStep.output_parameter_specifications!.map((s) => s.id)).toEqual([...CATCH_OUTPUT_NAMES])
    expect(catchStep.output_parameter_specifications!.map((s) => s.target)).toEqual([...CATCH_OUTPUT_NAMES])
  })

  it('exportWorkflow preserves an existing explicitly-targeted row and appends only the missing ones', () => {
    const nodes = [
      makeNode('c1', 'catch', {
        catchId: 'C1',
        outputs: [{ id: 'x1', name: 'Message', target: 'Catch.Message', description: 'user desc' }],
      }),
    ]
    const result = exportWorkflow(makeSpec('wf'), nodes, baseEdges)
    const specs = result.steps!.find((s) => s.oid === 'c1')!.output_parameter_specifications!
    expect(specs.map((s) => s.id)).toEqual(['Message', 'Reason', 'Step', 'StepID'])
    expect(specs[0]).toMatchObject({ oid: 'x1', target: 'Catch.Message', description: 'user desc' })
    expect(specs.slice(1).map((s) => s.target)).toEqual(['Reason', 'Step', 'StepID'])
  })

  it('exportWorkflow still omits output specs on non-CATCH steps without outputs', () => {
    const result = exportWorkflow(makeSpec('wf'), [makeNode('s1', 'scriptStep')], baseEdges)
    expect(result.steps!.find((s) => s.oid === 's1')!.output_parameter_specifications).toBeUndefined()
  })

  it('exportWorkflow backfills CATCH steps inside exported children', () => {
    const child: ChildSpecification = {
      id: 'child-1',
      parentSpecificationId: 'root-spec',
      parentChildSpecId: null,
      name: 'Child',
      description: null,
      data: {
        nodes: [makeNode('cs', 'start'), makeNode('cc', 'catch', { catchId: 'CC' })],
        edges: [] as Edge[],
      },
      depth: 1,
      createdAt: 0,
      updatedAt: 0,
    }
    const result = exportWorkflow(
      makeSpec('root-spec'),
      [makeNode('rs', 'start')],
      baseEdges,
      undefined,
      [],
      [],
      undefined,
      [child],
    )
    const childCatch = result.children![0].steps!.find((s) => s.oid === 'cc')!
    expect(childCatch.output_parameter_specifications!.map((s) => s.id)).toEqual([...CATCH_OUTPUT_NAMES])
  })

  it('exportWorkflowSpec backfills too (library export path)', () => {
    const spec = makeSpec('wf-lib', {
      nodes: [makeNode('c1', 'catch', { catchId: 'C1' })],
      edges: [],
    })
    const result = exportWorkflowSpec(spec, [spec])
    const specs = result.steps!.find((s) => s.oid === 'c1')!.output_parameter_specifications!
    expect(specs.map((s) => s.id)).toEqual([...CATCH_OUTPUT_NAMES])
  })
})
