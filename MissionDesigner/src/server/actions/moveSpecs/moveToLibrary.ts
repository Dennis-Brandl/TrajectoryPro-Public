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
import { canDo, loadPrincipal } from '../../authz/policy'
import { cat } from '../../authz/rights'
import { resolveVisibleSpec } from '../../routes/v2/_specGate'
import { GLOBAL_TEAM_ID } from '../../../lib/global-team'
import { loadElement, type ElementRows, type Querier } from './loadElement'
import { copyElement } from './copyIntoTeam'
import { moveElementRows } from './moveElementRows'
import { relinkEnvironmentLibraries, relinkWorkflowLibraries, rewriteActionLibraryNames } from './rewriteReferences'

export type MoveResult =
  | { ok: true; movedRootIds: string[]; referencesUpdated: number }
  | { ok: false; status: 403 | 404 | 409 | 422; code: string; details?: Record<string, unknown> }

/** Step-library elements are not movable: their references carry library ids that are not rewritten. */
const MOVABLE_TYPES: readonly string[] = ['workflow', 'environment', 'action']

interface LibRow {
  id: string
  name: string
  teamId: string | null
  entityType: string
}

/** Moves every version of the element `specId` belongs to into another library
 *  of the same entity type (or a GLOBAL library, for environments and actions).
 *  With mode 'copy' the source stays put: the destination gets new rows (which also
 *  takes `<cat>:create` there) and references to the source are left as they are.
 *  `movedRootIds` then lists the copies. */
export async function moveToLibrary(
  session: V2Session,
  specId: string,
  targetLibraryId: string,
  mode: 'move' | 'copy' = 'move',
): Promise<MoveResult> {
  const resolved = await resolveVisibleSpec(session, specId)
  if (!resolved) return { ok: false, status: 404, code: 'not_found' }
  const principal = await loadPrincipal(session.userId)
  if (!principal) return { ok: false, status: 404, code: 'not_found' }

  const src = resolved.lib
  const hasRights = (lib: { teamId: string | null; entityType: string }) =>
    canDo(principal, 'library.create', lib) && canDo(principal, 'library.delete', lib)
  if (!hasRights(src)) return { ok: false, status: 403, code: 'forbidden' }

  const [target] = await rawQuery<LibRow>('SELECT id, name, "teamId", "entityType" FROM library WHERE id = $1', [
    targetLibraryId,
  ])
  const invalid = (reason: string): MoveResult => ({
    ok: false,
    status: 422,
    code: 'move_target_invalid',
    details: { reason },
  })
  if (!target) return invalid('target_not_found')
  if (!MOVABLE_TYPES.includes(src.entityType)) return invalid('unsupported_type')
  if (target.id === src.id) return invalid('same_library')
  if (target.entityType !== src.entityType) return invalid('entity_type_differs')
  const crossesTeam = target.teamId !== src.teamId
  if (crossesTeam) {
    if (target.teamId !== GLOBAL_TEAM_ID) return invalid('other_team')
    if (src.entityType === 'workflow') return invalid('workflow_to_global')
    if (!hasRights(target)) return { ok: false, status: 403, code: 'forbidden' }
  }
  if (mode === 'copy' && !canDo(principal, 'create', target)) {
    return { ok: false, status: 403, code: 'forbidden', details: { missing: [`${cat(target.entityType)}:create`] } }
  }

  return withTransaction(async (q): Promise<MoveResult> => {
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
    if (mode === 'copy') {
      const copied = await copyElement(q, el, target.id, session.userId, { idMap: new Map(), libraryMap: new Map() })
      await copyEnvironmentLinks(q, copied.ownIds, target.id)
      return { ok: true, movedRootIds: copied.rootIds, referencesUpdated: 0 }
    }
    const teams = crossesTeam && src.teamId && target.teamId ? { fromTeamId: src.teamId, toTeamId: target.teamId } : {}
    await moveElementRows(q, el, target.id, session.userId, teams)
    const referencesUpdated = await fixReferences(q, src, target, el, session.userId)
    return { ok: true, movedRootIds: el.rootIds, referencesUpdated }
  })
}

/** A copy that stays in the team uses the same environments, so it keeps the same links. */
async function copyEnvironmentLinks(q: Querier, ownIds: Map<string, string>, targetLibraryId: string): Promise<void> {
  const links = await q<{ specificationId: string; environmentLibraryId: string }>(
    'SELECT "specificationId", "environmentLibraryId" FROM specification_environment WHERE "specificationId" = ANY($1::text[])',
    [[...ownIds.keys()]],
  )
  for (const l of links) {
    await q(
      `INSERT INTO specification_environment ("specificationId","environmentLibraryId") VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [ownIds.get(l.specificationId), l.environmentLibraryId],
    )
  }
  await relinkWorkflowLibraries(q, [...ownIds.values()], targetLibraryId)
}

/** Brings by-id and by-name references in line with the move. Returns how many
 *  references were updated (link rows added, or spec roots rewritten). */
async function fixReferences(
  q: Querier,
  src: { id: string; name: string; teamId: string | null; entityType: string },
  target: LibRow,
  el: ElementRows,
  account: string,
): Promise<number> {
  switch (src.entityType) {
    case 'environment':
      return relinkEnvironmentLibraries(q, el.rootIds, src.id, target.id)
    case 'workflow':
      return relinkWorkflowLibraries(q, el.rootIds, target.id)
    case 'action': {
      // A GLOBAL library resolves by name in every team; a team library only in its own.
      const teamIds = src.teamId === GLOBAL_TEAM_ID || !src.teamId ? 'all' : [src.teamId]
      return rewriteActionLibraryNames(q, [el.name], src.name, target.name, { teamIds }, account)
    }
    default:
      return 0
  }
}
