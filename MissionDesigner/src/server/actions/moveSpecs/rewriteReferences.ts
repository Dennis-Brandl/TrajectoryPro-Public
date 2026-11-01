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

import { createReferenceUpdatedEntry, parseHistory, serializeHistory } from '../../../types/specification-history'
import { GLOBAL_TEAM_ID } from '../../../lib/global-team'
import type { Querier } from './loadElement'

export type Obj = Record<string, unknown>
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** One by-name action reference inside parsed spec data: `entry[libKey]` names the library, `entry[nameKey]` the action. */
export interface ActionRefSite {
  entry: Obj
  libKey: string
  nameKey: string
}

/**
 * Every by-name action reference site in parsed spec data: environment
 * `included_actions[]` (and the legacy `includedActions[]`) and ACTION PROXY
 * `nodes[].data`.
 */
export function actionRefSites(data: Obj): ActionRefSite[] {
  const sites: ActionRefSite[] = []
  const add = (entry: unknown, libKey: string, nameKey: string) => {
    if (isObj(entry)) sites.push({ entry, libKey, nameKey })
  }
  for (const e of Array.isArray(data.included_actions) ? data.included_actions : [])
    add(e, 'action_library', 'action_name')
  for (const e of Array.isArray(data.includedActions) ? data.includedActions : []) add(e, 'actionLibrary', 'actionName')
  for (const n of Array.isArray(data.nodes) ? data.nodes : []) {
    if (isObj(n)) add(n.data, 'actionLibraryName', 'actionName')
  }
  return sites
}

/**
 * Pure JSON rewrite: moves every reference to one of `names` in library `from`
 * over to library `to`. Covers environment `included_actions[]` (and the legacy
 * `includedActions[]`) and ACTION PROXY `nodes[].data`. Returns the original
 * text untouched when nothing matches or the JSON is malformed.
 */
export function rewriteActionRefsInData(
  dataJson: string,
  names: Set<string>,
  from: string,
  to: string,
): { json: string; changed: boolean } {
  let data: unknown
  try {
    data = JSON.parse(dataJson)
  } catch {
    return { json: dataJson, changed: false }
  }
  if (!isObj(data)) return { json: dataJson, changed: false }

  let changed = false
  for (const { entry, libKey, nameKey } of actionRefSites(data)) {
    const name = entry[nameKey]
    if (entry[libKey] === from && typeof name === 'string' && names.has(name)) {
      entry[libKey] = to
      changed = true
    }
  }
  return changed ? { json: JSON.stringify(data), changed } : { json: dataJson, changed: false }
}

