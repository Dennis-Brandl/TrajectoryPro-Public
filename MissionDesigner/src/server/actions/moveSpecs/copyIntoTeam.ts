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

import { randomUUID } from 'node:crypto'
import { GLOBAL_TEAM_ID } from '../../../lib/global-team'
import { compareSemver } from '../../../types/version'
import { cat } from '../../authz/rights'
import { copySpecificationSubtree, type CloneSourceRow } from '../cloneSpecificationSubtree'
import { collectDependencies, type DepRef, type Dependencies } from './collectDependencies'
import type { ElementRows, Querier } from './loadElement'
import { isObj } from './rewriteReferences'
import { topoSortByParent } from './topoSort'

export interface CopyPlanResult {
  /** Every dependency row id (all versions of each handled element) → its destination spec id. */
  idMap: Map<string, string>
  /** Source library id → destination library id (found or created). */
  libraryMap: Map<string, string>
  librariesCreated: { id: string; name: string; entityType: string }[]
  /** Elements (all versions of one name) copied in. */
  elementsCopied: number
  /** `<cat>:library.create` / `<cat>:create` exercised in the destination team. */
  neededRights: string[]
  /** `<cat>:create` exercised in GLOBAL (elements added to a GLOBAL library). */
  neededGlobalRights: string[]
}

const mapId = (m: Map<string, string>, v: unknown) => (typeof v === 'string' ? (m.get(v) ?? v) : v)

/**
 * Remaps every by-id reference in a spec's data: `environmentSpecIds[]` and node
 * `environmentSpecId`, `actionProxyConfig.action_oid` / `environment_oid`,
 * `referencedStepSpecId`, `embeddedWorkflowSpecId`, `resourceCommands[].resourceSourceOid`
 * through `idMap`; node `referencedStepLibraryId` through `libraryMap`. Ids in
 * neither map are kept. Returns the original text when nothing changed.
 */
export function remapSpecRefs(dataJson: string, idMap: Map<string, string>, libraryMap: Map<string, string>): string {
  let data: unknown
  try {
    data = JSON.parse(dataJson)
  } catch {
    return dataJson
  }
  if (!isObj(data)) return dataJson
  let changed = false
  const fix = (o: Record<string, unknown>, key: string, m: Map<string, string>) => {
    const to = mapId(m, o[key])
    if (to !== o[key]) {
      o[key] = to
      changed = true
    }
  }
  const envIds = data.environmentSpecIds
  if (Array.isArray(envIds)) {
    const mapped = envIds.map((v) => mapId(idMap, v))
    if (mapped.some((v, i) => v !== envIds[i])) {
      data.environmentSpecIds = mapped
      changed = true
    }
  }
  for (const n of Array.isArray(data.nodes) ? data.nodes : []) {
    const d = isObj(n) ? n.data : undefined
    if (!isObj(d)) continue
    for (const k of ['environmentSpecId', 'referencedStepSpecId', 'embeddedWorkflowSpecId']) fix(d, k, idMap)
    fix(d, 'referencedStepLibraryId', libraryMap)
    if (isObj(d.actionProxyConfig)) {
      fix(d.actionProxyConfig, 'action_oid', idMap)
      fix(d.actionProxyConfig, 'environment_oid', idMap)
    }
    for (const rc of Array.isArray(d.resourceCommands) ? d.resourceCommands : []) {
      if (isObj(rc)) fix(rc, 'resourceSourceOid', idMap)
    }
  }
  return changed ? JSON.stringify(data) : dataJson
}

/** The `environmentLibraryIds` column (a JSON id array) remapped through `libraryMap`. */
export function remapLibraryIds(json: string | null, libraryMap: Map<string, string>): string | null {
  if (!json) return json
  try {
    const ids: unknown = JSON.parse(json)
    return Array.isArray(ids) ? JSON.stringify(ids.map((v) => mapId(libraryMap, v))) : json
  } catch {
    return json
  }
}

interface LibRow {
  id: string
  name: string
  entityType: string
  teamId: string
  version: string
  description: string | null
}

