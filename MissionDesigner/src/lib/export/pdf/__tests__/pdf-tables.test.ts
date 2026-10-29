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
import { describe, it, expect, vi } from 'vitest'

// Mock jspdf-autotable so table tests don't require a DOM/jsPDF instance
vi.mock('jspdf-autotable', () => ({
  default: vi.fn(),
}))

// Mock pdf-export's renderSectionHeader so renderLabeledTable tests don't need jsPDF
vi.mock('../pdf-export', () => ({
  renderSectionHeader: vi.fn((_doc: unknown, _text: string, y: number) => y + 20),
}))

import {
  buildInputParamsTable,
  buildOutputParamsTable,
  buildValuePropertiesTable,
  buildResourcesTable,
  buildResourceCommandsTable,
} from '../pdf-tables'
import type { ParameterSpec, ValueSpec, ResourceSpec, StepResourceCommand } from '@/types/nodes'

// ---------------------------------------------------------------------------
// buildInputParamsTable
// ---------------------------------------------------------------------------

describe('buildInputParamsTable', () => {
  it('returns null for undefined params', () => {
    expect(buildInputParamsTable(undefined, 'workflow')).toBeNull()
  })

  it('returns null for empty params array', () => {
    expect(buildInputParamsTable([], 'workflow')).toBeNull()
  })

  it('returns correct columns for workflow level', () => {
    const params: ParameterSpec[] = [{ id: '1', name: 'Input1', description: 'Desc', value: 'default' }]
    const result = buildInputParamsTable(params, 'workflow')
    expect(result).not.toBeNull()
    expect(result!.head[0]).toEqual(['Name', 'Description', 'Default Value'])
    expect(result!.body[0]).toEqual(['Input1', 'Desc', 'default'])
  })

  it('returns correct columns for step level', () => {
    const params: ParameterSpec[] = [
      { id: '1', name: 'StepParam', description: 'A param', value: 'someValue', valueType: 'literal' },
    ]
    const result = buildInputParamsTable(params, 'step')
    expect(result).not.toBeNull()
    expect(result!.head[0]).toEqual(['Name', 'Description', 'Value / Source'])
    expect(result!.body[0][0]).toBe('StepParam')
    expect(result!.body[0][2]).toBe('someValue')
  })

  it('prefixes property references with arrow for step level', () => {
    const params: ParameterSpec[] = [{ id: '1', name: 'Prop', value: 'MyProp.Value', valueType: 'property' }]
    const result = buildInputParamsTable(params, 'step')
    expect(result!.body[0][2]).toBe('→ MyProp.Value')
  })

  it('returns correct columns for action level', () => {
    const params: ParameterSpec[] = [
      {
        id: '1',
        name: 'ActionParam',
        description: 'Action description',
        entries: [
          { id: 'e1', name: 'Value', value: '' },
          { id: 'e2', name: 'Description', value: '' },
        ],
      },
    ]
    const result = buildInputParamsTable(params, 'action')
    expect(result).not.toBeNull()
    expect(result!.head[0]).toEqual(['Name', 'Entries', 'Description'])
    expect(result!.body[0][0]).toBe('ActionParam')
    expect(result!.body[0][1]).toBe('Value, Description')
    expect(result!.body[0][2]).toBe('Action description')
  })
})

// ---------------------------------------------------------------------------
// buildOutputParamsTable
// ---------------------------------------------------------------------------

describe('buildOutputParamsTable', () => {
  it('returns null for undefined params', () => {
    expect(buildOutputParamsTable(undefined, 'workflow')).toBeNull()
  })

  it('returns null for empty params array', () => {
    expect(buildOutputParamsTable([], 'step')).toBeNull()
  })

  it('returns correct columns for workflow level', () => {
    const params: ParameterSpec[] = [{ id: '1', name: 'Output1', description: 'An output', target: 'SomeProp.Value' }]
    const result = buildOutputParamsTable(params, 'workflow')
    expect(result).not.toBeNull()
    expect(result!.head[0]).toEqual(['Name', 'Description', 'Target Property'])
    expect(result!.body[0]).toEqual(['Output1', 'An output', 'SomeProp.Value'])
  })

  it('returns correct columns for step level', () => {
    const params: ParameterSpec[] = [{ id: '1', name: 'StepOutput', target: 'Result.Value' }]
    const result = buildOutputParamsTable(params, 'step')
    expect(result).not.toBeNull()
    expect(result!.head[0]).toEqual(['Name', 'Description', 'Target Property'])
    expect(result!.body[0][2]).toBe('Result.Value')
  })
})

