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
import JSZip from 'jszip'
import { setupTestFixture, resetAndSeedFixture, mockSessionAs, rawQuery, type TestFixture } from './testSeed'

let f: TestFixture

beforeAll(async () => {
  f = await setupTestFixture()
})

beforeEach(async () => {
  await resetAndSeedFixture(f)
  // Authenticate as unauthenticated by default; individual tests opt in.
  mockSessionAs(null)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface WfLibXSpec {
  libName: string
  libOid: string
  specOid: string
  specName: string
}

async function makeWfLibX(spec: WfLibXSpec): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    'manifest.json',
    JSON.stringify({
      packageType: 'workflow-library',
      packageVersion: '1.1',
      libraryName: spec.libName,
      createdAt: new Date().toISOString(),
      files: [{ path: `${spec.libName}.WFlib`, type: 'workflow-library' }],
      oidIndex: {
        libraries: [{ oid: spec.libOid, name: spec.libName, entityType: 'workflow', version: '1.0.0' }],
        specifications: [{ oid: spec.specOid, libraryOid: spec.libOid, name: spec.specName, version: '1.0.0' }],
      },
    }),
  )
  // The library JSON file shape: top-level `oid` is what indexParsedJsons reads.
  // workflow_specifications entries use MasterWorkflowSpecification shape, which
  // importWorkflowSpecToInternal expects (steps[], not nodes/edges).
  zip.file(
    `${spec.libName}.WFlib`,
    JSON.stringify({
      oid: spec.libOid,
      local_id: spec.libName,
      version: '1.0.0',
      workflow_specifications: [
        { oid: spec.specOid, local_id: spec.specName, version: '1.0.0', steps: [], connections: [] },
      ],
    }),
  )
  return zip.generateAsync({ type: 'uint8array' })
}

async function postPreview(bytes: Uint8Array): Promise<Response> {
  const form = new FormData()
  form.append('file', new File([bytes.buffer as ArrayBuffer], 'bundle.WFlibX', { type: 'application/zip' }))
  return f.app.request('/api/v2/packages/workflow-library/preview', {
    method: 'POST',
    headers: { origin: 'http://localhost:5173' },
    body: form,
  })
}

async function postCommit(body: {
  previewId: string
  resolutions: Record<string, 'keep' | 'replace'>
  teamId?: string
}): Promise<Response> {
  return f.app.request('/api/v2/packages/workflow-library/commit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:5173',
    },
    body: JSON.stringify({ teamId: f.teamMainId, ...body }),
  })
}

// ---------------------------------------------------------------------------
// POST /packages/workflow-library/preview
// ---------------------------------------------------------------------------

