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

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import JSZip from 'jszip'
import { setupTestFixture, resetAndSeedFixture, mockSessionAs, v2Req, rawQuery, type TestFixture } from './testSeed'
import * as insertImagesModule from '../../../packageFormat/insertImportImages'
import { EXPORT_WARNINGS_HEADER, decodeExportWarnings } from '@/lib/packageFormat/export-warnings-header'

// Spy wrapper so individual tests can override insertImportImages once via
// mockImplementationOnce to simulate ImportImageMissingError. The default
// delegates to the real implementation so all other tests are unaffected.
vi.mock('../../../packageFormat/insertImportImages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../packageFormat/insertImportImages')>()
  return {
    ...actual,
    insertImportImages: vi.fn(actual.insertImportImages),
  }
})

// A minimal but schema-valid environment library JSON (satisfies managed-element.json
// + master-environment-library.json AJV schemas used by importEnvironmentLibrary).
const VALID_ENV_LIB_JSON = {
  local_id: 'RollbackTestEnv',
  oid: 'env-oid-rollback-2-13',
  version: '1.0.0',
  last_modified_date: '2026-01-01T00:00:00.000Z',
  environment_specifications: [],
}

let f: TestFixture
beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetAndSeedFixture(f)
  mockSessionAs(null)
})

describe('GET /api/v2/packages/workflow/:rootSpecId', () => {
  it('401 without session', async () => {
    const res = await v2Req(f, 'GET', `/api/v2/packages/workflow/${f.rootSpecId}`)
    expect(res.status).toBe(401)
  })

  it('200 with a streamed ZIP for owner', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'GET', `/api/v2/packages/workflow/${f.rootSpecId}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toMatch(/attachment;.*\.WFmasterX"?$/)
    expect(res.headers.get('x-export-warnings')).toBeNull()

    // Filename derives from the root workflow spec ('Shared Root'), NOT the library ('Shared Lib').
    // This is a single-workflow package, not a library archive.
    const disposition = res.headers.get('content-disposition') ?? ''
    expect(disposition).toMatch(/filename="Shared_Root\.WFmasterX"?/)
    expect(disposition).not.toMatch(/Shared_Lib/)

    const buf = Buffer.from(await res.arrayBuffer())
    const zip = await JSZip.loadAsync(buf)
    // The v7.0 .WFmaster JSON inside the ZIP is named after the workflow, not the library.
    expect(zip.files['Shared_Root.WFmaster']).toBeDefined()
    const jsonText = await zip.files['Shared_Root.WFmaster'].async('string')
    const env = JSON.parse(jsonText) as {
      schemaVersion: string
      local_id: string
      oid: string
      steps: unknown[]
      connections: unknown[]
      children?: unknown[]
    }
    // v7.0 shape: recursive workflow at root, not a flat specifications[] wrapper.
    // P4.1 Task 3: export now emits the 5.0 envelope (form_document, not form_layout_config).
    expect(env.schemaVersion).toBe('5.0')
    expect(env.local_id).toBe('Shared Root')
    expect(env.oid).toBe(f.rootSpecId)
    expect(Array.isArray(env.steps)).toBe(true)
    expect(Array.isArray(env.connections)).toBe(true)
    // The runtime contract requires manifest.json absence-tolerant; we emit it
    // for forward compat (per editor-export-format.md §1.2).
    expect(zip.files['manifest.json']).toBeDefined()
  })

  it('carries the builder warnings back in the x-export-warnings header (GATE follow-up item 5)', async () => {
    mockSessionAs(f.userIdGlobal)
    // The form-designer upload flow stores images as { filename: dataUri } in spec.data.images;
    // a value that is not a data URI makes the builder skip the image and record a warning.
    const data = JSON.stringify({
      nodes: [
        { id: 'n-start', type: 'start', position: { x: 100, y: 100 }, data: { stepType: 'start', label: 'Start' } },
        { id: 'n-end', type: 'end', position: { x: 100, y: 250 }, data: { stepType: 'end', label: 'End' } },
      ],
      edges: [{ id: 'e1', source: 'n-start', target: 'n-end' }],
      images: { 'bad.png': 'not-a-data-uri' },
    })
    await rawQuery('UPDATE "specification" SET data = $1 WHERE id = $2', [data, f.rootSpecId])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await v2Req(f, 'GET', `/api/v2/packages/workflow/${f.rootSpecId}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/zip')
      expect(decodeExportWarnings(res.headers.get(EXPORT_WARNINGS_HEADER))).toEqual([
        'Image "bad.png" not exported: spec.data.images value is not a base64 data URI',
      ])
      // The server log line stays — it is the only record when the download is scripted.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('bad.png'))
    } finally {
      warn.mockRestore()
    }
  })
  it('404 for non-existent root', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'GET', '/api/v2/packages/workflow/nope')
    expect(res.status).toBe(404)
  })

  it('404 for unreadable root (private of another user)', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'GET', `/api/v2/packages/workflow/${f.privateRootSpecId}`)
    expect(res.status).toBe(404)
  })

  it('404 when called with a non-root spec id', async () => {
    mockSessionAs(f.userIdGlobal)
    // Insert a child spec
    await rawQuery(
      `INSERT INTO "specification" (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('child-1', $1, 'Child', '1.0.0', 'Draft', '{"nodes":[]}', $2, $3, 3, $4, $5)`,
      [f.libSharedId, f.rootSpecId, f.rootSpecId, Date.now(), Date.now()],
    )
    const res = await v2Req(f, 'GET', '/api/v2/packages/workflow/child-1')
    expect(res.status).toBe(404)
  })
})

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000000500' +
    '010da25e6c0000000049454e44ae426082',
  'hex',
)

