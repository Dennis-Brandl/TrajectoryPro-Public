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

// Data-safety round 2 §1: deleting a library whose tree holds a released root spec needs an
// administrator's confirmation of exactly the released specs found.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  setupTestFixture,
  resetAndSeedFixture,
  mockSessionAs,
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

const LIB = 'lib-del'

async function seedLibrary(id = LIB, parent?: string): Promise<void> {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "library" ("id","teamId","name","entityType","version","parentLibraryId","createdAt","updatedAt")
     VALUES ($1,$2,$3,'workflow','1.0.0',$4,$5,$5)`,
    [id, f.teamMainId, `Name ${id}`, parent ?? null, now],
  )
}

async function seedSpec(s: {
  id: string
  name: string
  version?: string
  state: string
  parent?: string
  root?: string
  libraryId?: string
}): Promise<void> {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "specification"
       ("id","libraryId","name","version","state","data",
        "rootSpecificationId","parentSpecificationId","dataSchemaVersion","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,'{"nodes":[]}',$6,$7,3,$8,$8)`,
    [s.id, s.libraryId ?? LIB, s.name, s.version ?? '1.0.0', s.state, s.root ?? s.id, s.parent ?? null, now],
  )
}

async function del(id: string, body?: unknown): Promise<Response> {
  return f.app.request(`/api/v2/libraries/${id}`, {
    method: 'DELETE',
    headers: { origin: 'http://localhost:5173', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function check(id: string): Promise<Response> {
  return f.app.request(`/api/v2/libraries/${id}/delete-check`, { headers: { origin: 'http://localhost:5173' } })
}

async function libExists(id = LIB): Promise<boolean> {
  return (await rawQuery(`SELECT 1 FROM "library" WHERE id=$1`, [id])).length > 0
}

async function specCount(): Promise<number> {
  const rows = await rawQuery<{ n: string }>(`SELECT count(*)::text n FROM "specification" WHERE "libraryId"=$1`, [LIB])
  return Number(rows[0].n)
}

type Listed = { releasedSpecs: Array<Record<string, unknown>> }

describe('library delete: released-spec check', () => {
  it('non-admin: refused with the released list', async () => {
    await seedLibrary()
    await seedSpec({ id: 'S-eff', name: 'B eff', state: 'Effective' })
    await seedSpec({ id: 'S-app', name: 'A app', state: 'Approved' })
    await seedSpec({ id: 'S-sup', name: 'C sup', state: 'Superseded' })
    mockSessionAs(f.userIdRegular)
    const res = await del(LIB)
    expect(res.status).toBe(409)
    const body = (await res.json()) as Listed & { code: string }
    expect(body.code).toBe('library_has_released_specs')
    expect(body.releasedSpecs).toEqual([
      { id: 'S-app', name: 'A app', version: '1.0.0', state: 'Approved', embeddedCount: 0 },
      { id: 'S-eff', name: 'B eff', version: '1.0.0', state: 'Effective', embeddedCount: 0 },
      { id: 'S-sup', name: 'C sup', version: '1.0.0', state: 'Superseded', embeddedCount: 0 },
    ])
    expect(await libExists()).toBe(true)
    expect(await specCount()).toBe(3)
  })

  it('obsolete and unreleased specs do not block', async () => {
    await seedLibrary()
    for (const [i, state] of ['Draft', 'InTest', 'InReview', 'Obsolete'].entries()) {
      await seedSpec({ id: `S${i}`, name: `N${i}`, state })
    }
    mockSessionAs(f.userIdRegular)
    const res = await del(LIB)
    expect(res.status).toBe(204)
    expect(await libExists()).toBe(false)
  })

  it('a released spec in a nested sub-library blocks', async () => {
    await seedLibrary()
    await seedLibrary('lib-child', LIB)
    await seedLibrary('lib-grand', 'lib-child')
    await seedSpec({ id: 'deep', name: 'Deep', state: 'Effective', libraryId: 'lib-grand' })
    mockSessionAs(f.userIdRegular)
    const res = await del(LIB)
    expect(res.status).toBe(409)
    const body = (await res.json()) as Listed
    expect(body.releasedSpecs.map((s) => s.id)).toEqual(['deep'])
    expect(await libExists('lib-grand')).toBe(true)
  })

  it('embedded children are counted, not listed', async () => {
    await seedLibrary()
    await seedSpec({ id: 'R', name: 'Root', state: 'Effective' })
    await seedSpec({ id: 'C1', name: 'c1', state: 'Effective', parent: 'R', root: 'R' })
    await seedSpec({ id: 'C2', name: 'c2', state: 'Effective', parent: 'R', root: 'R' })
    mockSessionAs(f.userIdRegular)
    const res = await del(LIB)
    expect(res.status).toBe(409)
    expect(((await res.json()) as Listed).releasedSpecs).toEqual([
      { id: 'R', name: 'Root', version: '1.0.0', state: 'Effective', embeddedCount: 2 },
    ])
  })

  it("a released child under an unreleased root is listed with its root's name", async () => {
    await seedLibrary()
    await seedSpec({ id: 'R', name: 'Root', state: 'Draft' })
    await seedSpec({ id: 'C', name: 'child', version: '2.0.0', state: 'Effective', parent: 'R', root: 'R' })
    mockSessionAs(f.userIdRegular)
    const res = await del(LIB)
    expect(res.status).toBe(409)
    expect(((await res.json()) as Listed).releasedSpecs).toEqual([
      { id: 'C', name: 'Root', version: '2.0.0', state: 'Effective', embeddedCount: 0 },
    ])
    expect(await libExists()).toBe(true)
    mockSessionAs(await seedAdminUser(f))
    const ok = await del(LIB, { confirmedReleasedIds: ['C'] })
    expect(ok.status).toBe(204)
    expect(await libExists()).toBe(false)
  })

  it('a released child in another library under a root in the tree is listed', async () => {
    await seedLibrary()
    await seedLibrary('lib-m')
    await seedSpec({ id: 'R', name: 'Root', state: 'Draft' })
    await seedSpec({ id: 'C', name: 'child', state: 'Effective', parent: 'R', root: 'R', libraryId: 'lib-m' })
    mockSessionAs(f.userIdRegular)
    const res = await del(LIB)
    expect(res.status).toBe(409)
    expect(((await res.json()) as Listed).releasedSpecs).toEqual([
      { id: 'C', name: 'Root', version: '1.0.0', state: 'Effective', embeddedCount: 0 },
    ])
    mockSessionAs(await seedAdminUser(f))
    const ok = await del(LIB, { confirmedReleasedIds: ['C'] })
    expect(ok.status).toBe(204)
    expect(await rawQuery(`SELECT id FROM "specification" WHERE id IN ('C','R')`)).toEqual([])
  })

  it('a released child in the tree whose root is in another library is listed', async () => {
    await seedLibrary()
    await seedLibrary('lib-m')
    await seedSpec({ id: 'R', name: 'Root', state: 'Effective', libraryId: 'lib-m' })
    await seedSpec({ id: 'C', name: 'child', state: 'Effective', parent: 'R', root: 'R' })
    mockSessionAs(f.userIdRegular)
    const res = await del(LIB)
    expect(res.status).toBe(409)
    expect(((await res.json()) as Listed).releasedSpecs).toEqual([
      { id: 'C', name: 'Root', version: '1.0.0', state: 'Effective', embeddedCount: 0 },
    ])
  })

  it('an outside descendant of a removed child is checked', async () => {
    await seedLibrary()
    await seedLibrary('lib-m')
    await seedLibrary('lib-o')
    await seedSpec({ id: 'R', name: 'Outer', state: 'Draft', libraryId: 'lib-o' })
    await seedSpec({ id: 'C1', name: 'c1', state: 'Draft', parent: 'R', root: 'R' })
    await seedSpec({ id: 'C2', name: 'c2', state: 'Effective', parent: 'C1', root: 'R', libraryId: 'lib-m' })
    mockSessionAs(f.userIdRegular)
    const res = await del(LIB)
    expect(res.status).toBe(409)
    expect(((await res.json()) as Listed).releasedSpecs).toEqual([
      { id: 'C2', name: 'Outer', version: '1.0.0', state: 'Effective', embeddedCount: 0 },
    ])
  })

  it('admin with matching confirmation deletes', async () => {
    await seedLibrary()
    await seedSpec({ id: 'R1', name: 'One', state: 'Effective' })
    await seedSpec({ id: 'R2', name: 'Two', state: 'Approved' })
    mockSessionAs(await seedAdminUser(f))
    const res = await del(LIB, { confirmedReleasedIds: ['R2', 'R1'] })
    expect(res.status).toBe(204)
    expect(await libExists()).toBe(false)
  })

  it('admin without or with stale confirmation is refused with the current list', async () => {
    await seedLibrary()
    await seedSpec({ id: 'R1', name: 'One', state: 'Effective' })
    await seedSpec({ id: 'R2', name: 'Two', state: 'Approved' })
    mockSessionAs(await seedAdminUser(f))
    const none = await del(LIB)
    expect(none.status).toBe(409)
    expect(((await none.json()) as Listed).releasedSpecs).toHaveLength(2)
    const stale = await del(LIB, { confirmedReleasedIds: ['R1'] })
    expect(stale.status).toBe(409)
    expect(((await stale.json()) as Listed).releasedSpecs).toHaveLength(2)
    expect(await libExists()).toBe(true)
  })

  it('admin deleting a library without released specs needs no body', async () => {
    await seedLibrary()
    await seedSpec({ id: 'D', name: 'Draft', state: 'Draft' })
    mockSessionAs(await seedAdminUser(f))
    expect((await del(LIB)).status).toBe(204)
  })

  it('delete-check lists the same specs', async () => {
    await seedLibrary()
    await seedSpec({ id: 'R1', name: 'One', state: 'Effective' })
    mockSessionAs(f.userIdRegular)
    const conflict = (await (await del(LIB)).json()) as Listed
    const res = await check(LIB)
    expect(res.status).toBe(200)
    expect(((await res.json()) as Listed).releasedSpecs).toEqual(conflict.releasedSpecs)
    expect((await check('nope')).status).toBe(404)
    mockSessionAs(f.userIdOther)
    expect((await check(LIB)).status).toBe(404)
  })

  it('delete-check is 403 without library.delete', async () => {
    await seedLibrary()
    const uid = 'viewer-only'
    await rawQuery(
      `INSERT INTO "user" ("id","email","emailVerified","createdAt","updatedAt") VALUES ($1,$2,false,$3,$3)`,
      [uid, 'viewer@example.com', new Date()],
    )
    await rawQuery(`INSERT INTO "user_team" ("userId","teamId") VALUES ($1,$2)`, [uid, f.teamMainId])
    mockSessionAs(uid)
    expect((await check(LIB)).status).toBe(403)
  })

  it('the external-proxy refusal is unchanged', async () => {
    await seedLibrary()
    await seedLibrary('lib-ext')
    await seedSpec({ id: 'T', name: 'Target', state: 'Draft' })
    await seedSpec({ id: 'P', name: 'Proxier', state: 'Draft', libraryId: 'lib-ext', parent: 'T', root: 'T' })
    await rawQuery(
      `INSERT INTO "proxy_reference" ("parentSpecificationId","nodeId","targetSpecificationId") VALUES ('P','n1','T')`,
    )
    mockSessionAs(f.userIdRegular)
    const res = await del(LIB)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('library_not_empty')
  })

  it('legacy admin delete route is gone', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await f.app.request('/api/admin/libraries/x', {
      method: 'DELETE',
      headers: { origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(404)
  })
})