describe('POST /packages/workflow-library/preview', () => {
  it('returns 400 json_envelope_invalid on malformed manifest (bad JSON)', async () => {
    mockSessionAs(f.userIdGlobal)
    const zip = new JSZip()
    zip.file('manifest.json', '{bad json')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const res = await postPreview(bytes)
    // Audit item 3: the manifest boundary is zod-parsed once — a SyntaxError is
    // a handled 400, never an unhandled 500.
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('json_envelope_invalid')
  })

  it('returns 400 json_envelope_invalid when the oidIndex shape is invalid', async () => {
    mockSessionAs(f.userIdGlobal)
    const zip = new JSZip()
    zip.file(
      'manifest.json',
      JSON.stringify({
        packageType: 'workflow-library',
        packageVersion: '1.1',
        // libraries entries missing required fields; specifications not an array
        oidIndex: { libraries: [{ oid: 42 }], specifications: 'nope' },
      }),
    )
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const res = await postPreview(bytes)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('json_envelope_invalid')
  })

  it('returns 400 when packageType is not workflow-library', async () => {
    mockSessionAs(f.userIdGlobal)
    const zip = new JSZip()
    zip.file(
      'manifest.json',
      JSON.stringify({
        packageType: 'something-else',
        packageVersion: '1.1',
        oidIndex: { libraries: [], specifications: [] },
      }),
    )
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const res = await postPreview(bytes)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('wrong_package_type')
  })

  it('returns 200 with a plan containing one create-library and one create-spec when DB is empty', async () => {
    mockSessionAs(f.userIdGlobal)
    const bytes = await makeWfLibX({ libName: 'L', libOid: 'L1', specOid: 'S1', specName: 'A' })
    const res = await postPreview(bytes)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { rows: Array<{ status: { tag: string } }>; previewId: string }
    // DB is empty after resetAndSeedFixture (no L1 OID, no lib named 'L' with type 'workflow'
    // except the seeded fixtures — but those have different OIDs/names so both rows are 'create').
    const tags = json.rows.map((r) => r.status.tag)
    expect(tags).toContain('create')
    expect(json.previewId).toBeTruthy()
  })

  it('returns 403 when unauthenticated', async () => {
    // mockSessionAs(null) is set in beforeEach
    const bytes = await makeWfLibX({ libName: 'L', libOid: 'L1', specOid: 'S1', specName: 'A' })
    const res = await postPreview(bytes)
    expect(res.status).toBe(401)
  })

  it('returns 403 when the user holds no workflow:library.create in any team', async () => {
    mockSessionAs(f.userIdOther) // member of no team → no rights anywhere
    const bytes = await makeWfLibX({ libName: 'L', libOid: 'L1', specOid: 'S1', specName: 'A' })
    const res = await postPreview(bytes)
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// POST /packages/workflow-library/commit
// ---------------------------------------------------------------------------

describe('POST /packages/workflow-library/commit', () => {
  it('returns 410 if previewId has expired / never existed', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await postCommit({ previewId: 'nope', resolutions: {} })
    expect(res.status).toBe(410)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('preview_expired')
  })

  it('happy path: preview empty DB → commit → 200 with summary', async () => {
    mockSessionAs(f.userIdGlobal)
    const bytes = await makeWfLibX({ libName: 'NewLib', libOid: 'NL1', specOid: 'NS1', specName: 'SpecA' })

    const previewRes = await postPreview(bytes)
    expect(previewRes.status).toBe(200)
    const plan = (await previewRes.json()) as { previewId: string; rows: unknown[] }

    const res = await postCommit({ previewId: plan.previewId, resolutions: {} })
    expect(res.status).toBe(200)

    const report = (await res.json()) as {
      created: { libraries: number; specifications: number }
      replaced: { libraries: number; specifications: number }
      kept: { libraries: number; specifications: number }
      noOp: { libraries: number; specifications: number }
    }
    expect(report.created.libraries).toBe(1)
    expect(report.created.specifications).toBe(1)

    // Verify the rows landed in the DB.
    const [libRow] = await rawQuery<{ id: string }>('SELECT id FROM "library" WHERE id = $1', ['NL1'])
    expect(libRow?.id).toBe('NL1')
    const [specRow] = await rawQuery<{ id: string }>('SELECT id FROM "specification" WHERE id = $1', ['NS1'])
    expect(specRow?.id).toBe('NS1')
  })

  it('assigns created libraries to the chosen team', async () => {
    mockSessionAs(f.userIdGlobal)
    const bytes = await makeWfLibX({ libName: 'TeamLib', libOid: 'TL1', specOid: 'TS1', specName: 'SpecA' })
    const plan = (await (await postPreview(bytes)).json()) as { previewId: string }
    const res = await postCommit({ previewId: plan.previewId, resolutions: {}, teamId: f.teamMainId })
    expect(res.status).toBe(200)
    const [row] = await rawQuery<{ teamId: string }>('SELECT "teamId" FROM "library" WHERE id = $1', ['TL1'])
    expect(row.teamId).toBe(f.teamMainId)
  })

  it('returns 400 when teamId is missing', async () => {
    mockSessionAs(f.userIdGlobal)
    const bytes = await makeWfLibX({ libName: 'L', libOid: 'NL2', specOid: 'NS2', specName: 'A' })
    const plan = (await (await postPreview(bytes)).json()) as { previewId: string }
    const res = await f.app.request('/api/v2/packages/workflow-library/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ previewId: plan.previewId, resolutions: {} }), // no teamId
    })
    expect(res.status).toBe(400)
  })

  it('returns 403 forbidden_entity_types when the user lacks library.create in the target team', async () => {
    mockSessionAs(f.userIdGlobal)
    const bytes = await makeWfLibX({ libName: 'L', libOid: 'NL3', specOid: 'NS3', specName: 'A' })
    const plan = (await (await postPreview(bytes)).json()) as { previewId: string }
    const res = await postCommit({ previewId: plan.previewId, resolutions: {}, teamId: 'team-with-no-rights' })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('forbidden_entity_types')
  })
})

describe('POST /packages/workflow-library/commit — libraries owned by another team (spec 2026-10-12 U3)', () => {
  async function seedOtherTeamLibrary() {
    const now = Date.now()
    await rawQuery(
      `INSERT INTO "team" ("id","name","createdAt","updatedAt") VALUES ('team-other','Other Team',$1,$1) ON CONFLICT DO NOTHING`,
      [now],
    )
    await rawQuery(
      `INSERT INTO "library" ("id","teamId","name","entityType","version","createdAt","updatedAt")
       VALUES ('lib-other','team-other','Other Lib','workflow','1.0.0',$1,$1)`,
      [now],
    )
  }

  it('refuses to replace a library in a team where the user has no rights; nothing changes', async () => {
    await seedOtherTeamLibrary()
    mockSessionAs(f.userIdGlobal) // full rights in team-main only
    const bytes = await makeWfLibX({ libName: 'Other Lib', libOid: 'OL1', specOid: 'OS1', specName: 'A' })
    const plan = (await (await postPreview(bytes)).json()) as {
      previewId: string
      rows: Array<{ bundleOid: string; status: { tag: string; refusal?: { reason: string } } }>
    }
    // The preview already refuses it (spec 2026-10-21 §6), and the commit answers 422.
    expect(plan.rows.find((r) => r.bundleOid === 'OL1')?.status).toMatchObject({
      tag: 'refused',
      refusal: { reason: 'no-permission' },
    })
    const res = await postCommit({ previewId: plan.previewId, resolutions: { OL1: 'replace' } })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: 'locked_replace' })
    const [row] = await rawQuery<{ teamId: string }>(`SELECT "teamId" FROM "library" WHERE "id" = 'lib-other'`)
    expect(row.teamId).toBe('team-other')
  })

  it('refuses to add specs into that library when the conflict is kept', async () => {
    await seedOtherTeamLibrary()
    mockSessionAs(f.userIdGlobal)
    const bytes = await makeWfLibX({ libName: 'Other Lib', libOid: 'OL2', specOid: 'OS2', specName: 'A' })
    const plan = (await (await postPreview(bytes)).json()) as { previewId: string }
    const res = await postCommit({ previewId: plan.previewId, resolutions: { OL2: 'keep' } })
    expect(res.status).toBe(403)
    const specs = await rawQuery(`SELECT 1 FROM "specification" WHERE "libraryId" = 'lib-other'`)
    expect(specs).toHaveLength(0)
  })
})