async function buildPackageZip(spec: { id: string; name: string }, withImage = false): Promise<Buffer> {
  const z = new JSZip()
  const now = new Date().toISOString()
  const env: Record<string, unknown> = {
    schemaVersion: '4.0',
    local_id: spec.name,
    oid: spec.id,
    version: '1.0.0',
    state: 'Draft',
    last_modified_date: now,
    steps: withImage
      ? [
          {
            local_id: 'Form',
            oid: 'oid-form-step',
            step_type: 'USER_INTERACTION',
            version: '1.0.0',
            last_modified_date: now,
            position: { x: 100, y: 100 },
            form_layout_config: [
              {
                deviceType: 'desktop',
                canvasWidth: 800,
                canvasHeight: 600,
                elements: [{ id: 'el-img-1', type: 'image', src: 'cover.png' }],
              },
            ],
          },
        ]
      : [],
    connections: [],
  }
  z.file('Workflow.WFmaster', JSON.stringify(env))
  if (withImage) {
    z.file('images/cover.png', PNG_BYTES)
  }
  return Buffer.from(await z.generateAsync({ type: 'uint8array' }))
}

async function multipartImport(
  f: TestFixture,
  zip: Buffer,
  targetLibraryId: string,
  userId: string | null,
): Promise<Response> {
  mockSessionAs(userId)
  const form = new FormData()
  form.set('file', new Blob([zip as BlobPart], { type: 'application/zip' }), 'workflow.WFmasterX')
  form.set('targetLibraryId', targetLibraryId)
  return f.app.request('/api/v2/packages/import', {
    method: 'POST',
    body: form,
    headers: { origin: 'http://localhost:5173' },
  })
}

