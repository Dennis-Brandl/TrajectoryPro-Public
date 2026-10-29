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

// Phase 35 §2.9: library listing endpoints under /api/v2/libraries.
// Create / PATCH / DELETE are NOT Plan 2a scope (the old routes still serve
// them). Fork lives in Wave E.

import { GLOBAL_TEAM_ID, allowedInGlobal } from '@/lib/global-team'
import { Hono } from 'hono'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { specReadDao } from '../../dao/specReadDao'
import { rawQuery, withTransaction } from '../../lib/db'
import { MAX_LIBRARIES_PER_LIST } from '../../limits'
import { v2ErrorBody } from '../../errors/v2'
import type { V2Session } from '../../middleware/v2/permissions'
import { assertCanWriteLibrary, gateErrorCode } from './_specGate'
import { loadPrincipal, canDo } from '../../authz/policy'
import { supersedeSweep } from '../../lifecycle/supersedeSweep'
import { findReleasedInTree, releasedStates, type ReleasedSpec } from '../../libraries/releasedInTree'

const CreateLibraryBody = z.strictObject({
  name: z.string().min(1).max(200),
  entityType: z.enum(['workflow', 'action', 'environment', 'step']),
  teamId: z.string().min(1),
  parentLibraryId: z.string().optional(),
  description: z.string().max(2000).optional(),
})

const DeleteLibraryBody = z.object({ confirmedReleasedIds: z.array(z.string()).max(10000).optional() })

/** Thrown inside the delete transaction to roll it back and answer 409 library_has_released_specs. */
class ReleasedSpecsError extends Error {
  constructor(readonly releasedSpecs: ReleasedSpec[]) {
    super('library_has_released_specs')
  }
}

type Variables = { v2Session: V2Session }

export const librariesV2 = new Hono<{ Variables: Variables }>()

librariesV2.get('/libraries', async (c) => {
  const session = c.get('v2Session')
  const entityType = c.req.query('entityType')
  const rows = await specReadDao.listVisibleLibraries({ sessionUserId: session.userId }, { entityType })
  if (rows.length > MAX_LIBRARIES_PER_LIST) {
    return c.json(v2ErrorBody('too_many_libraries', { count: rows.length }), 413)
  }
  return c.json({ libraries: rows })
})

librariesV2.get('/libraries/:id/specifications', async (c) => {
  const session = c.get('v2Session')
  const id = c.req.param('id')
  // Lazy sweep (design §8): flip out-of-force Effective versions before
  // listing so version displays are consistent without waiting for the timer.
  try {
    await supersedeSweep(Date.now(), id)
  } catch (err) {
    console.error('[supersedeSweep] lazy sweep failed:', err)
  }
  const lib = await specReadDao.getLibrary({ sessionUserId: session.userId }, id)
  if (!lib) return c.json(v2ErrorBody('not_found'), 404)
  const specs = await specReadDao.listRootSpecs({ sessionUserId: session.userId }, id)
  return c.json({ library: { id: lib.id }, specs })
})

librariesV2.get('/libraries/:id/specifications/tree', async (c) => {
  const session = c.get('v2Session')
  const id = c.req.param('id')
  // Lazy sweep (design §8): flip out-of-force Effective versions before
  // listing so version displays are consistent without waiting for the timer.
  try {
    await supersedeSweep(Date.now(), id)
  } catch (err) {
    console.error('[supersedeSweep] lazy sweep failed:', err)
  }
  const tree = await specReadDao.getLibraryTree({ sessionUserId: session.userId }, id)
  if (!tree) return c.json(v2ErrorBody('not_found'), 404)
  return c.json(tree)
})

