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
 * Server-side adapter history-field shape tests
 *
 * Verifies the internal data shape of spec objects produced by the
 * server-side adapted-tree helpers (specTreeAdapter, inlineReferencedSteps).
 * These helpers feed into the lifted exporter, which is responsible for
 * actually stripping `history` from the final export package (tested in
 * src/lib/packageFormat/__tests__/history-exclusion.test.ts).
 *
 * Specifically this file asserts:
 *   - adaptSpecTree preserves the DB row's `history` on rootSpec so
 *     DAO consumers can read audit data without re-fetching.
 *   - inlineReferencedSteps gives synthetic cloned specs an empty history
 *     (they have no corresponding DB row).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock specReadDao before importing modules that depend on it.
vi.mock('../../dao/specReadDao', () => {
  const trees = new Map<string, ReturnType<typeof makeSpecTree>>()
  return {
    specReadDao: {
      getTree: vi.fn((_ctx: unknown, specId: string) => trees.get(specId) ?? null),
      getSpecs: vi.fn(() => ({ specs: new Map(), missingIds: [] })),
      getLibrary: vi.fn(() => null),
    },
    __setTree: (specId: string, tree: ReturnType<typeof makeSpecTree>) => trees.set(specId, tree),
    __clear: () => trees.clear(),
  }
})

import { adaptSpecTree } from '../specTreeAdapter'
import { inlineReferencedSteps } from '../inlineReferencedSteps'
import type { ReadContext, SpecTree } from '../../dao/specReadDao'

const daoModule = (await import('../../dao/specReadDao')) as any

const ctx: ReadContext = { sessionUserId: 'user-1' }

const HISTORY_ENTRY = {
  type: 'created',
  at: '2026-05-01T00:00:00Z',
  account: 'user@test.com',
  version: '1.0.0',
}

function makeSpecTree(input: {
  rootId: string
  rootName: string
  libraryId: string
  rootData: Record<string, unknown>
  rootHistory?: (typeof HISTORY_ENTRY)[]
  children?: Array<{ id: string; parentSpecificationId: string; name: string; data: Record<string, unknown> }>
}): SpecTree {
  const root = {
    id: input.rootId,
    libraryId: input.libraryId,
    name: input.rootName,
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data: JSON.stringify(input.rootData),
    dataSchemaVersion: 4,
    parentSpecificationId: null,
    rootSpecificationId: input.rootId,
    effectiveFrom: null,
    history: input.rootHistory ?? [HISTORY_ENTRY],
    createdAt: 1700_000_000_000,
    updatedAt: 1700_000_000_000,
    lastEditedByUserId: null,
  }
  const children = (input.children ?? []).map((c) => ({
    id: c.id,
    libraryId: input.libraryId,
    name: c.name,
    description: null,
    typeName: null,
    version: '1.0.0',
    state: 'Draft',
    data: JSON.stringify(c.data),
    dataSchemaVersion: 4,
    parentSpecificationId: c.parentSpecificationId,
    rootSpecificationId: input.rootId,
    effectiveFrom: null,
    history: [HISTORY_ENTRY],
    createdAt: 1700_000_000_000,
    updatedAt: 1700_000_000_000,
    lastEditedByUserId: null,
  }))
  return {
    library: {
      id: input.libraryId,
      parentLibraryId: null,
      name: 'lib',
      entityType: 'workflow',
      description: null,
      author: null,
      changeHistory: null,
      version: '1.0.0',
      environmentLibraryIds: null,
      createdAt: 1700_000_000_000,
      updatedAt: 1700_000_000_000,
      lastEditedByUserId: null,
      teamId: null,
      createdByUserId: null,
    },
    specs: [root, ...children],
    proxyRefs: [],
    specEnvs: [],
    imageManifest: {},
  } as SpecTree
}

beforeEach(() => {
  daoModule.__clear()
  vi.clearAllMocks()
})

// =============================================================================
// adaptSpecTree — specs in the adapted tree still carry history (internal),
// but when fed through the lifted exporter the history is dropped (tested
// in lib/__tests__/history-exclusion.test.ts). Here we just confirm the
// adapter produces a well-formed result with history available at the spec
// level (so the data-layer has access to it without re-fetching).
// =============================================================================

describe('adaptSpecTree — history field presence', () => {
  it('rootSpec carries history from DB row', async () => {
    const tree = makeSpecTree({
      rootId: 'root-1',
      rootName: 'Root',
      libraryId: 'lib-1',
      rootData: { nodes: [], edges: [] },
      rootHistory: [HISTORY_ENTRY],
    })
    const adapted = await adaptSpecTree(tree, ctx)
    // The rootSpec retains history so DAO consumers can read it
    expect(adapted.rootSpec.history).toEqual([HISTORY_ENTRY])
  })
})

// =============================================================================
// inlineReferencedSteps — cloned specs in allSpecs should NOT carry real
// history entries (they're synthetic clones, not DB rows)
// =============================================================================

describe('inlineReferencedSteps — cloned specs have empty history', () => {
  it('cloned root spec pushed to allSpecs has history: []', async () => {
    // Library workflow (referenced)
    const libTree = makeSpecTree({
      rootId: 'lib-spec-1',
      rootName: 'LibStep',
      libraryId: 'step-lib',
      rootData: {
        nodes: [
          { id: 'ls1', type: 'start', data: { stepType: 'start', label: 'START' }, position: { x: 0, y: 0 } },
          { id: 'ls2', type: 'end', data: { stepType: 'end', label: 'END' }, position: { x: 0, y: 100 } },
        ],
        edges: [{ id: 'le1', source: 'ls1', target: 'ls2' }],
      },
      rootHistory: [HISTORY_ENTRY],
    })
    daoModule.__setTree('lib-spec-1', libTree)

    // Parent workflow with a reference-mode proxy
    const parentTree = makeSpecTree({
      rootId: 'parent-1',
      rootName: 'Parent',
      libraryId: 'workflow-lib',
      rootData: {
        nodes: [
          { id: 'ps1', type: 'start', data: { stepType: 'start', label: 'START' }, position: { x: 0, y: 0 } },
          {
            id: 'ps-proxy',
            type: 'workflowProxy',
            data: {
              stepType: 'workflowProxy',
              label: 'LibStep',
              subWorkflowMode: 'reference',
              referencedStepSpecId: 'lib-spec-1',
              referencedStepLibraryId: 'step-lib',
              referencedStepName: 'LibStep',
            },
            position: { x: 0, y: 200 },
          },
        ],
        edges: [],
      },
      rootHistory: [HISTORY_ENTRY],
    })

    const adapted = await adaptSpecTree(parentTree, ctx)
    await inlineReferencedSteps(adapted, ctx)

    // The cloned spec should have empty history (it's synthetic)
    const clonedSpecs = adapted.allSpecs.filter((s) => s.id !== adapted.rootSpec.id)
    for (const cloned of clonedSpecs) {
      expect(cloned.history).toEqual([])
    }
  })
})
