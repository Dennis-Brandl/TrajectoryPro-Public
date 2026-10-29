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
import { setupTestFixture, resetAndSeedFixture, mockSessionAs, v2Req, type TestFixture } from './testSeed'

let f: TestFixture

beforeAll(async () => {
  f = await setupTestFixture()
})

beforeEach(async () => {
  await resetAndSeedFixture(f)
  mockSessionAs(null)
})

describe('GET /api/v2/libraries', () => {
  it('401 without session', async () => {
    const res = await v2Req(f, 'GET', '/api/v2/libraries')
    expect(res.status).toBe(401)
  })

  it('returns owned + shared libraries', async () => {
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'GET', '/api/v2/libraries')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { libraries: Array<{ id: string }> }
    const ids = body.libraries.map((l) => l.id).sort()
    expect(ids).toEqual([f.libEnvSharedId, f.libPrivateId, f.libSharedId].sort())
  })

  it('filters by entityType', async () => {
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'GET', '/api/v2/libraries?entityType=environment')
    const body = (await res.json()) as { libraries: Array<{ id: string }> }
    expect(body.libraries.map((l) => l.id)).toEqual([f.libEnvSharedId])
  })

  it('does not leak private libraries of other users', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'GET', '/api/v2/libraries')
    const body = (await res.json()) as { libraries: Array<{ id: string }> }
    // userIdOther should see: only shared libs (libShared, libEnvShared)
    expect(body.libraries.map((l) => l.id)).not.toContain(f.libPrivateId)
  })
})

describe('GET /api/v2/libraries/:id/specifications', () => {
  it('returns root specs metadata-only for visible library', async () => {
    mockSessionAs(f.userIdRegular)
    const res = await v2Req(f, 'GET', `/api/v2/libraries/${f.libSharedId}/specifications`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { specs: Array<{ id: string; data?: string }> }
    expect(body.specs).toHaveLength(1)
    expect(body.specs[0].id).toBe(f.rootSpecId)
    // data column MUST NOT be returned
    expect(body.specs[0].data).toBeUndefined()
  })

  it('404 for invisible library (conflation)', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'GET', `/api/v2/libraries/${f.libPrivateId}/specifications`)
    expect(res.status).toBe(404)
  })
})
