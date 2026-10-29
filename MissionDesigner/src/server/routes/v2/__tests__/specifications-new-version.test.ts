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

async function countSpecRows(): Promise<number> {
  const rows = await rawQuery<{ c: unknown }>('SELECT count(*) c FROM specification')
  return Number(rows[0]?.c ?? 0)
}

describe('POST /api/v2/specifications/:id/new-version', () => {
  it('creates a deep copy as Draft, source unchanged', async () => {
    // Insert a child spec under the shared root so we have a 2-spec subtree.
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO specification
         (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId",
          "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Shared Child', '1.0.0', 'Draft', '{"nodes":[]}', $3, $4, 3, $5, $6)`,
      ['spec-shared-child', f.libSharedId, f.rootSpecId, f.rootSpecId, NOW, NOW],
    )

    // Ensure source has a non-Draft state so we can assert source unchanged.
    await rawQuery(`UPDATE specification SET state = 'Effective' WHERE id = $1`, [f.rootSpecId])

    mockSessionAs(f.userIdGlobal)

    const before = await countSpecRows()
    const res = await v2Req(f, 'POST', `/api/v2/specifications/${f.rootSpecId}/new-version`, {
      json: { version: '1.1.0' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      newSpec: {
        id: string
        version: string
        state: string
        libraryId: string
        history: Array<{ type: string; fromVersion: string; fromSpecId: string }>
      }
    }

    // Row count increased by 2 (root + child cloned).
    expect(await countSpecRows()).toBe(before + 2)

    expect(body.newSpec.version).toBe('1.1.0')
    expect(body.newSpec.state).toBe('Draft')
    expect(body.newSpec.libraryId).toBe(f.libSharedId)
    expect(body.newSpec.id).not.toBe(f.rootSpecId)
    expect(body.newSpec.history).toHaveLength(1)
    expect(body.newSpec.history[0].type).toBe('new_version')
    expect(body.newSpec.history[0].fromVersion).toBe('1.0.0')
    expect(body.newSpec.history[0].fromSpecId).toBe(f.rootSpecId)

    // Verify cloned child row exists with re-parented ids.
    const childRows = await rawQuery<{ parentSpecificationId: string }>(
      `SELECT "parentSpecificationId" FROM specification WHERE "rootSpecificationId" = $1 AND id <> $2`,
      [body.newSpec.id, body.newSpec.id],
    )
    expect(childRows).toHaveLength(1)
    expect(childRows[0].parentSpecificationId).toBe(body.newSpec.id)

    // Source spec is genuinely unchanged.
    const srcRes = await v2Req(f, 'GET', `/api/v2/specifications/${f.rootSpecId}`, {})
    const srcBody = (await srcRes.json()) as { spec: { state: string; version: string; history: unknown[] } }
    expect(srcBody.spec.state).toBe('Effective')
    expect(srcBody.spec.version).toBe('1.0.0')
    expect(srcBody.spec.history).toEqual([])
  })

  it('rejects invalid semver with 422', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', `/api/v2/specifications/${f.rootSpecId}/new-version`, {
      json: { version: 'not-a-version' },
    })
    expect(res.status).toBe(422)
  })

  it('rejects version with leading zeros (e.g. 01.0.0) as invalid semver with 422', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', `/api/v2/specifications/${f.rootSpecId}/new-version`, {
      json: { version: '01.0.0' },
    })
    expect(res.status).toBe(422)
  })

  it('rejects same version as source with 422', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', `/api/v2/specifications/${f.rootSpecId}/new-version`, {
      json: { version: '1.0.0' },
    })
    expect(res.status).toBe(422)
  })

  it('rejects collision with sibling at same name + version with 409', async () => {
    // Insert a sibling root spec at version '1.1.0' with same name.
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO specification
         (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId",
          "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Shared Root', '1.1.0', 'Draft', '{"nodes":[]}', 'spec-sibling', NULL, 3, $3, $4)`,
      ['spec-sibling', f.libSharedId, NOW, NOW],
    )

    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', `/api/v2/specifications/${f.rootSpecId}/new-version`, {
      json: { version: '1.1.0' },
    })
    expect(res.status).toBe(409)
  })

  it('returns 404 for missing source spec', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/nonexistent-spec-id/new-version', {
      json: { version: '1.0.1' },
    })
    expect(res.status).toBe(404)
  })

  it('returns 401 without session', async () => {
    const res = await v2Req(f, 'POST', `/api/v2/specifications/${f.rootSpecId}/new-version`, {
      json: { version: '2.0.0' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 404 when user cannot write the spec library', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'POST', `/api/v2/specifications/${f.rootSpecId}/new-version`, {
      json: { version: '2.0.0' },
    })
    expect(res.status).toBe(404)
  })

  it('clones a depth-2 tree correctly (root → child → grandchild)', async () => {
    const NOW = Date.now()
    // Insert child under root.
    await rawQuery(
      `INSERT INTO specification
         (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId",
          "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Child', '1.0.0', 'Draft', '{"nodes":[]}', $3, $4, 3, $5, $6)`,
      ['spec-depth2-child', f.libSharedId, f.rootSpecId, f.rootSpecId, NOW, NOW],
    )
    // Insert grandchild under child.
    await rawQuery(
      `INSERT INTO specification
         (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId",
          "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Grandchild', '1.0.0', 'Draft', '{"nodes":[]}', $3, 'spec-depth2-child', 3, $4, $5)`,
      ['spec-depth2-grandchild', f.libSharedId, f.rootSpecId, NOW, NOW],
    )

    mockSessionAs(f.userIdGlobal)

    const before = await countSpecRows()
    const res = await v2Req(f, 'POST', `/api/v2/specifications/${f.rootSpecId}/new-version`, {
      json: { version: '2.0.0' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { newSpec: { id: string } }

    // Root + child + grandchild all cloned.
    expect(await countSpecRows()).toBe(before + 3)

    // New child exists and is parented to new root.
    const newChildren = await rawQuery<{ id: string }>(
      `SELECT id FROM specification WHERE "parentSpecificationId" = $1`,
      [body.newSpec.id],
    )
    expect(newChildren).toHaveLength(1)

    // New grandchild exists and is parented to new child.
    const newGrandchildren = await rawQuery<{ id: string }>(
      `SELECT id FROM specification WHERE "parentSpecificationId" = $1`,
      [newChildren[0].id],
    )
    expect(newGrandchildren).toHaveLength(1)
  })

  it('403 for a member without the create right', async () => {
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO "user" (id, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ('test-viewer', 'viewer@example.com', false, $1, $2)`,
      [new Date(NOW), new Date(NOW)],
    )
    await rawQuery(`INSERT INTO user_team ("userId", "teamId") VALUES ('test-viewer', $1)`, [f.teamMainId])
    mockSessionAs('test-viewer')
    const res = await v2Req(f, 'POST', `/api/v2/specifications/${f.rootSpecId}/new-version`, {
      json: { version: '2.0.0' },
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('forbidden')
  })

  it('succeeds on an Effective (edit-locked) source — new-version is a create, not an edit', async () => {
    await rawQuery(`UPDATE specification SET state = 'Effective' WHERE id = $1`, [f.rootSpecId])
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', `/api/v2/specifications/${f.rootSpecId}/new-version`, {
      json: { version: '3.0.0' },
    })
    expect(res.status).toBe(200)
  })
})
