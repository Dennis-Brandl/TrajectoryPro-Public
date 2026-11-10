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

/**
 * A Count Limited Acquire/Release whose count is read from a property (Source mode)
 * must name that property before export.
 */

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
    data: {
      nodes,
      edges,
      workflowResources: [
        { id: 'r1', name: 'Slots', resourceType: 'Count Limited', count: 5 },
        { id: 'r2', name: 'Mutex', resourceType: 'Single Use' },
      ],
    },
  } as unknown as Specification
  return validateWorkflowWithChildren(nodes, edges, spec.id, [spec]).filter((e) => e.message.includes('count for'))
}

describe('Count Limited count Source validation', () => {
  it('flags an Acquire in Source mode with no property picked', () => {
    const errors = validate([
      { id: 'c1', resourceName: 'Slots', commandType: 'Acquire', count: 1, countValueType: 'property' },
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0].nodeId).toBe('ui')
    expect(errors[0].message).toBe('Pick where the Acquire count for "Slots" comes from')
  })

  it('flags a Release in Source mode with a blank property key', () => {
    const errors = validate([
      {
        id: 'c2',
        resourceName: 'Slots',
        commandType: 'Release',
        count: 1,
        countValueType: 'property',
        countProperty: '   ',
      },
    ])
    expect(errors.map((e) => e.message)).toEqual(['Pick where the Release count for "Slots" comes from'])
  })

  it('passes Source mode with a key, Text mode, and a stale Source mode on a non-countable resource', () => {
    const errors = validate([
      {
        id: 'c1',
        resourceName: 'Slots',
        commandType: 'Acquire',
        count: 1,
        countValueType: 'property',
        countProperty: 'Batch.Size',
      },
      { id: 'c2', resourceName: 'Slots', commandType: 'Release', count: 2 },
      { id: 'c3', resourceName: 'Mutex', commandType: 'Acquire', count: 1, countValueType: 'property' },
    ])
    expect(errors).toEqual([])
  })
})
