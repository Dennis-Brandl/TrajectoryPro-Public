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
import { setupTestFixture, resetAndSeedFixture, mockSessionAs, v2Req, rawQuery, type TestFixture } from './testSeed'

let f: TestFixture
beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetAndSeedFixture(f)
  mockSessionAs(null)
})

describe('POST /api/v2/libraries', () => {
  it('401 without session', async () => {
    const res = await v2Req(f, 'POST', '/api/v2/libraries', {
      json: { name: 'New', entityType: 'workflow' },
    })
    expect(res.status).toBe(401)
  })

  it('422 on schema mismatch (missing name)', async () => {
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'POST', '/api/v2/libraries', {
      json: { entityType: 'workflow' },
    })
    expect(res.status).toBe(422)
  })

  it('creates a top-level library and returns 201', async () => {
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'POST', '/api/v2/libraries', {
      json: { name: 'My New Lib', entityType: 'workflow', description: 'A test lib', teamId: f.teamMainId },
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { library: { id: string; name: string; createdByUserId: string } }
    expect(body.library.name).toBe('My New Lib')
    expect(body.library.createdByUserId).toBe(f.userIdRegular)
  })

  it('creates a child library under a writable parent', async () => {
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'POST', '/api/v2/libraries', {
      json: { name: 'Child', entityType: 'workflow', parentLibraryId: f.libPrivateId, teamId: f.teamMainId },
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { library: { parentLibraryId: string | null } }
    expect(body.library.parentLibraryId).toBe(f.libPrivateId)
  })

  it('403 when a non-member tries to create in a team', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'POST', '/api/v2/libraries', {
      json: { name: 'Child', entityType: 'workflow', teamId: f.teamMainId },
    })
    expect(res.status).toBe(403)
  })

  it('403 when a member without the librarian role tries to create', async () => {
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO "user" ("id","email","emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5)`,
      ['test-viewer', 'viewer@example.com', false, new Date(NOW), new Date(NOW)],
    )
    await rawQuery(`INSERT INTO "user_team" ("userId","teamId") VALUES ($1,$2)`, ['test-viewer', f.teamMainId])
    mockSessionAs('test-viewer')
    const res = await v2Req(f, 'POST', '/api/v2/libraries', {
      json: { name: 'My Lib', entityType: 'workflow', teamId: f.teamMainId },
    })
    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/v2/libraries/:id', () => {
  it('401 without session', async () => {
    const res = await v2Req(f, 'PATCH', `/api/v2/libraries/${f.libPrivateId}`, {
      json: { name: 'Renamed' },
    })
    expect(res.status).toBe(401)
  })

  it('404 when caller cannot write the library', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'PATCH', `/api/v2/libraries/${f.libPrivateId}`, {
      json: { name: 'Hacked' },
    })
    expect(res.status).toBe(404)
  })

  it('renames the library', async () => {
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'PATCH', `/api/v2/libraries/${f.libPrivateId}`, {
      json: { name: 'Renamed' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { library: { name: string } }
    expect(body.library.name).toBe('Renamed')
  })

  it('422 on empty patch (no patchable fields)', async () => {
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'PATCH', `/api/v2/libraries/${f.libPrivateId}`, {
      json: {},
    })
    expect(res.status).toBe(422)
  })

  it('round-trips environmentLibraryIds (set, replace, clear)', async () => {
    mockSessionAs(f.userIdRegular)
    // 1. Set initial bindings.
    const setRes = await v2Req(f, 'PATCH', `/api/v2/libraries/${f.libPrivateId}`, {
      json: { environmentLibraryIds: ['env-a', 'env-b'] },
    })
    expect(setRes.status).toBe(200)
    const setBody = (await setRes.json()) as { library: { environmentLibraryIds: string[] | null } }
    expect(setBody.library.environmentLibraryIds).toEqual(['env-a', 'env-b'])

    // 2. Replace.
    const replaceRes = await v2Req(f, 'PATCH', `/api/v2/libraries/${f.libPrivateId}`, {
      json: { environmentLibraryIds: ['env-c'] },
    })
    expect(replaceRes.status).toBe(200)
    const replaceBody = (await replaceRes.json()) as { library: { environmentLibraryIds: string[] | null } }
    expect(replaceBody.library.environmentLibraryIds).toEqual(['env-c'])

    // 3. Clear with null.
    const clearRes = await v2Req(f, 'PATCH', `/api/v2/libraries/${f.libPrivateId}`, {
      json: { environmentLibraryIds: null },
    })
    expect(clearRes.status).toBe(200)
    const clearBody = (await clearRes.json()) as { library: { environmentLibraryIds: string[] | null } }
    expect(clearBody.library.environmentLibraryIds).toBeNull()
  })

  it('403 when a member without the edit right patches the library', async () => {
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO "user" ("id","email","emailVerified","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5)`,
      ['test-viewer', 'viewer@example.com', false, new Date(NOW), new Date(NOW)],
    )
    await rawQuery(`INSERT INTO "user_team" ("userId","teamId") VALUES ($1,$2)`, ['test-viewer', f.teamMainId])
    mockSessionAs('test-viewer')
    const res = await v2Req(f, 'PATCH', `/api/v2/libraries/${f.libPrivateId}`, { json: { name: 'Nope' } })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('forbidden')
  })
})

