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
import { importWorkflowSpecToInternal } from '@/lib/import/workflow-importers'
import { readTypeName } from '../type-name'
import type { MasterWorkflowSpecification } from '../export-types'

function createMockSpec(typeName: string | null): Specification {
  return {
    id: 'spec-1',
    libraryId: 'lib-1',
    name: 'Root',
    description: null,
    typeName,
    data: {},
    version: '1.0.0',
    state: 'Draft',
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function node(id: string, type: StepNodeData['stepType']): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, stepType: type } }
}

function child(typeName: string | null, overrides: Partial<ChildSpecification> = {}): ChildSpecification {
  return {
    id: 'child-1',
    parentSpecificationId: 'spec-1',
    parentChildSpecId: null,
    name: 'Child',
    description: null,
    typeName,
    data: { nodes: [node('cs', 'start'), node('ce', 'end')], edges: [{ id: 'e', source: 'cs', target: 'ce' }] },
    depth: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

const edges: Edge<ConditionalEdgeData>[] = []
const rootNodes = [node('s', 'start'), node('e', 'end')]

describe('type_name export', () => {
  it('writes type_name on the root and on a nested child', () => {
    const grand = child('Phase', { id: 'gc', parentChildSpecId: 'child-1', name: 'Grand', depth: 2 })
    const out = exportWorkflow(createMockSpec('Procedure'), rootNodes, edges, undefined, [], [], undefined, [
      child('Unit Procedure'),
      grand,
    ])
    expect(out.type_name).toBe('Procedure')
    expect(out.children![0].type_name).toBe('Unit Procedure')
    expect(out.children![0].children![0].type_name).toBe('Phase')
  })

  it('omits the key entirely when the type is null or empty', () => {
    const out = exportWorkflow(createMockSpec(null), rootNodes, edges, undefined, [], [], undefined, [child(null)])
    expect('type_name' in out).toBe(false)
    expect('type_name' in out.children![0]).toBe(false)
    const blank = exportWorkflow(createMockSpec(''), rootNodes, edges)
    expect('type_name' in blank).toBe(false)
  })
})

describe('type_name import (client importer)', () => {
  it('round-trips root and child types', () => {
    const out = exportWorkflow(createMockSpec('Procedure'), rootNodes, edges, undefined, [], [], undefined, [
      child('Unit Procedure'),
    ])
    const json = JSON.parse(JSON.stringify(out)) as MasterWorkflowSpecification
    const imported = importWorkflowSpecToInternal(json, Date.now())
    expect(imported.typeName).toBe('Procedure')
    const pending = imported.data._pendingChildWorkflows as Array<{ typeName: string | null }>
    expect(pending[0].typeName).toBe('Unit Procedure')
  })

  it('a package without the key imports as null', () => {
    const out = exportWorkflow(createMockSpec(null), rootNodes, edges)
    const imported = importWorkflowSpecToInternal(JSON.parse(JSON.stringify(out)), Date.now())
    expect(imported.typeName).toBeNull()
  })

  it('a non-string type_name imports as null', () => {
    const out = exportWorkflow(createMockSpec(null), rootNodes, edges)
    const json = { ...JSON.parse(JSON.stringify(out)), type_name: 3 }
    expect(importWorkflowSpecToInternal(json, Date.now()).typeName).toBeNull()
  })
})

describe('readTypeName', () => {
  it('trims, and nulls blank, non-string and over-50 values', () => {
    expect(readTypeName('  Operation ')).toBe('Operation')
    expect(readTypeName('   ')).toBeNull()
    expect(readTypeName(3)).toBeNull()
    expect(readTypeName(undefined)).toBeNull()
    expect(readTypeName('x'.repeat(50))).toBe('x'.repeat(50))
    expect(readTypeName('x'.repeat(51))).toBeNull()
  })
})
