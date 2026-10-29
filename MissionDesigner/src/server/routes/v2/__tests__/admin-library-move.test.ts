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

async function insertLib(id: string, name: string, entityType: string, teamId: string, parent: string | null = null) {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "library" ("id","parentLibraryId","teamId","name","entityType","version","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,'1.0.0',$6,$6)`,
    [id, parent, teamId, name, entityType, now],
  )
}
const teamOf = async (id: string) =>
  (await rawQuery<{ teamId: string }>(`SELECT "teamId" FROM "library" WHERE "id" = $1`, [id]))[0]?.teamId

beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetAndSeedFixture(f)
  await seedGlobalTeam()
  mockSessionAs(null)
})

describe('POST /api/v2/admin/libraries/:id/move', () => {
  it('is admin-only', async () => {
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'POST', `/api/v2/admin/libraries/${f.libEnvSharedId}/move`, {
      json: { teamId: GLOBAL_TEAM_ID },
    })
    expect(res.status).toBe(403)
  })

  it('moves a library and its child libraries to GLOBAL', async () => {
    await insertLib('act-root', 'Actions', 'action', f.teamMainId)
    await insertLib('act-child', 'Sub', 'action', f.teamMainId, 'act-root')
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/libraries/act-root/move', { json: { teamId: GLOBAL_TEAM_ID } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ moved: 2 })
    expect(await teamOf('act-root')).toBe(GLOBAL_TEAM_ID)
    expect(await teamOf('act-child')).toBe(GLOBAL_TEAM_ID)
  })

  it('moves back out of GLOBAL', async () => {
    await insertLib('act-g', 'Actions', 'action', GLOBAL_TEAM_ID)
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/libraries/act-g/move', { json: { teamId: f.teamMainId } })
    expect(res.status).toBe(200)
    expect(await teamOf('act-g')).toBe(f.teamMainId)
  })

  it('refuses a workflow library into GLOBAL (422)', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', `/api/v2/admin/libraries/${f.libSharedId}/move`, {
      json: { teamId: GLOBAL_TEAM_ID },
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: 'schema_mismatch', field: 'entityType' })
    expect(await teamOf(f.libSharedId)).toBe(f.teamMainId)
  })

  it('refuses a child library (422) — move its root instead', async () => {
    await insertLib('act-root', 'Actions', 'action', f.teamMainId)
    await insertLib('act-child', 'Sub', 'action', f.teamMainId, 'act-root')
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/libraries/act-child/move', { json: { teamId: GLOBAL_TEAM_ID } })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: 'schema_mismatch', field: 'parentLibraryId' })
  })

  it('409 when the target team already has a library with that name; nothing moves', async () => {
    await insertLib('act-t', 'Actions', 'action', f.teamMainId)
    await insertLib('act-g', 'Actions', 'action', GLOBAL_TEAM_ID)
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/libraries/act-t/move', { json: { teamId: GLOBAL_TEAM_ID } })
    expect(res.status).toBe(409)
    expect(await teamOf('act-t')).toBe(f.teamMainId)
  })

  it('404 for an unknown library or team; 200 no-op for the same team', async () => {
    mockSessionAs(await seedAdminUser(f))
    expect(
      (await v2Req(f, 'POST', '/api/v2/admin/libraries/nope/move', { json: { teamId: GLOBAL_TEAM_ID } })).status,
    ).toBe(404)
    expect(
      (await v2Req(f, 'POST', `/api/v2/admin/libraries/${f.libEnvSharedId}/move`, { json: { teamId: 'no-team' } }))
        .status,
    ).toBe(404)
    const same = await v2Req(f, 'POST', `/api/v2/admin/libraries/${f.libEnvSharedId}/move`, {
      json: { teamId: f.teamMainId },
    })
    expect(same.status).toBe(200)
    expect(await same.json()).toEqual({ moved: 0 })
  })
})

describe('moving a library other teams use (review: Important 2)', () => {
  async function teamOther() {
    const now = Date.now()
    await rawQuery(
      `INSERT INTO "team" ("id","name","createdAt","updatedAt") VALUES ('team-other','Other Team',$1,$1) ON CONFLICT DO NOTHING`,
      [now],
    )
  }
  async function insertSpec(id: string, libraryId: string, data: unknown) {
    const now = Date.now()
    await rawQuery(
      `INSERT INTO "specification" ("id","libraryId","name","version","state","data","rootSpecificationId","parentSpecificationId","dataSchemaVersion","createdAt","updatedAt")
       VALUES ($1,$2,$1,'1.0.0','Draft',$3,$1,NULL,3,$4,$4)`,
      [id, libraryId, JSON.stringify(data), now],
    )
  }

  it('refuses (409 referenced) to move a GLOBAL environment library a team workflow library binds', async () => {
    await teamOther()
    await insertLib('env-g', 'Shared Env', 'environment', GLOBAL_TEAM_ID)
    await rawQuery(`UPDATE "library" SET "environmentLibraryIds" = '["env-g"]' WHERE "id" = $1`, [f.libSharedId])
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/libraries/env-g/move', { json: { teamId: 'team-other' } })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'conflict', conflictType: 'referenced', references: 1 })
    expect(await teamOf('env-g')).toBe(GLOBAL_TEAM_ID)
  })

  it('refuses to move a GLOBAL action library a team environment names', async () => {
    await teamOther()
    await insertLib('act-g', 'Shared Actions', 'action', GLOBAL_TEAM_ID)
    await insertSpec('env-spec-1', f.libEnvSharedId, {
      included_actions: [{ action_name: 'Go', action_library: 'Shared Actions' }],
    })
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/libraries/act-g/move', { json: { teamId: 'team-other' } })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ conflictType: 'referenced', references: 1 })
  })

  it('moves anyway with force', async () => {
    await teamOther()
    await insertLib('env-g', 'Shared Env', 'environment', GLOBAL_TEAM_ID)
    await rawQuery(`UPDATE "library" SET "environmentLibraryIds" = '["env-g"]' WHERE "id" = $1`, [f.libSharedId])
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/libraries/env-g/move', {
      json: { teamId: 'team-other', force: true },
    })
    expect(res.status).toBe(200)
    expect(await teamOf('env-g')).toBe('team-other')
  })

  it('refuses to move a workflow library whose specs name environments staying in the old team', async () => {
    await teamOther()
    await insertSpec('env-spec-m', f.libEnvSharedId, {})
    await rawQuery(`UPDATE "specification" SET "data" = $1 WHERE "id" = $2`, [
      JSON.stringify({ nodes: [], environmentSpecIds: ['env-spec-m'] }),
      f.rootSpecId,
    ])
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', `/api/v2/admin/libraries/${f.libSharedId}/move`, {
      json: { teamId: 'team-other' },
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ conflictType: 'referenced', references: 1 })
    expect(await teamOf(f.libSharedId)).toBe(f.teamMainId)
  })

  it('moving INTO GLOBAL never needs force (everyone keeps access)', async () => {
    await teamOther()
    await insertLib('env-o', 'Other Env', 'environment', 'team-other')
    await rawQuery(`UPDATE "library" SET "environmentLibraryIds" = '["env-o"]' WHERE "id" = $1`, [f.libSharedId])
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'POST', '/api/v2/admin/libraries/env-o/move', { json: { teamId: GLOBAL_TEAM_ID } })
    expect(res.status).toBe(200)
  })
})
