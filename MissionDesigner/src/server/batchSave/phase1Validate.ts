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

// Phase 35 §2.4 Phase 1: pre-transaction validation. NO writes here.
// Throws Phase1Error (with an HTTP status + body) on any failure.
//
// JSON body size enforcement is done at the route handler level (Hono body
// parser cap), not here.

import { rawQuery } from '../lib/db'
import { specReadDao, type ReadContext } from '../dao/specReadDao'
import { loadPrincipal, canSee, editLockedStates, type Principal } from '../authz/policy'
import { gateBatchOp } from './gate'
import { MAX_SPECS_PER_BATCH } from '../limits'
import { topoSortCreates, TopoCycleError } from './topoSort'
import type { BatchSaveRequest, SpecCreate } from './requestSchema'
import type { V2ErrorCode } from '../errors/v2'

/** Connection-scoped query function threaded from an outer withTransaction. */
type Q = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>

/**
 * Optional overrides for the import path where phase1Validate runs inside an
 * outer withTransaction. When provided:
 *  - `q`         replaces all rawQuery calls (avoids deadlock on PGlite and
 *                keeps reads inside the same transaction for atomicity).
 *  - `principal` pre-loaded outside the TX (loadPrincipal uses rawQuery which
 *                deadlocks inside pglite.transaction).
 *  - `locked`    pre-loaded outside the TX for the same reason.
 */
export interface Phase1Opts {
  q?: Q
  principal?: Principal
  locked?: Set<string>
}

export class Phase1Error extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(`${body.code ?? 'phase1'}`)
    this.name = 'Phase1Error'
  }
}

function fail(status: number, code: V2ErrorCode, extra?: Record<string, unknown>): never {
  throw new Phase1Error(status, { code, ...(extra ?? {}) })
}

export interface Phase1Result {
  createOrder: string[] // topologically sorted spec create ids
  touchedLibraryIds: Set<string>
}

interface SpecOpInfo {
  op: 'create' | 'update' | 'delete'
  specId: string
  libraryId: string
  /** State that gates the op: the spec's own state for update/delete, the
   *  EXISTING root's state for child creates, null otherwise. */
  state: string | null
}

