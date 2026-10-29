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

import { and, inArray, or } from 'drizzle-orm'
import type { db as appDb } from '../lib/db'
import { proxyReference, specification } from '../db/schema'
import { canDelete, canDo, type Principal } from '../authz/policy'
import type { Blocker, ImportPlanRow, RefusedReplace } from '@/types/wflibx-import'
import type { ExistingDbState } from './buildImportPlan'

export type Db = typeof appDb

/** Keeps each IN (...) list well under the driver's bind-parameter limit. */
const CHUNK = 1000

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK))
  return out
}

/**
 * The edit-locked specs a Replace of `targetSpecIds` would delete or change (spec 2026-10-21 §6):
 * the targets, every spec their delete cascades to (parentSpecificationId / rootSpecificationId
 * are ON DELETE CASCADE, followed transitively), and every spec that owns a proxy_reference into
 * that set (the Replace deletes those links). Uses `db`, not a transaction's `q` — call it, like
 * `editLockedStates()`, before `withTransaction`.
 */
export async function findReplaceBlockers(db: Db, targetSpecIds: string[], locked: Set<string>): Promise<Blocker[]> {
  if (targetSpecIds.length === 0 || locked.size === 0) return []
  const targets = new Set(targetSpecIds)
  const doomed = new Set(targetSpecIds)
  let frontier = [...targets]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const part of chunks(frontier)) {
      const rows = await db
        .select({ id: specification.id })
        .from(specification)
        .where(or(inArray(specification.parentSpecificationId, part), inArray(specification.rootSpecificationId, part)))
      for (const r of rows) {
        if (!doomed.has(r.id)) {
          doomed.add(r.id)
          next.push(r.id)
        }
      }
    }
    frontier = next
  }

  const linkOwners = new Set<string>()
  for (const part of chunks([...doomed])) {
    const rows = await db
      .select({ owner: proxyReference.parentSpecificationId })
      .from(proxyReference)
      .where(inArray(proxyReference.targetSpecificationId, part))
    for (const r of rows) if (!doomed.has(r.owner)) linkOwners.add(r.owner)
  }

  const blockers: Blocker[] = []
  for (const part of chunks([...doomed, ...linkOwners])) {
    const rows = await db
      .select({
        id: specification.id,
        name: specification.name,
        version: specification.version,
        state: specification.state,
      })
      .from(specification)
      .where(and(inArray(specification.id, part), inArray(specification.state, [...locked])))
    for (const r of rows) {
      blockers.push({
        specId: r.id,
        name: r.name,
        version: r.version,
        state: r.state,
        why: targets.has(r.id) ? 'is-locked' : doomed.has(r.id) ? 'family-locked' : 'owns-proxy-link',
      })
    }
  }
  return blockers.sort((a, b) => a.specId.localeCompare(b.specId))
}

/**
 * Turn every conflict row the importer may not Replace into a `refused` row. The lock rule is
 * checked first and on its own, so neither an administrator nor canDelete's Obsolete exception
 * gets a locked spec through; then a Replace needs canDelete on the existing spec (for a library:
 * `library.delete` plus canDelete on each of its specs) in that library's own team.
 */
export async function refuseBlockedReplaces(
  db: Db,
  rows: ImportPlanRow[],
  existing: ExistingDbState,
  principal: Principal,
  locked: Set<string>,
): Promise<ImportPlanRow[]> {
  const out: ImportPlanRow[] = []
  for (const row of rows) {
    const s = row.status
    if (s.tag !== 'conflict') {
      out.push(row)
      continue
    }
    const spec = row.kind === 'specification' ? existing.specifications.find((x) => x.id === s.existingOid) : undefined
    const libId = row.kind === 'library' ? s.existingOid : spec?.libraryId
    const lib = existing.libraries.find((l) => l.id === libId)
    const libSpecs = row.kind === 'library' ? existing.specifications.filter((x) => x.libraryId === libId) : []
    const existingState = spec?.state ?? ''
    const refuse = (refusal: { reason: 'locked' | 'no-permission'; blockers: Blocker[] }): void => {
      out.push({ ...row, status: { ...s, tag: 'refused', existingState, refusal } })
    }

    const targetIds = row.kind === 'library' ? libSpecs.map((x) => x.id) : [s.existingOid]
    const blockers = await findReplaceBlockers(db, targetIds, locked)
    if (blockers.length > 0) {
      refuse({ reason: 'locked', blockers })
      continue
    }

    let allowed = false
    if (lib) {
      const libRef = { teamId: lib.teamId ?? null, entityType: lib.entityType }
      if (row.kind === 'specification') {
        allowed = !!spec && (await canDelete(principal, { state: spec.state ?? null }, libRef))
      } else {
        allowed = canDo(principal, 'library.delete', libRef)
        // canDelete depends only on the state here, so one check per distinct state.
        for (const state of new Set(libSpecs.map((x) => x.state ?? null))) {
          if (!allowed) break
          allowed = await canDelete(principal, { state }, libRef)
        }
      }
    }
    if (allowed) out.push(row)
    else refuse({ reason: 'no-permission', blockers: [] })
  }
  return out
}