/** Same-named ROOT library of the type in `destTeamId`, else GLOBAL's; else a new one in `destTeamId`. */
async function destinationLibrary(
  q: Querier,
  src: LibRow,
  destTeamId: string,
  account: string,
  result: CopyPlanResult,
  rights: Set<string>,
): Promise<LibRow> {
  const [found] = await q<LibRow>(
    `SELECT id, name, "entityType", "teamId", version, description FROM library
      WHERE name = $1 AND "entityType" = $2 AND "parentLibraryId" IS NULL AND "teamId" = ANY($3::text[])
      ORDER BY ("teamId" = $4), id LIMIT 1`,
    [src.name, src.entityType, [destTeamId, GLOBAL_TEAM_ID], GLOBAL_TEAM_ID],
  )
  if (found) return found
  const id = randomUUID()
  const now = Date.now()
  // Modelled on POST /libraries, keeping the source's version and description.
  await q(
    `INSERT INTO "library" ("id", "parentLibraryId", "teamId", "createdByUserId", "name", "entityType", "description", "version", "createdAt", "updatedAt")
     VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [id, destTeamId, account, src.name, src.entityType, src.description, src.version, now],
  )
  result.librariesCreated.push({ id, name: src.name, entityType: src.entityType })
  rights.add(`${cat(src.entityType)}:library.create`)
  return { ...src, id, teamId: destTeamId }
}

const ROW_COLUMNS = `id, "libraryId", name, description, "typeName", version, state, data, "environmentLibraryIds",
  "parentSpecificationId", "rootSpecificationId", "dataSchemaVersion", "lastEditedByUserId", history, "effectiveFrom"`

/**
 * Makes the given dependencies available in `destTeamId`. Per source library: the
 * same-named root library of that type in the destination team (else GLOBAL) is
 * used as is; absent, it is created in the destination team. Each needed element
 * with no same-named root there is copied in whole — every version and child,
 * states, versions and history kept (+ `copied`), new ids, references between
 * copies remapped, images, proxy references and environment links re-created.
 * A copied element's own dependencies are handled the same way (to a fixed point);
 * elements already present are mapped by version (else to their latest), child
 * dependencies by name path, and are not expanded. Runs on
 * the caller's transaction; never touches the source rows.
 */
export async function copyIntoTeam(
  q: Querier,
  deps: Dependencies,
  destTeamId: string,
  account: string,
): Promise<CopyPlanResult> {
  const result: CopyPlanResult = {
    idMap: new Map(),
    libraryMap: new Map(),
    librariesCreated: [],
    elementsCopied: 0,
    neededRights: [],
    neededGlobalRights: [],
  }
  const rights = new Set<string>()
  const globalRights = new Set<string>()

  // Phase 1 — decide: destination libraries, which elements to copy, every new id.
  // Iterates to a fixed point: only elements actually copied are expanded into their
  // own dependencies; one mapped to an existing destination element is not.
  const flat = (d: Dependencies) => [...d.environments, ...d.actions, ...d.steps]
  const handled = new Set<string>() // `${srcLibId}\0${name}`
  const destOf = new Map<string, { src: LibRow; dest: LibRow } | null>()
  const copies: { destLibId: string; rows: CloneSourceRow[] }[] = []
  const seen: DepRef[] = []
  let pending = flat(deps)
  while (pending.length > 0) {
    const copiedRowIds: string[] = []
    for (const d of pending) {
      seen.push(d)
      const key = `${d.libraryId}\0${d.name}`
      if (handled.has(key)) continue
      handled.add(key)
      if (!destOf.has(d.libraryId)) {
        const [src] = await q<LibRow>(
          'SELECT id, name, "entityType", "teamId", version, description FROM library WHERE id = $1',
          [d.libraryId],
        )
        const dest = src ? await destinationLibrary(q, src, destTeamId, account, result, rights) : null
        if (src && dest) result.libraryMap.set(src.id, dest.id)
        destOf.set(d.libraryId, src && dest ? { src, dest } : null)
      }
      const libs = destOf.get(d.libraryId)
      if (!libs) continue
      const { src, dest } = libs
      const rootsOf = (libId: string) =>
        q<{ id: string; version: string }>(
          'SELECT id, version FROM specification WHERE "libraryId" = $1 AND name = $2 AND "parentSpecificationId" IS NULL',
          [libId, d.name],
        )
      const srcRoots = await rootsOf(src.id)
      const destRoots = await rootsOf(dest.id)
      if (destRoots.length > 0) {
        const latest = [...destRoots].sort((a, b) => compareSemver(b.version, a.version))[0]
        for (const s of srcRoots) {
          result.idMap.set(s.id, (destRoots.find((x) => x.version === s.version) ?? latest).id)
        }
        continue
      }
      const rows = await q<CloneSourceRow>(
        `SELECT ${ROW_COLUMNS} FROM specification WHERE "rootSpecificationId" = ANY($1::text[])`,
        [srcRoots.map((s) => s.id)],
      )
      if (rows.length === 0) continue
      for (const r of rows) result.idMap.set(r.id, randomUUID())
      copies.push({ destLibId: dest.id, rows })
      copiedRowIds.push(...rows.map((r) => r.id))
      result.elementsCopied++
      ;(dest.teamId === GLOBAL_TEAM_ID ? globalRights : rights).add(`${cat(src.entityType)}:create`)
    }
    pending = copiedRowIds.length > 0 ? flat(await collectDependencies(q, copiedRowIds)) : []
  }
  // A dependency on a child row of an element the destination already has.
  for (const d of seen) {
    if (!result.idMap.has(d.specId)) await mapChildDep(q, d.specId, result.idMap)
  }

  // Phase 2 — write, with references between copies pointing at the copies.
  const copiedIds: string[] = []
  for (const { destLibId, rows } of copies) {
    await insertCopies(q, rows, destLibId, account, result.idMap, result.libraryMap)
    copiedIds.push(...rows.map((r) => r.id))
  }
  await copyAttachments(q, copiedIds, result)

  result.neededRights = [...rights].sort()
  result.neededGlobalRights = [...globalRights].sort()
  return result
}

/** Writes copies of whole trees into `destLibId`, keeping state, version and history (+ `copied`). */
async function insertCopies(
  q: Querier,
  rows: CloneSourceRow[],
  destLibId: string,
  account: string,
  idMap: Map<string, string>,
  libraryMap: Map<string, string>,
): Promise<void> {
  const out = copySpecificationSubtree({
    source: rows,
    idMap,
    libraryId: destLibId,
    account,
    rewriteData: (json) => remapSpecRefs(json, idMap, libraryMap),
  })
  for (const r of topoSortByParent(out)) {
    await q(
      `INSERT INTO specification
         (id, "libraryId", name, description, "typeName", version, state, data, "environmentLibraryIds",
          "createdAt", "updatedAt", "parentSpecificationId", "rootSpecificationId", "dataSchemaVersion",
          "lastEditedByUserId", history, "effectiveFrom")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        r.id,
        r.libraryId,
        r.name,
        r.description,
        r.typeName,
        r.version,
        r.state,
        r.data,
        remapLibraryIds(r.environmentLibraryIds, libraryMap),
        r.createdAt,
        r.updatedAt,
        r.parentSpecificationId,
        r.rootSpecificationId,
        r.dataSchemaVersion,
        r.lastEditedByUserId,
        r.history,
        r.effectiveFrom ?? null,
      ],
    )
  }
}

