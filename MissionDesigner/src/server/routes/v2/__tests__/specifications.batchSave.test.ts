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

const EMPTY = { specs: [], proxyRefs: [], specEnvs: [], imageDeletes: [], imageRefs: [] }

describe('POST /api/v2/specifications/batch-save — happy path', () => {
  it('200 with empty payload', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', { json: EMPTY })
    expect(res.status).toBe(200)
  })

  it('creates a new root spec', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        ...EMPTY,
        specs: [
          {
            op: 'create',
            id: 'new-root',
            rootSpecificationId: 'new-root',
            libraryId: f.libSharedId,
            name: 'Brand New',
            data: '{"nodes":[]}',
            dataSchemaVersion: 3,
            version: '1.0.0',
            state: 'Draft',
          },
        ],
      },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { specs: Array<{ id: string }> }
    expect(body.specs[0].id).toBe('new-root')
  })

  it('updates an existing spec', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        ...EMPTY,
        specs: [{ op: 'update', id: f.rootSpecId, name: 'Renamed Root' }],
      },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { specs: Array<{ id: string }> }
    expect(body.specs[0].id).toBe(f.rootSpecId)
  })
})

describe('POST /api/v2/specifications/batch-save — error paths', () => {
  it('422 unknown_field on top-level extra key', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: { ...EMPTY, surprise: 1 },
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('unknown_field')
  })

  it('422 data_blob_invalid when nodes field is present but not an array', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        ...EMPTY,
        specs: [
          {
            op: 'create',
            id: 'x',
            rootSpecificationId: 'x',
            libraryId: f.libSharedId,
            name: 'X',
            data: '{"nodes":"oops"}',
            dataSchemaVersion: 3,
            version: '1.0.0',
            state: 'Draft',
          },
        ],
      },
    })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('data_blob_invalid')
  })

  it('422 cycle_detected', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        ...EMPTY,
        specs: [
          {
            op: 'create',
            id: 'a',
            parentSpecificationId: 'b',
            rootSpecificationId: f.rootSpecId,
            name: 'A',
            data: '{"nodes":[]}',
            dataSchemaVersion: 3,
          },
          {
            op: 'create',
            id: 'b',
            parentSpecificationId: 'a',
            rootSpecificationId: f.rootSpecId,
            name: 'B',
            data: '{"nodes":[]}',
            dataSchemaVersion: 3,
          },
        ],
      },
    })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('cycle_detected')
  })

  it('422 image_ref_unpaired', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: { ...EMPTY, imageRefs: [{ op: 'create', specificationId: f.rootSpecId, imageId: 'img1' }] },
    })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('image_ref_unpaired')
  })

  it('404 conflation on unwritable library', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        ...EMPTY,
        specs: [
          {
            op: 'create',
            id: 'x',
            rootSpecificationId: 'x',
            libraryId: f.libPrivateId,
            name: 'X',
            data: '{"nodes":[]}',
            dataSchemaVersion: 3,
            version: '1.0.0',
            state: 'Draft',
          },
        ],
      },
    })
    expect(res.status).toBe(404)
  })

  it('413 payload_too_large when specs exceed MAX_SPECS_PER_BATCH', async () => {
    mockSessionAs(f.userIdGlobal)
    const specs = Array.from({ length: 501 }, (_, i) => ({ op: 'update' as const, id: `s${i}` }))
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', { json: { ...EMPTY, specs } })
    expect(res.status).toBe(413)
  })
})

