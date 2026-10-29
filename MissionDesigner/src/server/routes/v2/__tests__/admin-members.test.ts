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
  await rawQuery(`DELETE FROM "team" WHERE "id" NOT IN ('team-main', 'team-default')`)
  mockSessionAs(null)
})

describe('GET /api/v2/admin/teams/:id/members', () => {
  it('403 for a non-admin', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'GET', `/api/v2/admin/teams/${f.teamMainId}/members`, {})
    expect(res.status).toBe(403)
  })

  it('lists members with their per-team role ids', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'GET', `/api/v2/admin/teams/${f.teamMainId}/members`, {})
    expect(res.status).toBe(200)
    const body = (await res.json()) as { members: Array<{ userId: string; email: string; roleIds: string[] }> }
    expect(body.members).toHaveLength(2)
    const global = body.members.find((m) => m.userId === f.userIdGlobal)
    expect(global?.roleIds.sort()).toEqual(['role-approver', 'role-author', 'role-librarian', 'role-publisher'])
    const regular = body.members.find((m) => m.userId === f.userIdRegular)
    expect(regular?.roleIds.sort()).toEqual(['role-approver', 'role-author', 'role-librarian', 'role-publisher'])
  })

  it('404 for an unknown team', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'GET', '/api/v2/admin/teams/nope/members', {})
    expect(res.status).toBe(404)
  })

  it('a member with no roles appears with empty roleIds (viewer)', async () => {
    await rawQuery('INSERT INTO "user_team" ("userId","teamId") VALUES ($1,$2)', [f.userIdOther, f.teamMainId])
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'GET', `/api/v2/admin/teams/${f.teamMainId}/members`, {})
    const body = (await res.json()) as { members: Array<{ userId: string; roleIds: string[] }> }
    expect(body.members.find((m) => m.userId === f.userIdOther)?.roleIds).toEqual([])
  })
})

describe('PUT /api/v2/admin/teams/:id/members/:userId', () => {
  it('adds a member (idempotent) and visibility takes effect live', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PUT', `/api/v2/admin/teams/${f.teamMainId}/members/${f.userIdOther}`, {})
    expect(res.status).toBe(204)
    const again = await v2Req(f, 'PUT', `/api/v2/admin/teams/${f.teamMainId}/members/${f.userIdOther}`, {})
    expect(again.status).toBe(204)

    // §13: reflected live — the new member can now SEE the team's library.
    mockSessionAs(f.userIdOther)
    const read = await v2Req(f, 'GET', `/api/v2/libraries/${f.libSharedId}/specifications`, {})
    expect(read.status).toBe(200)
  })

  it('404 for an unknown user or team', async () => {
    mockSessionAs(await seedAdminUser(f))
    expect((await v2Req(f, 'PUT', `/api/v2/admin/teams/${f.teamMainId}/members/ghost`, {})).status).toBe(404)
    expect((await v2Req(f, 'PUT', `/api/v2/admin/teams/nope/members/${f.userIdOther}`, {})).status).toBe(404)
  })
})

describe('DELETE /api/v2/admin/teams/:id/members/:userId', () => {
  it("removes membership AND that pair's role assignments; visibility revoked live", async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'DELETE', `/api/v2/admin/teams/${f.teamMainId}/members/${f.userIdRegular}`, {})
    expect(res.status).toBe(204)
    expect(
      (
        await rawQuery('SELECT 1 FROM "user_team" WHERE "userId" = $1 AND "teamId" = $2', [
          f.userIdRegular,
          f.teamMainId,
        ])
      )[0],
    ).toBeUndefined()
    expect(
      (
        await rawQuery('SELECT 1 FROM "user_team_role" WHERE "userId" = $1 AND "teamId" = $2', [
          f.userIdRegular,
          f.teamMainId,
        ])
      )[0],
    ).toBeUndefined()

    mockSessionAs(f.userIdRegular)
    const read = await v2Req(f, 'GET', `/api/v2/libraries/${f.libSharedId}/specifications`, {})
    expect(read.status).toBe(404)
  })

  it('removing a non-member is an idempotent 204', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'DELETE', `/api/v2/admin/teams/${f.teamMainId}/members/${f.userIdOther}`, {})
    expect(res.status).toBe(204)
  })
})

describe('PUT /api/v2/admin/teams/:id/members/:userId/roles', () => {
  it('replace-set assignment; auto-creates membership; rejects unknown roles', async () => {
    mockSessionAs(await seedAdminUser(f))
    // userIdOther is NOT a member — assignment must auto-create the membership row.
    const res = await v2Req(f, 'PUT', `/api/v2/admin/teams/${f.teamMainId}/members/${f.userIdOther}/roles`, {
      json: { roleIds: ['role-approver', 'role-approver', 'role-publisher'] },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { roleIds: string[] }
    expect(body.roleIds.sort()).toEqual(['role-approver', 'role-publisher'])
    expect(
      (
        await rawQuery('SELECT 1 FROM "user_team" WHERE "userId" = $1 AND "teamId" = $2', [f.userIdOther, f.teamMainId])
      )[0],
    ).toBeTruthy()

    const unknown = await v2Req(f, 'PUT', `/api/v2/admin/teams/${f.teamMainId}/members/${f.userIdOther}/roles`, {
      json: { roleIds: ['role-bogus'] },
    })
    expect(unknown.status).toBe(422)
  })

  it('assignments are reflected live in authz (§13)', async () => {
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO "user" ("id","email","emailVerified","createdAt","updatedAt")
       VALUES ('live-user','live@example.com',false,$1,$2)`,
      [new Date(NOW), new Date(NOW)],
    )

    const saveBody = {
      specs: [{ op: 'update', id: f.rootSpecId, name: 'Live Rename' }],
      proxyRefs: [],
      specEnvs: [],
      imageDeletes: [],
      imageRefs: [],
    }

    // Member with no roles → viewer → batch-save 403.
    mockSessionAs(await seedAdminUser(f))
    await v2Req(f, 'PUT', `/api/v2/admin/teams/${f.teamMainId}/members/live-user`, {})
    mockSessionAs('live-user')
    expect((await v2Req(f, 'POST', '/api/v2/specifications/batch-save', { json: saveBody })).status).toBe(403)

    // Assign Author → write works immediately.
    mockSessionAs('test-admin')
    await v2Req(f, 'PUT', `/api/v2/admin/teams/${f.teamMainId}/members/live-user/roles`, {
      json: { roleIds: ['role-author'] },
    })
    mockSessionAs('live-user')
    expect((await v2Req(f, 'POST', '/api/v2/specifications/batch-save', { json: saveBody })).status).toBe(200)

    // Revoke → write blocked again.
    mockSessionAs('test-admin')
    await v2Req(f, 'PUT', `/api/v2/admin/teams/${f.teamMainId}/members/live-user/roles`, { json: { roleIds: [] } })
    mockSessionAs('live-user')
    expect((await v2Req(f, 'POST', '/api/v2/specifications/batch-save', { json: saveBody })).status).toBe(403)
  })
})