librariesV2.post('/libraries', async (c) => {
  const session = c.get('v2Session')
  let body: z.infer<typeof CreateLibraryBody>
  try {
    body = CreateLibraryBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  if (body.teamId === GLOBAL_TEAM_ID && !allowedInGlobal(body.entityType)) {
    return c.json(v2ErrorBody('schema_mismatch', { field: 'entityType' }), 422)
  }

  const principal = await loadPrincipal(session.userId)
  if (!principal) return c.json(v2ErrorBody('not_found'), 404)
  // Must hold library.create for this entity type in the target team.
  if (!canDo(principal, 'library.create', { teamId: body.teamId, entityType: body.entityType })) {
    return c.json(v2ErrorBody('forbidden'), 403)
  }

  if (body.parentLibraryId) {
    const parent = await specReadDao.getLibrary({ sessionUserId: session.userId }, body.parentLibraryId)
    if (!parent) return c.json(v2ErrorBody('not_found'), 404)
    if (parent.entityType !== body.entityType) return c.json(v2ErrorBody('schema_mismatch'), 422)
    if (parent.teamId !== body.teamId) return c.json(v2ErrorBody('schema_mismatch', { field: 'teamId' }), 422)
  }

  const id = randomUUID()
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "library" ("id", "parentLibraryId", "teamId", "createdByUserId", "name", "entityType", "description", "version", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, '1.0.0', $8, $9)`,
    [
      id,
      body.parentLibraryId ?? null,
      body.teamId,
      session.userId,
      body.name,
      body.entityType,
      body.description ?? null,
      now,
      now,
    ],
  )

  const lib = await specReadDao.getLibrary({ sessionUserId: session.userId }, id)
  if (!lib) return c.json(v2ErrorBody('not_found'), 404)
  return c.json({ library: lib }, 201)
})

const PatchLibraryBody = z
  .strictObject({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    author: z.string().max(200).nullable().optional(),
    changeHistory: z.string().max(100000).nullable().optional(),
    version: z.string().max(50).optional(),
    /**
     * Workflow/step libraries: replaces the full set of bound environment
     * libraries. `null` clears the list. The handler stringifies into the
     * `library.environmentLibraryIds` JSON-text column.
     */
    environmentLibraryIds: z.array(z.string()).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field must be patched' })

librariesV2.patch('/libraries/:id', async (c) => {
  const session = c.get('v2Session')
  const id = c.req.param('id')
  let body: z.infer<typeof PatchLibraryBody>
  try {
    body = PatchLibraryBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }

  const gate = await assertCanWriteLibrary(session, id)
  if (!gate.ok) return c.json(v2ErrorBody(gateErrorCode(gate.status)), gate.status)

  // Build parameterized UPDATE: push value first, then reference by index.
  const sets: string[] = []
  const values: unknown[] = []
  if (body.name !== undefined) {
    values.push(body.name)
    sets.push(`"name" = $${values.length}`)
  }
  if (body.description !== undefined) {
    values.push(body.description)
    sets.push(`"description" = $${values.length}`)
  }
  if (body.author !== undefined) {
    values.push(body.author)
    sets.push(`"author" = $${values.length}`)
  }
  if (body.changeHistory !== undefined) {
    values.push(body.changeHistory)
    sets.push(`"changeHistory" = $${values.length}`)
  }
  if (body.version !== undefined) {
    values.push(body.version)
    sets.push(`"version" = $${values.length}`)
  }
  if (body.environmentLibraryIds !== undefined) {
    values.push(body.environmentLibraryIds === null ? null : JSON.stringify(body.environmentLibraryIds))
    sets.push(`"environmentLibraryIds" = $${values.length}`)
  }
  values.push(Date.now())
  sets.push(`"updatedAt" = $${values.length}`)
  values.push(id)

  await rawQuery(`UPDATE "library" SET ${sets.join(', ')} WHERE "id" = $${values.length}`, values)

  const updated = await specReadDao.getLibrary({ sessionUserId: session.userId }, id)
  if (!updated) return c.json(v2ErrorBody('not_found'), 404)
  return c.json({ library: updated })
})

// The released root specs a delete of this library (and its sub-libraries) would destroy.
librariesV2.get('/libraries/:id/delete-check', async (c) => {
  const session = c.get('v2Session')
  const id = c.req.param('id')
  const lib = await specReadDao.getLibrary({ sessionUserId: session.userId }, id)
  if (!lib) return c.json(v2ErrorBody('not_found'), 404)
  const principal = await loadPrincipal(session.userId)
  if (!principal || !canDo(principal, 'library.delete', lib)) return c.json(v2ErrorBody('forbidden'), 403)
  const releasedSpecs = await findReleasedInTree(rawQuery, id, await releasedStates())
  return c.json({ releasedSpecs })
})

librariesV2.delete('/libraries/:id', async (c) => {
  const session = c.get('v2Session')
  const id = c.req.param('id')
  const lib = await specReadDao.getLibrary({ sessionUserId: session.userId }, id)
  if (!lib) return c.json(v2ErrorBody('not_found'), 404)
  const principal = await loadPrincipal(session.userId)
  if (!principal || !canDo(principal, 'library.delete', lib)) return c.json(v2ErrorBody('forbidden'), 403)

  const parsed = DeleteLibraryBody.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json(v2ErrorBody('schema_mismatch'), 422)
  const confirmed = new Set(parsed.data.confirmedReleasedIds ?? [])
  // Read before withTransaction: editLockedStates() uses rawQuery, which deadlocks inside it on PGlite.
  const released = await releasedStates()

  // Collect this library + all descendants in the SAME team (no userId scoping).
  // Order by depth DESC so deepest children are deleted first — required because
  // library.parentLibraryId is a FK without CASCADE (deleting a parent while
  // children exist violates the FK).
  // specification.libraryId CASCADE and library_environment.libraryId CASCADE
  // fire automatically per row. An external spec proxying into this tree
  // (proxy_reference.targetSpecificationId is RESTRICT) throws FK → 409.
  try {
    await withTransaction(async (q) => {
      // Lock every spec the delete removes (the tree's specs plus specs in other libraries that
      // cascade with it), then refuse unless an administrator confirmed exactly what is found.
      const found = await findReleasedInTree(q, id, released, { lock: true })
      if (found.length > 0) {
        const same = found.length === confirmed.size && found.every((s) => confirmed.has(s.id))
        if (!principal.isAdministrator || !same) throw new ReleasedSpecsError(found)
      }
      const rows = await q<{ id: string }>(
        `WITH RECURSIVE tree(id, depth) AS (
           SELECT id, 0 FROM "library" WHERE id = $1
           UNION ALL
           SELECT l.id, t.depth + 1 FROM "library" l JOIN tree t ON l."parentLibraryId" = t.id
         )
         SELECT id FROM tree ORDER BY depth DESC`,
        [id],
      )
      for (const { id: libId } of rows) {
        await q(`DELETE FROM "library" WHERE "id" = $1`, [libId])
      }
    })
  } catch (err) {
    if (err instanceof ReleasedSpecsError) {
      return c.json(v2ErrorBody('library_has_released_specs', { releasedSpecs: err.releasedSpecs }), 409)
    }
    const msg = err instanceof Error ? err.message : String(err)
    if (/foreign key/i.test(msg)) {
      return c.json(v2ErrorBody('library_not_empty', { reason: 'external_proxy_reference' }), 409)
    }
    throw err
  }
  return c.body(null, 204)
})
