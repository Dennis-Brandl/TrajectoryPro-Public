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

// Phase 35 §2.3: read DAO — the ONLY place in the codebase that queries
// sensitive content tables (library, specification, image, junctions,
// proxy_reference). Imports from `_sensitiveTables` (enforced by the
// `cutover/no-sensitive-table-imports` lint rule landed in Plan 1 Wave D).
//
// Wave A: skeleton with all method signatures + stub bodies.
// Wave B: full implementation against the new schema.

import { GLOBAL_TEAM_ID } from '@/lib/global-team'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { parseHistory, type SpecificationHistoryEntry } from '@/types/specification-history'
import {
  library,
  specification,
  image,
  libraryEnvironment,
  specificationEnvironment,
  proxyReference,
  imageReference,
} from '../db/_sensitiveTables'
import { db, rawQuery } from '../lib/db'
import { loadPrincipal, canSee } from '../authz/policy'
import { MAX_LIBRARIES_PER_LIST, MAX_TREE_SPECS, MAX_TREE_PROXY_REFS, MAX_TREE_IMAGES } from '../limits'

export class TreeTooLargeError extends Error {
  constructor(
    public dimension: 'specs' | 'proxyRefs' | 'images',
    public count: number,
  ) {
    super(`tree too large: ${dimension}=${count}`)
    this.name = 'TreeTooLargeError'
  }
}

export interface ReadContext {
  sessionUserId: string
}

export interface Library {
  id: string
  parentLibraryId: string | null
  name: string
  entityType: string
  description: string | null
  author: string | null
  changeHistory: string | null
  version: string
  /**
   * Workflow/step libraries: ids of the environment libraries this library
   * is bound to. Stored on disk as JSON text in `library.environmentLibraryIds`;
   * `normalizeLibrary` parses it on read so callers always see the array form.
   */
  environmentLibraryIds: string[] | null
  createdAt: number
  updatedAt: number
  lastEditedByUserId: string | null
  teamId: string | null
  createdByUserId: string | null
}

export interface SpecMeta {
  id: string
  libraryId: string | null
  name: string
  description: string | null
  typeName: string | null
  version: string | null
  state: string | null
  createdAt: number
  updatedAt: number
  lastEditedByUserId: string | null
}

export interface SpecFull extends SpecMeta {
  data: string
  dataSchemaVersion: number
  parentSpecificationId: string | null
  rootSpecificationId: string
  /** Unix-ms in-force date — set when the spec was made Effective (Phase 3, design §8). */
  effectiveFrom: number | null
  /** Parsed history entries — always an array (empty when column is '[]' or missing). */
  history: SpecificationHistoryEntry[]
}

export interface ImageRow {
  id: string
  specificationId: string
  filename: string
  mimeType: string
  contentHash: string
  createdAt: number
}

export interface ImageManifestEntry {
  filename: string
  mimeType: string
  byteSize: number
}

export interface ProxyRefRow {
  parentSpecificationId: string
  nodeId: string
  targetSpecificationId: string
}

export interface SpecEnvRow {
  specificationId: string
  environmentLibraryId: string
}

export interface ReferencedChild {
  specId: string
  specName: string
  libraryId: string
  libraryName: string
}

export interface SpecTreeNode extends SpecMeta {
  children: SpecTreeNode[]
  referencedChildren: ReferencedChild[]
}

export interface SpecTreeResponse {
  roots: SpecTreeNode[]
}

export interface LibEnvRow {
  libraryId: string
  environmentLibraryId: string
}

export interface SpecTree {
  library: Library
  specs: SpecFull[]
  proxyRefs: ProxyRefRow[]
  specEnvs: SpecEnvRow[]
  imageManifest: Record<string, ImageManifestEntry[]>
}