/**
 * Copies a whole element (every version and child) into `destLibId`; the source
 * rows are not touched. `refs` remaps what the copies point at outside themselves.
 * Environment links are left to the caller, whose rule depends on crossing teams.
 * Returns the copies' root ids and the element's source id → copy id map.
 */
export async function copyElement(
  q: Querier,
  el: ElementRows,
  destLibId: string,
  account: string,
  refs: Pick<CopyPlanResult, 'idMap' | 'libraryMap'>,
): Promise<{ rootIds: string[]; ownIds: Map<string, string> }> {
  const rows = await q<CloneSourceRow>(`SELECT ${ROW_COLUMNS} FROM specification WHERE id = ANY($1::text[])`, [
    el.allRowIds,
  ])
  const ownIds = new Map(rows.map((r) => [r.id, randomUUID()]))
  const idMap = new Map([...refs.idMap, ...ownIds])
  await insertCopies(q, rows, destLibId, account, idMap, refs.libraryMap)
  await copyAttachments(q, el.allRowIds, { idMap, libraryMap: refs.libraryMap })
  return { rootIds: el.rootIds.map((id) => ownIds.get(id)!), ownIds }
}

/**
 * Maps a source child row whose root is mapped to an existing destination root:
 * to the destination row at the same name path under that root, else to the root.
 */
