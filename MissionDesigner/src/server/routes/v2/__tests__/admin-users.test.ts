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

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import {
  setupTestFixture,
  resetAndSeedFixture,
  mockSessionAs,
  v2Req,
  seedAdminUser,
  rawQuery,
  type TestFixture,
} from './testSeed'

// Isolate the better-auth glue: this endpoint test verifies validation, the admin
// gate, dup->409, and the 201 body — NOT better-auth internals (covered by
// userCreate.test.ts). The success mock inserts a real row so the re-select works.
vi.mock('../../../lib/userCreate', () => {
  class DuplicateEmailError extends Error {}
  class UserNotFoundError extends Error {}
  return { DuplicateEmailError, UserNotFoundError, createUserAccount: vi.fn(), setUserPassword: vi.fn() }
})
import { createUserAccount, DuplicateEmailError, setUserPassword, UserNotFoundError } from '../../../lib/userCreate'

let f: TestFixture

beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetAndSeedFixture(f)
  await rawQuery(`DELETE FROM "team" WHERE "id" NOT IN ('team-main', 'team-default')`)
  mockSessionAs(null)
  vi.mocked(createUserAccount).mockReset()
  vi.mocked(setUserPassword).mockReset()
})

describe('GET /api/v2/admin/users', () => {
  it('403 for a non-admin', async () => {
    mockSessionAs(f.userIdGlobal)
    expect((await v2Req(f, 'GET', '/api/v2/admin/users', {})).status).toBe(403)
  })

  it('lists users with id/name/email/isAdministrator/createdAt', async () => {
    const adminId = await seedAdminUser(f)
    mockSessionAs(adminId)
    const res = await v2Req(f, 'GET', '/api/v2/admin/users', {})
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      users: Array<{ id: string; email: string; isAdministrator: boolean }>
    }
    expect(body.users.find((u) => u.id === adminId)?.isAdministrator).toBe(true)
    expect(body.users.find((u) => u.id === f.userIdRegular)?.isAdministrator).toBe(false)
  })
})

