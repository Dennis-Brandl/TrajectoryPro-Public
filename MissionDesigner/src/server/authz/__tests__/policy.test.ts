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

// @vitest-environment node

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

let rawQuery: typeof import('../../lib/db').rawQuery
let loadPrincipal: typeof import('../policy').loadPrincipal
let canSee: typeof import('../policy').canSee
let can: typeof import('../policy').can
let canDo: typeof import('../policy').canDo
let legalEdge: typeof import('../policy').legalEdge
let rightForEdge: typeof import('../policy').rightForEdge
let editLockedStates: typeof import('../policy').editLockedStates
let isEditable: typeof import('../policy').isEditable
let canTransition: typeof import('../policy').canTransition
let canDelete: typeof import('../policy').canDelete

beforeAll(async () => {
  const dbMod = await import('../../lib/db')
  rawQuery = dbMod.rawQuery
  await dbMod.bootstrapDatabase()
  const p = await import('../policy')
  ;({
    loadPrincipal,
    canSee,
    can,
    canDo,
    legalEdge,
    rightForEdge,
    editLockedStates,
    isEditable,
    canTransition,
    canDelete,
  } = p)
})

beforeEach(async () => {
  // Clean in FK-safe order: dependents before parents; library before team (no CASCADE).
  await rawQuery(`DELETE FROM "app_setting"`)
  await rawQuery(`DELETE FROM "user_team_role"`)
  await rawQuery(`DELETE FROM "user_team"`)
  await rawQuery(`DELETE FROM "role_right"`)
  await rawQuery(`DELETE FROM "library"`)
  await rawQuery(`DELETE FROM "role"`)
  await rawQuery(`DELETE FROM "team"`)
  await rawQuery(`DELETE FROM "user"`)

  const now = Date.now()

  await rawQuery(`INSERT INTO "user" ("id", "email", "isAdministrator") VALUES ($1, $2, $3)`, [
    'admin',
    'a@x.com',
    true,
  ])
  await rawQuery(`INSERT INTO "user" ("id", "email", "isAdministrator") VALUES ($1, $2, $3)`, [
    'alice',
    'al@x.com',
    false,
  ])
  await rawQuery(`INSERT INTO "user" ("id", "email", "isAdministrator") VALUES ($1, $2, $3)`, [
    'viewer',
    'v@x.com',
    false,
  ])

  await rawQuery(
    `INSERT INTO "team" ("id", "name", "description", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5)`,
    ['teamA', 'A', '', now, now],
  )
  await rawQuery(
    `INSERT INTO "team" ("id", "name", "description", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5)`,
    ['teamB', 'B', '', now, now],
  )

  // alice: member of A with workflow:edit; viewer: member of A with no role.
  await rawQuery(`INSERT INTO "user_team" ("userId", "teamId") VALUES ($1, $2)`, ['alice', 'teamA'])
  await rawQuery(`INSERT INTO "user_team" ("userId", "teamId") VALUES ($1, $2)`, ['viewer', 'teamA'])

  await rawQuery(`INSERT INTO "role" ("id", "name", "isSeeded") VALUES ($1, $2, $3)`, ['r-wfedit', 'WF Edit', 0])
  await rawQuery(`INSERT INTO "role_right" ("roleId", "right") VALUES ($1, $2)`, ['r-wfedit', 'workflow:edit'])
  await rawQuery(`INSERT INTO "role_right" ("roleId", "right") VALUES ($1, $2)`, ['r-wfedit', 'workflow:delete'])
  await rawQuery(`INSERT INTO "user_team_role" ("userId", "teamId", "roleId") VALUES ($1, $2, $3)`, [
    'alice',
    'teamA',
    'r-wfedit',
  ])

  await rawQuery(
    `INSERT INTO "library" ("id", "teamId", "name", "entityType", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)`,
    ['libA', 'teamA', 'LibA', 'workflow', now, now],
  )
  await rawQuery(
    `INSERT INTO "library" ("id", "teamId", "name", "entityType", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)`,
    ['libB', 'teamB', 'LibB', 'workflow', now, now],
  )
})

