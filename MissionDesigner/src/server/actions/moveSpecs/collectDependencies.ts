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

// FINDING (Task 4, for Task 5): `actionProxyConfig.action_oid` and
// `actionProxyConfig.environment_oid` hold specification ROW IDS — `specification.id`
// of the action spec and of the environment spec. The gear picker writes them from
// `action.id` / `environmentSpecId` (ActionSelector.tsx → action-selection.ts:38),
// `resolve-action-spec.ts` compares `environment_oid` with `data.environmentSpecIds`,
// and the client importers keep the package `oid` AS the row id (library-importers.ts).
// A copy gets new row ids, so Task 5 MUST remap both through `idMap` — `remapSpecRefs`
// in copyIntoTeam.ts does exactly that, together with every other id reference site.

import { GLOBAL_TEAM_ID, pickLibraryByName } from '../../../lib/global-team'
import { compareSemver } from '../../../types/version'
import type { Querier } from './loadElement'
import { actionRefSites, envIdsOf, isObj } from './rewriteReferences'

export type DepEntityType = 'environment' | 'action' | 'step'

export interface DepRef {
  specId: string
  libraryId: string
  libraryName: string
  teamId: string
  entityType: DepEntityType
  /** The element (root) name and version of `specId`. */
  name: string
  version: string
}

export interface Dependencies {
  environments: DepRef[]
  actions: DepRef[]
  steps: DepRef[]
}

const DEP_TYPES: readonly string[] = ['environment', 'action', 'step']

/** References found in one spec row's data. */
interface RowRefs {
  ids: string[]
  actionNames: { library: string; name: string }[]
}

/**
 * Every outgoing reference in a spec row's data: spec ids (`environmentSpecIds`,
 * node `environmentSpecId`, `actionProxyConfig.environment_oid` / `action_oid`,
 * `referencedStepSpecId`, resource-command `resourceSourceOid`) and by-name action
 * references (environment `included_actions`, ACTION PROXY `actionLibraryName`).
 */
function refsOf(dataJson: string): RowRefs {
  const ids = envIdsOf(dataJson)
  const actionNames: RowRefs['actionNames'] = []
  let data: unknown
  try {
    data = JSON.parse(dataJson)
  } catch {
    return { ids, actionNames }
  }
  if (!isObj(data)) return { ids, actionNames }
  const str = (v: unknown) => (typeof v === 'string' && v ? [v] : [])
  for (const n of Array.isArray(data.nodes) ? data.nodes : []) {
    const d = isObj(n) ? n.data : undefined
    if (!isObj(d)) continue
    ids.push(...str(d.environmentSpecId), ...str(d.referencedStepSpecId))
    if (isObj(d.actionProxyConfig))
      ids.push(...str(d.actionProxyConfig.environment_oid), ...str(d.actionProxyConfig.action_oid))
    for (const rc of Array.isArray(d.resourceCommands) ? d.resourceCommands : []) {
      if (isObj(rc)) ids.push(...str(rc.resourceSourceOid))
    }
  }
  for (const { entry, libKey, nameKey } of actionRefSites(data)) {
    const library = entry[libKey]
    const name = entry[nameKey]
    if (typeof library === 'string' && library && typeof name === 'string' && name) actionNames.push({ library, name })
  }
  return { ids, actionNames }
}

interface TargetRow {
  specId: string
  libraryId: string
  libraryName: string
  teamId: string
  entityType: string
  rootId: string
  name: string
  version: string
}

const TARGET_SQL = `SELECT s.id AS "specId", l.id AS "libraryId", l.name AS "libraryName", l."teamId", l."entityType",
                           r.id AS "rootId", r.name, r.version
                      FROM specification s
                      JOIN specification r ON r.id = s."rootSpecificationId"
                      JOIN library l ON l.id = s."libraryId"`

/**
 * What the given rows DIRECTLY depend on outside themselves: environment, action
 * and step specs in non-GLOBAL libraries. Not recursive — what a dependency in
 * turn needs only matters when it is copied, so copyIntoTeam expands through the
 * elements it actually copies by calling this again on their rows. By-name action
 * references resolve team-first (the referencing row's team) then GLOBAL
 * (pickLibraryByName) to the element's latest version. Targets inside the given
 * rows' own trees are ignored. De-duplicated by spec id. Read-only.
 */
export async function collectDependencies(q: Querier, rowIds: string[]): Promise<Dependencies> {
  const own = new Set(rowIds)
  const deps = new Map<string, DepRef>()
  const accept = (t: TargetRow, refTeams?: Set<string>) => {
    // A by-id reference only counts when the target lives in the referencing row's own team.
    if (refTeams && !refTeams.has(t.teamId)) return
    if (own.has(t.rootId) || t.teamId === GLOBAL_TEAM_ID || !DEP_TYPES.includes(t.entityType)) return
    if (deps.has(t.specId)) return
    const { rootId: _rootId, ...ref } = t
    deps.set(t.specId, { ...ref, entityType: t.entityType as DepEntityType })
  }

  const rows = await q<{ id: string; data: string; teamId: string }>(
    `SELECT s.id, s.data, l."teamId" FROM specification s JOIN library l ON l.id = s."libraryId"
      WHERE s.id = ANY($1::text[])`,
    [rowIds],
  )
  const idRefs = new Map<string, Set<string>>()
  const nameRefs = new Map<string, { library: string; name: string; teamId: string }>()
  for (const r of rows) {
    const refs = refsOf(r.data)
    for (const id of refs.ids) {
      if (own.has(id)) continue
      const teams = idRefs.get(id) ?? new Set<string>()
      teams.add(r.teamId)
      idRefs.set(id, teams)
    }
    for (const a of refs.actionNames) nameRefs.set(`${r.teamId}\0${a.library}\0${a.name}`, { ...a, teamId: r.teamId })
  }

  if (idRefs.size > 0) {
    const targets = await q<TargetRow>(`${TARGET_SQL} WHERE s.id = ANY($1::text[]) ORDER BY s.id`, [[...idRefs.keys()]])
    for (const t of targets) accept(t, idRefs.get(t.specId))
  }

  for (const ref of nameRefs.values()) {
    const libs = await q<{ id: string; name: string; entityType: string; teamId: string }>(
      `SELECT id, name, "entityType", "teamId" FROM library
        WHERE name = $1 AND "entityType" = 'action' AND "teamId" = ANY($2::text[])
        ORDER BY ("teamId" = $3), ("parentLibraryId" IS NOT NULL), id`,
      [ref.library, [ref.teamId, GLOBAL_TEAM_ID], GLOBAL_TEAM_ID],
    )
    const lib = pickLibraryByName(libs, ref.library, 'action', ref.teamId)
    if (!lib || lib.teamId === GLOBAL_TEAM_ID) continue
    const versions = await q<TargetRow>(
      `${TARGET_SQL} WHERE s."libraryId" = $1 AND s.name = $2 AND s."parentSpecificationId" IS NULL`,
      [lib.id, ref.name],
    )
    const latest = versions.sort((a, b) => compareSemver(b.version, a.version))[0]
    if (latest) accept(latest)
  }

  const of = (type: DepEntityType) => [...deps.values()].filter((d) => d.entityType === type)
  return { environments: of('environment'), actions: of('action'), steps: of('step') }
}
