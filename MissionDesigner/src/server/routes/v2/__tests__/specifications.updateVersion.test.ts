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

// PATCH /api/v2/specifications/:id/version — the in-place "Bump Version" route.
// Regression pin for the user-testing bug: the VersionBadge bump used to live only
// in client memory (batch-save deliberately ignores `version` on update), so the
// DB row — and every server-side export reading it — kept the ORIGINAL version.

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

async function specVersionInDb(id: string): Promise<string | undefined> {
  const rows = await rawQuery<{ version: string }>('SELECT version FROM specification WHERE id = $1', [id])
  return rows[0]?.version
}

describe('PATCH /api/v2/specifications/:id/version', () => {
  it('persists the bump to the row — the value exports read', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/version`, {
      json: { version: '2.0.0' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { spec: { version: string } }
    expect(body.spec.version).toBe('2.0.0')
    expect(await specVersionInDb(f.rootSpecId)).toBe('2.0.0')
  })

  it('422 schema_mismatch on invalid semver and on an unknown body field', async () => {
    mockSessionAs(f.userIdGlobal)
    const bad = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/version`, {
      json: { version: 'two-point-oh' },
    })
    expect(bad.status).toBe(422)
    expect(((await bad.json()) as { code: string }).code).toBe('schema_mismatch')

    const extra = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/version`, {
      json: { version: '2.0.0', reason: 'strict object rejects me' },
    })
    expect(extra.status).toBe(422)
    expect(await specVersionInDb(f.rootSpecId)).toBe('1.0.0')
  })

  it('422 when the version is unchanged', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/version`, {
      json: { version: '1.0.0' },
    })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string; reason?: string }).reason).toBe('same_as_current')
  })

  it('409 conflict when a root sibling already holds (library, name, target version)', async () => {
    mockSessionAs(f.userIdGlobal)
    const nowVal = Date.now()
    await rawQuery(
      `INSERT INTO specification (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId",
       "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('sibling-3', $1, 'Shared Root', '3.0.0', 'Draft', '{"nodes":[]}', 'sibling-3', NULL, 3, $2, $3)`,
      [f.libSharedId, nowVal, nowVal],
    )
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/version`, {
      json: { version: '3.0.0' },
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('conflict')
    expect(await specVersionInDb(f.rootSpecId)).toBe('1.0.0')
  })

  it('409 edit_locked on a published spec — in-place bump is an edit, not a create', async () => {
    await rawQuery(`UPDATE specification SET state = 'Approved' WHERE id = $1`, [f.rootSpecId])
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/version`, {
      json: { version: '2.0.0' },
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('edit_locked')
    expect(await specVersionInDb(f.rootSpecId)).toBe('1.0.0')
  })

  it('404 for a non-member (visibility conflation) and for an unknown id', async () => {
    mockSessionAs(f.userIdOther)
    const invisible = await v2Req(f, 'PATCH', `/api/v2/specifications/${f.rootSpecId}/version`, {
      json: { version: '2.0.0' },
    })
    expect(invisible.status).toBe(404)

    mockSessionAs(f.userIdGlobal)
    const missing = await v2Req(f, 'PATCH', '/api/v2/specifications/no-such-spec/version', {
      json: { version: '2.0.0' },
    })
    expect(missing.status).toBe(404)
  })
})