async function mapChildDep(q: Querier, specId: string, idMap: Map<string, string>): Promise<void> {
  const chain = await q<{ id: string; name: string; parentSpecificationId: string | null }>(
    `WITH RECURSIVE up(id, name, "parentSpecificationId", depth) AS (
       SELECT id, name, "parentSpecificationId", 0 FROM specification WHERE id = $1
       UNION ALL
       SELECT s.id, s.name, s."parentSpecificationId", u.depth + 1
         FROM specification s JOIN up u ON s.id = u."parentSpecificationId"
     )
     SELECT id, name, "parentSpecificationId" FROM up ORDER BY depth DESC`,
    [specId],
  )
  const destRoot = chain[0] && idMap.get(chain[0].id)
  if (!destRoot) return
  let at: string = destRoot
  for (const link of chain.slice(1)) {
    const [child] = await q<{ id: string }>(
      'SELECT id FROM specification WHERE "parentSpecificationId" = $1 AND name = $2 ORDER BY id LIMIT 1',
      [at, link.name],
    )
    if (!child) {
      at = destRoot
      break
    }
    at = child.id
  }
  idMap.set(specId, at)
}

/** Proxy references, images and environment links of the copied source rows, re-created for the copies. */
async function copyAttachments(
  q: Querier,
  srcIds: string[],
  result: Pick<CopyPlanResult, 'idMap' | 'libraryMap'>,
): Promise<void> {
  if (srcIds.length === 0) return
  const { idMap, libraryMap } = result

  const proxies = await q<{ parentSpecificationId: string; nodeId: string; targetSpecificationId: string }>(
    'SELECT * FROM proxy_reference WHERE "parentSpecificationId" = ANY($1::text[])',
    [srcIds],
  )
  for (const p of proxies) {
    const target = idMap.get(p.targetSpecificationId)
    if (!target) continue // same-tree by trigger, so always copied; skip defensively
    await q(
      'INSERT INTO proxy_reference ("parentSpecificationId", "nodeId", "targetSpecificationId") VALUES ($1, $2, $3)',
      [idMap.get(p.parentSpecificationId), p.nodeId, target],
    )
  }

  // image.specificationId is immutable: copies get their own rows on the same blob.
  const images = await q<{
    id: string
    specificationId: string
    filename: string
    mimeType: string
    contentHash: string
    createdAt: number
  }>('SELECT * FROM image WHERE "specificationId" = ANY($1::text[])', [srcIds])
  const imageMap = new Map<string, string>()
  for (const img of images) {
    const id = randomUUID()
    imageMap.set(img.id, id)
    await q(
      `INSERT INTO image (id, "specificationId", filename, "mimeType", "contentHash", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, idMap.get(img.specificationId), img.filename, img.mimeType, img.contentHash, img.createdAt],
    )
  }
  const imageRefs = await q<{ specificationId: string; imageId: string }>(
    'SELECT * FROM image_reference WHERE "specificationId" = ANY($1::text[])',
    [srcIds],
  )
  for (const r of imageRefs) {
    await q('INSERT INTO image_reference ("specificationId", "imageId") VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      idMap.get(r.specificationId),
      imageMap.get(r.imageId) ?? r.imageId,
    ])
  }

  // Environment links: to the destination env library, or kept when it is GLOBAL's.
  const links = await q<{ specificationId: string; environmentLibraryId: string; teamId: string; libraryId: string }>(
    `SELECT se."specificationId", se."environmentLibraryId", el."teamId", s."libraryId"
       FROM specification_environment se
       JOIN library el ON el.id = se."environmentLibraryId"
       JOIN specification s ON s.id = se."specificationId"
      WHERE se."specificationId" = ANY($1::text[])`,
    [srcIds],
  )
  for (const l of links) {
    const envLib =
      libraryMap.get(l.environmentLibraryId) ?? (l.teamId === GLOBAL_TEAM_ID ? l.environmentLibraryId : null)
    const ownerLib = libraryMap.get(l.libraryId)
    if (!envLib || !ownerLib) continue
    await q(
      `INSERT INTO specification_environment ("specificationId", "environmentLibraryId") VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [idMap.get(l.specificationId), envLib],
    )
    await q(
      `INSERT INTO library_environment ("libraryId", "environmentLibraryId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [ownerLib, envLib],
    )
  }
}
