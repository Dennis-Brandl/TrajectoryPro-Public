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

// Phase 35 §2.3 / §2.5 / §2.7: specification read endpoints.
// Batch-save (§2.4) is added in Wave D — see bottom of this file.

import { Hono } from 'hono'
import { z } from 'zod'
import crypto from 'node:crypto'
import { specReadDao, TreeTooLargeError } from '../../dao/specReadDao'
import { v2ErrorBody } from '../../errors/v2'
import { MAX_BULK_FETCH_IDS } from '../../limits'
import type { V2Session } from '../../middleware/v2/permissions'
import { runBatchSave } from '../../batchSave'
import { translatePostgresError } from '../../batchSave/errorTranslate'
import { rawQuery, withTransaction } from '../../lib/db'
import { createStateChangeEntry, serializeHistory } from '../../../types/specification-history'
import type { SpecificationState } from '../../../types/library'
import { assertCanWriteSpec, gateErrorCode, resolveVisibleSpec } from './_specGate'
import { loadPrincipal, canDo, legalEdge, rightForEdge } from '../../authz/policy'
import { cloneSpecificationSubtree, type CloneSourceRow } from '../../actions/cloneSpecificationSubtree'
import { topoSortByParent } from '../../actions/moveSpecs/topoSort'

type Variables = { v2Session: V2Session }

export const specificationsV2 = new Hono<{ Variables: Variables }>()

specificationsV2.get('/specifications/:rootId/tree', async (c) => {
  const session = c.get('v2Session')
  const rootId = c.req.param('rootId')
  try {
    const tree = await specReadDao.getTree({ sessionUserId: session.userId }, rootId)
    if (!tree) return c.json(v2ErrorBody('not_found'), 404)
    return c.json(tree)
  } catch (err) {
    if (err instanceof TreeTooLargeError) {
      return c.json(v2ErrorBody('tree_too_large', { dimension: err.dimension, count: err.count }), 413)
    }
    throw err
  }
})

specificationsV2.get('/specifications/:id', async (c) => {
  const session = c.get('v2Session')
  const spec = await specReadDao.getSpec({ sessionUserId: session.userId }, c.req.param('id'))
  if (!spec) return c.json(v2ErrorBody('not_found'), 404)
  return c.json({ spec })
})

const BulkFetchBody = z.strictObject({
  specIds: z.array(z.string()).min(1),
})

specificationsV2.post('/specifications/bulk-fetch', async (c) => {
  const session = c.get('v2Session')
  let body: z.infer<typeof BulkFetchBody>
  try {
    body = BulkFetchBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  if (body.specIds.length > MAX_BULK_FETCH_IDS) {
    return c.json(v2ErrorBody('payload_too_large', { limit: MAX_BULK_FETCH_IDS, actual: body.specIds.length }), 413)
  }
  const result = await specReadDao.getSpecs({ sessionUserId: session.userId }, body.specIds)
  return c.json({ specs: Array.from(result.specs.values()), missingIds: result.missingIds })
})

specificationsV2.post('/specifications/batch-save', async (c) => {
  const session = c.get('v2Session')
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }

  const ctx = { sessionUserId: session.userId }
  const outcome = await runBatchSave(body, ctx)
  return c.json(outcome.body, outcome.status as 200 | 403 | 404 | 409 | 413 | 422)
})

const SPECIFICATION_STATES: readonly SpecificationState[] = [
  'Draft',
  'InTest',
  'InReview',
  'Approved',
  'Effective',
  'Superseded',
  'Obsolete',
] as const

const ChangeStateBody = z.strictObject({
  newState: z.enum([...SPECIFICATION_STATES] as [SpecificationState, ...SpecificationState[]]),
  reason: z.string(),
  /** Unix-ms in-force date — REQUIRED when newState='Effective', rejected otherwise (design §8, A1). */
  effectiveFrom: z.number().int().optional(),
})

