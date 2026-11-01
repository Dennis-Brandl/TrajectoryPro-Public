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

import { rawQuery, withTransaction } from '../../lib/db'
import type { V2Session } from '../../middleware/v2/permissions'
import { can, loadPrincipal } from '../../authz/policy'
import { resolveVisibleSpec } from '../../routes/v2/_specGate'
import { GLOBAL_TEAM_ID } from '../../../lib/global-team'
import { collectDependencies } from './collectDependencies'
import { copyElement, copyIntoTeam, remapLibraryIds, remapSpecRefs, type CopyPlanResult } from './copyIntoTeam'
import { loadElement, type Querier } from './loadElement'
import { moveElementRows } from './moveElementRows'
import { envIdsOf } from './rewriteReferences'
import type { MoveResult } from './moveToLibrary'

export type MoveToTeamResult =
  | (Extract<MoveResult, { ok: true }> & {
      librariesCreated: CopyPlanResult['librariesCreated']
      elementsCopied: number
      /** Destination libraries that received copies (de-duplicated). */
      touchedLibraryIds: string[]
    })
  | Extract<MoveResult, { ok: false }>

interface LibRow {
  id: string
  name: string
  teamId: string | null
  entityType: string
}

/** Thrown inside the transaction so the copies made so far roll back. */
class MissingRights extends Error {
  constructor(readonly missing: string[]) {
    super('missing rights')
  }
}

/**
 * Moves every version of a workflow into a workflow library of another team.
 * Environments, actions and sub-workflows it needs are copied into the
 * destination (see copyIntoTeam) and the moved rows are re-pointed at them.
 * With mode 'copy' the workflow's rows stay put and new rows in the destination
 * (which also takes `workflow:create` there) point at those copies instead;
 * `movedRootIds` then lists the new rows.
 */
export async function moveToTeam(
  session: V2Session,
  specId: string,
  targetTeamId: string,
  targetLibraryId: string,
  mode: 'move' | 'copy' = 'move',
): Promise<MoveToTeamResult> {
  const resolved = await resolveVisibleSpec(session, specId)
  if (!resolved) return { ok: false, status: 404, code: 'not_found' }
  const principal = await loadPrincipal(session.userId)
  if (!principal) return { ok: false, status: 404, code: 'not_found' }

  const src = resolved.lib
  const invalid = (reason: string): MoveToTeamResult => ({
    ok: false,
    status: 422,
    code: 'move_target_invalid',
    details: { reason },
  })
  const fromTeamId = src.teamId
  if (src.entityType !== 'workflow') return invalid('not_a_workflow')
  if (!fromTeamId || fromTeamId === GLOBAL_TEAM_ID) return invalid('source_not_team')
  if (targetTeamId === fromTeamId) return invalid('same_team')
  if (targetTeamId === GLOBAL_TEAM_ID) return invalid('workflow_to_global')

  const [target] = await rawQuery<LibRow>('SELECT id, name, "teamId", "entityType" FROM library WHERE id = $1', [
    targetLibraryId,
  ])
  if (!target) return invalid('target_not_found')
  if (target.entityType !== 'workflow') return invalid('entity_type_differs')
  if (target.teamId !== targetTeamId) return invalid('target_not_in_team')

  const missingBase = [src, target].flatMap((lib) =>
    ['workflow:library.create', 'workflow:library.delete'].filter((r) => !can(principal, r, lib)),
  )
  if (missingBase.length > 0) {
    return { ok: false, status: 403, code: 'forbidden', details: { missing: [...new Set(missingBase)].sort() } }
  }

  try {
    return await withTransaction(async (q): Promise<MoveToTeamResult> => {
      const el = await loadElement(q, specId, { lock: true })
      if (!el) return { ok: false, status: 404, code: 'not_found' }
      if (el.libraryId !== src.id) {
        return { ok: false, status: 409, code: 'conflict', details: { reason: 'moved_concurrently' } }
      }
      const clash = await q<{ id: string }>(
        'SELECT id FROM specification WHERE "libraryId" = $1 AND name = $2 AND "parentSpecificationId" IS NULL LIMIT 1',
        [target.id, el.name],
      )
      if (clash[0]) {
        return {
          ok: false,
          status: 409,
          code: 'move_name_conflict',
          details: { libraryName: target.name, name: el.name },
        }
      }

      const deps = await collectDependencies(q, el.allRowIds)
      const plan = await copyIntoTeam(q, deps, targetTeamId, session.userId)
      const missing = [
        ...plan.neededRights.filter((r) => !can(principal, r, { teamId: targetTeamId })),
        ...plan.neededGlobalRights.filter((r) => !can(principal, r, { teamId: GLOBAL_TEAM_ID })),
        ...(mode === 'copy' && !can(principal, 'workflow:create', target) ? ['workflow:create'] : []),
      ]
      // Throwing rolls back the copies made above.
      if (missing.length > 0) throw new MissingRights([...new Set(missing)].sort())

      let rootIds = el.rootIds
      if (mode === 'copy') {
        const copied = await copyElement(q, el, target.id, session.userId, plan)
        rootIds = copied.rootIds
        await repointRows(q, [...copied.ownIds.values()], rootIds, target.id, plan)
      } else {
        await moveElementRows(q, el, target.id, session.userId, { fromTeamId, toTeamId: targetTeamId })
        await repointRows(q, el.allRowIds, el.rootIds, target.id, plan)
      }
      return {
        ok: true,
        movedRootIds: rootIds,
        referencesUpdated: 0,
        librariesCreated: plan.librariesCreated,
        elementsCopied: plan.elementsCopied,
        touchedLibraryIds: [...new Set(plan.libraryMap.values())],
      }
    })
  } catch (e) {
    if (e instanceof MissingRights) {
      return { ok: false, status: 403, code: 'forbidden', details: { missing: e.missing } }
    }
    throw e
  }
}