export const specReadDao = {
  /** Library by id, visible only to a member of its owning team (or an admin). */
  async getLibrary(ctx: ReadContext, id: string): Promise<Library | null> {
    const [row] = await db.select().from(library).where(eq(library.id, id))
    if (!row) return null
    const principal = await loadPrincipal(ctx.sessionUserId)
    if (!principal || !canSee(principal, row)) return null
    return normalizeLibrary(row as unknown as Library)
  },

  /** Lists libraries owned by a team the caller belongs to, plus GLOBAL's (admins: all). */
  async listVisibleLibraries(ctx: ReadContext, opts: { entityType?: string }): Promise<Library[]> {
    const principal = await loadPrincipal(ctx.sessionUserId)
    if (!principal) return []
    const conds = []
    if (!principal.isAdministrator) {
      conds.push(
        sql`(${library.teamId} = ${GLOBAL_TEAM_ID} OR ${library.teamId} IN (SELECT "teamId" FROM "user_team" WHERE "userId" = ${ctx.sessionUserId}))`,
      )
    }
    if (opts.entityType) conds.push(eq(library.entityType, opts.entityType))
    const rows = await db
      .select()
      .from(library)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(library.name))
      .limit(MAX_LIBRARIES_PER_LIST + 1)
    return (rows as unknown as Library[]).map(normalizeLibrary)
  },

  /** Root specs in a library (metadata only, no data). Caller must have passed canRead. */
  async listRootSpecs(ctx: ReadContext, libraryId: string): Promise<SpecMeta[]> {
    const lib = await this.getLibrary(ctx, libraryId)
    if (!lib) return []
    const rows = await db
      .select({
        id: specification.id,
        libraryId: specification.libraryId,
        name: specification.name,
        description: specification.description,
        typeName: specification.typeName,
        version: specification.version,
        state: specification.state,
        createdAt: specification.createdAt,
        updatedAt: specification.updatedAt,
        lastEditedByUserId: specification.lastEditedByUserId,
      })
      .from(specification)
      .where(and(eq(specification.libraryId, libraryId), sql`${specification.parentSpecificationId} IS NULL`))
      .orderBy(asc(specification.name))
    return rows as SpecMeta[]
  },

  /** Full nested spec tree for a library, metadata-only. Returns null if not visible. */
  async getLibraryTree(ctx: ReadContext, libraryId: string): Promise<SpecTreeResponse | null> {
    const lib = await this.getLibrary(ctx, libraryId)
    if (!lib) return null

    // Use Drizzle query builder so mode:'number' handles bigint createdAt/updatedAt.
    const rows = await db
      .select({
        id: specification.id,
        libraryId: specification.libraryId,
        name: specification.name,
        description: specification.description,
        typeName: specification.typeName,
        version: specification.version,
        state: specification.state,
        data: specification.data,
        parentSpecificationId: specification.parentSpecificationId,
        rootSpecificationId: specification.rootSpecificationId,
        createdAt: specification.createdAt,
        updatedAt: specification.updatedAt,
        lastEditedByUserId: specification.lastEditedByUserId,
      })
      .from(specification)
      .where(eq(specification.libraryId, libraryId))
      .orderBy(sql`lower(${specification.name}) asc`)

    // Index by id and group children by parentSpecificationId (case-insensitive order
    // preserved from SQL).
    const metaById = new Map<string, SpecTreeNode>()
    const childrenByParent = new Map<string, SpecTreeNode[]>()
    const roots: SpecTreeNode[] = []

    for (const row of rows) {
      const node: SpecTreeNode = {
        id: row.id,
        libraryId: row.libraryId,
        name: row.name,
        description: row.description,
        typeName: row.typeName ?? null,
        version: row.version,
        state: row.state,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastEditedByUserId: row.lastEditedByUserId,
        children: [],
        referencedChildren: [],
      }
      metaById.set(row.id, node)
      if (row.parentSpecificationId) {
        const list = childrenByParent.get(row.parentSpecificationId) ?? []
        list.push(node)
        childrenByParent.set(row.parentSpecificationId, list)
      } else {
        roots.push(node)
      }
    }
    for (const [parentId, list] of childrenByParent) {
      const parent = metaById.get(parentId)
      if (parent) parent.children = list
    }

    // Resolve referenced children by scanning each parent's data.nodes for
    // workflowProxy with subWorkflowMode === 'reference'. Dedupe by specId.
    const libCache = new Map<string, Library | null>()
    libCache.set(libraryId, lib)
    for (const row of rows) {
      const node = metaById.get(row.id)!
      let parsed: unknown
      try {
        parsed = JSON.parse(row.data)
      } catch {
        continue
      }
      const nodes = (parsed as { nodes?: unknown }).nodes
      if (!Array.isArray(nodes)) continue
      const seen = new Set<string>()
      for (const n of nodes) {
        const data = (n as { type?: string; data?: Record<string, unknown> }).data
        const type = (n as { type?: string }).type
        // React Flow sets both node.type and node.data.stepType to 'workflowProxy'
        // for proxy nodes. Check either so the DAO is resilient to slight shape
        // drift across import paths.
        const isWorkflowProxy = type === 'workflowProxy' || data?.stepType === 'workflowProxy'
        if (!isWorkflowProxy || !data) continue
        if (data.subWorkflowMode !== 'reference') continue
        const targetId = data.referencedStepSpecId as string | undefined
        const targetLibId = data.referencedStepLibraryId as string | undefined
        const targetName = data.referencedStepName as string | undefined
        if (!targetId || !targetLibId) continue
        if (seen.has(targetId)) continue
        let targetLib = libCache.get(targetLibId)
        if (targetLib === undefined) {
          targetLib = await this.getLibrary(ctx, targetLibId)
          libCache.set(targetLibId, targetLib)
        }
        if (!targetLib) continue
        seen.add(targetId)
        node.referencedChildren.push({
          specId: targetId,
          specName: typeof targetName === 'string' ? targetName : targetId,
          libraryId: targetLibId,
          libraryName: targetLib.name,
        })
      }
    }

    return { roots }
  },

  /** Single spec with full data blob. Returns null if not visible. */
  async getSpec(ctx: ReadContext, id: string): Promise<SpecFull | null> {
    const [row] = await db
      .select({
        id: specification.id,
        libraryId: specification.libraryId,
        name: specification.name,
        description: specification.description,
        typeName: specification.typeName,
        version: specification.version,
        state: specification.state,
        data: specification.data,
        dataSchemaVersion: specification.dataSchemaVersion,
        parentSpecificationId: specification.parentSpecificationId,
        rootSpecificationId: specification.rootSpecificationId,
        effectiveFrom: specification.effectiveFrom,
        createdAt: specification.createdAt,
        updatedAt: specification.updatedAt,
        lastEditedByUserId: specification.lastEditedByUserId,
        history: specification.history,
      })
      .from(specification)
      .where(eq(specification.id, id))
    if (!row) return null
    // Resolve the tree's library via rootSpecificationId.
    if (!row.rootSpecificationId) return null
    const [rootLibId] = await db
      .select({ libraryId: specification.libraryId })
      .from(specification)
      .where(eq(specification.id, row.rootSpecificationId))
    if (!rootLibId?.libraryId) return null
    const lib = await this.getLibrary(ctx, rootLibId.libraryId)
    if (!lib) return null
    return {
      ...(row as unknown as Omit<SpecFull, 'history'> & { history: string }),
      history: parseHistory(row.history),
    }
  },

  /**
   * Whole tree by spec id (recursive CTE). Returns null if not visible.
   *
   * Accepts either a root id or any descendant id: if the caller passes a
   * non-root id the method resolves to its root via rootSpecificationId
   * before loading the tree. This keeps the client‑side simple — the UI
   * can hand us any selected spec id without having to know whether it is
   * a root.
   */
  async getTree(ctx: ReadContext, specId: string): Promise<SpecTree | null> {
    const [row] = await db
      .select({
        libraryId: specification.libraryId,
        parentSpecificationId: specification.parentSpecificationId,
        rootSpecificationId: specification.rootSpecificationId,
      })
      .from(specification)
      .where(eq(specification.id, specId))
    if (!row || !row.libraryId) return null

    // Resolve to root if the caller passed a non-root id.
    const rootId = row.parentSpecificationId === null ? specId : row.rootSpecificationId
    if (rootId === null) return null
    const rootRow =
      row.parentSpecificationId === null
        ? row
        : (
            await db
              .select({
                libraryId: specification.libraryId,
                parentSpecificationId: specification.parentSpecificationId,
              })
              .from(specification)
              .where(eq(specification.id, rootId))
          )[0]
    if (!rootRow || rootRow.parentSpecificationId !== null || !rootRow.libraryId) return null

    // 2. canRead on library
    const lib = await this.getLibrary(ctx, rootRow.libraryId)
    if (!lib) return null

    // 3. Pre-count via a cheap recursive CTE to enforce MAX_TREE_SPECS.
    const countRows = await rawQuery<{ c: unknown }>(
      `WITH RECURSIVE "tree"("id") AS (
         SELECT "id" FROM "specification" WHERE "id" = $1 AND "parentSpecificationId" IS NULL
         UNION ALL
         SELECT s."id" FROM "specification" s JOIN "tree" t ON s."parentSpecificationId" = t."id"
       )
       SELECT count(*) AS c FROM "tree"`,
      [rootId],
    )
    const treeCount = Number(countRows[0]?.c ?? 0)
    if (treeCount > MAX_TREE_SPECS) {
      throw new TreeTooLargeError('specs', treeCount)
    }

    // 4. Full spec rows — bigint columns (createdAt/updatedAt/effectiveFrom) come back
    //    as strings from rawQuery; normalize with Number().
    type RawSpecRow = Omit<SpecFull, 'history' | 'createdAt' | 'updatedAt' | 'effectiveFrom'> & {
      history: string
      createdAt: unknown
      updatedAt: unknown
      effectiveFrom: unknown
    }
    const rawSpecRows = await rawQuery<RawSpecRow>(
      `WITH RECURSIVE "tree"("id") AS (
         SELECT "id" FROM "specification" WHERE "id" = $1 AND "parentSpecificationId" IS NULL
         UNION ALL
         SELECT s."id" FROM "specification" s JOIN "tree" t ON s."parentSpecificationId" = t."id"
       )
       SELECT s."id", s."libraryId", s."name", s."description", s."typeName", s."version", s."state", s."data",
              s."dataSchemaVersion", s."parentSpecificationId", s."rootSpecificationId", s."effectiveFrom",
              s."createdAt", s."updatedAt", s."lastEditedByUserId", s."history"
         FROM "specification" s
        WHERE s."id" IN (SELECT "id" FROM "tree")
        ORDER BY s."id"`,
      [rootId],
    )
    const specRows: SpecFull[] = rawSpecRows.map((r) => ({
      ...r,
      createdAt: Number(r.createdAt),
      updatedAt: Number(r.updatedAt),
      effectiveFrom: r.effectiveFrom != null ? Number(r.effectiveFrom) : null,
      history: parseHistory(r.history),
    }))

    const idList = specRows.map((s) => s.id)

    // 5. proxy_reference rows for any parent in the tree (no epoch columns).
    const proxyRows =
      idList.length === 0
        ? []
        : await rawQuery<ProxyRefRow>(
            `SELECT "parentSpecificationId", "nodeId", "targetSpecificationId"
               FROM "proxy_reference"
              WHERE "parentSpecificationId" = ANY($1::text[])`,
            [idList],
          )
    if (proxyRows.length > MAX_TREE_PROXY_REFS) throw new TreeTooLargeError('proxyRefs', proxyRows.length)

    // 6. specification_environment rows (no epoch columns).
    const specEnvRows =
      idList.length === 0
        ? []
        : await rawQuery<SpecEnvRow>(
            `SELECT "specificationId", "environmentLibraryId"
               FROM "specification_environment"
              WHERE "specificationId" = ANY($1::text[])`,
            [idList],
          )

    // 7. image manifest — filename + mimeType + byteSize, no data, no epoch columns.
    const imageRows =
      idList.length === 0
        ? []
        : await rawQuery<{ specificationId: string; filename: string; mimeType: string; byteSize: number }>(
            `SELECT i."specificationId", i."filename", i."mimeType", ib."byteSize"
               FROM "image" i JOIN "image_blob" ib ON ib."contentHash" = i."contentHash"
              WHERE i."specificationId" = ANY($1::text[])`,
            [idList],
          )
    if (imageRows.length > MAX_TREE_IMAGES) throw new TreeTooLargeError('images', imageRows.length)

    const imageManifest: Record<string, ImageManifestEntry[]> = {}
    for (const r of imageRows) {
      if (!imageManifest[r.specificationId]) imageManifest[r.specificationId] = []
      imageManifest[r.specificationId].push({ filename: r.filename, mimeType: r.mimeType, byteSize: r.byteSize })
    }

    return {
      library: lib,
      specs: specRows,
      proxyRefs: proxyRows,
      specEnvs: specEnvRows,
      imageManifest,
    }
  },

  /** Bulk-fetch many specs, applying read-permission per row. Returns the map + missingIds[]. */
  async getSpecs(ctx: ReadContext, ids: string[]): Promise<{ specs: Map<string, SpecFull>; missingIds: string[] }> {
    if (ids.length === 0) return { specs: new Map(), missingIds: [] }
    const unique = Array.from(new Set(ids))

    // Drizzle inArray so mode:'number' handles bigint createdAt/updatedAt/effectiveFrom.
    const rawRows = await db
      .select({
        id: specification.id,
        libraryId: specification.libraryId,
        name: specification.name,
        description: specification.description,
        typeName: specification.typeName,
        version: specification.version,
        state: specification.state,
        data: specification.data,
        dataSchemaVersion: specification.dataSchemaVersion,
        parentSpecificationId: specification.parentSpecificationId,
        rootSpecificationId: specification.rootSpecificationId,
        effectiveFrom: specification.effectiveFrom,
        createdAt: specification.createdAt,
        updatedAt: specification.updatedAt,
        lastEditedByUserId: specification.lastEditedByUserId,
        history: specification.history,
      })
      .from(specification)
      .where(inArray(specification.id, unique))

    const rows = rawRows.map((r) => ({
      ...(r as unknown as Omit<SpecFull, 'history'> & { history: string }),
      history: parseHistory(r.history),
    })) as SpecFull[]

    // Resolve each row's tree library and apply canRead. Specs whose root
    // is not visible to the caller are dropped and the id goes to missingIds.
    const libCache = new Map<string, Library | null>()
    const specs = new Map<string, SpecFull>()
    for (const row of rows) {
      // Walk to root → libraryId. If row.libraryId is null (a child), look up via root.
      let libraryId = row.libraryId
      if (!libraryId) {
        const [rootRow] = await db
          .select({ libraryId: specification.libraryId })
          .from(specification)
          .where(eq(specification.id, row.rootSpecificationId))
        libraryId = rootRow?.libraryId ?? null
      }
      if (!libraryId) continue
      let lib = libCache.get(libraryId)
      if (lib === undefined) {
        lib = await this.getLibrary(ctx, libraryId)
        libCache.set(libraryId, lib)
      }
      if (!lib) continue
      specs.set(row.id, row)
    }

    const missingIds = unique.filter((id) => !specs.has(id))
    return { specs, missingIds }
  },

  /** Single image row by spec + filename (metadata + contentHash, not bytes). */
  async getImage(ctx: ReadContext, specificationId: string, filename: string): Promise<ImageRow | null> {
    const spec = await this.getSpec(ctx, specificationId)
    if (!spec) return null
    // Drizzle so mode:'number' handles bigint createdAt.
    const [row] = await db
      .select({
        id: image.id,
        specificationId: image.specificationId,
        filename: image.filename,
        mimeType: image.mimeType,
        contentHash: image.contentHash,
        createdAt: image.createdAt,
      })
      .from(image)
      .where(and(eq(image.specificationId, specificationId), eq(image.filename, filename)))
    return (row as unknown as ImageRow) ?? null
  },

  /** Image manifest for a set of specs (filename + mimeType + byteSize). */
  async getImageManifest(ctx: ReadContext, specIds: string[]): Promise<Record<string, ImageManifestEntry[]>> {
    if (specIds.length === 0) return {}
    // Drop specs the caller cannot read, then group by specId.
    const readable: string[] = []
    const libCache = new Map<string, Library | null>()
    for (const id of specIds) {
      const [row] = await db
        .select({
          libraryId: specification.libraryId,
          rootSpecificationId: specification.rootSpecificationId,
        })
        .from(specification)
        .where(eq(specification.id, id))
      if (!row) continue
      let libraryId = row.libraryId
      if (!libraryId) {
        if (!row.rootSpecificationId) continue
        const [rootRow] = await db
          .select({ libraryId: specification.libraryId })
          .from(specification)
          .where(eq(specification.id, row.rootSpecificationId))
        libraryId = rootRow?.libraryId ?? null
      }
      if (!libraryId) continue
      let lib = libCache.get(libraryId)
      if (lib === undefined) {
        lib = await this.getLibrary(ctx, libraryId)
        libCache.set(libraryId, lib)
      }
      if (!lib) continue
      readable.push(id)
    }
    if (readable.length === 0) return {}
    // No epoch columns in result; byteSize is integer → fine as-is.
    const rows = await rawQuery<{ specificationId: string; filename: string; mimeType: string; byteSize: number }>(
      `SELECT i."specificationId", i."filename", i."mimeType", ib."byteSize"
         FROM "image" i JOIN "image_blob" ib ON ib."contentHash" = i."contentHash"
        WHERE i."specificationId" = ANY($1::text[])`,
      [readable],
    )
    const manifest: Record<string, ImageManifestEntry[]> = {}
    for (const r of rows) {
      if (!manifest[r.specificationId]) manifest[r.specificationId] = []
      manifest[r.specificationId].push({ filename: r.filename, mimeType: r.mimeType, byteSize: r.byteSize })
    }
    return manifest
  },
}

function normalizeLibrary(row: Library): Library {
  // The DB column is JSON text; the typed Library interface exposes it as
  // string[] | null. Parse defensively — anything malformed becomes null
  // rather than corrupting the response shape downstream.
  let envIds: string[] | null = null
  const raw = (row as unknown as { environmentLibraryIds: unknown }).environmentLibraryIds
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        envIds = parsed
      }
    } catch {
      // fall through to null
    }
  } else if (Array.isArray(raw) && raw.every((x) => typeof x === 'string')) {
    // Some callers (forkLibrary write path) may already pass an array.
    envIds = raw as string[]
  }
  return {
    ...row,
    version: row.version ?? '1.0.0',
    environmentLibraryIds: envIds,
  }
}

// Touch the schema imports so `ts-prune` doesn't flag them as unused while
// the skeleton bodies are still stubs. Wave B removes this marker.
const _schemaRefs = [
  library,
  specification,
  image,
  libraryEnvironment,
  specificationEnvironment,
  proxyReference,
  imageReference,
] as const
void _schemaRefs
