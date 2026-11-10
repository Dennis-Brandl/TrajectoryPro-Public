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
import { validateWorkflowLibrary } from '../../import/schema-validator'

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

describe('Count Limited count from a property (Text/Source)', () => {
  const slotsSpec = () =>
    createSpec({
      workflowResources: [
        { id: 'r1', name: 'Slots', resourceType: 'Count Limited', count: 5 },
        { id: 'r2', name: 'Mutex', resourceType: 'Single Use' },
      ],
    })

  it('Text mode (explicit literal) exports amount exactly as before, with no amount_property', () => {
    const node = stepNode('s1', {
      resourceCommands: [
        { id: 'c1', resourceName: 'Slots', commandType: 'Acquire', count: 3, countValueType: 'literal' },
      ],
    } as Partial<StepNodeData>)
    const [cmd] = exportWorkflow(slotsSpec(), [node], [], undefined, [slotsSpec()]).steps[0]
      .resource_command_specifications!
    expect(cmd).toMatchObject({ command_type: 'Acquire Pool Amount', amount: 3 })
    expect('amount_property' in cmd).toBe(false)
  })

  it('Text mode keeps the literal even when a stale property key is stored', () => {
    const node = stepNode('s1', {
      resourceCommands: [
        {
          id: 'c1',
          resourceName: 'Slots',
          commandType: 'Acquire',
          count: 4,
          countValueType: 'literal',
          countProperty: 'Batch.Size',
        },
      ],
    } as Partial<StepNodeData>)
    const [cmd] = exportWorkflow(slotsSpec(), [node], [], undefined, [slotsSpec()]).steps[0]
      .resource_command_specifications!
    expect(cmd.amount).toBe(4)
    expect('amount_property' in cmd).toBe(false)
  })

  it('Source mode Acquire exports amount_property and NO amount field at all', () => {
    const node = stepNode('s1', {
      resourceCommands: [
        {
          id: 'c1',
          resourceName: 'Slots',
          commandType: 'Acquire',
          count: 2,
          countValueType: 'property',
          countProperty: 'Batch.Size',
        },
      ],
    } as Partial<StepNodeData>)
    const [cmd] = exportWorkflow(slotsSpec(), [node], [], undefined, [slotsSpec()]).steps[0]
      .resource_command_specifications!
    expect(cmd).toMatchObject({ command_type: 'Acquire Pool Amount', amount_property: 'Batch.Size' })
    expect('amount' in cmd).toBe(false)
  })

  it('Source mode Release exports amount_property and NO amount field at all', () => {
    const node = stepNode('s1', {
      resourceCommands: [
        {
          id: 'c2',
          resourceName: 'Slots',
          commandType: 'Release',
          count: 1,
          countValueType: 'property',
          countProperty: 'flowCount',
        },
      ],
    } as Partial<StepNodeData>)
    const [cmd] = exportWorkflow(slotsSpec(), [node], [], undefined, [slotsSpec()]).steps[0]
      .resource_command_specifications!
    expect(cmd).toMatchObject({ command_type: 'Release Pool Amount', amount_property: 'flowCount' })
    expect('amount' in cmd).toBe(false)
  })

  it('drops amount_property on a non-countable resource (stale Source mode) and keeps the literal', () => {
    const node = stepNode('s1', {
      resourceCommands: [
        {
          id: 'c1',
          resourceName: 'Mutex',
          commandType: 'Acquire',
          count: 1,
          countValueType: 'property',
          countProperty: 'Batch.Size',
        },
      ],
    } as Partial<StepNodeData>)
    const [cmd] = exportWorkflow(slotsSpec(), [node], [], undefined, [slotsSpec()]).steps[0]
      .resource_command_specifications!
    expect(cmd.command_type).toBe('Acquire')
    expect(cmd.amount).toBe(1)
    expect('amount_property' in cmd).toBe(false)
  })

  it('round-trips both modes losslessly through export and import', () => {
    const commands = [
      { id: 'c1', resourceName: 'Slots', commandType: 'Acquire' as const, count: 3 },
      {
        id: 'c2',
        resourceName: 'Slots',
        commandType: 'Release' as const,
        count: 1,
        countValueType: 'property' as const,
        countProperty: 'Batch.Size',
      },
    ]
    const node = stepNode('s1', { resourceCommands: commands } as Partial<StepNodeData>)
    const exported = exportWorkflow(slotsSpec(), [node], [], undefined, [slotsSpec()])
    const back = transformResourceCommands(exported.steps[0].resource_command_specifications)!
    expect(back[0]).toMatchObject({ id: 'c1', commandType: 'Acquire', count: 3 })
    expect(back[0].countValueType).toBeUndefined()
    expect(back[0].countProperty).toBeUndefined()
    expect(back[1]).toMatchObject({
      id: 'c2',
      commandType: 'Release',
      countValueType: 'property',
      countProperty: 'Batch.Size',
    })
    // Re-export gives the same wire form.
    const again = exportWorkflow(
      slotsSpec(),
      [stepNode('s1', { resourceCommands: back } as Partial<StepNodeData>)],
      [],
      undefined,
      [slotsSpec()],
    )
    expect(again.steps[0].resource_command_specifications).toEqual(exported.steps[0].resource_command_specifications)
  })

  it('import: amount_property → Source mode; absent or empty → Text mode with amount ?? 1', () => {
    const base = { resource_name: 'Slots', resource_source_type: 'workflow' as const, resource_source_oid: 'wf-1' }
    const [a, b, c] = transformResourceCommands([
      { oid: 'a', command_type: 'Acquire Pool Amount', amount_property: 'Batch.Size', ...base },
      { oid: 'b', command_type: 'Release Pool Amount', amount: 4, ...base },
      { oid: 'c', command_type: 'Acquire Pool Amount', amount_property: '', ...base },
    ])!
    expect(a).toMatchObject({
      commandType: 'Acquire',
      countValueType: 'property',
      countProperty: 'Batch.Size',
      count: 1,
    })
    expect(b).toMatchObject({ commandType: 'Release', count: 4 })
    expect(b.countValueType).toBeUndefined()
    expect(c.countValueType).toBeUndefined()
    expect(c.count).toBe(1)
  })
})

describe('workflow-library schema accepts amount_property', () => {
  const managed = (localId: string, oid: string) => ({
    local_id: localId,
    oid,
    version: '1.0.0',
    last_modified_date: '2026-11-09T00:00:00Z',
  })
  const library = (cmd: Record<string, unknown>) => ({
    ...managed('Pool Lib', 'lib-pool'),
    workflow_specifications: [
      {
        ...managed('Pool WF', 'wf-pool'),
        resource_command_specifications: [cmd],
        steps: [
          {
            ...managed('Work', 'step-1'),
            step_type: 'USER_INTERACTION',
            position: { x: 0, y: 0 },
            resource_command_specifications: [cmd],
          },
        ],
        connections: [],
      },
    ],
  })
  const poolCmd = { oid: 'c1', command_type: 'Acquire Pool Amount', resource_name: 'Slots' }

  it('validates a pool command with amount_property and no amount', () => {
    expect(validateWorkflowLibrary(library({ ...poolCmd, amount_property: 'Batch.Size' })).success).toBe(true)
  })

  it('rejects an empty amount_property', () => {
    expect(validateWorkflowLibrary(library({ ...poolCmd, amount_property: '' })).success).toBe(false)
  })
})
