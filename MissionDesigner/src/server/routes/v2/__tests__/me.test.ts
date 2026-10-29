// @vitest-environment node
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
  mockSessionAs(null)
})

describe('GET /api/v2/me', () => {
  it('401 without session', async () => {
    const res = await v2Req(f, 'GET', '/api/v2/me')
    expect(res.status).toBe(401)
  })

  it('returns the expected capability shape', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'GET', '/api/v2/me')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      userId: string
      isAdministrator: boolean
    }
    expect(body.userId).toBe(f.userIdGlobal)
    expect(body.isAdministrator).toBe(false)
    // Legacy flags must be absent from the response
    expect(body).not.toHaveProperty('isGlobal')
    expect(body).not.toHaveProperty('isWorkflowAuthor')
    expect(body).not.toHaveProperty('isStepLibraryAuthor')
    expect(body).not.toHaveProperty('isEnvironmentAuthor')
    expect(body).not.toHaveProperty('isActionAuthor')
  })

  it('fresh-reads isAdministrator on every call', async () => {
    mockSessionAs(f.userIdRegular)
    const res1 = await v2Req(f, 'GET', '/api/v2/me')
    expect(((await res1.json()) as { isAdministrator: boolean }).isAdministrator).toBe(false)
    await rawQuery('UPDATE "user" SET "isAdministrator" = true WHERE "id" = $1', [f.userIdRegular])
    const res2 = await v2Req(f, 'GET', '/api/v2/me')
    expect(((await res2.json()) as { isAdministrator: boolean }).isAdministrator).toBe(true)
  })

  it('returns the user display name (fresh-read)', async () => {
    mockSessionAs(f.userIdGlobal)
    await rawQuery('UPDATE "user" SET "name" = $1 WHERE "id" = $2', ['Ada Lovelace', f.userIdGlobal])
    const res = await v2Req(f, 'GET', '/api/v2/me')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string | null }
    expect(body.name).toBe('Ada Lovelace')
  })

  it('includes the team principal: memberships, rightsByTeam, and teams', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'GET', '/api/v2/me')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      memberships: string[]
      rightsByTeam: Record<string, string[]>
      teams: Array<{ id: string; name: string }>
    }
    // userIdGlobal is a member of team-main with all four cross-category roles.
    expect(body.memberships).toContain(f.teamMainId)
    expect(body.teams.some((t) => t.id === f.teamMainId && t.name === 'Main Team')).toBe(true)
    const rights = body.rightsByTeam[f.teamMainId] ?? []
    expect(rights).toContain('workflow:create')
    expect(rights).toContain('workflow:approve')
    expect(rights).toContain('workflow:makeEffective')
    expect(rights).toContain('workflow:library.create')
  })

  it('a non-member sees no memberships and an empty rights map', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'GET', '/api/v2/me')
    const body = (await res.json()) as {
      memberships: string[]
      rightsByTeam: Record<string, string[]>
      teams: Array<{ id: string; name: string }>
    }
    expect(body.memberships).toEqual([])
    expect(body.rightsByTeam).toEqual({})
    // non-admin, non-member: only GLOBAL, which every user can browse (spec 2026-10-12)
    expect(body.teams.map((t) => t.id)).toEqual(['team-global'])
  })

  it('an administrator gets every team in teams[] regardless of membership', async () => {
    const adminId = await seedAdminUser(f)
    mockSessionAs(adminId)
    const res = await v2Req(f, 'GET', '/api/v2/me')
    const body = (await res.json()) as {
      isAdministrator: boolean
      teams: Array<{ id: string; name: string }>
      memberships: string[]
      rightsByTeam: Record<string, string[]>
    }
    expect(body.isAdministrator).toBe(true)
    // admin has no membership row but must still see team-main in the picker
    expect(body.teams.some((t) => t.id === f.teamMainId)).toBe(true)
    expect(body.memberships).toEqual([])
    expect(body.rightsByTeam).toEqual({})
  })

  it('includes the edit-locked state list (defaults to the seeded four)', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'GET', '/api/v2/me')
    const body = (await res.json()) as { editLockedStates: string[] }
    expect(Array.isArray(body.editLockedStates)).toBe(true)
    expect(body.editLockedStates).toEqual(expect.arrayContaining(['Approved', 'Effective', 'Superseded', 'Obsolete']))
  })

  it('response contains only isAdministrator (not the five dropped flags)', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'GET', '/api/v2/me')
    const body = (await res.json()) as Record<string, unknown>
    expect('isAdministrator' in body).toBe(true)
    expect('isGlobal' in body).toBe(false)
    expect('isWorkflowAuthor' in body).toBe(false)
    expect('isStepLibraryAuthor' in body).toBe(false)
    expect('isEnvironmentAuthor' in body).toBe(false)
    expect('isActionAuthor' in body).toBe(false)
  })
})
