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

// Phase 35 §2.2: shared spec → root → library → canWrite gate used by every
// /api/v2 mutation handler. Extracted so the four image handlers and the
// upcoming batch-save handler share one definition.

import { GLOBAL_TEAM_ID } from '@/lib/global-team'
import { rawQuery } from '../../lib/db'
import { specReadDao, type Library, type SpecFull } from '../../dao/specReadDao'
import { loadPrincipal, canDo, editLockedStates } from '../../authz/policy'
import type { V2Session } from '../../middleware/v2/permissions'

export type SpecWriteGate = { ok: true; spec: SpecFull; lib: Library } | { ok: false; status: 403 | 404 | 409 }
export type LibraryWriteGate = { ok: true; lib: Library } | { ok: false; status: 403 | 404 }

/** Maps a gate failure status to its v2 error code. */
export function gateErrorCode(status: 403 | 404 | 409): 'forbidden' | 'not_found' | 'edit_locked' {
  return status === 403 ? 'forbidden' : status === 404 ? 'not_found' : 'edit_locked'
}

/**
 * Content-write gate (design D15 + §7 edit-lock): 404 not-visible,
 * 403 visible-but-no-edit-right, 409 visible-with-right-but-edit-locked.
 * Admins bypass both the right and the lock.
 */
export async function assertCanWriteSpec(session: V2Session, specId: string): Promise<SpecWriteGate> {
  const resolved = await resolveVisibleSpec(session, specId)
  if (!resolved) return { ok: false, status: 404 }
  const principal = await loadPrincipal(session.userId)
  if (!principal) return { ok: false, status: 404 }
  if (principal.isAdministrator) return { ok: true, ...resolved }
  if (!canDo(principal, 'edit', resolved.lib)) return { ok: false, status: 403 }
  if (resolved.spec.state != null && (await editLockedStates()).has(resolved.spec.state)) {
    return { ok: false, status: 409 }
  }
  return { ok: true, ...resolved }
}

/**
 * Resolves a spec the caller can SEE plus its owning library — visibility
 * only, NO right check. Phase 3 callers (PATCH /state, new-version) compute
 * their own 403/409 splits. Returns null → caller maps to 404.
 */
export async function resolveVisibleSpec(
  session: V2Session,
  specId: string,
): Promise<{ spec: SpecFull; lib: Library } | null> {
  const ctx = { sessionUserId: session.userId }
  const spec = await specReadDao.getSpec(ctx, specId)
  if (!spec) return null

  let libraryId: string | null = spec.libraryId
  if (!libraryId) {
    // Child spec — resolve via root.
    const rows = await rawQuery<{ libraryId: string | null }>(
      'SELECT "libraryId" FROM "specification" WHERE "id" = $1',
      [spec.rootSpecificationId],
    )
    libraryId = rows[0]?.libraryId ?? null
  }
  if (!libraryId) return null

  const lib = await specReadDao.getLibrary(ctx, libraryId)
  if (!lib) return null
  return { spec, lib }
}

/**
 * Resolves a library by id and verifies the caller has read access. Returns
 * the library row on success, null on missing/unreadable. Caller maps null → 404.
 *
 * Used by the export endpoint (GET /api/v2/packages/workflow/:rootSpecId resolves
 * the root → libraryId → asserts canRead before streaming the ZIP).
 */
export async function assertCanReadLibrary(session: V2Session, libraryId: string): Promise<Library | null> {
  const ctx = { sessionUserId: session.userId }
  return specReadDao.getLibrary(ctx, libraryId)
}

/**
 * Library-write gate: 404 not-visible, 403 visible-but-no-edit-right.
 * Libraries have no lifecycle state (design D18) — no 409 here.
 */
export async function assertCanWriteLibrary(session: V2Session, libraryId: string): Promise<LibraryWriteGate> {
  const ctx = { sessionUserId: session.userId }
  const lib = await specReadDao.getLibrary(ctx, libraryId)
  if (!lib) return { ok: false, status: 404 }
  const principal = await loadPrincipal(session.userId)
  if (!principal) return { ok: false, status: 404 }
  if (!canDo(principal, 'edit', lib)) return { ok: false, status: 403 }
  return { ok: true, lib }
}

/**
 * Permission-boundary EXISTS check for content-addressed images (§2.6 B1).
 * The caller may only reference a `contentHash` if they can already read at
 * least one `image` row that points at it. Otherwise the caller could probe
 * for the existence of arbitrary blobs by hash.
 */
export async function userCanSeeContentHash(contentHash: string, sessionUserId: string): Promise<boolean> {
  const rows = await rawQuery(
    `SELECT 1 FROM "image" i
       JOIN "specification" s ON s."id" = i."specificationId"
       JOIN "library" l ON l."id" = (
         SELECT "libraryId" FROM "specification" WHERE "id" = s."rootSpecificationId"
       )
      WHERE i."contentHash" = $1
        AND (
          (SELECT "isAdministrator" FROM "user" WHERE "id" = $2) = true
          OR l."teamId" = $4
          OR l."teamId" IN (SELECT "teamId" FROM "user_team" WHERE "userId" = $3)
        )
      LIMIT 1`,
    [contentHash, sessionUserId, sessionUserId, GLOBAL_TEAM_ID],
  )
  return rows.length > 0
}