describe('POST /api/v2/packages/import', () => {
  it('401 without session', async () => {
    const zip = await buildPackageZip({ id: 'src-1', name: 'Imported' })
    const res = await multipartImport(f, zip, f.libSharedId, null)
    expect(res.status).toBe(401)
  })

  it('200 imports a minimal workflow into a writable library', async () => {
    const zip = await buildPackageZip({ id: 'src-1', name: 'Imported' })
    const res = await multipartImport(f, zip, f.libSharedId, f.userIdGlobal)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      rootSpecId: string
      specCount: number
      imageCount: number
    }
    expect(body.specCount).toBe(1)
    expect(body.imageCount).toBe(0)
    expect(body.rootSpecId).toMatch(/.+/)
    // The new spec must exist with the new id and the imported name
    const [row] = await rawQuery<{ name: string }>('SELECT name FROM "specification" WHERE id = $1', [body.rootSpecId])
    expect(row.name).toBe('Imported')
  })

  it('imports a workflow with an image and creates the image_blob', async () => {
    const zip = await buildPackageZip({ id: 'src-1', name: 'WithImg' }, true)
    const res = await multipartImport(f, zip, f.libSharedId, f.userIdGlobal)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rootSpecId: string; specCount: number; imageCount: number }
    expect(body.specCount).toBe(1)
    expect(body.imageCount).toBe(1)
    const [blobs] = await rawQuery<{ c: string }>('SELECT count(*) AS c FROM "image_blob"')
    expect(Number(blobs.c)).toBeGreaterThanOrEqual(1)
  })

  it('404 conflation when target library is not writable', async () => {
    const zip = await buildPackageZip({ id: 'src-1', name: 'X' })
    const res = await multipartImport(f, zip, f.libPrivateId, f.userIdOther)
    expect(res.status).toBe(404)
  })

  it('422 when targetLibraryId is missing from form', async () => {
    mockSessionAs(f.userIdGlobal)
    const zip = await buildPackageZip({ id: 'src-1', name: 'X' })
    const form = new FormData()
    form.set('file', new Blob([zip as BlobPart], { type: 'application/zip' }), 'workflow.WFmasterX')
    // intentionally no targetLibraryId
    const res = await f.app.request('/api/v2/packages/import', {
      method: 'POST',
      body: form,
      headers: { origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(422)
  })

  it('422 unsupported_schema_version when JSON envelope is v2.0', async () => {
    const z = new JSZip()
    z.file('Workflow.WFmaster', JSON.stringify({ schemaVersion: '2.0', specifications: [] }))
    const zip = Buffer.from(await z.generateAsync({ type: 'uint8array' }))
    const res = await multipartImport(f, zip, f.libSharedId, f.userIdGlobal)
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('unsupported_schema_version')
  })

  it('422 zip_filename_invalid on path traversal', async () => {
    const z = new JSZip()
    z.file('Workflow.WFmaster', JSON.stringify({ schemaVersion: '3.0', library: {}, specifications: [] }))
    z.file('../escape.png', PNG_BYTES)
    const zip = Buffer.from(await z.generateAsync({ type: 'uint8array' }))
    const res = await multipartImport(f, zip, f.libSharedId, f.userIdGlobal)
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('zip_filename_invalid')
  })

  it('imports leniently when an image reference is missing from the ZIP and clears the src', async () => {
    mockSessionAs(f.userIdGlobal)
    // Build a zip that references an image not in the zip — the import path
    // tolerates this and clears the src on the form-element instead of failing.
    const now = new Date().toISOString()
    const z = new JSZip()
    z.file(
      'Workflow.WFmaster',
      JSON.stringify({
        schemaVersion: '4.0',
        local_id: 'PartialAssets',
        oid: 'src-rollback',
        version: '1.0.0',
        state: 'Draft',
        last_modified_date: now,
        steps: [
          {
            local_id: 'Form',
            oid: 'oid-form-step',
            step_type: 'USER_INTERACTION',
            version: '1.0.0',
            last_modified_date: now,
            position: { x: 100, y: 100 },
            form_layout_config: [
              {
                deviceType: 'desktop',
                canvasWidth: 800,
                canvasHeight: 600,
                elements: [{ id: 'el-img-1', type: 'image', src: 'missing.png' }],
              },
            ],
          },
        ],
        connections: [],
      }),
    )
    const zip = Buffer.from(await z.generateAsync({ type: 'uint8array' }))
    const [beforeRow] = await rawQuery<{ c: string }>('SELECT count(*) AS c FROM "specification"')
    const res = await multipartImport(f, zip, f.libSharedId, f.userIdGlobal)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rootSpecId: string; imageCount: number }
    expect(body.imageCount).toBe(0)
    const [afterRow] = await rawQuery<{ c: string }>('SELECT count(*) AS c FROM "specification"')
    expect(Number(afterRow.c)).toBe(Number(beforeRow.c) + 1)

    // P4.2: legacy form_layout_config is hydrated only to feed the v1→v2 converter and is
    // never persisted (v1 editor retired) — the step lands with formDocument only, so the
    // missing-image tolerance is observed on the CONVERTED v2 image block (same placeholder
    // + dropped-imageOid contract as the native-5.0 sibling test below), not on formLayouts.
    const [row] = await rawQuery<{ data: string }>('SELECT data FROM "specification" WHERE id = $1', [body.rootSpecId])
    expect(row).toBeDefined()
    const data = JSON.parse(row.data) as {
      nodes: Array<{
        data?: {
          formDocument?: {
            sections: Array<{ rows: Array<{ blocks: Array<{ type: string; src?: string; imageOid?: string }> }> }>
          }
        }
      }>
    }
    const blocks = data.nodes[0]?.data?.formDocument?.sections.flatMap((s) => s.rows.flatMap((r) => r.blocks))
    const imgBlock = blocks?.find((b) => b.type === 'image')
    expect(imgBlock?.src).toBe('No image selected')
    expect(imgBlock).not.toHaveProperty('imageOid')
  })

  it('imports leniently when a v2 form_document image reference is missing from the ZIP and clears the src', async () => {
    mockSessionAs(f.userIdGlobal)
    // Same idiom as the v1 test above, but the envelope is a native 5.0
    // package whose step carries form_document (v2) instead of
    // form_layout_config (v1) — the missing-image tolerance must apply to
    // both shapes identically.
    const now = new Date().toISOString()
    const z = new JSZip()
    z.file(
      'Workflow.WFmaster',
      JSON.stringify({
        schemaVersion: '5.0',
        local_id: 'PartialAssetsV2',
        oid: 'src-rollback-v2',
        version: '1.0.0',
        state: 'Draft',
        last_modified_date: now,
        steps: [
          {
            local_id: 'Form',
            oid: 'oid-form-step-v2',
            step_type: 'USER_INTERACTION',
            version: '1.0.0',
            last_modified_date: now,
            position: { x: 100, y: 100 },
            form_document: {
              version: 2,
              sections: [
                {
                  id: 'sec-content',
                  role: 'content',
                  rows: [
                    {
                      id: 'row-1',
                      blocks: [
                        {
                          id: 'blk-ghost',
                          type: 'image',
                          src: 'ghost.png',
                          imageOid: 'oid-ghost',
                          layout: { aspectRatio: '16/9' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ],
        connections: [],
      }),
    )
    const zip = Buffer.from(await z.generateAsync({ type: 'uint8array' }))
    const [beforeRow] = await rawQuery<{ c: string }>('SELECT count(*) AS c FROM "specification"')
    const res = await multipartImport(f, zip, f.libSharedId, f.userIdGlobal)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rootSpecId: string; imageCount: number }
    expect(body.imageCount).toBe(0)
    const [afterRow] = await rawQuery<{ c: string }>('SELECT count(*) AS c FROM "specification"')
    expect(Number(afterRow.c)).toBe(Number(beforeRow.c) + 1)

    // The v2 image block's src must be cleared to the palette placeholder
    // (NOT '' — v2 src has minLength:1, which would invalidate the document)
    // with the now-dangling imageOid dropped.
    const [row] = await rawQuery<{ data: string }>('SELECT data FROM "specification" WHERE id = $1', [body.rootSpecId])
    expect(row).toBeDefined()
    const data = JSON.parse(row.data) as {
      nodes: Array<{
        data?: {
          formDocument?: {
            sections: Array<{ rows: Array<{ blocks: Array<{ type: string; src?: string; imageOid?: string }> }> }>
          }
        }
      }>
    }
    const blocks = data.nodes[0]?.data?.formDocument?.sections.flatMap((s) => s.rows.flatMap((r) => r.blocks))
    const imgBlock = blocks?.find((b) => b.type === 'image')
    expect(imgBlock?.src).toBe('No image selected')
    expect(imgBlock).not.toHaveProperty('imageOid')
  })

  it('200 and auto-renames a duplicate-named child instead of failing with 409', async () => {
    // Regression: a package with two children sharing (name, version) under the
    // same parent used to 409 on specification_sibling_name_unique. The importer
    // now disambiguates the later sibling's name so the whole import succeeds.
    const now = new Date().toISOString()
    const mkChild = (oid: string) => ({
      local_id: 'Dup Child',
      oid,
      version: '1.0.0',
      state: 'Draft',
      last_modified_date: now,
      parentChildSpecId: null,
      steps: [],
      connections: [],
    })
    const z = new JSZip()
    z.file(
      'Workflow.WFmaster',
      JSON.stringify({
        schemaVersion: '4.0',
        local_id: 'DupKidsRoot',
        oid: 'src-dupkids-root',
        version: '1.0.0',
        state: 'Draft',
        last_modified_date: now,
        steps: [],
        connections: [],
        children: [mkChild('src-kid-a'), mkChild('src-kid-b')],
      }),
    )
    const zip = Buffer.from(await z.generateAsync({ type: 'uint8array' }))
    const res = await multipartImport(f, zip, f.libSharedId, f.userIdGlobal)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rootSpecId: string; specCount: number }
    expect(body.specCount).toBe(3)
    const childRows = await rawQuery<{ name: string }>(
      'SELECT name FROM "specification" WHERE "parentSpecificationId" = $1 ORDER BY name',
      [body.rootSpecId],
    )
    expect(childRows.map((r) => r.name)).toEqual(['Dup Child', 'Dup Child (2)'])
  })

  it('200 and auto-renames the root when re-importing a workflow already in the library', async () => {
    // "Reload" of a workflow that already exists must not 409 on
    // specification_root_name_unique; the second import lands as a renamed copy.
    const zip = await buildPackageZip({ id: 'src-reload', name: 'Reloadable' })
    const first = await multipartImport(f, zip, f.libSharedId, f.userIdGlobal)
    expect(first.status).toBe(200)
    const second = await multipartImport(f, zip, f.libSharedId, f.userIdGlobal)
    expect(second.status).toBe(200)
    const nameRows = await rawQuery<{ name: string }>(
      `SELECT name FROM "specification" WHERE "libraryId" = $1 AND "parentSpecificationId" IS NULL AND name LIKE 'Reloadable%' ORDER BY name`,
      [f.libSharedId],
    )
    expect(nameRows.map((r) => r.name)).toEqual(['Reloadable', 'Reloadable (2)'])
  })

  it('rolls back env library AND workflow specs on batch-save failure (all-or-nothing guarantee)', async () => {
    // Regression test for Task 2.13: old code split the import into 3 separate
    // transactions so a mid-import failure left orphaned env/action libraries
    // and partial spec rows committed to the DB.
    //
    // Setup: a user who has team membership (can SEE the library) but holds NO
    // rights (cannot CREATE specs). importLibrariesFromZip will try to create
    // the env library, then phase1Validate / phase2Apply will fail with 403.
    //
    // Old (3-TX) code:  TX1 commits the env library → it stays in the DB.
    // New (1-TX) code:  the 403 propagates and rolls back the whole TX → no
    //                   env library, no workflow spec in the DB.
    const restrictedUserId = 'test-no-rights-2-13'
    await rawQuery(
      `INSERT INTO "user" ("id","email","emailVerified","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [restrictedUserId, 'norts2013@example.com', false, new Date(), new Date()],
    )
    // Member of teamMain (so canSee is true) but no role → no rights.
    await rawQuery(`INSERT INTO "user_team" ("userId","teamId") VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
      restrictedUserId,
      f.teamMainId,
    ])

    // Build a ZIP with an env library sibling + minimal workflow envelope.
    const z = new JSZip()
    z.file('environments/RollbackTestEnv.WFenvir', JSON.stringify(VALID_ENV_LIB_JSON))
    z.file(
      'Workflow.WFmaster',
      JSON.stringify({
        schemaVersion: '4.0',
        local_id: 'RollbackWf2013',
        oid: 'src-rollback-wf-2-13',
        version: '1.0.0',
        state: 'Draft',
        last_modified_date: '2026-01-01T00:00:00.000Z',
        steps: [],
        connections: [],
      }),
    )
    const zip = Buffer.from(await z.generateAsync({ type: 'uint8array' }))

    // Verify no env lib exists before the import attempt.
    const [envBefore] = await rawQuery<{ c: string }>(
      `SELECT count(*) AS c FROM "library" WHERE name = 'RollbackTestEnv'`,
    )
    expect(Number(envBefore.c)).toBe(0)

    // Import as the restricted user — must fail because they lack workflow:create.
    const res = await multipartImport(f, zip, f.libSharedId, restrictedUserId)
    // The 403 is thrown by the gate check (phase1 or phase2).
    expect(res.status).toBe(403)

    // CRITICAL: the env library must NOT have been committed (old code would
    // leave it; new code rolls it back together with everything else).
    const [envAfter] = await rawQuery<{ c: string }>(
      `SELECT count(*) AS c FROM "library" WHERE name = 'RollbackTestEnv'`,
    )
    expect(Number(envAfter.c)).toBe(0)

    // No workflow spec was written either.
    const specRows = await rawQuery<{ id: string }>(
      `SELECT id FROM "specification" WHERE "libraryId" = $1 AND name = 'RollbackWf2013'`,
      [f.libSharedId],
    )
    expect(specRows).toHaveLength(0)
  })

  it('rolls back env library AND workflow spec when insertImportImages throws ImportImageMissingError', async () => {
    // This is the worst partial-state scenario from the old 3-TX design: phase2Apply
    // already wrote the spec rows, importLibrariesFromZip already wrote the env lib,
    // THEN insertImportImages failed. Under the new single-TX design the rollback
    // removes ALL of them atomically. This is impossible to trigger via a real ZIP
    // (the pre-filter removes missing image refs before buildImportBatch), so we
    // mock insertImportImages to simulate bytes-absent-at-insert-time.
    const { ImportImageMissingError } = insertImagesModule
    vi.mocked(insertImagesModule.insertImportImages).mockImplementationOnce(async () => {
      throw new ImportImageMissingError('sim-spec-id', 'cover.png')
    })

    const now = new Date().toISOString()
    const z = new JSZip()
    // Env library sibling — will be committed in step 1 of the TX.
    z.file(
      'environments/ImageRollbackEnv.WFenvir',
      JSON.stringify({
        local_id: 'ImageRollbackEnv',
        oid: 'env-oid-img-rb-2-13',
        version: '1.0.0',
        last_modified_date: now,
        environment_specifications: [],
      }),
    )
    // Workflow with an image element + image bytes in the ZIP so the pre-filter
    // keeps the ref and imageInserts is non-empty → insertImportImages is called.
    z.file(
      'Workflow.WFmaster',
      JSON.stringify({
        schemaVersion: '4.0',
        local_id: 'ImageRollbackWf',
        oid: 'src-img-rb-wf-2-13',
        version: '1.0.0',
        state: 'Draft',
        last_modified_date: now,
        steps: [
          {
            local_id: 'Form',
            oid: 'oid-form-img-rb',
            step_type: 'USER_INTERACTION',
            version: '1.0.0',
            last_modified_date: now,
            position: { x: 100, y: 100 },
            form_layout_config: [
              {
                deviceType: 'desktop',
                canvasWidth: 800,
                canvasHeight: 600,
                elements: [{ id: 'el-img', type: 'image', src: 'cover.png' }],
              },
            ],
          },
        ],
        connections: [],
      }),
    )
    z.file('images/cover.png', PNG_BYTES)
    const zip = Buffer.from(await z.generateAsync({ type: 'uint8array' }))

    // Verify clean state before the import.
    const [envBefore] = await rawQuery<{ c: string }>(
      `SELECT count(*) AS c FROM "library" WHERE name = 'ImageRollbackEnv'`,
    )
    expect(Number(envBefore.c)).toBe(0)

    // Import as the normal user who HAS workflow:create rights, so phase2Apply runs
    // and writes the spec row before insertImportImages (mocked) throws.
    const res = await multipartImport(f, zip, f.libSharedId, f.userIdGlobal)

    // The ImportImageMissingError becomes a 422 image_not_found via the outer catch.
    expect(res.status).toBe(422)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('image_not_found')

    // CRITICAL: the env library created in step 1 must be rolled back.
    const [envAfter] = await rawQuery<{ c: string }>(
      `SELECT count(*) AS c FROM "library" WHERE name = 'ImageRollbackEnv'`,
    )
    expect(Number(envAfter.c)).toBe(0)

    // The workflow spec written by phase2Apply must also be absent.
    const specRows = await rawQuery<{ id: string }>(
      `SELECT id FROM "specification" WHERE "libraryId" = $1 AND name = 'ImageRollbackWf'`,
      [f.libSharedId],
    )
    expect(specRows).toHaveLength(0)
  })
})
