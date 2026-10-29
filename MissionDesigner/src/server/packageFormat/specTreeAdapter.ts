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

// Phase 1 — v7.0 envelope migration.
//
// Bridges the server's `SpecTree` shape (flat `SpecFull[]` with stringified
// `data`, parentSpecificationId pointers) to the editor frontend's split shape
// (root `Specification` + `ChildSpecification[]` with parsed `data` objects)
// that the lifted exporter at `@/lib/packageFormat/workflow-exporters` expects.
//
// Also fetches referenced environment specs / libraries so the exporter can
// embed `environment_specifications[]` per the v7.0 schema.

import type { SpecTree, SpecFull, ReadContext, Library as DaoLibrary } from '../dao/specReadDao'
import { specReadDao } from '../dao/specReadDao'
import type {
  Library as ClientLibrary,
  Specification as ClientSpecification,
  ChildSpecification as ClientChildSpecification,
  EntityType,
  SpecificationState,
} from '@/types/library'

export interface AdaptedTree {
  /** Root workflow spec, with parsed data. */
  rootSpec: ClientSpecification
  /** All non-root specs flattened to ChildSpecification with parentChildSpecId + depth. */
  childTree: ClientChildSpecification[]
  /**
   * Every spec the lifted exporter may need to resolve — root + children + any
   * environment specs referenced via spec.data.environmentSpecIds. Indexed by id
   * by the exporter via Map.
   */
  allSpecs: ClientSpecification[]
  /** Workflow library + every environment library referenced by an env spec. */
  allLibraries: ClientLibrary[]
}

const VALID_STATES = new Set<SpecificationState>([
  'Draft',
  'InTest',
  'InReview',
  'Approved',
  'Effective',
  'Superseded',
  'Obsolete',
])

function asSpecState(s: string | null): SpecificationState {
  if (s && VALID_STATES.has(s as SpecificationState)) return s as SpecificationState
  return 'Draft'
}

function parseData(jsonText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(jsonText)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fallthrough
  }
  return {}
}

function adaptLibrary(row: DaoLibrary): ClientLibrary {
  return {
    id: row.id,
    parentLibraryId: row.parentLibraryId,
    name: row.name,
    entityType: row.entityType as EntityType,
    description: row.description,
    author: row.author,
    changeHistory: row.changeHistory,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function adaptToSpecification(s: SpecFull): ClientSpecification {
  return {
    id: s.id,
    libraryId: s.libraryId ?? '',
    name: s.name,
    description: s.description,
    typeName: s.typeName,
    version: s.version ?? '1.0.0',
    state: asSpecState(s.state),
    data: parseData(s.data),
    history: s.history,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }
}

function computeDepths(specs: SpecFull[], rootId: string): Map<string, number> {
  const depths = new Map<string, number>()
  depths.set(rootId, 0)
  // Iterate until stable — at most O(n^2) but spec trees are tiny.
  let changed = true
  while (changed) {
    changed = false
    for (const s of specs) {
      if (depths.has(s.id)) continue
      if (!s.parentSpecificationId) continue
      const parentDepth = depths.get(s.parentSpecificationId)
      if (parentDepth === undefined) continue
      depths.set(s.id, parentDepth + 1)
      changed = true
    }
  }
  return depths
}

/**
 * Adapt a server `SpecTree` to the shape the lifted exporter consumes.
 *
 * Resolves referenced environment specs and libraries via additional DAO reads
 * so the exporter can embed `environment_specifications[]` per spec.
 *
 * @param tree     The workflow spec tree from `specReadDao.getTree`.
 * @param ctx      Read context for the env spec / library lookups.
 * @returns        Adapted shape ready to feed into `exportWorkflowSpec`.
 * @throws         When the tree has no root spec (parentSpecificationId === null).
 */
export async function adaptSpecTree(tree: SpecTree, ctx: ReadContext): Promise<AdaptedTree> {
  const rootRow = tree.specs.find((s) => s.parentSpecificationId === null)
  if (!rootRow) {
    throw new Error('SpecTree has no root spec (parentSpecificationId === null)')
  }

  const workflowLibrary = adaptLibrary(tree.library)
  const rootSpec = adaptToSpecification(rootRow)

  // Children = every non-root spec, mapped to ChildSpecification.
  const depths = computeDepths(tree.specs, rootRow.id)
  const childTree: ClientChildSpecification[] = tree.specs
    .filter((s) => s.id !== rootRow.id)
    .map((s) => ({
      id: s.id,
      parentSpecificationId: s.parentSpecificationId ?? rootRow.id,
      parentChildSpecId: s.parentSpecificationId === rootRow.id ? null : (s.parentSpecificationId ?? null),
      name: s.name,
      description: s.description,
      typeName: s.typeName,
      data: parseData(s.data),
      depth: depths.get(s.id) ?? 1,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }))

  // Pre-populate allSpecs with the root + children adapted form.
  const allSpecs: ClientSpecification[] = [rootSpec]
  for (const c of childTree) {
    allSpecs.push({
      id: c.id,
      libraryId: rootSpec.libraryId,
      name: c.name,
      description: c.description,
      typeName: c.typeName,
      version: '1.0.0',
      state: 'Draft',
      data: c.data,
      history: [],
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })
  }

  // Resolve environment specs referenced via data.environmentSpecIds across the
  // entire tree, fetch them with read-permission filtering, and add to allSpecs.
  const referencedEnvSpecIds = new Set<string>()
  for (const s of tree.specs) {
    const data = parseData(s.data)
    const ids = data.environmentSpecIds
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === 'string') referencedEnvSpecIds.add(id)
      }
    }
  }

  const allLibraries: ClientLibrary[] = [workflowLibrary]

  if (referencedEnvSpecIds.size > 0) {
    const envSpecLookup = await specReadDao.getSpecs(ctx, [...referencedEnvSpecIds])
    const envLibIds = new Set<string>()
    for (const envSpec of envSpecLookup.specs.values()) {
      allSpecs.push(adaptToSpecification(envSpec))
      if (envSpec.libraryId) envLibIds.add(envSpec.libraryId)
    }
    for (const libId of envLibIds) {
      const lib = await specReadDao.getLibrary(ctx, libId)
      if (lib) allLibraries.push(adaptLibrary(lib))
    }
  }

  return { rootSpec, childTree, allSpecs, allLibraries }
}
