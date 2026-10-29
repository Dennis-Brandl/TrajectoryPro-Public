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
  await rawQuery('DELETE FROM "app_setting" WHERE key = $1', ['setupComplete'])
  mockSessionAs(null)
})

describe('POST /api/v2/admin/setup-complete', () => {
  it('401 without a session', async () => {
    const res = await v2Req(f, 'POST', '/api/v2/admin/setup-complete', { json: {} })
    expect(res.status).toBe(401)
  })

  it('403 for a non-admin', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/admin/setup-complete', { json: {} })
    expect(res.status).toBe(403)
  })

  it('200 and sets the flag when an admin and a team exist', async () => {
    mockSessionAs(await seedAdminUser(f)) // admin exists; team-main + team-default exist
    const res = await v2Req(f, 'POST', '/api/v2/admin/setup-complete', { json: {} })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ setupComplete: true })
    const [row] = await rawQuery<{ value: string }>('SELECT value FROM "app_setting" WHERE key = $1', ['setupComplete'])
    expect(row.value).toBe('true')
  })

  it('409 setup_incomplete when no team exists', async () => {
    // FK-safe teardown of all teams + the content that references them.
    await rawQuery('DELETE FROM "specification_environment"')
    await rawQuery('DELETE FROM "library_environment"')
    await rawQuery('DELETE FROM "specification"')
    await rawQuery('DELETE FROM "library"')
    await rawQuery('DELETE FROM "user_team_role"')
    await rawQuery('DELETE FROM "user_team"')
    await rawQuery('DELETE FROM "team"')
    mockSessionAs(await seedAdminUser(f)) // admin exists but zero teams
    const res = await v2Req(f, 'POST', '/api/v2/admin/setup-complete', { json: {} })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('setup_incomplete')
    expect((await rawQuery('SELECT value FROM "app_setting" WHERE key = $1', ['setupComplete']))[0]).toBeUndefined()
  })
})