/** The `environmentSpecIds` of a workflow spec's data (empty when absent or malformed). */
export function envIdsOf(dataJson: string): string[] {
  try {
    const d: unknown = JSON.parse(dataJson)
    const ids = isObj(d) ? d.environmentSpecIds : undefined
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/**
 * Environment specs moved from `fromLibId` to `toLibId`: every root workflow that
 * lists one of them in `environmentSpecIds` gains links to the destination
 * environment library (spec level and workflow-library level). The spec-level
 * link to the source library is dropped once that workflow no longer points into
 * it; library-level links are only ever added, never removed. Workflow content is
 * untouched (it references ids). Call after the rows have moved. Returns link
 * rows added.
 */
export async function relinkEnvironmentLibraries(
  q: Querier,
  movedEnvRootIds: string[],
  fromLibId: string,
  toLibId: string,
): Promise<number> {
  if (movedEnvRootIds.length === 0) return 0
  const moved = new Set(movedEnvRootIds)
  const workflows = await q<{ id: string; libraryId: string; data: string }>(
    `SELECT s.id, s."libraryId", s.data
       FROM specification s JOIN library l ON l.id = s."libraryId"
      WHERE s."parentSpecificationId" IS NULL AND l."entityType" = 'workflow'
        AND s.data LIKE '%environmentSpecIds%'`,
  )
  const idsByWorkflow = new Map<string, string[]>()
  for (const w of workflows) idsByWorkflow.set(w.id, envIdsOf(w.data))

  const affected = workflows.filter((w) => idsByWorkflow.get(w.id)!.some((id) => moved.has(id)))
  if (affected.length === 0) return 0

  // Which environment library each referenced env spec lives in (after the move).
  const allIds = [...new Set([...idsByWorkflow.values()].flat())]
  const libRows = await q<{ id: string; libraryId: string }>(
    'SELECT id, "libraryId" FROM specification WHERE id = ANY($1::text[])',
    [allIds],
  )
  const libOfEnv = new Map(libRows.map((r) => [r.id, r.libraryId]))
  const pointsIntoFrom = (workflowId: string) =>
    idsByWorkflow.get(workflowId)!.some((id) => libOfEnv.get(id) === fromLibId)

  let added = 0
  const insertLink = async (sql: string, params: unknown[]) => {
    added += (await q<{ x: number }>(`${sql} ON CONFLICT DO NOTHING RETURNING 1 AS x`, params)).length
  }
  for (const w of affected) {
    await insertLink(
      'INSERT INTO specification_environment ("specificationId","environmentLibraryId") VALUES ($1,$2)',
      [w.id, toLibId],
    )
    await insertLink('INSERT INTO library_environment ("libraryId","environmentLibraryId") VALUES ($1,$2)', [
      w.libraryId,
      toLibId,
    ])
    if (!pointsIntoFrom(w.id)) {
      await q('DELETE FROM specification_environment WHERE "specificationId" = $1 AND "environmentLibraryId" = $2', [
        w.id,
        fromLibId,
      ])
    }
  }
  return added
}

/**
 * Workflow roots moved into `toLibId`: the destination library links to every
 * environment library the moved workflows use. Returns link rows added.
 */
export async function relinkWorkflowLibraries(
  q: Querier,
  movedWorkflowRootIds: string[],
  toLibId: string,
): Promise<number> {
  if (movedWorkflowRootIds.length === 0) return 0
  const rows = await q<{ x: number }>(
    `INSERT INTO library_environment ("libraryId","environmentLibraryId")
     SELECT DISTINCT $1::text, se."environmentLibraryId"
       FROM specification_environment se WHERE se."specificationId" = ANY($2::text[])
     ON CONFLICT DO NOTHING
     RETURNING 1 AS x`,
    [toLibId, movedWorkflowRootIds],
  )
  return rows.length
}

/**
 * Action specs named `movedActionNames` moved from library `fromLibName` to
 * `toLibName`: rewrites the by-name references in every environment spec and every
 * workflow spec (any state, any tree row, edit locks bypassed) of the teams that
 * resolve the library, and records a `reference_updated` entry on each changed
 * root. Returns the number of changed roots.
 */
export async function rewriteActionLibraryNames(
  q: Querier,
  movedActionNames: string[],
  fromLibName: string,
  toLibName: string,
  scope: { teamIds: string[] | 'all' },
  account: string,
): Promise<number> {
  if (movedActionNames.length === 0 || fromLibName === toLibName) return 0
  const names = new Set(movedActionNames)
  // The library name as it appears inside the stored JSON text.
  const needle = JSON.stringify(fromLibName).slice(1, -1)
  const params: unknown[] = [needle]
  let teamClause: string
  if (scope.teamIds !== 'all') {
    teamClause = 'AND l."teamId" = ANY($2::text[])'
    params.push(scope.teamIds)
  } else {
    // Names resolve team-first: a team that owns a root action library of the same name was
    // never using the GLOBAL one, so its references are not ours to rewrite.
    teamClause = `AND NOT EXISTS (
        SELECT 1 FROM library al
         WHERE al."teamId" = l."teamId" AND al."teamId" <> $2 AND al.name = $3
           AND al."entityType" = 'action' AND al."parentLibraryId" IS NULL)`
    params.push(GLOBAL_TEAM_ID, fromLibName)
  }
  const rows = await q<{ id: string; rootSpecificationId: string; entityType: string; data: string }>(
    `SELECT s.id, s."rootSpecificationId", l."entityType", s.data
       FROM specification s JOIN library l ON l.id = s."libraryId"
      WHERE l."entityType" IN ('environment','workflow') ${teamClause}
        AND position($1 in s.data) > 0
      ORDER BY s.id`,
    params,
  )
  const changedRoots = new Map<string, 'action_library' | 'actionLibraryName'>()
  const now = Date.now()
  for (const r of rows) {
    const out = rewriteActionRefsInData(r.data, names, fromLibName, toLibName)
    if (!out.changed) continue
    await q('UPDATE specification SET data = $1, "updatedAt" = $2 WHERE id = $3', [out.json, now, r.id])
    if (!changedRoots.has(r.rootSpecificationId)) {
      changedRoots.set(r.rootSpecificationId, r.entityType === 'environment' ? 'action_library' : 'actionLibraryName')
    }
  }
  for (const [rootId, field] of changedRoots) {
    const [root] = await q<{ version: string; history: string | null }>(
      'SELECT version, history FROM specification WHERE id = $1',
      [rootId],
    )
    if (!root) continue
    const history = parseHistory(root.history)
    history.push(
      createReferenceUpdatedEntry({ account, version: root.version, field, from: fromLibName, to: toLibName }),
    )
    await q('UPDATE specification SET history = $1 WHERE id = $2', [serializeHistory(history), rootId])
  }
  return changedRoots.size
}
