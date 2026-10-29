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
 * History exclusion tests
 *
 * Verifies that the `history` field (editor metadata, not a runtime contract
 * field) is never serialized into any exported package format:
 *   - exportWorkflowSpec   → .WFmaster JSON
 *   - exportWorkflow        → .WFmaster JSON (single-spec path)
 *   - exportActionLibrary   → .WFaction JSON
 *   - exportEnvironmentSpec → embedded env spec inside .WFmaster / .WFenvir
 *   - exportEnvironmentLibrary → .WFenvir JSON
 *   - exportStepLibrary     → .WFslib JSON
 *
 * Also asserts that embedded child specs inside a workflow export do not
 * carry history (they are produced by buildNestedChildExport internally, so
 * the assertion is on the full exported tree).
 */

import { describe, it, expect } from 'vitest'
import type { Library, Specification, ChildSpecification } from '@/types/library'
import type { WorkflowNode, StepNodeData } from '@/types/nodes'
import type { Edge } from '@xyflow/react'
import type { ConditionalEdgeData } from '@/types/edges'
import { exportWorkflow, exportWorkflowSpec } from '../workflow-exporters'
import {
  exportActionLibrary,
  exportEnvironmentSpec,
  exportEnvironmentLibrary,
  exportStepLibrary,
} from '../library-exporters'

// =============================================================================
// Recursive helper — asserts no object in the tree has a `history` property
// =============================================================================

function hasNoHistory(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return true
  if ('history' in obj) return false
  return Object.values(obj as Record<string, unknown>).every((v) =>
    Array.isArray(v) ? v.every(hasNoHistory) : hasNoHistory(v),
  )
}

// =============================================================================
// Factory helpers
// =============================================================================

const HISTORY_ENTRY = {
  type: 'created' as const,
  at: '2026-05-01T00:00:00Z',
  account: 'user@test.com',
  version: '1.0.0',
}

function makeSpec(overrides: Partial<Specification> = {}): Specification {
  return {
    id: 'spec-1',
    libraryId: 'lib-1',
    name: 'TestSpec',
    description: null,
    version: '1.0.0',
    state: 'Draft' as const,
    data: {},
    history: [HISTORY_ENTRY],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  }
}

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return {
    id: 'lib-1',
    parentLibraryId: null,
    name: 'TestLibrary',
    entityType: 'workflow' as const,
    description: null,
    author: null,
    changeHistory: null,
    version: '1.0.0',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  }
}

function makeNode(id: string, type: StepNodeData['stepType']): WorkflowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: id, stepType: type },
  }
}

function makeChildSpec(overrides: Partial<ChildSpecification> = {}): ChildSpecification {
  return {
    id: 'child-1',
    parentSpecificationId: 'spec-1',
    parentChildSpecId: null,
    name: 'ChildWorkflow',
    description: null,
    data: {
      nodes: [makeNode('cs1', 'start'), makeNode('cs2', 'end')],
      edges: [{ id: 'e1', source: 'cs1', target: 'cs2' }],
    },
    depth: 1,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  }
}

const EMPTY_EDGES: Edge<ConditionalEdgeData>[] = []

// =============================================================================
// exportWorkflow
// =============================================================================

describe('exportWorkflow — history exclusion', () => {
  it('does not include history in exported spec', () => {
    const spec = makeSpec({ history: [HISTORY_ENTRY] })
    const result = exportWorkflow(spec, [], EMPTY_EDGES)
    expect(hasNoHistory(result)).toBe(true)
    expect(result).not.toHaveProperty('history')
  })

  it('does not include history in exported children', () => {
    const spec = makeSpec({ history: [HISTORY_ENTRY] })
    const nodes = [makeNode('n1', 'start'), makeNode('n2', 'workflowProxy')]
    const childTree = [makeChildSpec()]
    const result = exportWorkflow(spec, nodes, EMPTY_EDGES, undefined, [], [], undefined, childTree)
    expect(hasNoHistory(result)).toBe(true)
  })
})

// =============================================================================
// exportWorkflowSpec
// =============================================================================

describe('exportWorkflowSpec — history exclusion', () => {
  it('does not include history in exported spec', () => {
    const spec = makeSpec({ history: [HISTORY_ENTRY] })
    const result = exportWorkflowSpec(spec, [spec])
    expect(hasNoHistory(result)).toBe(true)
    expect(result).not.toHaveProperty('history')
  })

  it('does not include history in exported children via childTree', () => {
    const spec = makeSpec({ history: [HISTORY_ENTRY] })
    const childTree = [makeChildSpec()]
    const result = exportWorkflowSpec(spec, [spec], undefined, undefined, childTree)
    expect(hasNoHistory(result)).toBe(true)
  })

  it('does not include history when env specs with history are embedded', () => {
    const envSpec = makeSpec({
      id: 'env-spec-1',
      libraryId: 'env-lib-1',
      name: 'TestEnv',
      data: { environmentSpecIds: undefined },
      history: [HISTORY_ENTRY],
    })
    const envLib = makeLibrary({ id: 'env-lib-1', entityType: 'environment' })
    const rootSpec = makeSpec({
      id: 'spec-1',
      data: { environmentSpecIds: ['env-spec-1'] },
      history: [HISTORY_ENTRY],
    })
    const allSpecs = [rootSpec, envSpec]
    const allLibraries = [makeLibrary(), envLib]
    const result = exportWorkflowSpec(rootSpec, allSpecs, allLibraries)
    expect(hasNoHistory(result)).toBe(true)
  })
})

// =============================================================================
// exportActionLibrary
// =============================================================================

describe('exportActionLibrary — history exclusion', () => {
  it('does not include history in exported action specs', () => {
    const lib = makeLibrary({ entityType: 'action' })
    const spec = makeSpec({
      libraryId: lib.id,
      history: [HISTORY_ENTRY],
      data: { inputs: [], outputs: [], values: [] },
    })
    const result = exportActionLibrary(lib, [spec])
    expect(hasNoHistory(result)).toBe(true)
  })
})

// =============================================================================
// exportEnvironmentSpec
// =============================================================================

describe('exportEnvironmentSpec — history exclusion', () => {
  it('does not include history in exported environment spec', () => {
    const spec = makeSpec({
      libraryId: 'env-lib-1',
      data: { resources: [], included_actions: [] },
      history: [HISTORY_ENTRY],
    })
    const result = exportEnvironmentSpec(spec)
    expect(hasNoHistory(result)).toBe(true)
    expect(result).not.toHaveProperty('history')
  })
})

// =============================================================================
// exportEnvironmentLibrary
// =============================================================================

describe('exportEnvironmentLibrary — history exclusion', () => {
  it('does not include history in exported environment library', () => {
    const lib = makeLibrary({ entityType: 'environment' })
    const spec = makeSpec({
      libraryId: lib.id,
      data: { resources: [], included_actions: [] },
      history: [HISTORY_ENTRY],
    })
    const result = exportEnvironmentLibrary(lib, [spec])
    expect(hasNoHistory(result)).toBe(true)
  })
})

// =============================================================================
// exportStepLibrary
// =============================================================================

describe('exportStepLibrary — history exclusion', () => {
  it('does not include history in exported step library specs', () => {
    const lib = makeLibrary({ id: 'step-lib-1', entityType: 'step' })
    const spec = makeSpec({
      id: 'step-spec-1',
      libraryId: 'step-lib-1',
      data: { nodes: [], edges: [] },
      history: [HISTORY_ENTRY],
    })
    const result = exportStepLibrary(lib, [spec])
    expect(hasNoHistory(result)).toBe(true)
  })
})
