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

// Inlines referenced library workflows into the package as deep-copied
// embedded children, so a .WFmasterX is fully self-contained — the runtime
// never needs to resolve a cross-library reference.
//
// A workflowProxy node has two modes:
//   - embedded:  body lives in spec_tree as a child_specification (already
//                exported as `children[]`).
//   - reference: body lives in a separate Master Workflow Step Library; the
//                node only carries a pointer (referencedStepSpecId/
//                referencedStepLibraryId).
//
// For the runtime package we resolve every reference to a deep clone with
// fresh oids, append the clone(s) to the workflow's ChildSpecification tree,
// and rewrite the proxy node to embedded mode. The downstream exporter then
// picks them up via the existing `children[]` assembly path.

import { randomUUID } from 'node:crypto'
import type { ReadContext } from '../dao/specReadDao'
import { specReadDao } from '../dao/specReadDao'
import { adaptSpecTree, type AdaptedTree } from './specTreeAdapter'
import type {
  Specification as ClientSpecification,
  ChildSpecification as ClientChildSpecification,
} from '@/types/library'

/**
 * Walk the adapted tree, resolve every workflowProxy with subWorkflowMode='reference',
 * and inline the referenced workflow as a deep-copied embedded child.
 *
 * Mutates `adapted` in place: childTree gains new ChildSpecifications, allSpecs
 * gains the new clones (and any env specs from the referenced workflows), and
 * each proxy node's data is rewritten from reference → embedded mode.
 */
export async function inlineReferencedSteps(adapted: AdaptedTree, ctx: ReadContext): Promise<AdaptedTree> {
  const cycleGuard = new Set<string>()

  // Snapshot the original child count BEFORE any cloning so newly appended
  // clones aren't iterated again by this top-level loop. cloneAndAppend
  // already eagerly inlines clones inside the cycleGuard scope of the call
  // that created them; re-processing them here would let the guard pop and
  // re-enter, causing infinite recursion on self-referencing library specs.
  const originalChildCount = adapted.childTree.length

  await inlineWithinSpec(adapted.rootSpec.id, adapted.rootSpec.data, adapted, ctx, cycleGuard)
  for (let i = 0; i < originalChildCount; i++) {
    const child = adapted.childTree[i]
    await inlineWithinSpec(child.id, child.data, adapted, ctx, cycleGuard)
  }

  return adapted
}

async function inlineWithinSpec(
  ownerSpecId: string,
  ownerData: Record<string, unknown>,
  outer: AdaptedTree,
  ctx: ReadContext,
  cycleGuard: Set<string>,
): Promise<void> {
  const nodes = ownerData.nodes
  if (!Array.isArray(nodes)) return

  for (const rawNode of nodes) {
    if (!rawNode || typeof rawNode !== 'object') continue
    const node = rawNode as { type?: unknown; data?: Record<string, unknown> }
    const nodeData = node.data
    if (!nodeData) continue

    const isWorkflowProxy = node.type === 'workflowProxy' || nodeData.stepType === 'workflowProxy'
    if (!isWorkflowProxy) continue
    if (nodeData.subWorkflowMode !== 'reference') continue

    const refSpecId = nodeData.referencedStepSpecId
    if (typeof refSpecId !== 'string' || refSpecId.length === 0) continue

    if (cycleGuard.has(refSpecId)) {
      // Self-referencing or cyclic graph — refuse to inline an infinite tree.
      // Leave the proxy alone so the runtime sees a bare proxy and can fail
      // loudly instead of us silently swallowing the cycle.
      continue
    }

    const refTree = await specReadDao.getTree(ctx, refSpecId)
    if (!refTree) continue // referenced spec is missing or not visible to caller

    let refAdapted: AdaptedTree
    try {
      refAdapted = await adaptSpecTree(refTree, ctx)
    } catch {
      continue
    }

    cycleGuard.add(refSpecId)
    const clonedRootId = await cloneAndAppend(refAdapted, ownerSpecId, outer, ctx, cycleGuard)
    cycleGuard.delete(refSpecId)

    if (!clonedRootId) continue

    // Rewrite the proxy node: clear reference-mode pointers, install the new
    // embedded clone id. The runtime's local_id-based join from proxy step to
    // child workflow continues to work because the cloned child's name still
    // matches the source library step's name (and the proxy's label is the
    // same — typically the user copied that label from the lib step).
    nodeData.subWorkflowMode = 'embedded'
    nodeData.embeddedWorkflowSpecId = clonedRootId
    delete nodeData.referencedStepSpecId
    delete nodeData.referencedStepLibraryId
    delete nodeData.referencedStepName
  }
}

/**
 * Deep-clone the referenced adapted tree, append it to `outer.childTree` /
 * `outer.allSpecs`, carry env specs/libraries forward, and recurse so any
 * nested references inside the clone are also inlined.
 *
 * `ownerSpecId` is the spec containing the proxy that triggered this inline.
 * If it equals `outer.rootSpec.id`, the clone is a direct child of the root
 * (parentChildSpecId=null). Otherwise the clone is parented under that owner
 * (parentChildSpecId=ownerSpecId), so referenced-within-referenced workflows
 * land in the correct place in the child tree.
 *
 * Returns the new clone root spec id, or null if cloning failed.
 */