/** Remaps ids in the moved rows and re-links the roots' environment libraries. */
async function repointRows(
  q: Querier,
  allRowIds: string[],
  rootIds: string[],
  targetLibraryId: string,
  plan: CopyPlanResult,
): Promise<void> {
  const rows = await q<{ id: string; data: string; environmentLibraryIds: string | null }>(
    'SELECT id, data, "environmentLibraryIds" FROM specification WHERE id = ANY($1::text[])',
    [allRowIds],
  )
  const roots = new Set(rootIds)
  const rootEnvIds = new Map<string, string[]>()
  for (const r of rows) {
    const data = remapSpecRefs(r.data, plan.idMap, plan.libraryMap)
    const libIds = remapLibraryIds(r.environmentLibraryIds, plan.libraryMap)
    if (data !== r.data || libIds !== r.environmentLibraryIds) {
      await q('UPDATE specification SET data = $1, "environmentLibraryIds" = $2 WHERE id = $3', [data, libIds, r.id])
    }
    if (roots.has(r.id)) rootEnvIds.set(r.id, envIdsOf(data))
  }

  // Each root links the environment libraries its (remapped) environments live in.
  for (const [rootId, envIds] of rootEnvIds) {
    await q('DELETE FROM specification_environment WHERE "specificationId" = $1', [rootId])
    if (envIds.length === 0) continue
    const libs = await q<{ libraryId: string }>(
      `SELECT DISTINCT s."libraryId" FROM specification s JOIN library l ON l.id = s."libraryId"
        WHERE s.id = ANY($1::text[]) AND l."entityType" = 'environment'`,
      [envIds],
    )
    for (const { libraryId } of libs) {
      await q(
        `INSERT INTO specification_environment ("specificationId","environmentLibraryId") VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [rootId, libraryId],
      )
      await q(
        `INSERT INTO library_environment ("libraryId","environmentLibraryId") VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [targetLibraryId, libraryId],
      )
    }
  }
}
