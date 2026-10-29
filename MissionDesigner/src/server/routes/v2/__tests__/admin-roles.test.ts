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
import {
  setupTestFixture,
  resetAndSeedFixture,
  mockSessionAs,
  v2Req,
  seedAdminUser,
  rawQuery,
  type TestFixture,
} from './testSeed'

let f: TestFixture

beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetAndSeedFixture(f)
  // role/role_right are seeded once at startup and NOT wiped by the fixture —
  // remove this file's residue (custom roles + the fake-seeded probe).
  await rawQuery(`DELETE FROM "role" WHERE "isSeeded" = 0 OR "id" LIKE 'test-%'`)
  mockSessionAs(null)
})

describe('GET /api/v2/admin/roles', () => {
  it('403 for a non-admin', async () => {
    mockSessionAs(f.userIdGlobal)
    expect((await v2Req(f, 'GET', '/api/v2/admin/roles', {})).status).toBe(403)
  })

  it('lists the seeded catalog with rights and assignment counts', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'GET', '/api/v2/admin/roles', {})
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      roles: Array<{ id: string; isSeeded: number; rights: string[]; assignmentCount: number }>
    }
    expect(body.roles.length).toBeGreaterThanOrEqual(16)
    const author = body.roles.find((r) => r.id === 'role-author')
    expect(author?.isSeeded).toBe(1)
    expect(author?.rights).toContain('workflow:create')
    expect(author?.rights).toContain('action:delete')
    expect(author?.assignmentCount).toBe(2) // userIdGlobal + userIdRegular in team-main
  })
})

describe('POST /api/v2/admin/roles', () => {
  it('creates a role with validated rights', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/roles', {
      json: { name: 'QA Approver', description: 'approve only', rights: ['workflow:approve', 'workflow:approve'] },
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { role: { id: string; isSeeded: number; rights: string[] } }
    expect(body.role.isSeeded).toBe(0)
    expect(body.role.rights).toEqual(['workflow:approve']) // deduped
  })

  it('422 on an unknown right', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/roles', {
      json: { name: 'Bad', rights: ['workflow:fly'] },
    })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { unknown: string[] }).unknown).toEqual(['workflow:fly'])
  })

  it('409 on a duplicate name', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/roles', { json: { name: 'Author', rights: [] } })
    expect(res.status).toBe(409)
  })
})

describe('PATCH /api/v2/admin/roles/:id', () => {
  it('replaces the rights set', async () => {
    mockSessionAs(await seedAdminUser(f))
    const created = await v2Req(f, 'POST', '/api/v2/admin/roles', {
      json: { name: 'Shifting', rights: ['workflow:edit'] },
    })
    const roleId = ((await created.json()) as { role: { id: string } }).role.id

    const res = await v2Req(f, 'PATCH', `/api/v2/admin/roles/${roleId}`, {
      json: { rights: ['environment:edit'] },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { role: { rights: string[] } }
    expect(body.role.rights).toEqual(['environment:edit'])
    expect(
      (await rawQuery(`SELECT 1 FROM "role_right" WHERE "roleId" = $1 AND "right" = 'workflow:edit'`, [roleId]))[0],
    ).toBeUndefined()
  })

  it('404 unknown role; 422 empty patch', async () => {
    mockSessionAs(await seedAdminUser(f))
    expect((await v2Req(f, 'PATCH', '/api/v2/admin/roles/nope', { json: { name: 'X' } })).status).toBe(404)
    const created = await v2Req(f, 'POST', '/api/v2/admin/roles', { json: { name: 'Patchee', rights: [] } })
    const roleId = ((await created.json()) as { role: { id: string } }).role.id
    expect((await v2Req(f, 'PATCH', `/api/v2/admin/roles/${roleId}`, { json: {} })).status).toBe(422)
  })
})

describe('DELETE /api/v2/admin/roles/:id', () => {
  it('deletes a role and cascades rights + assignments', async () => {
    mockSessionAs(await seedAdminUser(f))
    const created = await v2Req(f, 'POST', '/api/v2/admin/roles', {
      json: { name: 'Doomed Role', rights: ['action:edit'] },
    })
    const roleId = ((await created.json()) as { role: { id: string } }).role.id
    await rawQuery('INSERT INTO "user_team_role" ("userId","teamId","roleId") VALUES ($1,$2,$3)', [
      f.userIdRegular,
      f.teamMainId,
      roleId,
    ])

    const res = await v2Req(f, 'DELETE', `/api/v2/admin/roles/${roleId}`, {})
    expect(res.status).toBe(204)
    expect((await rawQuery('SELECT 1 FROM "role" WHERE "id" = $1', [roleId]))[0]).toBeUndefined()
    expect((await rawQuery('SELECT 1 FROM "role_right" WHERE "roleId" = $1', [roleId]))[0]).toBeUndefined()
    expect((await rawQuery('SELECT 1 FROM "user_team_role" WHERE "roleId" = $1', [roleId]))[0]).toBeUndefined()
  })

  it('seeded roles are deletable too (§9)', async () => {
    mockSessionAs(await seedAdminUser(f))
    await rawQuery(`INSERT INTO "role" ("id","name","description","isSeeded") VALUES ($1,$2,$3,$4)`, [
      'test-seeded',
      'Fake Seeded',
      '',
      1,
    ])
    const res = await v2Req(f, 'DELETE', '/api/v2/admin/roles/test-seeded', {})
    expect(res.status).toBe(204)
  })

  it('404 for an unknown role', async () => {
    mockSessionAs(await seedAdminUser(f))
    expect((await v2Req(f, 'DELETE', '/api/v2/admin/roles/nope', {})).status).toBe(404)
  })
})

describe('GET /api/v2/admin/roles/:id', () => {
  it('403 for a non-admin', async () => {
    mockSessionAs(f.userIdGlobal)
    expect((await v2Req(f, 'GET', '/api/v2/admin/roles/role-author', {})).status).toBe(403)
  })

  it('returns the role with rights and a fresh assignmentCount', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'GET', '/api/v2/admin/roles/role-author', {})
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      role: { id: string; isSeeded: number; rights: string[]; assignmentCount: number }
    }
    expect(body.role.id).toBe('role-author')
    expect(body.role.isSeeded).toBe(1)
    expect(body.role.rights).toContain('workflow:create')
    expect(body.role.assignmentCount).toBe(2) // userIdGlobal + userIdRegular in team-main
  })

  it('404 for an unknown role', async () => {
    mockSessionAs(await seedAdminUser(f))
    expect((await v2Req(f, 'GET', '/api/v2/admin/roles/nope', {})).status).toBe(404)
  })

  it('newly created roles report assignmentCount 0 in the single envelope', async () => {
    mockSessionAs(await seedAdminUser(f))
    const created = await v2Req(f, 'POST', '/api/v2/admin/roles', { json: { name: 'Counted', rights: [] } })
    expect(created.status).toBe(201)
    const body = (await created.json()) as { role: { assignmentCount: number } }
    expect(body.role.assignmentCount).toBe(0)
  })
})
