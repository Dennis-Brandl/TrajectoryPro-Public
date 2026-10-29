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

// Phase 35 §2.4 Phase 2: transactional mutations. Opens a Postgres transaction,
// re-checks the team-scoped edit right on every touched library,
// applies creates/updates/deletes/proxyRefs/specEnvs/imageDeletes/imageRefs
// in the documented order, COMMITs. Throws Phase2Error on any failure;
// Postgres errors pass through translatePostgresError.

import { withTransaction } from '../lib/db'
import { loadPrincipal, canSee, editLockedStates, type Principal } from '../authz/policy'
import { gateBatchOp } from './gate'
import { translatePostgresError, type PgLikeError } from './errorTranslate'
import { derivedChildFields } from './derivedChildFields'
import { createCreatedEntry, serializeHistory } from '../../types/specification-history'
import type { BatchSaveRequest, SpecCreate } from './requestSchema'
import type { SpecificationState } from '../../types/library'
import type { ReadContext } from '../dao/specReadDao'
import type { Phase1Result } from './phase1Validate'

export class Phase2Error extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(`${body.code ?? body.conflictType ?? 'phase2'}`)
    this.name = 'Phase2Error'
  }
}

function rollback(status: number, body: Record<string, unknown>): never {
  throw new Phase2Error(status, body)
}

export async function phase2Apply(
  req: BatchSaveRequest,
  plan: Phase1Result,
  ctx: ReadContext,
  externalQ?: <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>,
  externalPrincipal?: Principal,
  externalLocked?: Set<string>,
): Promise<void> {
  const now = Date.now()

  if (externalQ) {
    // Called from inside an outer transaction — principal and locked must be
    // pre-loaded by the caller (they use rawQuery which deadlocks inside
    // pglite.transaction). Run _phase2Body directly with the outer q.
    const principal = externalPrincipal
    if (!principal) throw new Phase2Error(404, { code: 'not_found' })
    const locked = externalLocked ?? new Set<string>()
    await _phase2Body(req, plan, ctx, now, externalQ, principal, locked)
    return
  }

  // Standalone path: load principal + locked states OUTSIDE the transaction —
  // both are read-only and have no atomicity requirement with the writes.
  // Keeping them outside also avoids the PGlite processing-lock deadlock:
  // pglite.transaction() holds the lock for the callback duration, and any
  // pglite.query() call inside (e.g. via rawQuery) would queue behind that
  // same lock and hang forever.
  const principal = await loadPrincipal(ctx.sessionUserId)
  if (!principal) throw new Phase2Error(404, { code: 'not_found' })
  const locked = await editLockedStates()

  await withTransaction(async (q) => {
    await _phase2Body(req, plan, ctx, now, q, principal, locked)
  })
}