const libA = { teamId: 'teamA', entityType: 'workflow' }
const libB = { teamId: 'teamB', entityType: 'workflow' }

describe('loadPrincipal', () => {
  it('returns null for an unknown user', async () => expect(await loadPrincipal('nope')).toBeNull())
  it('captures memberships and team-scoped rights', async () => {
    const p = (await loadPrincipal('alice'))!
    expect(p.memberships.has('teamA')).toBe(true)
    expect(p.memberships.has('teamB')).toBe(false)
    expect(p.rightsByTeam.get('teamA')?.has('workflow:edit')).toBe(true)
    expect(p.isAdministrator).toBe(false)
  })
})

describe('canSee', () => {
  it('member sees their team library', async () => expect(canSee((await loadPrincipal('alice'))!, libA)).toBe(true))
  it('non-member does not see another team library', async () =>
    expect(canSee((await loadPrincipal('alice'))!, libB)).toBe(false))
  it('viewer (member, no role) still sees the team library', async () =>
    expect(canSee((await loadPrincipal('viewer'))!, libA)).toBe(true))
  it('admin sees everything', async () => {
    const admin = (await loadPrincipal('admin'))!
    expect(canSee(admin, libA)).toBe(true)
    expect(canSee(admin, libB)).toBe(true)
  })
})

describe('can / canDo', () => {
  it('grants the held team-scoped right', async () => {
    const alice = (await loadPrincipal('alice'))!
    expect(can(alice, 'workflow:edit', libA)).toBe(true)
    expect(canDo(alice, 'edit', libA)).toBe(true)
  })
  it('denies a right not held in that team', async () =>
    expect(canDo((await loadPrincipal('alice'))!, 'approve', libA)).toBe(false))
  it('denies a right in a team the user is not in', async () =>
    expect(canDo((await loadPrincipal('alice'))!, 'edit', libB)).toBe(false))
  it('viewer (no role) cannot write', async () =>
    expect(canDo((await loadPrincipal('viewer'))!, 'edit', libA)).toBe(false))
  it('admin can do anything', async () =>
    expect(canDo((await loadPrincipal('admin'))!, 'makeEffective', libB)).toBe(true))
  it('folds step entityType into the workflow category', async () => {
    expect(canDo((await loadPrincipal('alice'))!, 'edit', { teamId: 'teamA', entityType: 'step' })).toBe(true)
  })
})

describe('legalEdge / rightForEdge (design §7 table)', () => {
  it.each([
    ['Draft', 'InTest', 'edit'],
    ['Draft', 'InReview', 'edit'],
    ['InTest', 'Draft', 'edit'],
    ['InTest', 'InReview', 'edit'],
    ['InReview', 'Draft', 'edit'],
    ['InReview', 'InTest', 'edit'],
    ['Draft', 'Approved', 'approve'],
    ['InTest', 'Approved', 'approve'],
    ['InReview', 'Approved', 'approve'],
    ['Approved', 'Effective', 'makeEffective'],
    ['Approved', 'Superseded', 'makeEffective'],
    ['Approved', 'Obsolete', 'makeEffective'],
    ['Effective', 'Superseded', 'makeEffective'],
    ['Effective', 'Obsolete', 'makeEffective'],
    ['Superseded', 'Obsolete', 'makeEffective'],
  ] as const)('%s → %s is legal and demands %s', (from, to, verb) => {
    expect(legalEdge(from, to)).toBe(true)
    expect(rightForEdge(from, to)).toBe(verb)
  })

  it.each([
    ['Draft', 'Effective'],
    ['Draft', 'Superseded'],
    ['Draft', 'Obsolete'],
    ['Approved', 'Draft'],
    ['Approved', 'InReview'],
    ['Effective', 'Approved'],
    ['Effective', 'Draft'],
    ['Superseded', 'Effective'],
    ['Obsolete', 'Draft'],
    ['Obsolete', 'Effective'],
    ['Draft', 'Draft'],
  ] as const)('%s → %s is illegal', (from, to) => {
    expect(legalEdge(from, to)).toBe(false)
    expect(rightForEdge(from, to)).toBeNull()
  })
})

