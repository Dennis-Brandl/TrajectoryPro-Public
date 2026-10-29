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
//
// Count Limited resource commands must round-trip to the schema's pool commands
// (JSON_SCHEMA §1.7.5): the editor authors them as plain Acquire/Release with a
// count — there is no pool-command UI — so the EXPORT side owns the mapping to
// "Acquire Pool Amount"/"Release Pool Amount" (amount = count), and the IMPORT
// side maps them back. Before 2026-08-10 the export passed "Acquire" through
// verbatim, and every runtime validator rejected the workflow at start with
// INVALID_RESOURCE_COMMAND ("Acquire not compatible with resource type
// 'countable use with pool limits'") — the RW-5 user-testing ticket.

import { describe, it, expect } from 'vitest'
import type { Specification } from '@/types/library'
import type { WorkflowNode, StepNodeData } from '@/types/nodes'
import { exportWorkflow } from '../workflow-exporters'
import { transformResourceCommands } from '../../import/transformers'
import type { ResourceCommandSpecification } from '../export-types'

function createSpec(data: Record<string, unknown>, id = 'spec-123'): Specification {
  return {
    id,
    libraryId: 'lib-456',
    name: 'Resource WF',
    description: 'Test workflow',
    data,
    version: '1.0.0',
    state: 'Draft' as const,
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function stepNode(id: string, data: Partial<StepNodeData>): WorkflowNode {
  return {
    id,
    type: 'userInteractionStep',
    position: { x: 100, y: 100 },
    data: { label: id, stepType: 'userInteractionStep', ...data },
  } as WorkflowNode
}

describe('countable resource command export mapping', () => {
  it('maps Acquire/Release on a workflow-owned Count Limited resource to the pool commands with amount = count', () => {
    const spec = createSpec({
      workflowResources: [{ id: 'r1', name: 'Slots', resourceType: 'Count Limited', count: 5 }],
    })
    const node = stepNode('s1', {
      resourceCommands: [
        { id: 'c1', resourceName: 'Slots', commandType: 'Acquire', count: 2 },
        { id: 'c2', resourceName: 'Slots', commandType: 'Release', count: 2 },
      ],
    } as Partial<StepNodeData>)

    const exported = exportWorkflow(spec, [node], [], undefined, [spec])
    const cmds = exported.steps[0].resource_command_specifications!
    expect(cmds[0]).toMatchObject({
      command_type: 'Acquire Pool Amount',
      resource_name: 'Slots',
      amount: 2,
      resource_source_type: 'workflow',
      resource_source_oid: 'spec-123',
    })
    expect(cmds[1]).toMatchObject({ command_type: 'Release Pool Amount', amount: 2 })
  })

  it('leaves Acquire/Release untouched for non-countable resources', () => {
    const spec = createSpec({
      workflowResources: [
        { id: 'r1', name: 'Mutex', resourceType: 'Single Use' },
        { id: 'r2', name: 'Ovens', resourceType: 'Shared Use', count: 3 },
      ],
    })
    const node = stepNode('s1', {
      resourceCommands: [
        { id: 'c1', resourceName: 'Mutex', commandType: 'Acquire', count: 1 },
        { id: 'c2', resourceName: 'Ovens', commandType: 'Release', count: 1 },
      ],
    } as Partial<StepNodeData>)

    const exported = exportWorkflow(spec, [node], [], undefined, [spec])
    const cmds = exported.steps[0].resource_command_specifications!
    expect(cmds[0].command_type).toBe('Acquire')
    expect(cmds[1].command_type).toBe('Release')
  })

  it('defaults a missing count to amount 1 on pool commands (the validators require amount > 0)', () => {
    const spec = createSpec({
      workflowResources: [{ id: 'r1', name: 'Slots', resourceType: 'Count Limited', count: 5 }],
    })
    const node = stepNode('s1', {
      resourceCommands: [{ id: 'c1', resourceName: 'Slots', commandType: 'Acquire' }],
    } as Partial<StepNodeData>)

    const exported = exportWorkflow(spec, [node], [], undefined, [spec])
    expect(exported.steps[0].resource_command_specifications![0]).toMatchObject({
      command_type: 'Acquire Pool Amount',
      amount: 1,
    })
  })

  it('maps commands against an environment-owned Count Limited resource too', () => {
    const envSpec = createSpec(
      { resources: [{ id: 'r1', name: 'Pool', resourceType: 'Count Limited', count: 4 }] },
      'env-1',
    )
    const spec = createSpec({ environmentSpecIds: ['env-1'] })
    const node = stepNode('s1', {
      resourceCommands: [{ id: 'c1', resourceName: 'Pool', commandType: 'Acquire', count: 3 }],
    } as Partial<StepNodeData>)

    const exported = exportWorkflow(spec, [node], [], undefined, [spec, envSpec])
    expect(exported.steps[0].resource_command_specifications![0]).toMatchObject({
      command_type: 'Acquire Pool Amount',
      amount: 3,
      resource_source_type: 'environment',
      resource_source_oid: 'env-1',
    })
  })
})

describe('pool command import mapping', () => {
  const base = {
    resource_name: 'Slots',
    resource_source_type: 'workflow' as const,
    resource_source_oid: 'wf-1',
  }

  it('maps Acquire Pool Amount back to an Acquire command carrying the amount as count', () => {
    const [cmd] = transformResourceCommands([
      { oid: 'c1', command_type: 'Acquire Pool Amount', amount: 2, ...base } as ResourceCommandSpecification,
    ])!
    expect(cmd).toMatchObject({ commandType: 'Acquire', count: 2 })
  })

  it('maps Release Pool Amount back to a RELEASE command, not an Acquire', () => {
    // The old fallback funneled every unrecognized command_type — including
    // "Release Pool Amount" — to 'Acquire', silently turning a pool release into
    // a second acquire on import.
    const [cmd] = transformResourceCommands([
      { oid: 'c1', command_type: 'Release Pool Amount', amount: 2, ...base } as ResourceCommandSpecification,
    ])!
    expect(cmd).toMatchObject({ commandType: 'Release', count: 2 })
  })
})
