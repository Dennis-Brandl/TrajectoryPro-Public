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
import { seedGlobalTeam } from '../../../lib/rbacSeed'
import { GLOBAL_TEAM_ID } from '@/lib/global-team'

let f: TestFixture

async function insertGlobalLibrary(id: string, name: string, entityType = 'action') {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "library" ("id","teamId","name","entityType","version","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'1.0.0',$5,$6)`,
    [id, GLOBAL_TEAM_ID, name, entityType, now, now],
  )
}

beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetAndSeedFixture(f)
  await seedGlobalTeam()
  await rawQuery(`UPDATE "team" SET "name" = 'GLOBAL' WHERE "id" = $1`, [GLOBAL_TEAM_ID])
  mockSessionAs(null)
})

describe('seedGlobalTeam', () => {
  it('creates exactly one GLOBAL team and is idempotent', async () => {
    await seedGlobalTeam()
    const rows = await rawQuery<{ id: string; name: string }>(`SELECT "id","name" FROM "team" WHERE "name" = 'GLOBAL'`)
    expect(rows).toEqual([{ id: GLOBAL_TEAM_ID, name: 'GLOBAL' }])
  })

  it('creates nothing when another team already uses the name GLOBAL', async () => {
    await rawQuery(`DELETE FROM "team" WHERE "id" = $1`, [GLOBAL_TEAM_ID])
    const now = Date.now()
    await rawQuery(`INSERT INTO "team" ("id","name","createdAt","updatedAt") VALUES ('team-squatter','GLOBAL',$1,$1)`, [
      now,
    ])
    try {
      await seedGlobalTeam()
      const rows = await rawQuery(`SELECT 1 FROM "team" WHERE "id" = $1`, [GLOBAL_TEAM_ID])
      expect(rows).toHaveLength(0)
    } finally {
      await rawQuery(`DELETE FROM "team" WHERE "id" = 'team-squatter'`)
      await seedGlobalTeam()
    }
  })
})

describe('GLOBAL libraries are visible to everyone (U1)', () => {
  it('a user in no team lists and reads a GLOBAL library', async () => {
    await insertGlobalLibrary('lib-g', 'Distributed')
    mockSessionAs(f.userIdOther) // member of no team
    const list = await v2Req(f, 'GET', '/api/v2/libraries?entityType=action', {})
    expect(list.status).toBe(200)
    const body = (await list.json()) as { libraries: Array<{ id: string }> }
    expect(body.libraries.map((l) => l.id)).toEqual(['lib-g'])
    const one = await v2Req(f, 'GET', '/api/v2/libraries/lib-g/specifications', {})
    expect(one.status).toBe(200)
  })

  it('other teams stay hidden from that user', async () => {
    mockSessionAs(f.userIdOther)
    const list = await v2Req(f, 'GET', '/api/v2/libraries', {})
    const body = (await list.json()) as { libraries: Array<{ id: string }> }
    expect(body.libraries.some((l) => l.id === f.libSharedId)).toBe(false)
  })

  it('/me lists GLOBAL last, flagged, for a user in no team', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'GET', '/api/v2/me', {})
    const body = (await res.json()) as { teams: Array<{ id: string; name: string; isGlobal: boolean }> }
    expect(body.teams).toEqual([{ id: GLOBAL_TEAM_ID, name: 'GLOBAL', isGlobal: true }])
  })

  it('/me lists the member team first and GLOBAL last', async () => {
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'GET', '/api/v2/me', {})
    const body = (await res.json()) as { teams: Array<{ id: string; isGlobal: boolean }> }
    expect(body.teams.map((t) => t.id)).toEqual([f.teamMainId, GLOBAL_TEAM_ID])
    expect(body.teams.map((t) => t.isGlobal)).toEqual([false, true])
  })
})

describe('GLOBAL is protected', () => {
  it('cannot be renamed (409 global_team_protected) but its description can change', async () => {
    mockSessionAs(await seedAdminUser(f))
    const rename = await v2Req(f, 'PATCH', `/api/v2/admin/teams/${GLOBAL_TEAM_ID}`, { json: { name: 'Shared' } })
    expect(rename.status).toBe(409)
    expect(((await rename.json()) as { code: string }).code).toBe('global_team_protected')
    const describe_ = await v2Req(f, 'PATCH', `/api/v2/admin/teams/${GLOBAL_TEAM_ID}`, {
      json: { description: 'Shared by every team' },
    })
    expect(describe_.status).toBe(200)
  })

  it('the Teams dialog may resend the unchanged name with a new description', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PATCH', `/api/v2/admin/teams/${GLOBAL_TEAM_ID}`, {
      json: { name: 'GLOBAL', description: 'Shared by every team' },
    })
    expect(res.status).toBe(200)
  })

  it('cannot be deleted (409 global_team_protected)', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'DELETE', `/api/v2/admin/teams/${GLOBAL_TEAM_ID}`, {})
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('global_team_protected')
  })

  it('does not count toward setup completion', async () => {
    const rows = await rawQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM "team" WHERE "id" <> $1`, [GLOBAL_TEAM_ID])
    expect(Number(rows[0].n)).toBeGreaterThan(0) // fixture team present; the route test below proves GLOBAL alone fails
    await rawQuery(`DELETE FROM "user_team_role"`)
    await rawQuery(`DELETE FROM "user_team"`)
    await rawQuery(`DELETE FROM "specification"`)
    await rawQuery(`DELETE FROM "library"`)
    await rawQuery(`DELETE FROM "team" WHERE "id" <> $1`, [GLOBAL_TEAM_ID])
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/setup-complete', {})
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string; teamCount: number }).teamCount).toBe(0)
    // restore the fixture team for later files sharing this worker
    const now = Date.now()
    await rawQuery(
      `INSERT INTO "team" ("id","name","description","createdAt","updatedAt") VALUES ($1,'Main Team','fixture',$2,$2) ON CONFLICT DO NOTHING`,
      [f.teamMainId, now],
    )
  })
})

describe('creating libraries in GLOBAL (U2, U3)', () => {
  async function grantGlobalRole(userId: string, roleId: string) {
    await rawQuery(`INSERT INTO "user_team" ("userId","teamId") VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
      userId,
      GLOBAL_TEAM_ID,
    ])
    await rawQuery(
      `INSERT INTO "user_team_role" ("userId","teamId","roleId") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [userId, GLOBAL_TEAM_ID, roleId],
    )
  }

  it('a user with a GLOBAL librarian role creates an action library there', async () => {
    await grantGlobalRole(f.userIdOther, 'role-librarian')
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'POST', '/api/v2/libraries', {
      json: { name: 'Shared Actions', entityType: 'action', teamId: GLOBAL_TEAM_ID },
    })
    expect(res.status).toBe(201)
  })

  it('a workflow library in GLOBAL is refused with 422 schema_mismatch on entityType', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/libraries', {
      json: { name: 'Shared Workflows', entityType: 'workflow', teamId: GLOBAL_TEAM_ID },
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: 'schema_mismatch', field: 'entityType' })
  })

  it('a user without a GLOBAL role cannot create there (403)', async () => {
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'POST', '/api/v2/libraries', {
      json: { name: 'Nope', entityType: 'action', teamId: GLOBAL_TEAM_ID },
    })
    expect(res.status).toBe(403)
  })

  it('a user without a GLOBAL role cannot edit a GLOBAL library (403)', async () => {
    await insertGlobalLibrary('lib-g', 'Distributed')
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'PATCH', '/api/v2/libraries/lib-g', { json: { description: 'x' } })
    expect(res.status).toBe(403)
  })
})