describe('POST /api/v2/specifications/batch-save — Phase 3 gating', () => {
  it('update on an edit-locked spec → 409 edit_locked', async () => {
    await rawQuery(`UPDATE specification SET state = 'Approved' WHERE id = $1`, [f.rootSpecId])
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [{ op: 'update', id: f.rootSpecId, name: 'sneaky rename' }],
        proxyRefs: [],
        specEnvs: [],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('edit_locked')
  })

  it('delete on an Effective spec → 409; delete on an Obsolete spec succeeds', async () => {
    mockSessionAs(f.userIdGlobal)
    await rawQuery(`UPDATE specification SET state = 'Effective' WHERE id = $1`, [f.rootSpecId])
    const blocked = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [{ op: 'delete', id: f.rootSpecId }],
        proxyRefs: [],
        specEnvs: [],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(blocked.status).toBe(409)

    await rawQuery(`UPDATE specification SET state = 'Obsolete' WHERE id = $1`, [f.rootSpecId])
    const ok = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [{ op: 'delete', id: f.rootSpecId }],
        proxyRefs: [],
        specEnvs: [],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(ok.status).toBe(200)
    const checkRows = await rawQuery<{ id: string }>('SELECT id FROM specification WHERE id = $1', [f.rootSpecId])
    expect(checkRows[0]).toBeUndefined()
  })

  it('root create ignores client state — always born Draft (bypass closed)', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [
          {
            op: 'create',
            id: 'spec-bypass-create',
            parentSpecificationId: null,
            rootSpecificationId: 'spec-bypass-create',
            libraryId: f.libSharedId,
            name: 'Bypass Create',
            data: '{"nodes":[]}',
            dataSchemaVersion: 3,
            state: 'Effective',
          },
        ],
        proxyRefs: [],
        specEnvs: [],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(res.status).toBe(200)
    const rows = await rawQuery<{ state: string }>('SELECT state FROM specification WHERE id = $1', [
      'spec-bypass-create',
    ])
    expect(rows[0]?.state).toBe('Draft')
  })

  it('update ignores client state and version (bypass closed)', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [{ op: 'update', id: f.rootSpecId, name: 'Renamed', state: 'Approved', version: '9.9.9' }],
        proxyRefs: [],
        specEnvs: [],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(res.status).toBe(200)
    const rows = await rawQuery<{ name: string; state: string; version: string }>(
      'SELECT name, state, version FROM specification WHERE id = $1',
      [f.rootSpecId],
    )
    const row = rows[0]!
    expect(row.name).toBe('Renamed')
    expect(row.state).toBe('Draft')
    expect(row.version).toBe('1.0.0')
  })

  it('create needs the create right — edit-only member gets 403', async () => {
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO role (id, name, "isSeeded") VALUES ('r-editonly', 'Edit Only', 0) ON CONFLICT DO NOTHING`,
    )
    await rawQuery(
      `INSERT INTO role_right ("roleId", "right") VALUES ('r-editonly', 'workflow:edit') ON CONFLICT DO NOTHING`,
    )
    await rawQuery(
      `INSERT INTO "user" (id, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ('test-editonly', 'editonly@example.com', false, $1, $2)`,
      [new Date(NOW), new Date(NOW)],
    )
    await rawQuery(`INSERT INTO user_team ("userId", "teamId") VALUES ('test-editonly', $1)`, [f.teamMainId])
    await rawQuery(
      `INSERT INTO user_team_role ("userId", "teamId", "roleId") VALUES ('test-editonly', $1, 'r-editonly')`,
      [f.teamMainId],
    )
    mockSessionAs('test-editonly')
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [
          {
            op: 'create',
            id: 'spec-needs-create',
            parentSpecificationId: null,
            rootSpecificationId: 'spec-needs-create',
            libraryId: f.libSharedId,
            name: 'Needs Create',
            data: '{"nodes":[]}',
            dataSchemaVersion: 3,
          },
        ],
        proxyRefs: [],
        specEnvs: [],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('forbidden')
  })

  it('child create under an edit-locked root → 409', async () => {
    await rawQuery(`UPDATE specification SET state = 'Approved' WHERE id = $1`, [f.rootSpecId])
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [
          {
            op: 'create',
            id: 'spec-locked-child',
            parentSpecificationId: f.rootSpecId,
            rootSpecificationId: f.rootSpecId,
            name: 'Locked Child',
            data: '{"nodes":[]}',
            dataSchemaVersion: 3,
          },
        ],
        proxyRefs: [],
        specEnvs: [],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('edit_locked')
  })

  it('proxyRef on an edit-locked parent → 409', async () => {
    await rawQuery(`UPDATE specification SET state = 'Approved' WHERE id = $1`, [f.rootSpecId])
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [],
        proxyRefs: [
          { op: 'create', parentSpecificationId: f.rootSpecId, nodeId: 'n1', targetSpecificationId: f.rootSpecId },
        ],
        specEnvs: [],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('edit_locked')
  })

  it('proxyRef on a same-batch created spec requires the edit right', async () => {
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO role (id, name, "isSeeded") VALUES ('r-createonly', 'Create Only', 0) ON CONFLICT DO NOTHING`,
    )
    await rawQuery(
      `INSERT INTO role_right ("roleId", "right") VALUES ('r-createonly', 'workflow:create') ON CONFLICT DO NOTHING`,
    )
    await rawQuery(
      `INSERT INTO "user" (id, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ('test-createonly', 'createonly@example.com', false, $1, $2)`,
      [new Date(NOW), new Date(NOW)],
    )
    await rawQuery(`INSERT INTO user_team ("userId", "teamId") VALUES ('test-createonly', $1)`, [f.teamMainId])
    await rawQuery(
      `INSERT INTO user_team_role ("userId", "teamId", "roleId") VALUES ('test-createonly', $1, 'r-createonly')`,
      [f.teamMainId],
    )
    mockSessionAs('test-createonly')
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [
          {
            op: 'create',
            id: 'spec-proxy-host',
            parentSpecificationId: null,
            rootSpecificationId: 'spec-proxy-host',
            libraryId: f.libSharedId,
            name: 'Proxy Host',
            data: '{"nodes":[]}',
            dataSchemaVersion: 3,
          },
        ],
        proxyRefs: [
          {
            op: 'create',
            parentSpecificationId: 'spec-proxy-host',
            nodeId: 'n1',
            targetSpecificationId: 'spec-proxy-host',
          },
        ],
        specEnvs: [],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('forbidden')
    const checkRows = await rawQuery<{ id: string }>('SELECT id FROM specification WHERE id = $1', ['spec-proxy-host'])
    expect(checkRows[0]).toBeUndefined()
  })

  it('proxyRef on a same-batch created spec succeeds with author rights', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [
          {
            op: 'create',
            id: 'spec-proxy-host-ok',
            parentSpecificationId: null,
            rootSpecificationId: 'spec-proxy-host-ok',
            libraryId: f.libSharedId,
            name: 'Proxy Host OK',
            data: '{"nodes":[]}',
            dataSchemaVersion: 3,
          },
        ],
        proxyRefs: [
          {
            op: 'create',
            parentSpecificationId: 'spec-proxy-host-ok',
            nodeId: 'n1',
            targetSpecificationId: 'spec-proxy-host-ok',
          },
        ],
        specEnvs: [],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(res.status).toBe(200)
    const proxyRows = await rawQuery<{ nodeId: string }>(
      `SELECT "nodeId" FROM proxy_reference WHERE "parentSpecificationId" = $1`,
      ['spec-proxy-host-ok'],
    )
    expect(proxyRows[0]).toBeTruthy()
  })

  it('specEnv binding on an edit-locked spec → 409 edit_locked', async () => {
    await rawQuery(`UPDATE specification SET state = 'Approved' WHERE id = $1`, [f.rootSpecId])
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [],
        proxyRefs: [],
        specEnvs: [{ op: 'create', specificationId: f.rootSpecId, environmentLibraryId: f.libEnvSharedId }],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('edit_locked')
  })

  it('specEnv unbind on an edit-locked spec → 409', async () => {
    await rawQuery(
      `INSERT INTO specification_environment ("specificationId", "environmentLibraryId") VALUES ($1, $2)`,
      [f.rootSpecId, f.libEnvSharedId],
    )
    await rawQuery(`UPDATE specification SET state = 'Effective' WHERE id = $1`, [f.rootSpecId])
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [],
        proxyRefs: [],
        specEnvs: [{ op: 'delete', specificationId: f.rootSpecId, environmentLibraryId: f.libEnvSharedId }],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(res.status).toBe(409)
  })

  it('specEnv binding requires the edit right (create-only member → 403)', async () => {
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO role (id, name, "isSeeded") VALUES ('r-createonly', 'Create Only', 0) ON CONFLICT DO NOTHING`,
    )
    await rawQuery(
      `INSERT INTO role_right ("roleId", "right") VALUES ('r-createonly', 'workflow:create') ON CONFLICT DO NOTHING`,
    )
    await rawQuery(
      `INSERT INTO "user" (id, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ('test-createonly-env', 'createonly-env@example.com', false, $1, $2) ON CONFLICT DO NOTHING`,
      [new Date(NOW), new Date(NOW)],
    )
    await rawQuery(
      `INSERT INTO user_team ("userId", "teamId") VALUES ('test-createonly-env', $1) ON CONFLICT DO NOTHING`,
      [f.teamMainId],
    )
    await rawQuery(
      `INSERT INTO user_team_role ("userId", "teamId", "roleId") VALUES ('test-createonly-env', $1, 'r-createonly') ON CONFLICT DO NOTHING`,
      [f.teamMainId],
    )
    mockSessionAs('test-createonly-env')
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [],
        proxyRefs: [],
        specEnvs: [{ op: 'create', specificationId: f.rootSpecId, environmentLibraryId: f.libEnvSharedId }],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('forbidden')
  })

  it('specEnv bind + unbind round-trip on a Draft spec succeeds', async () => {
    mockSessionAs(f.userIdGlobal)
    const bind = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [],
        proxyRefs: [],
        specEnvs: [{ op: 'create', specificationId: f.rootSpecId, environmentLibraryId: f.libEnvSharedId }],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(bind.status).toBe(200)
    const bindRows = await rawQuery(`SELECT 1 FROM specification_environment WHERE "specificationId" = $1`, [
      f.rootSpecId,
    ])
    expect(bindRows[0]).toBeTruthy()

    const unbind = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        specs: [],
        proxyRefs: [],
        specEnvs: [{ op: 'delete', specificationId: f.rootSpecId, environmentLibraryId: f.libEnvSharedId }],
        imageDeletes: [],
        imageRefs: [],
      },
    })
    expect(unbind.status).toBe(200)
    const unbindRows = await rawQuery(`SELECT 1 FROM specification_environment WHERE "specificationId" = $1`, [
      f.rootSpecId,
    ])
    expect(unbindRows[0]).toBeUndefined()
  })
})

describe('POST /api/v2/specifications/batch-save — trigger integration', () => {
  it('422 cross_tree_proxy when proxyRef crosses trees', async () => {
    mockSessionAs(f.userIdGlobal)
    // Create a second root in the same library first
    await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        ...EMPTY,
        specs: [
          {
            op: 'create',
            id: 'root2',
            rootSpecificationId: 'root2',
            libraryId: f.libSharedId,
            name: 'Root2',
            data: '{"nodes":[]}',
            dataSchemaVersion: 3,
            version: '1.0.0',
            state: 'Draft',
          },
        ],
      },
    })
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        ...EMPTY,
        specs: [{ op: 'update', id: f.rootSpecId, name: 'x' }],
        proxyRefs: [
          { op: 'create', parentSpecificationId: f.rootSpecId, nodeId: 'n1', targetSpecificationId: 'root2' },
        ],
      },
    })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('cross_tree_proxy')
  })

  it('422 when specenv_root_only trigger fires on child spec', async () => {
    mockSessionAs(f.userIdGlobal)
    // Insert a child directly (bypassing batch-save for the setup)
    const nowVal = Date.now()
    await rawQuery(
      `INSERT INTO specification (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId",
       "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('child1', $1, 'Child', '1.0.0', 'Draft', '{"nodes":[]}', $2, $3, 3, $4, $5)`,
      [f.libSharedId, f.rootSpecId, f.rootSpecId, nowVal, nowVal],
    )
    const res = await v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
      json: {
        ...EMPTY,
        specs: [{ op: 'update', id: 'child1', name: 'Renamed' }],
        specEnvs: [{ op: 'create', specificationId: 'child1', environmentLibraryId: f.libEnvSharedId }],
      },
    })
    expect(res.status).toBe(422)
  })
})
