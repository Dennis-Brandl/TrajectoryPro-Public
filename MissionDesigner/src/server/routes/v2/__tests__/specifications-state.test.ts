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
  rawQuery,
  seedAdminUser,
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

async function setSpecState(state: string): Promise<void> {
  await rawQuery('UPDATE specification SET state = $1 WHERE id = $2', [state, f.rootSpecId])
}

async function getSpecRow(): Promise<{ state: string; effectiveFrom: number | null; history: string }> {
  const rows = await rawQuery<{ state: string; effectiveFrom: unknown; history: string }>(
    'SELECT state, "effectiveFrom", history FROM specification WHERE id = $1',
    [f.rootSpecId],
  )
  const row = rows[0]!
  return {
    state: row.state,
    effectiveFrom: row.effectiveFrom != null ? Number(row.effectiveFrom) : null,
    history: row.history,
  }
}

async function lastHistoryEntry(): Promise<Record<string, unknown>> {
  const { history } = await getSpecRow()
  const entries = JSON.parse(history) as Array<Record<string, unknown>>
  return entries[entries.length - 1]
}

/** Member of teamMain with ONLY the Author role (create/edit/delete — no approve/makeEffective). */
async function seedAuthorOnlyUser(): Promise<string> {
  const id = 'test-author-only'
  const NOW = Date.now()
  await rawQuery(
    `INSERT INTO "user" (id, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'author-only@example.com', false, $2, $3)`,
    [id, new Date(NOW), new Date(NOW)],
  )
  await rawQuery(`INSERT INTO user_team ("userId", "teamId") VALUES ($1, $2)`, [id, f.teamMainId])
  await rawQuery(`INSERT INTO user_team_role ("userId", "teamId", "roleId") VALUES ($1, $2, $3)`, [
    id,
    f.teamMainId,
    'role-author',
  ])
  return id
}

describe('PATCH /api/v2/specifications/:id/state — legality + rights', () => {
  it('legal edge with the edit right: Draft → InReview appends history and updates state', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'InReview', reason: 'ready for review' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { spec: { state: string; history: unknown[]; lastEditedByUserId: string } }
    expect(body.spec.state).toBe('InReview')
    expect(body.spec.history).toHaveLength(1)
    expect(body.spec.history[0]).toMatchObject({
      type: 'state_change',
      fromState: 'Draft',
      toState: 'InReview',
      reason: 'ready for review',
      version: '1.0.0',
    })
    expect(body.spec.lastEditedByUserId).toBe(f.userIdGlobal)
  })

  it('approve right moves InReview → Approved', async () => {
    await setSpecState('InReview')
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'Approved', reason: 'looks good' },
    })
    expect(res.status).toBe(200)
    expect((await getSpecRow()).state).toBe('Approved')
  })

  it('rejects whitespace-only reason with 422', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'InReview', reason: '   ' },
    })
    expect(res.status).toBe(422)
  })

  it('rejects same-state transition with 422', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'Draft', reason: 'no change' },
    })
    expect(res.status).toBe(422)
  })

  it('returns 404 when spec does not exist', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'PATCH', '/api/v2/specifications/nonexistent-spec-id/state', {
      json: { newState: 'InReview', reason: 'ready' },
    })
    expect(res.status).toBe(404)
  })

  it('returns 401 without session', async () => {
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'InReview', reason: 'ready' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 404 for a non-member of the owning team', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'InReview', reason: 'ready' },
    })
    expect(res.status).toBe(404)
  })

  it('returns 403 forbidden when the member lacks the edge right (Draft → Approved without approve)', async () => {
    mockSessionAs(await seedAuthorOnlyUser())
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'Approved', reason: 'ship it' },
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('forbidden')
  })

  it('returns 409 illegal_transition on an illegal edge even with every right (Draft → Effective)', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'Effective', reason: 'skip the line', effectiveFrom: Date.now() },
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('illegal_transition')
  })
})

describe('PATCH /state — effectiveFrom (A1: server-local day, reject past)', () => {
  it('Approved → Effective without effectiveFrom → 422', async () => {
    await setSpecState('Approved')
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'Effective', reason: 'go live' },
    })
    expect(res.status).toBe(422)
  })

  it('Approved → Effective with a past date → 422', async () => {
    await setSpecState('Approved')
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'Effective', reason: 'go live', effectiveFrom: Date.now() - 24 * 60 * 60 * 1000 },
    })
    expect(res.status).toBe(422)
  })

  it('Approved → Effective today sets state, column, and history effectiveFrom', async () => {
    await setSpecState('Approved')
    mockSessionAs(f.userIdGlobal)
    const when = Date.now() // "today" = immediately in force
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'Effective', reason: 'go live', effectiveFrom: when },
    })
    expect(res.status).toBe(200)
    const row = await getSpecRow()
    expect(row.state).toBe('Effective')
    expect(row.effectiveFrom).toBe(when)
    expect(await lastHistoryEntry()).toMatchObject({ type: 'state_change', toState: 'Effective', effectiveFrom: when })
  })

  it('future-dated Effective is accepted (scheduling)', async () => {
    await setSpecState('Approved')
    mockSessionAs(f.userIdGlobal)
    const when = Date.now() + 7 * 24 * 60 * 60 * 1000
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'Effective', reason: 'scheduled', effectiveFrom: when },
    })
    expect(res.status).toBe(200)
    expect((await getSpecRow()).effectiveFrom).toBe(when)
  })

  it('rejects effectiveFrom on a non-Effective transition with 422', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'InTest', reason: 'testing', effectiveFrom: Date.now() },
    })
    expect(res.status).toBe(422)
    expect((await getSpecRow()).state).toBe('Draft')
  })
})

