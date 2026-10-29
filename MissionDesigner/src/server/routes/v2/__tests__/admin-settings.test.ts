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

const DEFAULT_LOCKED = ['Approved', 'Effective', 'Superseded', 'Obsolete']

beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetAndSeedFixture(f)
  // app_setting is NOT wiped by the fixture — restore the default before each test.
  await rawQuery(
    `INSERT INTO "app_setting" (key, value) VALUES ('editLockedStates', $1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(DEFAULT_LOCKED)],
  )
  mockSessionAs(null)
})

describe('GET /api/v2/admin/settings/edit-locked-states', () => {
  it('403 for a non-admin', async () => {
    mockSessionAs(f.userIdGlobal)
    expect((await v2Req(f, 'GET', '/api/v2/admin/settings/edit-locked-states', {})).status).toBe(403)
  })

  it('returns the current set in canonical state order', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'GET', '/api/v2/admin/settings/edit-locked-states', {})
    expect(res.status).toBe(200)
    expect(((await res.json()) as { states: string[] }).states).toEqual(DEFAULT_LOCKED)
  })
})

describe('PUT /api/v2/admin/settings/edit-locked-states', () => {
  it('stores a deduped, canonical-ordered subset', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PUT', '/api/v2/admin/settings/edit-locked-states', {
      json: { states: ['Effective', 'Approved', 'Approved'] },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { states: string[] }).states).toEqual(['Approved', 'Effective'])
    const [row] = await rawQuery<{ value: string }>(`SELECT value FROM "app_setting" WHERE key = 'editLockedStates'`)
    expect(JSON.parse(row.value)).toEqual(['Approved', 'Effective'])
  })

  it('accepts the empty set (nothing locked)', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PUT', '/api/v2/admin/settings/edit-locked-states', { json: { states: [] } })
    expect(res.status).toBe(200)
    const get = await v2Req(f, 'GET', '/api/v2/admin/settings/edit-locked-states', {})
    expect(((await get.json()) as { states: string[] }).states).toEqual([])
  })

  it('422 on an unknown state', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PUT', '/api/v2/admin/settings/edit-locked-states', {
      json: { states: ['Drafty'] },
    })
    expect(res.status).toBe(422)
  })

  it('takes effect live in the policy engine (§13)', async () => {
    mockSessionAs(await seedAdminUser(f))
    await v2Req(f, 'PUT', '/api/v2/admin/settings/edit-locked-states', { json: { states: ['Draft'] } })

    // rootSpec is Draft — now edit-locked, so a content update must 409.
    mockSessionAs(f.userIdGlobal)
    const saveBody = {
      specs: [{ op: 'update', id: f.rootSpecId, name: 'Locked Rename' }],
      proxyRefs: [],
      specEnvs: [],
      imageDeletes: [],
      imageRefs: [],
    }
    const blocked = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', { json: saveBody })
    expect(blocked.status).toBe(409)
    expect(((await blocked.json()) as { code: string }).code).toBe('edit_locked')

    // Restore the default — the same update succeeds.
    mockSessionAs('test-admin')
    await v2Req(f, 'PUT', '/api/v2/admin/settings/edit-locked-states', { json: { states: DEFAULT_LOCKED } })
    mockSessionAs(f.userIdGlobal)
    expect((await v2Req(f, 'POST', '/api/v2/specifications/batch-save', { json: saveBody })).status).toBe(200)
  })
})
