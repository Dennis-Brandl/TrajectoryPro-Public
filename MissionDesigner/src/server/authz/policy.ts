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

// The single authorization source of truth (design §6). Fresh-reads membership
// + team-scoped rights per request — the better-auth session cookie is untrusted,
// same stance as the v2 session middleware. canSee/can/canDo replace the owner/isShared model.

import { GLOBAL_TEAM_ID } from '@/lib/global-team'
import { rawQuery } from '../lib/db'
import { cat, EDIT_LOCKED_STATES_DEFAULT } from './rights'

export interface Principal {
  userId: string
  isAdministrator: boolean
  memberships: Set<string> // teamIds the user belongs to (visibility)
  rightsByTeam: Map<string, Set<string>> // teamId -> rights held in that team
}

/** Resolve a user's authorization context, or null if the user no longer exists. */
export async function loadPrincipal(userId: string): Promise<Principal | null> {
  const [u] = await rawQuery<{ isAdministrator: boolean | null }>(
    'SELECT "isAdministrator" FROM "user" WHERE "id" = $1',
    [userId],
  )
  if (!u) return null

  const memberships = new Set<string>(
    (await rawQuery<{ teamId: string }>('SELECT "teamId" FROM "user_team" WHERE "userId" = $1', [userId])).map(
      (r) => r.teamId,
    ),
  )

  const rightsByTeam = new Map<string, Set<string>>()
  const rows = await rawQuery<{ teamId: string; right: string }>(
    `SELECT utr."teamId" AS "teamId", rr."right" AS "right"
       FROM "user_team_role" utr JOIN "role_right" rr ON rr."roleId" = utr."roleId"
      WHERE utr."userId" = $1`,
    [userId],
  )
  for (const { teamId, right } of rows) {
    let set = rightsByTeam.get(teamId)
    if (!set) {
      set = new Set<string>()
      rightsByTeam.set(teamId, set)
    }
    set.add(right)
  }

  return { userId, isAdministrator: Boolean(u.isAdministrator), memberships, rightsByTeam }
}

/** Visibility: any member of the owning team (or an admin) can read the library;
 *  everyone can read a GLOBAL library (spec 2026-10-12 U1). */
export function canSee(p: Principal, lib: { teamId: string | null }): boolean {
  if (p.isAdministrator) return true
  if (lib.teamId === GLOBAL_TEAM_ID) return true
  return lib.teamId != null && p.memberships.has(lib.teamId)
}

/** Capability: the caller holds `right` in the library's owning team (or is admin). */
export function can(p: Principal, right: string, lib: { teamId: string | null }): boolean {
  if (p.isAdministrator) return true
  if (lib.teamId == null) return false
  return p.rightsByTeam.get(lib.teamId)?.has(right) ?? false
}

/** Convenience: builds the right string from the library's entityType category. */
export function canDo(p: Principal, verb: string, lib: { teamId: string | null; entityType: string }): boolean {
  return can(p, `${cat(lib.entityType)}:${verb}`, lib)
}

// --- Phase 3: lifecycle state machine (design §7/§8) -----------------------

/** Legal transitions and the right VERB each one demands (design §7 table).
 *  Key: `${from}>${to}`. Anything absent is an illegal edge — 409 for
 *  non-admins; admins may force it and the history entry is flagged. */
const LEGAL_EDGES: Readonly<Record<string, 'edit' | 'approve' | 'makeEffective'>> = {
  // Authoring band — freely reversible while unapproved.
  'Draft>InTest': 'edit',
  'Draft>InReview': 'edit',
  'InTest>Draft': 'edit',
  'InTest>InReview': 'edit',
  'InReview>Draft': 'edit',
  'InReview>InTest': 'edit',
  // Approval — the single gate out of the authoring band; no reversal back.
  'Draft>Approved': 'approve',
  'InTest>Approved': 'approve',
  'InReview>Approved': 'approve',
  // Publication — Obsolete is terminal.
  'Approved>Effective': 'makeEffective',
  'Approved>Superseded': 'makeEffective',
  'Approved>Obsolete': 'makeEffective',
  'Effective>Superseded': 'makeEffective',
  'Effective>Obsolete': 'makeEffective',
  'Superseded>Obsolete': 'makeEffective',
}

export function legalEdge(from: string, to: string): boolean {
  return `${from}>${to}` in LEGAL_EDGES
}

/** The right verb a transition demands, or null for an illegal edge. */
export function rightForEdge(from: string, to: string): 'edit' | 'approve' | 'makeEffective' | null {
  return LEGAL_EDGES[`${from}>${to}`] ?? null
}

/** Spec states whose content is locked against edit/delete. Reads the
 *  admin-tunable `app_setting['editLockedStates']` fresh per call (1-row PK
 *  lookup); falls back to the seeded default on a missing or malformed row. */
export async function editLockedStates(): Promise<Set<string>> {
  const [row] = await rawQuery<{ value: string }>(`SELECT "value" FROM "app_setting" WHERE "key" = 'editLockedStates'`)
  if (row) {
    try {
      const parsed: unknown = JSON.parse(row.value)
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) return new Set(parsed)
    } catch {
      // malformed setting → fall back to the default
    }
  }
  return new Set(EDIT_LOCKED_STATES_DEFAULT)
}

/** System-wide e-signature role names (spec 2026-09-06 §4.2): plain strings that must match
 *  Mission Commander role names by hand. Read fresh per call from `app_setting['esignatureRoles']`;
 *  a missing or malformed row reads as the empty list. */
export async function esignatureRoles(): Promise<string[]> {
  const [row] = await rawQuery<{ value: string }>(`SELECT "value" FROM "app_setting" WHERE "key" = 'esignatureRoles'`)
  if (row) {
    try {
      const parsed: unknown = JSON.parse(row.value)
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) return parsed
    } catch {
      // malformed setting → empty list
    }
  }
  return []
}

export interface SpecStateRef {
  state: string | null
}
export interface LibRef {
  teamId: string | null
  entityType: string
}

/** Content writes: admin, or edit right while the spec's state is not edit-locked. */
export async function isEditable(p: Principal, spec: SpecStateRef, lib: LibRef): Promise<boolean> {
  if (p.isAdministrator) return true
  if (spec.state != null && (await editLockedStates()).has(spec.state)) return false
  return canDo(p, 'edit', lib)
}

/** State transitions: admin (any edge), or a legal edge plus that edge's right. */
export function canTransition(p: Principal, spec: SpecStateRef, lib: LibRef, to: string): boolean {
  if (p.isAdministrator) return true
  const verb = rightForEdge(spec.state ?? '', to)
  if (!verb) return false
  return canDo(p, verb, lib)
}

/** Deletes: admin, or delete right while the state is Obsolete or not edit-locked. */
export async function canDelete(p: Principal, spec: SpecStateRef, lib: LibRef): Promise<boolean> {
  if (p.isAdministrator) return true
  if (!canDo(p, 'delete', lib)) return false
  if (spec.state == null || spec.state === 'Obsolete') return true
  return !(await editLockedStates()).has(spec.state)
}
