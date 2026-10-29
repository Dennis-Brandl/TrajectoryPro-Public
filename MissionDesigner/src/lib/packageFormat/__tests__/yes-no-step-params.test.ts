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
import type { Specification } from '@/types/library'
import type { WorkflowNode, StepNodeData } from '@/types/nodes'
import type { Edge } from '@xyflow/react'
import type { ConditionalEdgeData } from '@/types/edges'
import { exportWorkflow } from '../workflow-exporters'

function makeSpec(name = 'wf'): Specification {
  return {
    id: 'spec-1',
    libraryId: 'lib-1',
    name,
    description: null,
    version: '1.0.0',
    state: 'Draft' as const,
    data: {},
    history: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

function makeNode(id: string, type: StepNodeData['stepType'], data: Partial<StepNodeData> = {}): WorkflowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: data.label || id, stepType: type, ...data },
  }
}

describe('exportWorkflow — yesNoStep parameter persistence', () => {
  it('emits input_parameter_specifications for yesNoStep when inputs are set', () => {
    const yesNo = makeNode('y1', 'yesNoStep', {
      label: 'Confirm?',
      inputs: [{ id: 'in-1', name: 'rowCount' }],
      outputs: [{ id: 'out-1', name: 'decision' }],
      resourceCommands: [
        {
          id: 'rc-1',
          resourceName: 'lock',
          commandType: 'Acquire',
          count: 1,
        },
      ],
    })
    const start = makeNode('s', 'start')
    const end = makeNode('e', 'end')
    const edges: Edge<ConditionalEdgeData>[] = []

    const result = exportWorkflow(makeSpec(), [start, yesNo, end], edges)
    // nodeToManagedElement copies node.id into oid (entity-converters.ts:45);
    // local_id holds data.label, which is 'Confirm?' for this node.
    const yesNoStep = result.steps.find((s) => s.oid === 'y1')!

    expect(yesNoStep).toBeDefined()
    // The exporter maps `id <- input.name` and `oid <- input.id`
    // (see src/lib/export/parameter-extractors.ts:32-34). It does NOT emit
    // a `name` field on the output.
    expect(yesNoStep.input_parameter_specifications).toBeDefined()
    expect(yesNoStep.input_parameter_specifications).toHaveLength(1)
    expect(yesNoStep.input_parameter_specifications![0].id).toBe('rowCount')
    expect(yesNoStep.input_parameter_specifications![0].oid).toBe('in-1')

    expect(yesNoStep.output_parameter_specifications).toBeDefined()
    expect(yesNoStep.output_parameter_specifications).toHaveLength(1)
    expect(yesNoStep.output_parameter_specifications![0].id).toBe('decision')
    expect(yesNoStep.output_parameter_specifications![0].oid).toBe('out-1')

    // extractResourceCommands maps to `oid` + `resource_name` + `command_type`
    // (see src/lib/export/step-extractors.ts:35-44).
    expect(yesNoStep.resource_command_specifications).toBeDefined()
    expect(yesNoStep.resource_command_specifications).toHaveLength(1)
    expect(yesNoStep.resource_command_specifications![0].resource_name).toBe('lock')
    expect(yesNoStep.resource_command_specifications![0].command_type).toBe('Acquire')
  })

  it('omits input_parameter_specifications when yesNoStep has no inputs', () => {
    const yesNo = makeNode('y1', 'yesNoStep', { label: 'Confirm?' })
    const result = exportWorkflow(makeSpec(), [yesNo], [])
    // nodeToManagedElement copies node.id into oid (entity-converters.ts:45);
    // local_id holds data.label, which is 'Confirm?' for this node.
    const yesNoStep = result.steps.find((s) => s.oid === 'y1')!

    expect(yesNoStep).toBeDefined()
    // extractInputParams returns undefined for empty / missing arrays.
    expect(yesNoStep.input_parameter_specifications).toBeUndefined()
    expect(yesNoStep.output_parameter_specifications).toBeUndefined()
  })
})
