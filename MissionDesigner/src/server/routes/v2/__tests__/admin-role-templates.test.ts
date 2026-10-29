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
import { ROLE_SEEDS } from '../../../authz/rights'

let f: TestFixture

beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetAndSeedFixture(f)
  await rawQuery(`DELETE FROM "team" WHERE "id" NOT IN ('team-main', 'team-default')`)
  mockSessionAs(null)
})

describe('GET /api/v2/admin/role-templates', () => {
  it('returns all 16 built-in templates with rights', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'GET', '/api/v2/admin/role-templates', {})
    expect(res.status).toBe(200)
    const body = (await res.json()) as { roleTemplates: Array<{ id: string; rights: string[] }> }
    expect(body.roleTemplates).toHaveLength(16)
    const author = body.roleTemplates.find((r) => r.id === 'role-author')
    expect(author?.rights).toEqual(ROLE_SEEDS.find((r) => r.id === 'role-author')!.rights)
  })
})

describe('POST /api/v2/admin/role-templates/apply', () => {
  it('re-creates a selected built-in with isSeeded=1 and its rights', async () => {
    mockSessionAs(await seedAdminUser(f))
    // The fixture DB already has all 16 seeded; delete one to prove apply restores it.
    await rawQuery('DELETE FROM "role" WHERE "id" = $1', ['role-author']) // cascades role_right + user_team_role
    const res = await v2Req(f, 'POST', '/api/v2/admin/role-templates/apply', { json: { roleIds: ['role-author'] } })
    expect(res.status).toBe(201)
    const [row] = await rawQuery<{ isSeeded: number }>('SELECT "isSeeded" FROM "role" WHERE "id" = $1', ['role-author'])
    expect(row?.isSeeded).toBe(1)
    const rights = (
      await rawQuery<{ right: string }>('SELECT "right" FROM "role_right" WHERE "roleId" = $1 ORDER BY "right"', [
        'role-author',
      ])
    ).map((r) => r.right)
    expect(rights).toEqual([...ROLE_SEEDS.find((r) => r.id === 'role-author')!.rights].sort())
  })

  it('422 on a malformed body', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/role-templates/apply', { json: { roleIds: 'nope' } })
    expect(res.status).toBe(422)
  })
})
