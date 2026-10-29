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

async function insertChildSpec(
  f: TestFixture,
  id: string,
  parent: string,
  root: string,
  name: string,
  libId = f.libSharedId,
) {
  const NOW = Date.now()
  await rawQuery(
    `INSERT INTO "specification"
     ("id","libraryId","name","version","state","data","rootSpecificationId","parentSpecificationId",
      "dataSchemaVersion","createdAt","updatedAt")
     VALUES ($1,$2,$3,'1.0.0','Draft','{"nodes":[]}',$4,$5,3,$6,$7)`,
    [id, libId, name, root, parent, NOW, NOW],
  )
}

describe('GET /api/v2/libraries/:id/specifications/tree', () => {
  it('401 without session', async () => {
    const res = await v2Req(f, 'GET', `/api/v2/libraries/${f.libSharedId}/specifications/tree`)
    expect(res.status).toBe(401)
  })

  it('404 when library is not visible to caller', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'GET', `/api/v2/libraries/${f.libPrivateId}/specifications/tree`)
    expect(res.status).toBe(404)
  })

  it('returns a nested tree for a visible library', async () => {
    await insertChildSpec(f, 'child-1', f.rootSpecId, f.rootSpecId, 'Child 1')
    await insertChildSpec(f, 'grand-1', 'child-1', f.rootSpecId, 'Grand 1')
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'GET', `/api/v2/libraries/${f.libSharedId}/specifications/tree`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      roots: Array<{ id: string; children: Array<{ id: string; children: Array<{ id: string }> }> }>
    }
    const root = body.roots.find((r) => r.id === f.rootSpecId)!
    expect(root.children).toHaveLength(1)
    expect(root.children[0].id).toBe('child-1')
    expect(root.children[0].children[0].id).toBe('grand-1')
  })

  it('does not include the `data` column in any node', async () => {
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'GET', `/api/v2/libraries/${f.libSharedId}/specifications/tree`)
    const body = (await res.json()) as { roots: Array<Record<string, unknown>> }
    for (const r of body.roots) expect(r.data).toBeUndefined()
  })
})
