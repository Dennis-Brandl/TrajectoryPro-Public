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

describe('GET /api/v2/specifications/:rootId/tree', () => {
  it('401 without session', async () => {
    const res = await v2Req(f, 'GET', `/api/v2/specifications/${f.rootSpecId}/tree`)
    expect(res.status).toBe(401)
  })

  it('returns full tree for owner', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'GET', `/api/v2/specifications/${f.rootSpecId}/tree`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      library: { id: string }
      specs: Array<{ id: string }>
      proxyRefs: unknown[]
      specEnvs: unknown[]
      imageManifest: Record<string, unknown>
    }
    expect(body.library.id).toBe(f.libSharedId)
    expect(body.specs.map((s) => s.id)).toEqual([f.rootSpecId])
  })

  it('404 for invisible root', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'GET', `/api/v2/specifications/${f.privateRootSpecId}/tree`)
    expect(res.status).toBe(404)
  })

  it('resolves to the containing tree when called with a child spec id', async () => {
    mockSessionAs(f.userIdGlobal)
    // Insert a child of f.rootSpecId
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO specification (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId",
       "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('child-1', $1, 'Child', '1.0.0','Draft','{"nodes":[]}', $2, $3, 3, $4, $5)`,
      [f.libSharedId, f.rootSpecId, f.rootSpecId, NOW, NOW],
    )
    const res = await v2Req(f, 'GET', '/api/v2/specifications/child-1/tree')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { specs: Array<{ id: string }> }
    const ids = new Set(body.specs.map((s) => s.id))
    expect(ids.has(f.rootSpecId)).toBe(true)
    expect(ids.has('child-1')).toBe(true)
  })
})

describe('GET /api/v2/specifications/:id', () => {
  it('returns the spec with data for owner', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'GET', `/api/v2/specifications/${f.rootSpecId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { spec: { id: string; data: string } }
    expect(body.spec.id).toBe(f.rootSpecId)
    expect(body.spec.data).toBe('{"nodes":[]}')
  })

  it('404 for invisible spec', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'GET', `/api/v2/specifications/${f.privateRootSpecId}`)
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v2/specifications/bulk-fetch', () => {
  it('returns specs[] + missingIds[] (missingIds[] mixes unreadable + not-found)', async () => {
    // Team-model intent: a member of teamMain reads the visible shared root, while
    // an UNREADABLE spec (one in a team the member does not belong to) and a
    // not-found id both land in missingIds. Seed a foreign team + library + root
    // spec that f.userIdGlobal cannot see, to stand in for the old private root.
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO team (id, name, description, "createdAt", "updatedAt") VALUES ('team-foreign', 'Foreign Team', 'fixture', $1, $2) ON CONFLICT DO NOTHING`,
      [NOW, NOW],
    )
    await rawQuery(
      `INSERT INTO library (id, "createdByUserId", "teamId", name, "entityType", version, "createdAt", "updatedAt")
       VALUES ('lib-foreign', $1, 'team-foreign', 'Foreign Lib', 'workflow', '1.0.0', $2, $3)`,
      [f.userIdOther, NOW, NOW],
    )
    await rawQuery(
      `INSERT INTO specification (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId",
       "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('spec-foreign-root', 'lib-foreign', 'Foreign Root', '1.0.0','Draft','{"nodes":[]}', 'spec-foreign-root', NULL, 3, $1, $2)`,
      [NOW, NOW],
    )

    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/bulk-fetch', {
      json: { specIds: [f.rootSpecId, 'spec-foreign-root', 'missing-id'] },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      specs: Array<{ id: string }>
      missingIds: string[]
    }
    expect(body.specs.map((s) => s.id)).toEqual([f.rootSpecId]) // shared root is visible to the member
    // 'spec-foreign-root' is a real spec but unreadable (foreign team); 'missing-id'
    // does not exist. Both must appear in missingIds — the unreadable→missing intent.
    expect(body.missingIds.sort()).toEqual(['missing-id', 'spec-foreign-root'].sort())
  })

  it('413 when ids exceed MAX_BULK_FETCH_IDS', async () => {
    mockSessionAs(f.userIdGlobal)
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/bulk-fetch', { json: { specIds: ids } })
    expect(res.status).toBe(413)
  })

  it('422 for missing specIds field', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/bulk-fetch', { json: {} })
    expect(res.status).toBe(422)
  })
})
