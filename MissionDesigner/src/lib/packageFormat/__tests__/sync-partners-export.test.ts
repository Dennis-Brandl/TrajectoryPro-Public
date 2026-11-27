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
// Spec 2026-11-27: a Synchronize SYNC command carries its number of partners, Text or
// Source like an Input Parameter. Text exports as `partners`, Source as `partners_property`;
// nothing else ever exports either field.

import { describe, it, expect } from 'vitest'
import type { Specification } from '@/types/library'
import type { WorkflowNode, StepNodeData, StepResourceCommand } from '@/types/nodes'
import { exportWorkflow } from '../workflow-exporters'
import { transformResourceCommands } from '../../import/transformers'
import type { ResourceCommandSpecification } from '../export-types'

function createSpec(): Specification {
  return {
    id: 'spec-123',
    libraryId: 'lib-456',
    name: 'Sync WF',
    description: 'Test workflow',
    data: { workflowResources: [{ id: 'r1', name: 'Chan', resourceType: 'Sync', count: 1 }] },
    version: '1.0.0',
    state: 'Draft' as const,
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function exportOne(cmd: Partial<StepResourceCommand>): ResourceCommandSpecification {
  const spec = createSpec()
  const node = {
    id: 's1',
    type: 'userInteractionStep',
    position: { x: 0, y: 0 },
    data: {
      label: 's1',
      stepType: 'userInteractionStep',
      resourceCommands: [{ id: 'c1', resourceName: 'Chan', commandType: 'Synchronize', count: 1, ...cmd }],
    } as Partial<StepNodeData>,
  } as WorkflowNode
  return exportWorkflow(spec, [node], [], undefined, [spec]).steps[0].resource_command_specifications![0]
}

describe('Synchronize partners export', () => {
  it('Synchronize with Text partners exports partners as a number', () => {
    const out = exportOne({ partners: '4' })
    expect(out.partners).toBe(4)
    expect(out).not.toHaveProperty('partners_property')
  })

  it('Synchronize with no partners set exports partners 2', () => {
    expect(exportOne({}).partners).toBe(2)
  })

  it('Synchronize in Source mode exports partners_property and no partners', () => {
    const out = exportOne({ partners: '4', partnersValueType: 'property', partnersProperty: 'Batch.Count' })
    expect(out.partners_property).toBe('Batch.Count')
    expect(out).not.toHaveProperty('partners')
  })

  it('Source mode with no key picked exports a blank partners_property so the engine refuses it', () => {
    const out = exportOne({ partners: '4', partnersValueType: 'property', partnersProperty: '  ' })
    expect(out.partners_property).toBe('')
    expect(out).not.toHaveProperty('partners')
  })

  it('a non-number Text value is exported raw so the engine refuses it', () => {
    expect(exportOne({ partners: 'abc' }).partners).toBe('abc')
  })

  it('Send and Receive never export partners, even with leftover fields', () => {
    for (const commandType of ['Send', 'Receive'] as const) {
      const out = exportOne({ commandType, partners: '5', partnersValueType: 'property', partnersProperty: 'X.Y' })
      expect(out).not.toHaveProperty('partners')
      expect(out).not.toHaveProperty('partners_property')
    }
  })
})

describe('Synchronize partners import', () => {
  const base = { command_type: 'Synchronize' as const, resource_name: 'Chan' }
  it('import maps partners and partners_property back to the editor model', () => {
    const [text, source, none] = transformResourceCommands([
      { ...base, partners: 4 },
      { ...base, partners_property: 'Batch.Count' },
      { ...base },
    ] as ResourceCommandSpecification[])!
    expect(text).toMatchObject({ partners: '4' })
    expect(text.partnersValueType).toBeUndefined()
    expect(source).toMatchObject({ partnersValueType: 'property', partnersProperty: 'Batch.Count' })
    expect(none.partners).toBeUndefined()
  })
})
