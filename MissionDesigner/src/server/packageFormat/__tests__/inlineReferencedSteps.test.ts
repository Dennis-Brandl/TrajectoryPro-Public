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

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock specReadDao before importing the helper so the module sees the mock.
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

import { inlineReferencedSteps } from '../inlineReferencedSteps'
import { adaptSpecTree, type AdaptedTree } from '../specTreeAdapter'
import type { ReadContext, SpecTree } from '../../dao/specReadDao'

// Re-import the mock so we can stage trees for getTree to return.

const daoModule = (await import('../../dao/specReadDao')) as any

const ctx: ReadContext = { sessionUserId: 'user-1' }

function makeSpecTree(input: {
  rootId: string
  rootName: string
  libraryId: string
  rootData: Record<string, unknown>
  children?: Array<{
    id: string
    parentSpecificationId: string
    name: string
    data: Record<string, unknown>
  }>
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
    history: [],
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
    history: [],
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

async function adaptParent(tree: SpecTree): Promise<AdaptedTree> {
  return adaptSpecTree(tree, ctx)
}

beforeEach(() => {
  daoModule.__clear()
  vi.clearAllMocks()
})

describe('inlineReferencedSteps', () => {
  it('inlines a single referenced workflow as an embedded child with fresh ids', async () => {
    // Library workflow (referenced)
    const libTree = makeSpecTree({
      rootId: 'lib-spec-1',
      rootName: 'LibStepWorkflow',
      libraryId: 'step-lib',
      rootData: {
        nodes: [
          { id: 'lib-start', type: 'start', data: { stepType: 'start', label: 'START' }, position: { x: 0, y: 0 } },
          { id: 'lib-end', type: 'end', data: { stepType: 'end', label: 'END' }, position: { x: 0, y: 100 } },
        ],
        edges: [{ id: 'lib-edge-1', source: 'lib-start', target: 'lib-end' }],
      },
    })
    daoModule.__setTree('lib-spec-1', libTree)

    // Parent workflow with a reference-mode proxy pointing at the lib step.
    const parentTree = makeSpecTree({
      rootId: 'parent-1',
      rootName: 'Parent',
      libraryId: 'workflow-lib',
      rootData: {
        nodes: [
          { id: 'p-start', type: 'start', data: { stepType: 'start', label: 'START' }, position: { x: 0, y: 0 } },
          {
            id: 'p-proxy',
            type: 'workflowProxy',
            data: {
              stepType: 'workflowProxy',
              label: 'LibStepWorkflow',
              subWorkflowMode: 'reference',
              referencedStepSpecId: 'lib-spec-1',
              referencedStepLibraryId: 'step-lib',
              referencedStepName: 'LibStepWorkflow',
            },
            position: { x: 0, y: 100 },
          },
        ],
        edges: [{ id: 'p-edge-1', source: 'p-start', target: 'p-proxy' }],
      },
    })
    const adapted = await adaptParent(parentTree)

    await inlineReferencedSteps(adapted, ctx)

    // childTree gained a clone of the lib spec.
    expect(adapted.childTree).toHaveLength(1)
    const clone = adapted.childTree[0]
    expect(clone.name).toBe('LibStepWorkflow')
    expect(clone.parentSpecificationId).toBe('parent-1')
    expect(clone.parentChildSpecId).toBeNull()
    expect(clone.id).not.toBe('lib-spec-1') // fresh id

    // Cloned step ids are regenerated (no collision risk).
    const cloneNodes = (clone.data.nodes as Array<{ id: string }>) ?? []
    expect(cloneNodes).toHaveLength(2)
    for (const n of cloneNodes) {
      expect(n.id).not.toBe('lib-start')
      expect(n.id).not.toBe('lib-end')
    }
    const cloneEdges = (clone.data.edges as Array<{ id: string; source: string; target: string }>) ?? []
    expect(cloneEdges).toHaveLength(1)
    // Edge source/target remap to the regenerated node ids
    expect(cloneNodes.map((n) => n.id)).toContain(cloneEdges[0].source)
    expect(cloneNodes.map((n) => n.id)).toContain(cloneEdges[0].target)

    // Proxy node was rewritten to embedded mode.
    const parentNodes = adapted.rootSpec.data.nodes as Array<{ data: Record<string, unknown> }>
    const proxy = parentNodes.find((n) => n.data.stepType === 'workflowProxy')!
    expect(proxy.data.subWorkflowMode).toBe('embedded')
    expect(proxy.data.embeddedWorkflowSpecId).toBe(clone.id)
    expect(proxy.data.referencedStepSpecId).toBeUndefined()
    expect(proxy.data.referencedStepLibraryId).toBeUndefined()
    expect(proxy.data.referencedStepName).toBeUndefined()
  })

  it('produces independent clones when the same lib step is referenced twice', async () => {
    const libTree = makeSpecTree({
      rootId: 'lib-spec-1',
      rootName: 'Reusable',
      libraryId: 'step-lib',
      rootData: {
        nodes: [
          { id: 'lib-start', type: 'start', data: { stepType: 'start', label: 'START' }, position: { x: 0, y: 0 } },
          { id: 'lib-end', type: 'end', data: { stepType: 'end', label: 'END' }, position: { x: 0, y: 100 } },
        ],
        edges: [{ id: 'lib-edge-1', source: 'lib-start', target: 'lib-end' }],
      },
    })
    daoModule.__setTree('lib-spec-1', libTree)

    const parentTree = makeSpecTree({
      rootId: 'parent-1',
      rootName: 'Parent',
      libraryId: 'workflow-lib',
      rootData: {
        nodes: [
          {
            id: 'p-proxy-A',
            type: 'workflowProxy',
            data: {
              stepType: 'workflowProxy',
              label: 'Reusable',
              subWorkflowMode: 'reference',
              referencedStepSpecId: 'lib-spec-1',
              referencedStepLibraryId: 'step-lib',
            },
            position: { x: 0, y: 0 },
          },
          {
            id: 'p-proxy-B',
            type: 'workflowProxy',
            data: {
              stepType: 'workflowProxy',
              label: 'Reusable',
              subWorkflowMode: 'reference',
              referencedStepSpecId: 'lib-spec-1',
              referencedStepLibraryId: 'step-lib',
            },
            position: { x: 0, y: 100 },
          },
        ],
        edges: [],
      },
    })
    const adapted = await adaptParent(parentTree)

    await inlineReferencedSteps(adapted, ctx)

    expect(adapted.childTree).toHaveLength(2)
    const [a, b] = adapted.childTree
    expect(a.id).not.toBe(b.id)

    // Both clones have their own fresh internal node ids.
    const aNodeIds = (a.data.nodes as Array<{ id: string }>).map((n) => n.id)
    const bNodeIds = (b.data.nodes as Array<{ id: string }>).map((n) => n.id)
    for (const id of aNodeIds) {
      expect(bNodeIds).not.toContain(id)
    }

    // Each proxy now points to its own clone.
    const parentNodes = adapted.rootSpec.data.nodes as Array<{ id: string; data: Record<string, unknown> }>
    const proxyA = parentNodes.find((n) => n.id === 'p-proxy-A')!
    const proxyB = parentNodes.find((n) => n.id === 'p-proxy-B')!
    expect(proxyA.data.embeddedWorkflowSpecId).toBe(a.id)
    expect(proxyB.data.embeddedWorkflowSpecId).toBe(b.id)
    expect(proxyA.data.embeddedWorkflowSpecId).not.toBe(proxyB.data.embeddedWorkflowSpecId)
  })

  it('inlines nested references (lib step that itself references another lib step)', async () => {
    // Inner lib (referenced by the outer lib).
    const innerTree = makeSpecTree({
      rootId: 'inner-1',
      rootName: 'Inner',
      libraryId: 'step-lib',
      rootData: {
        nodes: [
          { id: 'in-start', type: 'start', data: { stepType: 'start', label: 'START' }, position: { x: 0, y: 0 } },
        ],
        edges: [],
      },
    })
    // Outer lib has its own reference-mode proxy pointing at inner.
    const outerTree = makeSpecTree({
      rootId: 'outer-1',
      rootName: 'Outer',
      libraryId: 'step-lib',
      rootData: {
        nodes: [
          {
            id: 'out-proxy',
            type: 'workflowProxy',
            data: {
              stepType: 'workflowProxy',
              label: 'Inner',
              subWorkflowMode: 'reference',
              referencedStepSpecId: 'inner-1',
              referencedStepLibraryId: 'step-lib',
            },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      },
    })
    daoModule.__setTree('inner-1', innerTree)
    daoModule.__setTree('outer-1', outerTree)

    const parentTree = makeSpecTree({
      rootId: 'parent-1',
      rootName: 'Parent',
      libraryId: 'workflow-lib',
      rootData: {
        nodes: [
          {
            id: 'p-proxy',
            type: 'workflowProxy',
            data: {
              stepType: 'workflowProxy',
              label: 'Outer',
              subWorkflowMode: 'reference',
              referencedStepSpecId: 'outer-1',
              referencedStepLibraryId: 'step-lib',
            },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      },
    })
    const adapted = await adaptParent(parentTree)

    await inlineReferencedSteps(adapted, ctx)

    // childTree has BOTH the outer clone and its inner clone.
    expect(adapted.childTree).toHaveLength(2)
    const outerClone = adapted.childTree.find((c) => c.name === 'Outer')!
    const innerClone = adapted.childTree.find((c) => c.name === 'Inner')!
    expect(outerClone).toBeDefined()
    expect(innerClone).toBeDefined()

    // Inner clone is parented under outer clone.
    expect(innerClone.parentChildSpecId).toBe(outerClone.id)

    // The cloned outer's proxy node is now embedded mode pointing to inner clone.
    const outerNodes = outerClone.data.nodes as Array<{ data: Record<string, unknown> }>
    const outerProxy = outerNodes.find((n) => n.data.stepType === 'workflowProxy')!
    expect(outerProxy.data.subWorkflowMode).toBe('embedded')
    expect(outerProxy.data.embeddedWorkflowSpecId).toBe(innerClone.id)
    expect(outerProxy.data.referencedStepSpecId).toBeUndefined()
  })

  it('leaves the proxy alone when the referenced spec cannot be resolved', async () => {
    // No tree staged for the referenced id — getTree returns null.
    const parentTree = makeSpecTree({
      rootId: 'parent-1',
      rootName: 'Parent',
      libraryId: 'workflow-lib',
      rootData: {
        nodes: [
          {
            id: 'p-proxy',
            type: 'workflowProxy',
            data: {
              stepType: 'workflowProxy',
              label: 'Missing',
              subWorkflowMode: 'reference',
              referencedStepSpecId: 'does-not-exist',
              referencedStepLibraryId: 'step-lib',
            },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      },
    })
    const adapted = await adaptParent(parentTree)

    await inlineReferencedSteps(adapted, ctx)

    expect(adapted.childTree).toHaveLength(0)
    const proxy = (adapted.rootSpec.data.nodes as Array<{ data: Record<string, unknown> }>)[0]
    expect(proxy.data.subWorkflowMode).toBe('reference') // unchanged
    expect(proxy.data.referencedStepSpecId).toBe('does-not-exist')
  })

  it('does not infinite-loop on cyclic references (A -> A)', async () => {
    // Self-referencing library spec.
    const cycle = makeSpecTree({
      rootId: 'cyc-1',
      rootName: 'Cycle',
      libraryId: 'step-lib',
      rootData: {
        nodes: [
          {
            id: 'c-proxy',
            type: 'workflowProxy',
            data: {
              stepType: 'workflowProxy',
              label: 'Cycle',
              subWorkflowMode: 'reference',
              referencedStepSpecId: 'cyc-1',
              referencedStepLibraryId: 'step-lib',
            },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      },
    })
    daoModule.__setTree('cyc-1', cycle)

    const parentTree = makeSpecTree({
      rootId: 'parent-1',
      rootName: 'Parent',
      libraryId: 'workflow-lib',
      rootData: {
        nodes: [
          {
            id: 'p-proxy',
            type: 'workflowProxy',
            data: {
              stepType: 'workflowProxy',
              label: 'Cycle',
              subWorkflowMode: 'reference',
              referencedStepSpecId: 'cyc-1',
              referencedStepLibraryId: 'step-lib',
            },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      },
    })
    const adapted = await adaptParent(parentTree)

    // Should terminate. We accept either: (a) one level of clone with the
    // inner self-proxy left in reference mode, or (b) zero clones with the
    // outer proxy left in reference mode. Either is correct cycle handling.
    await expect(inlineReferencedSteps(adapted, ctx)).resolves.toBeDefined()
    // The outer proxy was inlinable (cyc-1 not yet in cycleGuard), so we expect
    // exactly one clone whose inner proxy still references cyc-1.
    expect(adapted.childTree.length).toBeLessThanOrEqual(1)
  })

  it('ignores embedded-mode proxies (no spurious cloning)', async () => {
    const parentTree = makeSpecTree({
      rootId: 'parent-1',
      rootName: 'Parent',
      libraryId: 'workflow-lib',
      rootData: {
        nodes: [
          {
            id: 'p-proxy',
            type: 'workflowProxy',
            data: {
              stepType: 'workflowProxy',
              label: 'Embedded',
              subWorkflowMode: 'embedded',
              embeddedWorkflowSpecId: 'some-existing-child',
            },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      },
    })
    const adapted = await adaptParent(parentTree)
    await inlineReferencedSteps(adapted, ctx)
    expect(adapted.childTree).toHaveLength(0)
  })
})