async function cloneAndAppend(
  ref: AdaptedTree,
  ownerSpecId: string,
  outer: AdaptedTree,
  ctx: ReadContext,
  cycleGuard: Set<string>,
): Promise<string | null> {
  // Generate fresh ids for the cloned root and every cloned child.
  const idMap = new Map<string, string>()
  const newRootId = randomUUID()
  idMap.set(ref.rootSpec.id, newRootId)
  for (const child of ref.childTree) {
    idMap.set(child.id, randomUUID())
  }

  // Clone the root spec's data with fresh internal step/edge ids.
  const rootDataClone = deepCloneSpecData(ref.rootSpec.data)

  const cloneRootParentChildSpecId = ownerSpecId === outer.rootSpec.id ? null : ownerSpecId

  const newRootChild: ClientChildSpecification = {
    id: newRootId,
    parentSpecificationId: outer.rootSpec.id,
    parentChildSpecId: cloneRootParentChildSpecId,
    name: ref.rootSpec.name,
    description: ref.rootSpec.description,
    typeName: ref.rootSpec.typeName ?? null,
    data: rootDataClone,
    depth: 1,
    createdAt: ref.rootSpec.createdAt,
    updatedAt: ref.rootSpec.updatedAt,
  }
  outer.childTree.push(newRootChild)
  outer.allSpecs.push({
    id: newRootId,
    libraryId: outer.rootSpec.libraryId,
    name: ref.rootSpec.name,
    description: ref.rootSpec.description,
    typeName: ref.rootSpec.typeName ?? null,
    version: '1.0.0',
    state: 'Draft',
    data: rootDataClone,
    history: [],
    createdAt: ref.rootSpec.createdAt,
    updatedAt: ref.rootSpec.updatedAt,
  })

  // Clone each descendant child with remapped parent linkage.
  const clonedDataByNewId = new Map<string, Record<string, unknown>>()
  clonedDataByNewId.set(newRootId, rootDataClone)
  for (const child of ref.childTree) {
    const newId = idMap.get(child.id)!
    const newParentChildSpecId =
      child.parentChildSpecId === null ? newRootId : (idMap.get(child.parentChildSpecId) ?? newRootId)
    const dataClone = deepCloneSpecData(child.data)
    clonedDataByNewId.set(newId, dataClone)
    outer.childTree.push({
      id: newId,
      parentSpecificationId: outer.rootSpec.id,
      parentChildSpecId: newParentChildSpecId,
      name: child.name,
      description: child.description,
      typeName: child.typeName ?? null,
      data: dataClone,
      depth: child.depth + 1,
      createdAt: child.createdAt,
      updatedAt: child.updatedAt,
    })
    outer.allSpecs.push({
      id: newId,
      libraryId: outer.rootSpec.libraryId,
      name: child.name,
      description: child.description,
      typeName: child.typeName ?? null,
      version: '1.0.0',
      state: 'Draft',
      data: dataClone,
      history: [],
      createdAt: child.createdAt,
      updatedAt: child.updatedAt,
    })
  }

  // Carry over env specs and libraries referenced by the cloned tree so the
  // env exporter can still resolve them. Skip anything already present.
  const refRootAndChildIds = new Set<string>([ref.rootSpec.id, ...ref.childTree.map((c) => c.id)])
  for (const spec of ref.allSpecs) {
    if (refRootAndChildIds.has(spec.id)) continue
    if (outer.allSpecs.some((s) => s.id === spec.id)) continue
    outer.allSpecs.push(spec)
  }
  for (const lib of ref.allLibraries) {
    if (outer.allLibraries.some((l) => l.id === lib.id)) continue
    outer.allLibraries.push(lib)
  }

  // Recurse: a cloned tree may itself contain reference-mode proxies. Resolve
  // them now (under the same cycleGuard scope) so the package emerges fully
  // self-contained. Each clone's own id is the owner so that references
  // discovered inside it are parented under it, not under the outer root.
  for (const [cloneId, data] of clonedDataByNewId) {
    await inlineWithinSpec(cloneId, data, outer, ctx, cycleGuard)
  }

  return newRootId
}

/**
 * Structural deep-clone of a spec.data object, with fresh React Flow node and
 * edge ids. Edge `source`/`target` references are remapped to match the new
 * node ids.
 *
 * Other identifiers inside (parameter oids, value property oids, etc.) are
 * left untouched — they already live within the cloned spec's scope, so they
 * cannot collide with siblings; this matches the semantics of an in-editor
 * "Copy from Workflow" embedded copy.
 */
function deepCloneSpecData(data: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(data)) as Record<string, unknown>

  const nodeIdMap = new Map<string, string>()
  const nodes = clone.nodes
  if (Array.isArray(nodes)) {
    for (const rawNode of nodes) {
      if (!rawNode || typeof rawNode !== 'object') continue
      const n = rawNode as { id?: unknown }
      if (typeof n.id === 'string') {
        const newId = randomUUID()
        nodeIdMap.set(n.id, newId)
        n.id = newId
      }
    }
  }

  const edges = clone.edges
  if (Array.isArray(edges)) {
    for (const rawEdge of edges) {
      if (!rawEdge || typeof rawEdge !== 'object') continue
      const e = rawEdge as { id?: unknown; source?: unknown; target?: unknown }
      if (typeof e.id === 'string') e.id = randomUUID()
      if (typeof e.source === 'string') {
        const m = nodeIdMap.get(e.source)
        if (m) e.source = m
      }
      if (typeof e.target === 'string') {
        const m = nodeIdMap.get(e.target)
        if (m) e.target = m
      }
    }
  }

  return clone
}

/** Re-export for tests that need to drive the helpers directly. */
export const _internal = { inlineWithinSpec, cloneAndAppend, deepCloneSpecData }

// Type-only re-export so callers can import the input/output shape from one place.
export type { AdaptedTree }
export type { ClientSpecification }