/**
 * The post-import list of refused Replaces: one entry per refused spec row (the existing spec),
 * then, for a refused library row, the locked specs that blocked it — or the library itself for a
 * rights refusal. Deduplicated by OID, since a refused spec usually also blocks its library.
 */
export function refusedReport(rows: ImportPlanRow[]): RefusedReplace[] {
  const byOid = new Map<string, RefusedReplace>()
  const ordered = [...rows.filter((r) => r.kind === 'specification'), ...rows.filter((r) => r.kind === 'library')]
  for (const row of ordered) {
    const s = row.status
    if (s.tag !== 'refused') continue
    const reason = s.refusal.reason
    if (row.kind === 'library' && reason === 'locked') {
      for (const b of s.refusal.blockers) {
        if (!byOid.has(b.specId)) {
          byOid.set(b.specId, { oid: b.specId, name: b.name, version: b.version, state: b.state, reason })
        }
      }
    } else if (!byOid.has(s.existingOid)) {
      byOid.set(s.existingOid, {
        oid: s.existingOid,
        name: s.existingName,
        version: s.existingVersion,
        state: s.existingState,
        reason,
        ...(reason === 'changed-since-export'
          ? {
              fileVersion: row.bundleVersion,
              fileState: s.refusal.fileState ?? '',
              ...(s.refusal.effectiveVersionHere !== undefined
                ? { effectiveVersionHere: s.refusal.effectiveVersionHere }
                : {}),
            }
          : {}),
      })
    }
  }
  return [...byOid.values()]
}

/** Connection-scoped query function threaded from withTransaction. */
type Q = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>

/** A Replace found a locked spec inside the transaction; rolls the whole commit back. */
export class LockedReplaceError extends Error {
  constructor(public readonly blockers: Blocker[]) {
    super('locked_replace')
    this.name = 'LockedReplaceError'
  }
}

/**
 * The in-transaction half of the lock rule (spec 2026-10-21 §6): run with the transaction's `q`
 * right before a Replace deletes. Row-locks (FOR UPDATE) everything the delete would affect —
 * the targets (for a library: the library row and every spec in it), their cascade targets and the
 * owners of the proxy references it removes — growing the set until it is stable, then throws
 * LockedReplaceError if any of them is in a locked state. The locks hold until commit, so no spec
 * can be released, and no child or proxy link added, between this check and the delete. `locked`
 * comes from `editLockedStates()`, read before `withTransaction` (rawQuery deadlocks inside it).
 */
export async function assertReplaceUnlocked(
  q: Q,
  target: { specIds: string[] } | { libraryId: string },
  locked: Set<string>,
): Promise<void> {
  let targets: string[]
  if ('libraryId' in target) {
    await q('SELECT id FROM "library" WHERE id = $1 FOR UPDATE', [target.libraryId])
    const rows = await q<{ id: string }>('SELECT id FROM "specification" WHERE "libraryId" = $1 FOR UPDATE', [
      target.libraryId,
    ])
    targets = rows.map((r) => r.id)
  } else {
    targets = target.specIds
  }
  if (targets.length === 0) return
  const targetSet = new Set(targets)

  let lockedIds = new Set<string>()
  let doomed = new Set<string>()
  for (;;) {
    const walk = await q<{ id: string }>(
      `WITH RECURSIVE doomed(id) AS (
         SELECT id FROM "specification" WHERE id = ANY($1::text[])
         UNION
         SELECT s.id FROM "specification" s
           JOIN doomed d ON s."parentSpecificationId" = d.id OR s."rootSpecificationId" = d.id
       )
       SELECT id FROM doomed`,
      [targets],
    )
    doomed = new Set(walk.map((r) => r.id))
    const linkRows = await q<{ owner: string }>(
      `SELECT DISTINCT "parentSpecificationId" AS owner FROM "proxy_reference"
        WHERE "targetSpecificationId" = ANY($1::text[])`,
      [[...doomed]],
    )
    const owners = new Set(linkRows.map((r) => r.owner).filter((id) => !doomed.has(id)))
    const wanted = [...doomed, ...owners].filter((id) => !lockedIds.has(id))
    if (wanted.length === 0) break
    // Sorted, so concurrent commits take the row locks in the same order.
    await q('SELECT id FROM "specification" WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE', [wanted.sort()])
    lockedIds = new Set([...lockedIds, ...wanted])
  }

  const rows = await q<{ id: string; name: string; version: string; state: string }>(
    `SELECT id, name, version, state FROM "specification" WHERE id = ANY($1::text[]) ORDER BY id`,
    [[...lockedIds]],
  )
  const blockers: Blocker[] = rows
    .filter((r) => locked.has(r.state))
    .map((r) => ({
      specId: r.id,
      name: r.name,
      version: r.version,
      state: r.state,
      why: targetSet.has(r.id) ? 'is-locked' : doomed.has(r.id) ? 'family-locked' : 'owns-proxy-link',
    }))
  if (blockers.length > 0) throw new LockedReplaceError(blockers)
}