describe('editLockedStates', () => {
  it('falls back to the seeded default when the setting row is missing', async () => {
    expect(await editLockedStates()).toEqual(new Set(['Approved', 'Effective', 'Superseded', 'Obsolete']))
  })
  it('honours an admin-tuned app_setting row', async () => {
    await rawQuery(`INSERT INTO "app_setting" ("key", "value") VALUES ($1, $2)`, ['editLockedStates', '["Approved"]'])
    expect(await editLockedStates()).toEqual(new Set(['Approved']))
  })
  it('falls back to the default on a malformed setting', async () => {
    await rawQuery(`INSERT INTO "app_setting" ("key", "value") VALUES ($1, $2)`, ['editLockedStates', 'not json'])
    expect(await editLockedStates()).toEqual(new Set(['Approved', 'Effective', 'Superseded', 'Obsolete']))
  })
})

describe('isEditable', () => {
  it('member with edit right can edit a Draft spec', async () =>
    expect(await isEditable((await loadPrincipal('alice'))!, { state: 'Draft' }, libA)).toBe(true))
  it('edit-locked state blocks even the edit right', async () =>
    expect(await isEditable((await loadPrincipal('alice'))!, { state: 'Approved' }, libA)).toBe(false))
  it('viewer (no role) cannot edit even a Draft', async () =>
    expect(await isEditable((await loadPrincipal('viewer'))!, { state: 'Draft' }, libA)).toBe(false))
  it('admin bypasses the edit lock', async () =>
    expect(await isEditable((await loadPrincipal('admin'))!, { state: 'Effective' }, libA)).toBe(true))
  it('null state is treated as editable (not in any locked state)', async () =>
    expect(await isEditable((await loadPrincipal('alice'))!, { state: null }, libA)).toBe(true))
})

describe('canTransition', () => {
  it('edit right covers the authoring band', async () =>
    expect(canTransition((await loadPrincipal('alice'))!, { state: 'Draft' }, libA, 'InTest')).toBe(true))
  it('approve needs the approve right (edit is not enough)', async () =>
    expect(canTransition((await loadPrincipal('alice'))!, { state: 'Draft' }, libA, 'Approved')).toBe(false))
  it('illegal edge is false regardless of rights', async () =>
    expect(canTransition((await loadPrincipal('alice'))!, { state: 'Draft' }, libA, 'Effective')).toBe(false))
  it('admin may force an illegal edge', async () =>
    expect(canTransition((await loadPrincipal('admin'))!, { state: 'Draft' }, libA, 'Effective')).toBe(true))
  it('null state cannot transition (no legal edge from null)', async () =>
    expect(canTransition((await loadPrincipal('alice'))!, { state: null }, libA, 'Draft')).toBe(false))
})

describe('canDelete', () => {
  it('delete right works in the editable band', async () =>
    expect(await canDelete((await loadPrincipal('alice'))!, { state: 'Draft' }, libA)).toBe(true))
  it('edit-locked states block deletion', async () =>
    expect(await canDelete((await loadPrincipal('alice'))!, { state: 'Effective' }, libA)).toBe(false))
  it('Obsolete is deletable despite being edit-locked', async () =>
    expect(await canDelete((await loadPrincipal('alice'))!, { state: 'Obsolete' }, libA)).toBe(true))
  it('no delete right → false even on Draft', async () =>
    expect(await canDelete((await loadPrincipal('viewer'))!, { state: 'Draft' }, libA)).toBe(false))
  it('admin can delete anything', async () =>
    expect(await canDelete((await loadPrincipal('admin'))!, { state: 'Effective' }, libA)).toBe(true))
})