async function _phase2Body(
  req: BatchSaveRequest,
  plan: Phase1Result,
  ctx: ReadContext,
  now: number,
  q: <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>,
  principal: Principal,
  locked: Set<string>,
): Promise<void> {
  // Step 10 (Phase 3): per-op in-tx re-check — mirrors phase1's gate so a
  // racing role/state change between phases cannot slip a write through.
  const libRowCache = new Map<string, { id: string; teamId: string | null; entityType: string }>()

  const gateLib = async (libraryId: string): Promise<{ id: string; teamId: string | null; entityType: string }> => {
    const cached = libRowCache.get(libraryId)
    if (cached) return cached
    const rows = await q<{ id: string; teamId: string | null; entityType: string }>(
      'SELECT id, "teamId", "entityType" FROM library WHERE id = $1',
      [libraryId],
    )
    const lib = rows[0]
    if (!lib) rollback(404, { code: 'not_found', libraryId })
    if (!canSee(principal, lib)) rollback(404, { code: 'not_found', libraryId })
    libRowCache.set(libraryId, lib)
    return lib
  }

  const currentStateRow = async (
    specId: string,
  ): Promise<{ state: string | null; libraryId: string | null } | undefined> => {
    const rows = await q<{ state: string | null; libraryId: string | null }>(
      `SELECT s.state AS state, COALESCE(s."libraryId", r."libraryId") AS "libraryId"
           FROM specification s LEFT JOIN specification r ON r.id = s."rootSpecificationId"
          WHERE s.id = $1`,
      [specId],
    )
    return rows[0]
  }

  for (const s of req.specs) {
    let libraryId: string | null
    let state: string | null = null
    if (s.op === 'create') {
      if (!s.parentSpecificationId) {
        libraryId = s.libraryId ?? null
      } else {
        const rootRows = await q<{ libraryId: string | null; state: string | null }>(
          'SELECT "libraryId", state FROM specification WHERE id = $1',
          [s.rootSpecificationId],
        )
        const rootRow = rootRows[0]
        if (rootRow?.libraryId) {
          libraryId = rootRow.libraryId
          state = rootRow.state
        } else {
          const rootCreate = req.specs.find((x): x is SpecCreate => x.op === 'create' && x.id === s.rootSpecificationId)
          libraryId = rootCreate?.libraryId ?? null
        }
      }
    } else {
      const row = await currentStateRow(s.id)
      libraryId = row?.libraryId ?? null
      state = row?.state ?? null
    }
    if (!libraryId) rollback(422, { code: 'parent_not_found', specId: s.id })
    const gate = gateBatchOp(principal, s.op, await gateLib(libraryId), state, locked)
    if (!gate.ok) rollback(gate.status, { code: gate.code, specId: s.id })
  }

  const resolveBatchCreateLib = async (specId: string): Promise<string | null> => {
    const pc = req.specs.find((x): x is SpecCreate => x.op === 'create' && x.id === specId)
    if (!pc) return null
    if (!pc.parentSpecificationId) return pc.libraryId ?? null
    const rootRows = await q<{ libraryId: string | null }>('SELECT "libraryId" FROM specification WHERE id = $1', [
      pc.rootSpecificationId,
    ])
    return (
      rootRows[0]?.libraryId ??
      req.specs.find((x): x is SpecCreate => x.op === 'create' && x.id === pc.rootSpecificationId)?.libraryId ??
      null
    )
  }

  const gateContentRef = async (targetSpecId: string): Promise<void> => {
    const row = await currentStateRow(targetSpecId)
    if (row?.libraryId) {
      const gate = gateBatchOp(principal, 'update', await gateLib(row.libraryId), row.state, locked)
      if (!gate.ok) rollback(gate.status, { code: gate.code, specId: targetSpecId })
      return
    }
    const batchLibId = await resolveBatchCreateLib(targetSpecId)
    if (!batchLibId) return // unresolvable: FK/trigger rejects creates; deletes are no-ops
    const gate = gateBatchOp(principal, 'update', await gateLib(batchLibId), null, locked)
    if (!gate.ok) rollback(gate.status, { code: gate.code, specId: targetSpecId })
  }

  // New content-linked entry types → route them through gateContentRef() here.
  for (const p of req.proxyRefs) await gateContentRef(p.parentSpecificationId)
  for (const e of req.specEnvs) await gateContentRef(e.specificationId)

  try {
    // Step 12a: creates (topo-sorted)
    const creates = new Map(req.specs.filter((s) => s.op === 'create').map((s) => [s.id, s] as const))
    for (const id of plan.createOrder) {
      const s = creates.get(id)!
      const isRoot = !s.parentSpecificationId
      let libraryId = s.libraryId
      let version = s.version ?? '1.0.0'
      // Roots are always born Draft — lifecycle moves only via PATCH /state (design §7).
      let state: string = 'Draft'
      if (!isRoot) {
        const derived = await derivedChildFields(s.rootSpecificationId, q)
        if (!derived) {
          const existingRows = await q<{ libraryId: string; version: string; state: SpecificationState }>(
            'SELECT "libraryId", version, state FROM specification WHERE id = $1',
            [s.rootSpecificationId],
          )
          const existing = existingRows[0]
          if (!existing) rollback(422, { code: 'parent_not_found', specId: s.id })
          libraryId = existing.libraryId
          version = existing.version
          state = existing.state as SpecificationState
        } else {
          libraryId = derived.libraryId
          version = derived.version
          state = derived.state as SpecificationState
        }
      }
      const historyJson = serializeHistory([createCreatedEntry({ account: ctx.sessionUserId, version })])
      await q(
        `INSERT INTO specification
             (id, "libraryId", name, description, "typeName", version, state, data, "dataSchemaVersion",
              "rootSpecificationId", "parentSpecificationId", "createdAt", "updatedAt",
              "lastEditedByUserId", history)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          s.id,
          libraryId,
          s.name,
          s.description ?? null,
          s.typeName ?? null,
          version,
          state,
          s.data,
          s.dataSchemaVersion,
          s.rootSpecificationId,
          s.parentSpecificationId ?? null,
          now,
          now,
          ctx.sessionUserId,
          historyJson,
        ],
      )
    }

    // Step 12b: updates
    for (const s of req.specs) {
      if (s.op !== 'update') continue
      let paramIdx = 1
      const sets: string[] = []
      const vals: unknown[] = []
      sets.push(`"updatedAt" = $${paramIdx++}`)
      vals.push(now)
      sets.push(`"lastEditedByUserId" = $${paramIdx++}`)
      vals.push(ctx.sessionUserId)
      if (s.name !== undefined) {
        sets.push(`name = $${paramIdx++}`)
        vals.push(s.name)
      }
      if (s.description !== undefined) {
        sets.push(`description = $${paramIdx++}`)
        vals.push(s.description)
      }
      if (s.typeName !== undefined) {
        sets.push(`"typeName" = $${paramIdx++}`)
        vals.push(s.typeName)
      }
      if (s.data !== undefined) {
        sets.push(`data = $${paramIdx++}`)
        vals.push(s.data)
      }
      if (s.dataSchemaVersion !== undefined) {
        sets.push(`"dataSchemaVersion" = $${paramIdx++}`)
        vals.push(s.dataSchemaVersion)
      }
      if (s.parentSpecificationId !== undefined) {
        sets.push(`"parentSpecificationId" = $${paramIdx++}`)
        vals.push(s.parentSpecificationId)
      }
      await q(`UPDATE specification SET ${sets.join(', ')} WHERE id = $${paramIdx}`, [...vals, s.id])
    }

    // Step 12c: deletes
    for (const s of req.specs) {
      if (s.op !== 'delete') continue
      await q('DELETE FROM specification WHERE id = $1', [s.id])
    }

    // Step 13: proxyRefs — deletes first, then creates
    for (const p of req.proxyRefs) {
      if (p.op === 'delete') {
        await q('DELETE FROM proxy_reference WHERE "parentSpecificationId" = $1 AND "nodeId" = $2', [
          p.parentSpecificationId,
          p.nodeId,
        ])
      }
    }
    for (const p of req.proxyRefs) {
      if (p.op === 'create') {
        await q(
          'INSERT INTO proxy_reference ("parentSpecificationId", "nodeId", "targetSpecificationId") VALUES ($1, $2, $3)',
          [p.parentSpecificationId, p.nodeId, p.targetSpecificationId],
        )
      }
    }

    // Step 14: specEnvs
    for (const e of req.specEnvs) {
      if (e.op === 'delete') {
        await q('DELETE FROM specification_environment WHERE "specificationId" = $1 AND "environmentLibraryId" = $2', [
          e.specificationId,
          e.environmentLibraryId,
        ])
      } else {
        await q('INSERT INTO specification_environment ("specificationId", "environmentLibraryId") VALUES ($1, $2)', [
          e.specificationId,
          e.environmentLibraryId,
        ])
      }
    }

    // Step 15: imageDeletes
    for (const d of req.imageDeletes) {
      await q('DELETE FROM image WHERE "specificationId" = $1 AND filename = $2', [d.specificationId, d.filename])
    }

    // Step 16: imageRefs
    for (const r of req.imageRefs) {
      if (r.op === 'delete') {
        await q('DELETE FROM image_reference WHERE "specificationId" = $1 AND "imageId" = $2', [
          r.specificationId,
          r.imageId,
        ])
      } else {
        await q('INSERT INTO image_reference ("specificationId", "imageId") VALUES ($1, $2)', [
          r.specificationId,
          r.imageId,
        ])
      }
    }
  } catch (err) {
    if (err instanceof Phase2Error) throw err
    const translated = translatePostgresError(err as PgLikeError)
    throw new Phase2Error(translated.status, translated.body)
  }
}
