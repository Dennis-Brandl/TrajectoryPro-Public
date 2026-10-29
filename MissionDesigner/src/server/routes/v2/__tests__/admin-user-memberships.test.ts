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

describe('GET /api/v2/admin/users/:id/memberships', () => {
  it('403 for a non-admin', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'GET', `/api/v2/admin/users/${f.userIdGlobal}/memberships`, {})
    expect(res.status).toBe(403)
  })

  it("lists the user's teams with per-team role ids", async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'GET', `/api/v2/admin/users/${f.userIdGlobal}/memberships`, {})
    expect(res.status).toBe(200)
    const body = (await res.json()) as { memberships: Array<{ teamId: string; teamName: string; roleIds: string[] }> }
    const main = body.memberships.find((m) => m.teamId === f.teamMainId)
    expect(main).toBeTruthy()
    expect(main?.roleIds.sort()).toEqual(['role-approver', 'role-author', 'role-librarian', 'role-publisher'])
  })

  it('404 for an unknown user', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'GET', '/api/v2/admin/users/ghost/memberships', {})
    expect(res.status).toBe(404)
  })

  it('a user with no memberships returns an empty array', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'GET', `/api/v2/admin/users/${f.userIdOther}/memberships`, {})
    expect(res.status).toBe(200)
    const body = (await res.json()) as { memberships: unknown[] }
    expect(body.memberships).toEqual([])
  })
})