describe('POST /api/v2/admin/users', () => {
  it('401 without a session', async () => {
    const res = await v2Req(f, 'POST', '/api/v2/admin/users', { json: { email: 'a@x.test', password: 'password123' } })
    expect(res.status).toBe(401)
  })

  it('403 for a non-admin', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/admin/users', { json: { email: 'a@x.test', password: 'password123' } })
    expect(res.status).toBe(403)
  })

  it('422 on an invalid email', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/users', { json: { email: 'nope', password: 'password123' } })
    expect(res.status).toBe(422)
  })

  it('422 on a short password', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/users', { json: { email: 'a@x.test', password: 'short' } })
    expect(res.status).toBe(422)
  })

  it('409 conflict when the glue reports a duplicate', async () => {
    mockSessionAs(await seedAdminUser(f))
    vi.mocked(createUserAccount).mockRejectedValueOnce(new DuplicateEmailError())
    const res = await v2Req(f, 'POST', '/api/v2/admin/users', {
      json: { email: 'dupe@x.test', password: 'password123' },
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('conflict')
  })

  it('201 and returns the created user', async () => {
    mockSessionAs(await seedAdminUser(f))
    vi.mocked(createUserAccount).mockImplementationOnce(async (input) => {
      const id = 'new-user-1'
      await rawQuery(
        `INSERT INTO "user" ("id","email","name","isAdministrator","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, input.email.toLowerCase(), input.name ?? null, input.isAdministrator ?? false, new Date(), new Date()],
      )
      return { id }
    })
    const res = await v2Req(f, 'POST', '/api/v2/admin/users', {
      json: { email: 'New@x.test', password: 'password123', name: 'New User' },
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      user: { id: string; email: string; name: string | null; isAdministrator: boolean }
    }
    expect(body.user).toMatchObject({ id: 'new-user-1', email: 'new@x.test', name: 'New User', isAdministrator: false })
  })
})

describe('PATCH /api/v2/admin/users/:id', () => {
  it('404 for an unknown user', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PATCH', '/api/v2/admin/users/ghost', { json: { isAdministrator: true } })
    expect(res.status).toBe(404)
  })

  it('422 on a non-boolean body', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PATCH', `/api/v2/admin/users/${f.userIdRegular}`, {
      json: { isAdministrator: 'yes' },
    })
    expect(res.status).toBe(422)
  })

  it('promotes a user to admin and echoes the updated record', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PATCH', `/api/v2/admin/users/${f.userIdRegular}`, {
      json: { isAdministrator: true },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { user: { isAdministrator: boolean } }).user.isAdministrator).toBe(true)
  })

  it('409 last_admin when demoting the only administrator', async () => {
    const adminId = await seedAdminUser(f)
    mockSessionAs(adminId)
    const res = await v2Req(f, 'PATCH', `/api/v2/admin/users/${adminId}`, { json: { isAdministrator: false } })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('last_admin')
  })

  it('allows demoting an admin when another administrator remains', async () => {
    const adminId = await seedAdminUser(f)
    await seedAdminUser(f, 'admin-2')
    mockSessionAs(adminId)
    const res = await v2Req(f, 'PATCH', `/api/v2/admin/users/${adminId}`, { json: { isAdministrator: false } })
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/v2/admin/users/:id', () => {
  it('404 for an unknown user', async () => {
    mockSessionAs(await seedAdminUser(f))
    expect((await v2Req(f, 'DELETE', '/api/v2/admin/users/ghost', {})).status).toBe(404)
  })

  it('403 when an admin tries to delete themselves', async () => {
    const adminId = await seedAdminUser(f)
    mockSessionAs(adminId)
    expect((await v2Req(f, 'DELETE', `/api/v2/admin/users/${adminId}`, {})).status).toBe(403)
  })

  it('deletes a simple user → 204; their team library SURVIVES (no FK cascade off userId)', async () => {
    mockSessionAs(await seedAdminUser(f))
    // Post-cutover: library.userId (the old ON DELETE CASCADE column) is gone and
    // libraries are team-owned, so deleting userIdRegular must NOT remove libPrivate.
    const res = await v2Req(f, 'DELETE', `/api/v2/admin/users/${f.userIdRegular}`, {})
    expect(res.status).toBe(204)
    expect((await rawQuery('SELECT 1 FROM "user" WHERE "id" = $1', [f.userIdRegular]))[0]).toBeUndefined()
    expect((await rawQuery('SELECT 1 FROM "library" WHERE "id" = $1', [f.libPrivateId]))[0]).toBeDefined()
  })

  it("blanks attribution (createdByUserId/lastEditedByUserId → NULL) on the deleted user's team library", async () => {
    mockSessionAs(await seedAdminUser(f))
    // libShared was created by userIdGlobal in the fixture. Make userIdGlobal also
    // the last editor of both the library and its root spec, then delete them.
    // (userIdGlobal is not the acting admin, so the self-delete guard is not hit.)
    await rawQuery('UPDATE "library" SET "lastEditedByUserId" = $1 WHERE "id" = $2', [f.userIdGlobal, f.libSharedId])
    await rawQuery('UPDATE "specification" SET "lastEditedByUserId" = $1 WHERE "id" = $2', [
      f.userIdGlobal,
      f.rootSpecId,
    ])

    const res = await v2Req(f, 'DELETE', `/api/v2/admin/users/${f.userIdGlobal}`, {})
    expect(res.status).toBe(204)

    // Library survives; its createdByUserId + lastEditedByUserId are now NULL.
    const lib = (
      await rawQuery<{ createdByUserId: string | null; lastEditedByUserId: string | null }>(
        'SELECT "createdByUserId","lastEditedByUserId" FROM "library" WHERE "id" = $1',
        [f.libSharedId],
      )
    )[0]
    expect(lib).toBeDefined()
    expect(lib!.createdByUserId).toBeNull()
    expect(lib!.lastEditedByUserId).toBeNull()

    // The root spec survives too; its lastEditedByUserId nulls out (SET NULL).
    const spec = (
      await rawQuery<{ lastEditedByUserId: string | null }>(
        'SELECT "lastEditedByUserId" FROM "specification" WHERE "id" = $1',
        [f.rootSpecId],
      )
    )[0]
    expect(spec).toBeDefined()
    expect(spec!.lastEditedByUserId).toBeNull()
  })

  it('a user who created/edited content is still deletable (no 409)', async () => {
    mockSessionAs(await seedAdminUser(f))
    // userIdGlobal created libShared + libEnvShared in the fixture; deletion must
    // not be blocked by those attribution references now that they SET NULL.
    const res = await v2Req(f, 'DELETE', `/api/v2/admin/users/${f.userIdGlobal}`, {})
    expect(res.status).toBe(204)
    expect((await rawQuery('SELECT 1 FROM "user" WHERE "id" = $1', [f.userIdGlobal]))[0]).toBeUndefined()
  })
})

describe('POST /api/v2/admin/users/:id/password', () => {
  it('204 and sets the password', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/users/u-x/password', { json: { password: 'longenough' } })
    expect(res.status).toBe(204)
    expect(setUserPassword).toHaveBeenCalledWith('u-x', 'longenough')
  })

  it('422 on a short password', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/users/u-x/password', { json: { password: 'short' } })
    expect(res.status).toBe(422)
    expect(setUserPassword).not.toHaveBeenCalled()
  })

  it('404 for an unknown user', async () => {
    mockSessionAs(await seedAdminUser(f))
    vi.mocked(setUserPassword).mockRejectedValueOnce(new UserNotFoundError())
    const res = await v2Req(f, 'POST', '/api/v2/admin/users/ghost/password', { json: { password: 'longenough' } })
    expect(res.status).toBe(404)
  })

  it('403 for a non-admin', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/admin/users/u-x/password', { json: { password: 'longenough' } })
    expect(res.status).toBe(403)
    expect(setUserPassword).not.toHaveBeenCalled()
  })
})
