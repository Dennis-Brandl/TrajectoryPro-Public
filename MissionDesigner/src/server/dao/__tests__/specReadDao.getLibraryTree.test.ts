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
let bootstrapDatabase: typeof import('../../lib/db').bootstrapDatabase
let seedRoles: typeof import('../../lib/rbacSeed').seedRoles
let specReadDao: typeof import('../specReadDao').specReadDao

const USER_A = 'user-a'
const USER_B = 'user-b'
const LIB_WORKFLOW = 'lib-wf'
const LIB_STEP = 'lib-step'
const ROOT_1 = 'wf-root-1'
const ROOT_2 = 'wf-root-2'
const CHILD_1A = 'wf-child-1a'
const GRAND_1A1 = 'wf-grand-1a1'
const STEP_SPEC = 'step-spec-1'

const TEAM_A = 'team-a' // holds LIB_WORKFLOW; USER_A member
const TEAM_SHARED = 'team-shared' // holds LIB_STEP; USER_A member (so referenced children resolve)
const TEAM_HIDDEN = 'team-hidden' // no members; used to hide LIB_STEP from USER_A in one test

beforeAll(async () => {
  ;({ rawQuery, bootstrapDatabase } = await import('../../lib/db'))
  ;({ seedRoles } = await import('../../lib/rbacSeed'))
  await bootstrapDatabase()
  await seedRoles()
  ;({ specReadDao } = await import('../specReadDao'))
})

async function seed(): Promise<void> {
  // FK-safe teardown — do not delete role/role_right/app_setting (seeded once in beforeAll).
  await rawQuery('DELETE FROM "user_team_role"')
  await rawQuery('DELETE FROM "user_team"')
  await rawQuery('DELETE FROM "proxy_reference"')
  await rawQuery('DELETE FROM "specification_environment"')
  await rawQuery('DELETE FROM "library_environment"')
  await rawQuery('DELETE FROM "specification"')
  await rawQuery('DELETE FROM "library"')
  await rawQuery('DELETE FROM "user"')
  await rawQuery('DELETE FROM "team"')

  const now = Date.now()
  await rawQuery(
    `INSERT INTO "user" ("id", "email", "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, false, $3, $4)`,
    [USER_A, 'a@x.com', now, now],
  )
  await rawQuery(
    `INSERT INTO "user" ("id", "email", "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, false, $3, $4)`,
    [USER_B, 'b@x.com', now, now],
  )

  // Teams preserve the original visibility: USER_A owns/reads LIB_WORKFLOW and can
  // also read the "shared" LIB_STEP (so its referenced children resolve); USER_B is
  // a member of neither, preserving "USER_B cannot read LIB_WORKFLOW".
  for (const [tid, name] of [
    [TEAM_A, 'Team A'],
    [TEAM_SHARED, 'Team Shared'],
    [TEAM_HIDDEN, 'Team Hidden'],
  ] as const) {
    await rawQuery(
      `INSERT INTO "team" ("id", "name", "description", "createdAt", "updatedAt") VALUES ($1, $2, '', $3, $4)`,
      [tid, name, now, now],
    )
  }

  for (const tid of [TEAM_A, TEAM_SHARED]) {
    await rawQuery(`INSERT INTO "user_team" ("userId", "teamId") VALUES ($1, $2)`, [USER_A, tid])
    await rawQuery(`INSERT INTO "user_team_role" ("userId", "teamId", "roleId") VALUES ($1, $2, 'role-author')`, [
      USER_A,
      tid,
    ])
  }

  await rawQuery(
    `INSERT INTO "library" ("id", "createdByUserId", "teamId", "name", "entityType", "version", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'WF Lib', 'workflow', '1.0.0', $4, $5)`,
    [LIB_WORKFLOW, USER_A, TEAM_A, now, now],
  )
  await rawQuery(
    `INSERT INTO "library" ("id", "createdByUserId", "teamId", "name", "entityType", "version", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'Step Lib', 'step', '1.0.0', $4, $5)`,
    [LIB_STEP, USER_B, TEAM_SHARED, now, now],
  )

  const insertSpec = async (
    id: string,
    libId: string,
    name: string,
    version: string,
    state: string,
    data: string,
    rootId: string,
    parentId: string | null,
  ) => {
    await rawQuery(
      `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
       "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 3, $9, $10)`,
      [id, libId, name, version, state, data, rootId, parentId, now, now],
    )
  }

  await insertSpec(
    ROOT_1,
    LIB_WORKFLOW,
    'Workflow 1',
    '1.1.2',
    'Draft',
    JSON.stringify({
      nodes: [
        {
          id: 'n1',
          type: 'workflowProxy',
          data: {
            subWorkflowMode: 'reference',
            referencedStepSpecId: STEP_SPEC,
            referencedStepLibraryId: LIB_STEP,
            referencedStepName: 'Ref Step',
          },
        },
      ],
    }),
    ROOT_1,
    null,
  )
  await insertSpec(
    ROOT_2,
    LIB_WORKFLOW,
    'Workflow 2',
    '2.0.0',
    'Effective',
    JSON.stringify({ nodes: [] }),
    ROOT_2,
    null,
  )
  await insertSpec(CHILD_1A, LIB_WORKFLOW, 'Child 1A', '1.1.2', 'Draft', JSON.stringify({ nodes: [] }), ROOT_1, ROOT_1)
  await insertSpec(
    GRAND_1A1,
    LIB_WORKFLOW,
    'Grand 1A1',
    '1.1.2',
    'Draft',
    JSON.stringify({ nodes: [] }),
    ROOT_1,
    CHILD_1A,
  )
  await insertSpec(
    STEP_SPEC,
    LIB_STEP,
    'Ref Step',
    '1.0.0',
    'Effective',
    JSON.stringify({ nodes: [] }),
    STEP_SPEC,
    null,
  )
}