/** A1: server-local calendar day — midnight of the server's current day. */
function startOfTodayMs(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

specificationsV2.patch('/specifications/:id/state', async (c) => {
  const session = c.get('v2Session') as V2Session
  const id = c.req.param('id')

  let body: z.infer<typeof ChangeStateBody>
  try {
    body = ChangeStateBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  if (body.reason.trim().length < 1) {
    return c.json(v2ErrorBody('schema_mismatch', { field: 'reason' }), 422)
  }

  // Visibility (404 conflation for non-members), then rights/legality below.
  const resolved = await resolveVisibleSpec(session, id)
  if (!resolved) return c.json(v2ErrorBody('not_found'), 404)
  const { spec: current, lib } = resolved

  const principal = await loadPrincipal(session.userId)
  if (!principal) return c.json(v2ErrorBody('not_found'), 404)

  const fromState = current.state as SpecificationState
  if (fromState === body.newState) {
    return c.json(v2ErrorBody('schema_mismatch', { field: 'newState' }), 422)
  }

  // Legality + per-edge right (design §7): 409 for an illegal edge, 403 for a
  // legal edge whose right the member lacks. Admins bypass both — a forced
  // illegal edge is flagged in history (design D14).
  const edgeLegal = legalEdge(fromState, body.newState)
  if (!principal.isAdministrator) {
    if (!edgeLegal) {
      return c.json(v2ErrorBody('illegal_transition', { from: fromState, to: body.newState }), 409)
    }
    const verb = rightForEdge(fromState, body.newState)!
    if (!canDo(principal, verb, lib)) return c.json(v2ErrorBody('forbidden'), 403)
  }

  // Effective requires a scheduled date — admins included, an Effective spec
  // without one is meaningless. All other targets must not carry one (A1).
  const now = Date.now()
  let effectiveFrom: number | null = null
  if (body.newState === 'Effective') {
    if (body.effectiveFrom === undefined) {
      return c.json(v2ErrorBody('schema_mismatch', { field: 'effectiveFrom', reason: 'required for Effective' }), 422)
    }
    if (body.effectiveFrom < startOfTodayMs(now)) {
      return c.json(v2ErrorBody('schema_mismatch', { field: 'effectiveFrom', reason: 'in the past' }), 422)
    }
    effectiveFrom = body.effectiveFrom
  } else if (body.effectiveFrom !== undefined) {
    return c.json(v2ErrorBody('schema_mismatch', { field: 'effectiveFrom', reason: 'only valid for Effective' }), 422)
  }

  const entry = createStateChangeEntry({
    account: session.userId,
    version: current.version ?? '1.0.0',
    fromState,
    toState: body.newState,
    reason: body.reason,
    adminOverride: principal.isAdministrator && !edgeLegal,
    effectiveFrom: effectiveFrom ?? undefined,
  })
  const newHistory = serializeHistory([...current.history, entry])

  if (body.newState === 'Effective') {
    await rawQuery(
      `UPDATE specification SET state = $1, history = $2, "updatedAt" = $3, "lastEditedByUserId" = $4, "effectiveFrom" = $5 WHERE id = $6`,
      [body.newState, newHistory, now, session.userId, effectiveFrom, id],
    )
  } else {
    await rawQuery(
      `UPDATE specification SET state = $1, history = $2, "updatedAt" = $3, "lastEditedByUserId" = $4 WHERE id = $5`,
      [body.newState, newHistory, now, session.userId, id],
    )
  }

  const updated = await specReadDao.getSpec({ sessionUserId: session.userId }, id)
  return c.json({ spec: updated })
})

// ---------------------------------------------------------------------------
// POST /specifications/:id/new-version
// ---------------------------------------------------------------------------

const NewVersionBody = z.strictObject({ version: z.string() })

function isValidSemver(v: string): boolean {
  const parts = v.split('.')
  if (parts.length !== 3) return false
  return parts.every((p) => /^(0|[1-9]\d*)$/.test(p))
}

specificationsV2.post('/specifications/:id/new-version', async (c) => {
  const session = c.get('v2Session') as V2Session
  const id = c.req.param('id')

  let body: z.infer<typeof NewVersionBody>
  try {
    body = NewVersionBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }

  const newVersion = body.version
  if (!isValidSemver(newVersion)) {
    return c.json(v2ErrorBody('schema_mismatch', { field: 'version' }), 422)
  }

  // Permission (design D8): creating a new version is a CREATE, not an edit —
  // the source spec may legitimately be edit-locked (Approved/Effective/…).
  const resolved = await resolveVisibleSpec(session, id)
  if (!resolved) return c.json(v2ErrorBody('not_found'), 404)
  const principal = await loadPrincipal(session.userId)
  if (!principal) return c.json(v2ErrorBody('not_found'), 404)
  if (!canDo(principal, 'create', resolved.lib)) return c.json(v2ErrorBody('forbidden'), 403)

  const source = resolved.spec

  // Same-version guard.
  if (source.version === newVersion) {
    return c.json(v2ErrorBody('schema_mismatch', { field: 'version', reason: 'same_as_current' }), 422)
  }

  // Sibling collision check: root spec in same library with same name + same target version.
  // A race between this check and the INSERT is caught by the `specification_root_name_unique`
  // partial index in db.ts; the resulting 23505 unique_violation is translated to 409
  // by translatePostgresError below. The race-condition path is not unit-tested due to fixture
  // limitations — it relies on the partial-index fallback firing before the check would re-run.
  const collisionRows = await rawQuery<{ id: string }>(
    `SELECT id FROM specification
       WHERE "libraryId" = $1 AND name = $2 AND version = $3
         AND "parentSpecificationId" IS NULL
       LIMIT 1`,
    [source.libraryId, source.name, newVersion],
  )
  if (collisionRows[0]) return c.json(v2ErrorBody('conflict', { reason: 'version_exists' }), 409)

  // Load owned subtree rows (root + all descendants) directly from DB.
  const subtreeRows = await rawQuery<CloneSourceRow>(
    `WITH RECURSIVE owned(id) AS (
       SELECT id FROM specification WHERE id = $1
       UNION
       SELECT s.id FROM specification s
         JOIN owned o ON s."parentSpecificationId" = o.id
     )
     SELECT s.id, s."libraryId", s.name, s.description, s."typeName", s.version, s.state, s.data,
            s."environmentLibraryIds", s."parentSpecificationId", s."rootSpecificationId",
            s."dataSchemaVersion", s."lastEditedByUserId", s.history
       FROM specification s
      WHERE s.id IN (SELECT id FROM owned)`,
    [id],
  )

  // Clone the subtree.
  const result = cloneSpecificationSubtree({
    source: subtreeRows,
    newRootVersion: newVersion,
    account: session.userId,
    newId: () => crypto.randomUUID(),
  })

  // Sort cloned rows parent-before-child so the spec_root_consistency_insert
  // trigger never sees a child whose parent doesn't exist yet.
  // Uses BFS topological sort to handle trees of arbitrary depth (depth-1
  // two-bucket sort would fail for grandchildren emitted before their parent).
  const sortedRows = topoSortByParent(result.rows)

  // The cloneSpecificationSubtree helper uses null for the new root's
  // rootSpecificationId (pure-helper convention). The DB convention for root
  // specs is self-referential (rootSpecificationId = id), which the
  // spec_root_consistency_insert trigger also requires: children's parent must
  // have a non-null rootSpecificationId. Remap null → own id before inserting.

  // Bulk INSERT all cloned rows in a single transaction.
  try {
    await withTransaction(async (q) => {
      for (const r of sortedRows) {
        const dbRootSpecId = r.rootSpecificationId ?? r.id // root is self-referential in DB
        await q(
          `INSERT INTO specification
             (id, "libraryId", name, description, "typeName", version, state, data, "environmentLibraryIds",
              "createdAt", "updatedAt", "parentSpecificationId", "rootSpecificationId", "dataSchemaVersion",
              "lastEditedByUserId", history)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            r.id,
            r.libraryId,
            r.name,
            r.description,
            r.typeName,
            r.version,
            r.state,
            r.data,
            r.environmentLibraryIds,
            r.createdAt,
            r.updatedAt,
            r.parentSpecificationId,
            dbRootSpecId,
            r.dataSchemaVersion,
            r.lastEditedByUserId,
            r.history,
          ],
        )
      }
    })
  } catch (err) {
    const pgErr = err as { code?: string; message?: string }
    // 23505 unique_violation: the `specification_root_name_unique` partial index fired on a
    // concurrent INSERT that raced past the pre-flight collision check above. Return the
    // same 409 conflict shape as the pre-flight so callers see a consistent response.
    if (pgErr.code === '23505') {
      return c.json(v2ErrorBody('conflict', { reason: 'version_exists' }), 409)
    }
    const translated = translatePostgresError(pgErr)
    if (translated.status !== 500) {
      return c.json(translated.body, translated.status as 409 | 422)
    }
    throw err
  }

  // Re-fetch the new root so `history` is a parsed array (not raw JSON string).
  const newSpec = await specReadDao.getSpec({ sessionUserId: session.userId }, result.newRootId)
  return c.json({ newSpec })
})

// ---------------------------------------------------------------------------
// PATCH /specifications/:id/version — in-place version bump
// ---------------------------------------------------------------------------

const UpdateVersionBody = z.strictObject({ version: z.string() })

// The VersionBadge "Bump Version" dialog re-labels the spec the user is editing,
// IN PLACE — distinct from POST /:id/new-version, which clones a new Draft.
// batch-save deliberately ignores `version` on update ("bypass closed", see
// requestSchema.ts) — that closure assumed version changes had a dedicated route,
// and this is it. Without it the bump lived only in client memory: the badge
// showed the new number while the row (and every server-side export reading it)
// kept the old one.
specificationsV2.patch('/specifications/:id/version', async (c) => {
  const session = c.get('v2Session') as V2Session
  const id = c.req.param('id')

  let body: z.infer<typeof UpdateVersionBody>
  try {
    body = UpdateVersionBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  if (!isValidSemver(body.version)) {
    return c.json(v2ErrorBody('schema_mismatch', { field: 'version' }), 422)
  }

  // Re-labeling in place is an EDIT of the current draft — same gate as content
  // writes (edit right + edit-locked state, admin bypass), NOT the new-version
  // route's 'create' gate: a published spec's version is part of its identity
  // and may only move via Create New Version's clone.
  const gate = await assertCanWriteSpec(session, id)
  if (!gate.ok) return c.json(v2ErrorBody(gateErrorCode(gate.status)), gate.status)
  const current = gate.spec

  if (current.version === body.version) {
    return c.json(v2ErrorBody('schema_mismatch', { field: 'version', reason: 'same_as_current' }), 422)
  }

  // Root sibling collision — same (library, name, version) identity rule the
  // new-version route enforces. Children carry no independent identity, and a
  // child's libraryId is null anyway — roots only.
  if (current.parentSpecificationId === null) {
    const collisionRows = await rawQuery<{ id: string }>(
      `SELECT id FROM specification
         WHERE "libraryId" = $1 AND name = $2 AND version = $3
           AND "parentSpecificationId" IS NULL
         LIMIT 1`,
      [current.libraryId, current.name, body.version],
    )
    if (collisionRows[0]) return c.json(v2ErrorBody('conflict', { reason: 'version_exists' }), 409)
  }

  await rawQuery(`UPDATE specification SET version = $1, "updatedAt" = $2, "lastEditedByUserId" = $3 WHERE id = $4`, [
    body.version,
    Date.now(),
    session.userId,
    id,
  ])

  const updated = await specReadDao.getSpec({ sessionUserId: session.userId }, id)
  return c.json({ spec: updated })
})