export async function phase1Validate(
  req: BatchSaveRequest,
  ctx: ReadContext,
  opts?: Phase1Opts,
): Promise<Phase1Result> {
  // When an outer transaction's q is supplied, use it for every DB read.
  // This avoids the PGlite processing-lock deadlock (pglite.query() inside
  // pglite.transaction() would hang) and keeps reads on the same connection
  // as the ongoing transaction so they see uncommitted data written in the TX.
  const rq = async <R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<R[]> =>
    opts?.q ? opts.q<R>(text, params) : rawQuery<R>(text, params ?? [])

  // Step 2: hard limits
  const entryCount =
    req.specs.length + req.proxyRefs.length + req.specEnvs.length + req.imageDeletes.length + req.imageRefs.length
  if (entryCount > MAX_SPECS_PER_BATCH) {
    fail(413, 'payload_too_large', { limit: MAX_SPECS_PER_BATCH, actual: entryCount })
  }

  // Step 3: data blob validation for creates + updates.
  // Only workflows/steps have a canvas `nodes` array; actions and environments
  // legitimately omit it. Enforce shape (object, no leaked imageBase64) and if
  // a `nodes` field is present, require it to be an array — but don't require
  // the field to exist.
  for (const s of req.specs) {
    if (s.op === 'create' || (s.op === 'update' && s.data !== undefined)) {
      const blobStr = (s as { data?: string }).data
      if (blobStr === undefined) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(blobStr)
      } catch {
        fail(422, 'data_blob_invalid', { specId: s.id, reason: 'not JSON' })
      }
      if (!parsed || typeof parsed !== 'object') fail(422, 'data_blob_invalid', { specId: s.id, reason: 'not object' })
      const nodesField = (parsed as { nodes?: unknown }).nodes
      if (nodesField !== undefined && !Array.isArray(nodesField)) {
        fail(422, 'data_blob_invalid', { specId: s.id, reason: 'nodes field must be an array' })
      }
      const text = JSON.stringify(parsed)
      if (/imageBase64/.test(text)) fail(422, 'data_blob_invalid', { specId: s.id, reason: 'imageBase64 leaked' })
    }
  }

  // Step 4: dup id among specs.create
  const createIds = req.specs.filter((s) => s.op === 'create').map((s) => s.id)
  const seen = new Set<string>()
  for (const id of createIds) {
    if (seen.has(id)) fail(422, 'duplicate_id_in_batch', { id })
    seen.add(id)
  }

  // Step 4a: pairing invariant for imageRefs[] and imageDeletes[]
  const specIdsInBatch = new Set(req.specs.map((s) => s.id))
  for (const r of req.imageRefs) {
    if (!specIdsInBatch.has(r.specificationId)) {
      fail(422, 'image_ref_unpaired', { specificationId: r.specificationId, imageId: r.imageId })
    }
  }
  for (const d of req.imageDeletes) {
    if (!specIdsInBatch.has(d.specificationId)) {
      fail(422, 'image_ref_unpaired', { specificationId: d.specificationId, filename: d.filename })
    }
  }

  // Step 5: topo sort creates (Kahn)
  const creates = req.specs.filter((s): s is SpecCreate => s.op === 'create')
  let createOrder: string[]
  try {
    createOrder = topoSortCreates(
      creates.map((c) => ({ id: c.id, parentSpecificationId: c.parentSpecificationId ?? null })),
    )
  } catch (err) {
    if (err instanceof TopoCycleError) fail(422, 'cycle_detected', { ids: err.cycleIds })
    throw err
  }

  // Step 6: parent existence — any parent not in the create set must exist in DB
  const missingParents: string[] = []
  for (const c of creates) {
    const p = c.parentSpecificationId
    if (!p) continue
    if (createIds.includes(p)) continue
    const rows = await rq<{ id: string }>('SELECT id FROM specification WHERE id = $1', [p])
    if (!rows[0]) missingParents.push(p)
  }
  if (missingParents.length > 0) fail(422, 'parent_not_found', { ids: missingParents })

  // Step 6a: image existence pre-check for imageRefs[].create
  const imageIdsToCheck = req.imageRefs.filter((r) => r.op === 'create').map((r) => r.imageId)
  for (const id of imageIdsToCheck) {
    const rows = await rq<{ id: string }>('SELECT id FROM image WHERE id = $1', [id])
    if (!rows[0]) fail(422, 'image_not_found', { imageId: id })
  }

  // Step 7: per-op library + current-state resolution
  const specOps: SpecOpInfo[] = []
  const touchedLibraryIds = new Set<string>()
  for (const s of req.specs) {
    if (s.op === 'create') {
      if (!s.parentSpecificationId) {
        if (!s.libraryId) fail(422, 'schema_mismatch', { specId: s.id, reason: 'root missing libraryId' })
        specOps.push({ op: 'create', specId: s.id, libraryId: s.libraryId, state: null })
        touchedLibraryIds.add(s.libraryId)
      } else {
        // Dereference rootSpecificationId → libraryId + state. NEVER trust client libraryId for children.
        const rootRows = await rq<{ libraryId: string | null; state: string | null }>(
          'SELECT "libraryId", state FROM specification WHERE id = $1',
          [s.rootSpecificationId],
        )
        const rootRow = rootRows[0]
        if (!rootRow?.libraryId) {
          // Root may itself be in the batch — it will be forced to Draft on insert (never locked).
          const rootCreate = creates.find((c) => c.id === s.rootSpecificationId)
          if (!rootCreate?.libraryId) fail(422, 'parent_not_found', { rootSpecificationId: s.rootSpecificationId })
          specOps.push({ op: 'create', specId: s.id, libraryId: rootCreate.libraryId, state: null })
          touchedLibraryIds.add(rootCreate.libraryId)
        } else {
          specOps.push({ op: 'create', specId: s.id, libraryId: rootRow.libraryId, state: rootRow.state })
          touchedLibraryIds.add(rootRow.libraryId)
        }
      }
    } else {
      const rows = await rq<{ state: string | null; libraryId: string | null }>(
        `SELECT s.state AS state, COALESCE(s."libraryId", r."libraryId") AS "libraryId"
           FROM specification s LEFT JOIN specification r ON r.id = s."rootSpecificationId"
          WHERE s.id = $1`,
        [s.id],
      )
      const row = rows[0]
      if (!row?.libraryId) fail(422, 'parent_not_found', { specId: s.id })
      specOps.push({ op: s.op, specId: s.id, libraryId: row.libraryId, state: row.state })
      touchedLibraryIds.add(row.libraryId)
    }
  }
  // Shared: resolve a same-batch create's library through the batch graph.
  const resolveBatchCreateLib = async (specId: string): Promise<string | null> => {
    const pc = creates.find((x) => x.id === specId)
    if (!pc) return null
    if (!pc.parentSpecificationId) return pc.libraryId ?? null
    const rootRows = await rq<{ libraryId: string | null }>('SELECT "libraryId" FROM specification WHERE id = $1', [
      pc.rootSpecificationId,
    ])
    return rootRows[0]?.libraryId ?? creates.find((x) => x.id === pc.rootSpecificationId)?.libraryId ?? null
  }

  // proxyRef and specEnv mutations both edit the TARGET spec's content —
  // gate them as updates (existing target: its current state; same-batch
  // create: born Draft, state null; truly unresolvable: skipped — the
  // FK/trigger rejects creates and deletes are no-ops).
  const contentRefOp = async (targetSpecId: string): Promise<SpecOpInfo | null> => {
    const rows = await rq<{ state: string | null; libraryId: string | null }>(
      `SELECT s.state AS state, COALESCE(s."libraryId", r."libraryId") AS "libraryId"
         FROM specification s LEFT JOIN specification r ON r.id = s."rootSpecificationId"
        WHERE s.id = $1`,
      [targetSpecId],
    )
    const row = rows[0]
    if (row?.libraryId) return { op: 'update', specId: targetSpecId, libraryId: row.libraryId, state: row.state }
    const batchLibId = await resolveBatchCreateLib(targetSpecId)
    if (!batchLibId) return null
    return { op: 'update', specId: targetSpecId, libraryId: batchLibId, state: null }
  }

  // New entry types that edit a spec's content → route them through contentRefOp() here.
  const refOps: SpecOpInfo[] = []
  for (const p of req.proxyRefs) {
    const op = await contentRefOp(p.parentSpecificationId)
    if (op) {
      refOps.push(op)
      touchedLibraryIds.add(op.libraryId)
    }
  }
  for (const e of req.specEnvs) {
    const op = await contentRefOp(e.specificationId)
    if (op) {
      refOps.push(op)
      touchedLibraryIds.add(op.libraryId)
    }
  }

  // Step 8: pre-tx per-op gate — 404 (library not visible) / 403 (no right) / 409 (edit-locked)
  // Load principal + locked from opts when provided (import path: they are loaded OUTSIDE the
  // outer transaction to avoid rawQuery deadlock inside pglite.transaction()).
  const principal = opts?.principal ?? (await loadPrincipal(ctx.sessionUserId))
  if (!principal) fail(404, 'not_found')
  const locked = opts?.locked ?? (await editLockedStates())
  // Minimal library shape needed by gateBatchOp (teamId + entityType).
  const libCache = new Map<string, { teamId: string | null; entityType: string } | null>()
  for (const opInfo of [...specOps, ...refOps]) {
    let lib = libCache.get(opInfo.libraryId)
    if (lib === undefined) {
      if (opts?.q) {
        // Inside an outer transaction: use q for the library lookup to avoid
        // both the PGlite processing-lock deadlock and the cross-connection
        // atomicity break that would occur if we called db.select() here.
        const rows = await opts.q<{ teamId: string | null; entityType: string }>(
          'SELECT "teamId", "entityType" FROM "library" WHERE id = $1',
          [opInfo.libraryId],
        )
        const row = rows[0]
        lib = row && canSee(principal, row) ? row : null
      } else {
        lib = await specReadDao.getLibrary(ctx, opInfo.libraryId)
      }
      libCache.set(opInfo.libraryId, lib ?? null)
    }
    if (!lib) fail(404, 'not_found', { libraryId: opInfo.libraryId })
    const gate = gateBatchOp(principal, opInfo.op, lib, opInfo.state, locked)
    if (!gate.ok) fail(gate.status, gate.code, { specId: opInfo.specId })
  }

  return { createOrder, touchedLibraryIds }
}
