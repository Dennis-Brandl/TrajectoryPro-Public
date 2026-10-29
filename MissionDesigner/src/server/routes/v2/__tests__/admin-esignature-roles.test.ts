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
  // app_setting is NOT wiped by the fixture — start every test from the seeded empty list.
  await rawQuery(
    `INSERT INTO "app_setting" (key, value) VALUES ('esignatureRoles', $1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify([])],
  )
  mockSessionAs(null)
})

describe('GET /api/v2/admin/settings/esignature-roles', () => {
  it('403 for a non-admin', async () => {
    mockSessionAs(f.userIdGlobal)
    expect((await v2Req(f, 'GET', '/api/v2/admin/settings/esignature-roles', {})).status).toBe(403)
  })

  it('returns the stored list', async () => {
    await rawQuery(`UPDATE "app_setting" SET value = $1 WHERE key = 'esignatureRoles'`, [
      JSON.stringify(['Time Sheet Approver']),
    ])
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'GET', '/api/v2/admin/settings/esignature-roles', {})
    expect(res.status).toBe(200)
    expect(((await res.json()) as { roles: string[] }).roles).toEqual(['Time Sheet Approver'])
  })

  it('falls back to [] when the row is missing or malformed', async () => {
    await rawQuery(`UPDATE "app_setting" SET value = 'not json' WHERE key = 'esignatureRoles'`)
    mockSessionAs(await seedAdminUser(f))
    expect(
      ((await (await v2Req(f, 'GET', '/api/v2/admin/settings/esignature-roles', {})).json()) as { roles: string[] })
        .roles,
    ).toEqual([])
    await rawQuery(`DELETE FROM "app_setting" WHERE key = 'esignatureRoles'`)
    expect(
      ((await (await v2Req(f, 'GET', '/api/v2/admin/settings/esignature-roles', {})).json()) as { roles: string[] })
        .roles,
    ).toEqual([])
  })
})

describe('PUT /api/v2/admin/settings/esignature-roles', () => {
  it('403 for a non-admin', async () => {
    mockSessionAs(f.userIdGlobal)
    expect((await v2Req(f, 'PUT', '/api/v2/admin/settings/esignature-roles', { json: { roles: ['X'] } })).status).toBe(
      403,
    )
  })

  it('stores trimmed names in the given order', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PUT', '/api/v2/admin/settings/esignature-roles', {
      json: { roles: ['  Time Sheet Approver ', 'QA Lead'] },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { roles: string[] }).roles).toEqual(['Time Sheet Approver', 'QA Lead'])
    const [row] = await rawQuery<{ value: string }>(`SELECT value FROM "app_setting" WHERE key = 'esignatureRoles'`)
    expect(JSON.parse(row.value)).toEqual(['Time Sheet Approver', 'QA Lead'])
  })

  it('accepts the empty list', async () => {
    mockSessionAs(await seedAdminUser(f))
    expect((await v2Req(f, 'PUT', '/api/v2/admin/settings/esignature-roles', { json: { roles: [] } })).status).toBe(200)
  })

  it('422 on blank, over-long, case-insensitive duplicate, > 200 entries, or a non-array', async () => {
    mockSessionAs(await seedAdminUser(f))
    for (const roles of [
      [' '],
      ['a'.repeat(65)],
      ['Approver', 'approver'],
      Array.from({ length: 201 }, (_, i) => `R${i}`),
      'Approver',
    ]) {
      const res = await v2Req(f, 'PUT', '/api/v2/admin/settings/esignature-roles', { json: { roles } })
      expect(res.status, JSON.stringify(roles).slice(0, 40)).toBe(422)
      expect(((await res.json()) as { code: string }).code).toBe('schema_mismatch')
    }
  })
})

describe('GET /api/v2/esignature-roles (public, authenticated)', () => {
  it('401 without a session', async () => {
    expect((await v2Req(f, 'GET', '/api/v2/esignature-roles', {})).status).toBe(401)
  })

  it('returns the list to a non-admin', async () => {
    await rawQuery(`UPDATE "app_setting" SET value = $1 WHERE key = 'esignatureRoles'`, [JSON.stringify(['QA Lead'])])
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'GET', '/api/v2/esignature-roles', {})
    expect(res.status).toBe(200)
    expect(((await res.json()) as { roles: string[] }).roles).toEqual(['QA Lead'])
  })
})
