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
import type { StepResourceCommand, WorkflowNode } from '@/types/nodes'
import type { Specification } from '@/types/library'
import { validateWorkflowWithChildren } from '@/lib/export/workflow-validation'

/** Spec 2026-11-27: a Synchronize's number of partners must be a number 2 or greater to export. */

const MESSAGE = 'The number of sync partners must be a number 2 or greater.'

function validate(commands: StepResourceCommand[]) {
  const nodes = [
    { id: 's', type: 'start', position: { x: 0, y: 0 }, data: { label: 'START', stepType: 'start' } },
    {
      id: 'ui',
      type: 'userInteractionStep',
      position: { x: 0, y: 0 },
      data: { label: 'Work', stepType: 'userInteractionStep', resourceCommands: commands },
    },
    { id: 'e', type: 'end', position: { x: 0, y: 0 }, data: { label: 'END', stepType: 'end' } },
  ] as unknown as WorkflowNode[]
  const edges = [
    { id: 'e1', source: 's', target: 'ui', type: 'default' },
    { id: 'e2', source: 'ui', target: 'e', type: 'default' },
  ] as Edge[]
  const spec = {
    id: 'wf-1',
    libraryId: 'L1',
    name: 'wf-1',
    description: null,
    version: '1.0.0',
    state: 'Draft',
    history: [],
    createdAt: 0,
    updatedAt: 0,
    data: { nodes, edges, workflowResources: [{ id: 'r1', name: 'Chan', resourceType: 'Sync' }] },
  } as unknown as Specification
  return validateWorkflowWithChildren(nodes, edges, spec.id, [spec]).filter((e) => e.message.includes('partners'))
}

const sync = (extra: Partial<StepResourceCommand>): StepResourceCommand => ({
  id: 'c1',
  resourceName: 'Chan',
  commandType: 'Synchronize',
  count: 1,
  ...extra,
})

describe('Synchronize partners validation', () => {
  it.each(['abc', '1', '0', '2.5', '', '-3'])(
    'Text partners %j blocks export with the partners message',
    (partners) => {
      const errors = validate([sync({ partners })])
      expect(errors.map((e) => e.message)).toEqual([MESSAGE])
      expect(errors[0].nodeId).toBe('ui')
    },
  )

  it.each(['2', '3', ' 12 '])('Text partners %j passes', (partners) => {
    expect(validate([sync({ partners })])).toEqual([])
  })

  it('no partners set (the default 2) passes', () => {
    expect(validate([sync({})])).toEqual([])
  })

  it('Source mode with no key asks where the number comes from', () => {
    expect(validate([sync({ partnersValueType: 'property', partnersProperty: ' ' })]).map((e) => e.message)).toEqual([
      'Pick where the number of sync partners for "Chan" comes from',
    ])
  })

  it('Source mode with a key passes, even with a leftover bad Text value', () => {
    expect(validate([sync({ partners: 'x', partnersValueType: 'property', partnersProperty: 'Batches' })])).toEqual([])
  })

  it('a Send with leftover partners text is not checked', () => {
    expect(validate([sync({ commandType: 'Send', partners: 'abc' })])).toEqual([])
  })
})