beforeEach(async () => {
  await seed()
})

describe('specReadDao.getLibraryTree', () => {
  it('returns nested roots with children and grandchildren', async () => {
    const r = await specReadDao.getLibraryTree({ sessionUserId: USER_A }, LIB_WORKFLOW)
    expect(r).not.toBeNull()
    expect(r!.roots.map((n) => n.id).sort()).toEqual([ROOT_1, ROOT_2].sort())
    const root1 = r!.roots.find((n) => n.id === ROOT_1)!
    expect(root1.children).toHaveLength(1)
    expect(root1.children[0].id).toBe(CHILD_1A)
    expect(root1.children[0].children).toHaveLength(1)
    expect(root1.children[0].children[0].id).toBe(GRAND_1A1)
  })

  it('surfaces referenced children for reference-mode proxy nodes', async () => {
    const r = await specReadDao.getLibraryTree({ sessionUserId: USER_A }, LIB_WORKFLOW)
    const root1 = r!.roots.find((n) => n.id === ROOT_1)!
    expect(root1.referencedChildren).toEqual([
      { specId: STEP_SPEC, specName: 'Ref Step', libraryId: LIB_STEP, libraryName: 'Step Lib' },
    ])
    const root2 = r!.roots.find((n) => n.id === ROOT_2)!
    expect(root2.referencedChildren).toEqual([])
  })

  it('orders specs alphabetically (case-insensitive) at each level', async () => {
    const extra = 'wf-child-1b'
    await rawQuery(
      `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
       "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ($1, $2, 'aardvark', '1.1.2', 'Draft', '{"nodes":[]}', $3, $4, 3, 0, 0)`,
      [extra, LIB_WORKFLOW, ROOT_1, ROOT_1],
    )
    const r = await specReadDao.getLibraryTree({ sessionUserId: USER_A }, LIB_WORKFLOW)
    const root1 = r!.roots.find((n) => n.id === ROOT_1)!
    expect(root1.children.map((c) => c.name)).toEqual(['aardvark', 'Child 1A'])
  })

  it('returns null for libraries the caller cannot read', async () => {
    const r = await specReadDao.getLibraryTree({ sessionUserId: USER_B }, LIB_WORKFLOW)
    expect(r).toBeNull()
  })

  it('omits data column from the response (metadata only)', async () => {
    const r = await specReadDao.getLibraryTree({ sessionUserId: USER_A }, LIB_WORKFLOW)
    const root1 = r!.roots.find((n) => n.id === ROOT_1)!
    expect((root1 as unknown as { data?: string }).data).toBeUndefined()
  })

  it('dedupes referencedChildren when one parent has multiple proxy nodes pointing to the same spec', async () => {
    await rawQuery(`UPDATE "specification" SET "data" = $1 WHERE "id" = $2`, [
      JSON.stringify({
        nodes: [
          {
            id: 'n1',
            type: 'workflowProxy',
            data: {
              subWorkflowMode: 'reference',
              referencedStepSpecId: STEP_SPEC,
              referencedStepLibraryId: LIB_STEP,
              referencedStepName: 'Ref Step',
            },
          },
          {
            id: 'n2',
            type: 'workflowProxy',
            data: {
              subWorkflowMode: 'reference',
              referencedStepSpecId: STEP_SPEC,
              referencedStepLibraryId: LIB_STEP,
              referencedStepName: 'Ref Step',
            },
          },
        ],
      }),
      ROOT_1,
    ])
    const r = await specReadDao.getLibraryTree({ sessionUserId: USER_A }, LIB_WORKFLOW)
    const root1 = r!.roots.find((n) => n.id === ROOT_1)!
    expect(root1.referencedChildren).toHaveLength(1)
  })

  it('drops referencedChildren whose target library is not visible to the caller', async () => {
    // Make LIB_STEP invisible to USER_A in team terms: move it to TEAM_HIDDEN,
    // which USER_A is not a member of (the team-model equivalent of the original
    // un-sharing). The referenced child must then be dropped.
    await rawQuery(`UPDATE "library" SET "teamId" = $1 WHERE "id" = $2`, [TEAM_HIDDEN, LIB_STEP])
    const r = await specReadDao.getLibraryTree({ sessionUserId: USER_A }, LIB_WORKFLOW)
    const root1 = r!.roots.find((n) => n.id === ROOT_1)!
    expect(root1.referencedChildren).toEqual([])
  })
})