describe('PATCH /state — admin override', () => {
  it('admin may force an illegal edge and the history entry is flagged', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'Obsolete', reason: 'retire immediately' }, // Draft → Obsolete is illegal
    })
    expect(res.status).toBe(200)
    expect((await getSpecRow()).state).toBe('Obsolete')
    expect(await lastHistoryEntry()).toMatchObject({ type: 'state_change', toState: 'Obsolete', adminOverride: true })
  })

  it('admin on a LEGAL edge is not flagged', async () => {
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'InTest', reason: 'normal move' },
    })
    expect(res.status).toBe(200)
    expect('adminOverride' in (await lastHistoryEntry())).toBe(false)
  })

  it('admin must still supply effectiveFrom to reach Effective', async () => {
    await setSpecState('Approved')
    mockSessionAs(await seedAdminUser(f))
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'Effective', reason: 'force' },
    })
    expect(res.status).toBe(422)
  })
})

describe('lazy supersede sweep on version-display GETs', () => {
  it('GET /libraries/:id/specifications flips an out-of-force Effective version first', async () => {
    const NOW = Date.now()
    await rawQuery(`UPDATE specification SET state = 'Effective', "effectiveFrom" = $1 WHERE id = $2`, [
      NOW - 10_000,
      f.rootSpecId,
    ])
    await rawQuery(
      `INSERT INTO specification (id, "libraryId", name, version, state, data, "rootSpecificationId",
         "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt", "effectiveFrom", history)
       VALUES ('spec-shared-root-v2', $1, 'Shared Root', '2.0.0', 'Effective', '{"nodes":[]}',
               'spec-shared-root-v2', NULL, 3, $2, $3, $4, '[]')`,
      [f.libSharedId, NOW, NOW, NOW - 1_000],
    )
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'GET', `/api/v2/libraries/${f.libSharedId}/specifications`, {})
    expect(res.status).toBe(200)
    expect((await getSpecRow()).state).toBe('Superseded')
  })

  it('GET /libraries/:id/specifications/tree also triggers the sweep', async () => {
    const NOW = Date.now()
    await rawQuery(`UPDATE specification SET state = 'Effective', "effectiveFrom" = $1 WHERE id = $2`, [
      NOW - 10_000,
      f.rootSpecId,
    ])
    await rawQuery(
      `INSERT INTO specification (id, "libraryId", name, version, state, data, "rootSpecificationId",
         "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt", "effectiveFrom", history)
       VALUES ('spec-shared-root-v3', $1, 'Shared Root', '3.0.0', 'Effective', '{"nodes":[]}',
               'spec-shared-root-v3', NULL, 3, $2, $3, $4, '[]')`,
      [f.libSharedId, NOW, NOW, NOW - 1_000],
    )
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'GET', `/api/v2/libraries/${f.libSharedId}/specifications/tree`, {})
    expect(res.status).toBe(200)
    expect((await getSpecRow()).state).toBe('Superseded')
  })
})

describe('effectiveFrom is exposed on SpecFull reads', () => {
  async function makeEffective(): Promise<number> {
    await setSpecState('Approved')
    mockSessionAs(f.userIdGlobal)
    const when = Date.now() + 24 * 60 * 60 * 1000
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/state`, {
      json: { newState: 'Effective', reason: 'go', effectiveFrom: when },
    })
    expect(res.status).toBe(200)
    return when
  }

  it('GET /specifications/:id returns effectiveFrom', async () => {
    const when = await makeEffective()
    const res = await v2Req(f, 'GET', `/api/v2/specifications/${f.rootSpecId}`, {})
    expect(((await res.json()) as { spec: { effectiveFrom: number | null } }).spec.effectiveFrom).toBe(when)
  })

  it('GET /specifications/:rootId/tree returns effectiveFrom on specs', async () => {
    const when = await makeEffective()
    const res = await v2Req(f, 'GET', `/api/v2/specifications/${f.rootSpecId}/tree`, {})
    const body = (await res.json()) as { specs: Array<{ id: string; effectiveFrom: number | null }> }
    expect(body.specs.find((s) => s.id === f.rootSpecId)?.effectiveFrom).toBe(when)
  })

  it('bulk-fetch returns effectiveFrom (null when unset)', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/bulk-fetch', {
      json: { specIds: [f.rootSpecId] },
    })
    const body = (await res.json()) as { specs: Array<{ effectiveFrom: number | null }> }
    expect(body.specs[0].effectiveFrom).toBeNull()
  })
})
