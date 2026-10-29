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
  // team/role/app_setting are NOT wiped by the fixture — clean this file's residue
  // and undo renames (the fixture re-insert is OR IGNORE, so it never restores the name).
  await rawQuery(`DELETE FROM "team" WHERE "id" NOT IN ('team-main', 'team-default')`)
  await rawQuery(`UPDATE "team" SET "name" = 'Main Team', "description" = 'fixture' WHERE "id" = $1`, [f.teamMainId])
  mockSessionAs(null)
})

describe('admin gate', () => {
  it('401 without session', async () => {
    const res = await v2Req(f, 'GET', '/api/v2/admin/teams', {})
    expect(res.status).toBe(401)
  })

  it('403 forbidden for a non-admin (isGlobal is not isAdministrator)', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'GET', '/api/v2/admin/teams', {})
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('forbidden')
  })
})

describe('GET /api/v2/admin/teams', () => {
  it('lists teams with member and library counts, ordered by name', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'GET', '/api/v2/admin/teams', {})
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      teams: Array<{ id: string; name: string; memberCount: number; libraryCount: number }>
    }
    const main = body.teams.find((t) => t.id === f.teamMainId)
    expect(main).toMatchObject({ name: 'Main Team', memberCount: 2, libraryCount: 3 })
    const names = body.teams.map((t) => t.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })
})

describe('POST /api/v2/admin/teams', () => {
  it('creates a team and returns 201', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/teams', {
      json: { name: 'QA Team', description: 'quality' },
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { team: { id: string; name: string; description: string | null } }
    expect(body.team.name).toBe('QA Team')
    const [row] = await rawQuery<{ name: string }>('SELECT "name" FROM "team" WHERE "id" = $1', [body.team.id])
    expect(row.name).toBe('QA Team')
  })

  it('409 conflict on a duplicate name', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/teams', { json: { name: 'Main Team' } })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('conflict')
  })

  it('422 on an empty name', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/teams', { json: { name: '' } })
    expect(res.status).toBe(422)
  })
})

describe('PATCH /api/v2/admin/teams/:id', () => {
  it('renames a team', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PATCH', `/api/v2/admin/teams/${f.teamMainId}`, { json: { name: 'Renamed Team' } })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { team: { name: string } }).team.name).toBe('Renamed Team')
  })

  it('round-trips description: set on create, clear with null', async () => {
    mockSessionAs(await seedAdminUser(f))
    const created = await v2Req(f, 'POST', '/api/v2/admin/teams', {
      json: { name: 'Described', description: 'has one' },
    })
    const teamId = ((await created.json()) as { team: { id: string; description: string | null } }).team.id

    const cleared = await v2Req(f, 'PATCH', `/api/v2/admin/teams/${teamId}`, { json: { description: null } })
    expect(cleared.status).toBe(200)
    expect(((await cleared.json()) as { team: { description: string | null } }).team.description).toBeNull()
  })

  it('409 when renaming onto an existing name', async () => {
    mockSessionAs(await seedAdminUser(f))
    // Create a second team, then rename team-main onto its name → unique-name conflict.
    const created = await v2Req(f, 'POST', '/api/v2/admin/teams', { json: { name: 'Other Team' } })
    expect(created.status).toBe(201)
    const res = await v2Req(f, 'PATCH', `/api/v2/admin/teams/${f.teamMainId}`, { json: { name: 'Other Team' } })
    expect(res.status).toBe(409)
  })

  it('404 for an unknown team', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PATCH', '/api/v2/admin/teams/nope', { json: { name: 'X' } })
    expect(res.status).toBe(404)
  })

  it('422 on an empty patch', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PATCH', `/api/v2/admin/teams/${f.teamMainId}`, { json: {} })
    expect(res.status).toBe(422)
  })
})

describe('DELETE /api/v2/admin/teams/:id', () => {
  it('deletes an empty team and cascades its memberships', async () => {
    mockSessionAs(await seedAdminUser(f))
    const created = await v2Req(f, 'POST', '/api/v2/admin/teams', { json: { name: 'Doomed' } })
    const teamId = ((await created.json()) as { team: { id: string } }).team.id
    await rawQuery('INSERT INTO "user_team" ("userId","teamId") VALUES ($1,$2)', [f.userIdRegular, teamId])

    const res = await v2Req(f, 'DELETE', `/api/v2/admin/teams/${teamId}`, {})
    expect(res.status).toBe(204)
    expect((await rawQuery('SELECT "id" FROM "team" WHERE "id" = $1', [teamId]))[0]).toBeUndefined()
    expect((await rawQuery('SELECT "userId" FROM "user_team" WHERE "teamId" = $1', [teamId]))[0]).toBeUndefined()
  })

  it('409 team_not_empty when the team still owns libraries', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'DELETE', `/api/v2/admin/teams/${f.teamMainId}`, {})
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('team_not_empty')
  })

  it('404 for an unknown team', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'DELETE', '/api/v2/admin/teams/nope', {})
    expect(res.status).toBe(404)
  })
})