// ---------------------------------------------------------------------------
// buildValuePropertiesTable
// ---------------------------------------------------------------------------

describe('buildValuePropertiesTable', () => {
  it('returns null for undefined values', () => {
    expect(buildValuePropertiesTable(undefined)).toBeNull()
  })

  it('returns null for empty values array', () => {
    expect(buildValuePropertiesTable([])).toBeNull()
  })

  it('returns correct columns with formatted entries', () => {
    const values: ValueSpec[] = [
      {
        id: '1',
        name: 'UserResponse',
        entries: [
          { id: 'e1', name: 'Value', value: '' },
          { id: 'e2', name: 'Description', value: 'User answer' },
        ],
      },
    ]
    const result = buildValuePropertiesTable(values)
    expect(result).not.toBeNull()
    expect(result!.head[0]).toEqual(['Name', 'Entries'])
    expect(result!.body[0][0]).toBe('UserResponse')
    expect(result!.body[0][1]).toContain('Value:')
    expect(result!.body[0][1]).toContain('Description:')
  })
})

// ---------------------------------------------------------------------------
// buildResourcesTable
// ---------------------------------------------------------------------------

describe('buildResourcesTable', () => {
  it('returns null for undefined resources', () => {
    expect(buildResourcesTable(undefined)).toBeNull()
  })

  it('returns null for empty resources array', () => {
    expect(buildResourcesTable([])).toBeNull()
  })

  it('returns correct columns', () => {
    const resources: ResourceSpec[] = [
      {
        id: '1',
        name: 'Camera',
        resourceType: 'Single Use',
        count: 1,
        names: undefined,
      },
    ]
    const result = buildResourcesTable(resources)
    expect(result).not.toBeNull()
    expect(result!.head[0]).toEqual(['Name', 'Type', 'Count/Limit', 'Names'])
    expect(result!.body[0]).toEqual(['Camera', 'Single Use', '1', ''])
  })

  it('formats named resources correctly', () => {
    const resources: ResourceSpec[] = [
      {
        id: '1',
        name: 'Bay',
        resourceType: 'Named',
        count: 3,
        names: ['Bay1', 'Bay2', 'Bay3'],
      },
    ]
    const result = buildResourcesTable(resources)
    expect(result!.body[0][3]).toBe('Bay1, Bay2, Bay3')
  })
})

// ---------------------------------------------------------------------------
// buildResourceCommandsTable
// ---------------------------------------------------------------------------

describe('buildResourceCommandsTable', () => {
  it('returns null for undefined commands', () => {
    expect(buildResourceCommandsTable(undefined)).toBeNull()
  })

  it('returns null for empty commands array', () => {
    expect(buildResourceCommandsTable([])).toBeNull()
  })

  it('returns correct columns', () => {
    const commands: StepResourceCommand[] = [
      {
        id: '1',
        commandType: 'Acquire',
        resourceName: 'Camera',
        count: 1,
        target: 'CameraSlot.Value',
      },
    ]
    const result = buildResourceCommandsTable(commands)
    expect(result).not.toBeNull()
    expect(result!.head[0]).toEqual(['Command Type', 'Resource Name', 'Count', 'Target/Source'])
    expect(result!.body[0]).toEqual(['Acquire', 'Camera', '1', 'CameraSlot.Value'])
  })

  it('uses source when target is absent', () => {
    const commands: StepResourceCommand[] = [
      {
        id: '2',
        commandType: 'Send',
        resourceName: 'DataBus',
        count: 1,
        source: 'Payload.Value',
      },
    ]
    const result = buildResourceCommandsTable(commands)
    expect(result!.body[0][3]).toBe('Payload.Value')
  })
})