describe('DELETE /api/v2/libraries/:id', () => {
  let emptyLibId: string

  beforeEach(async () => {
    // Create an empty library for delete tests
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'POST', '/api/v2/libraries', {
      json: { name: 'Empty for delete', entityType: 'workflow', teamId: f.teamMainId },
    })
    const body = (await res.json()) as { library: { id: string } }
    emptyLibId = body.library.id
    mockSessionAs(null) // reset session for individual tests
  })

  it('401 without session', async () => {
    const res = await v2Req(f, 'DELETE', `/api/v2/libraries/${emptyLibId}`)
    expect(res.status).toBe(401)
  })

  it('404 when a non-member tries to delete', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'DELETE', `/api/v2/libraries/${emptyLibId}`)
    expect(res.status).toBe(404)
  })

  it('cascades delete of a library that contains specs', async () => {
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'DELETE', `/api/v2/libraries/${f.libPrivateId}`)
    expect(res.status).toBe(204)
    const remaining = await rawQuery<{ n: number }>('SELECT COUNT(*)::int AS n FROM "library" WHERE "id" = $1', [
      f.libPrivateId,
    ])
    expect(remaining[0].n).toBe(0)
    const specs = await rawQuery<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM "specification" WHERE "libraryId" = $1',
      [f.libPrivateId],
    )
    expect(specs[0].n).toBe(0)
  })

  it('cascades delete through descendant child libraries', async () => {
    mockSessionAs(f.userIdRegular)
    // Nest: libPrivate → childA → grandchildB
    const mkChild = await v2Req(f, 'POST', '/api/v2/libraries', {
      json: { name: 'child-A', entityType: 'workflow', parentLibraryId: f.libPrivateId, teamId: f.teamMainId },
    })
    const childAId = ((await mkChild.json()) as { library: { id: string } }).library.id
    const mkGrand = await v2Req(f, 'POST', '/api/v2/libraries', {
      json: { name: 'grand-B', entityType: 'workflow', parentLibraryId: childAId, teamId: f.teamMainId },
    })
    const grandBId = ((await mkGrand.json()) as { library: { id: string } }).library.id

    const res = await v2Req(f, 'DELETE', `/api/v2/libraries/${f.libPrivateId}`)
    expect(res.status).toBe(204)

    for (const id of [f.libPrivateId, childAId, grandBId]) {
      const rows = await rawQuery<{ n: number }>('SELECT COUNT(*)::int AS n FROM "library" WHERE "id" = $1', [id])
      expect(rows[0].n).toBe(0)
    }
  })

  it('deletes an empty library and returns 204', async () => {
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'DELETE', `/api/v2/libraries/${emptyLibId}`)
    expect(res.status).toBe(204)
  })

  it('403 when a member without the librarian role tries to delete', async () => {
    const now = Date.now()
    await rawQuery(
      `INSERT INTO "user" ("id","email","emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5)`,
      ['test-viewer-del', 'viewer-del@example.com', false, new Date(now), new Date(now)],
    )
    await rawQuery(`INSERT INTO "user_team" ("userId","teamId") VALUES ($1,$2)`, ['test-viewer-del', f.teamMainId])
    mockSessionAs('test-viewer-del')
    const res = await v2Req(f, 'DELETE', `/api/v2/libraries/${emptyLibId}`)
    expect(res.status).toBe(403)
  })
})
