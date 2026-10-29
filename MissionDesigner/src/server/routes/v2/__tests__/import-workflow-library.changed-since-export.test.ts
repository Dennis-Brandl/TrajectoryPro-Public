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

// A same-OID spec whose state or version changed here since the export is reported as refused
// (changed-since-export), not silently skipped; the rest of the package still imports.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import JSZip from 'jszip'
import { setupTestFixture, resetAndSeedFixture, mockSessionAs, rawQuery, type TestFixture } from './testSeed'
import type { ImportPlan, ImportPlanRow, PostImportReport } from '@/types/wflibx-import'

let f: TestFixture

beforeAll(async () => {
  f = await setupTestFixture()
})

beforeEach(async () => {
  await resetAndSeedFixture(f)
  mockSessionAs(null)
})

// The library has the SAME OID here and in the bundle, as after an export of this install.
const LIB = 'lib-smoke'
const LIB_NAME = 'Smoke Test Library'

async function seed(): Promise<void> {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "library" ("id","teamId","name","entityType","version","createdAt","updatedAt")
     VALUES ($1,$2,$3,'workflow','1.0.0',$4,$4)`,
    [LIB, f.teamMainId, LIB_NAME, now],
  )
  for (const [id, version, state] of [
    ['KD2', '2.0.0', 'Obsolete'],
    ['KD3', '3.0.0', 'Effective'],
  ]) {
    await rawQuery(
      `INSERT INTO "specification"
         ("id","libraryId","name","version","state","data",
          "rootSpecificationId","parentSpecificationId","dataSchemaVersion","createdAt","updatedAt")
       VALUES ($1,$2,'Kitchen Demo',$3,$4,'{"nodes":[]}',$1,NULL,3,$5,$5)`,
      [id, LIB, version, state, now],
    )
  }
}

async function makeBundle(specs: Array<{ oid: string; name: string; version: string; state: string }>) {
  const zip = new JSZip()
  zip.file(
    'manifest.json',
    JSON.stringify({
      packageType: 'workflow-library',
      packageVersion: '1.1',
      libraryName: LIB_NAME,
      oidIndex: {
        libraries: [{ oid: LIB, name: LIB_NAME, entityType: 'workflow', version: '1.0.0' }],
        specifications: specs.map((s) => ({ oid: s.oid, libraryOid: LIB, name: s.name, version: s.version })),
      },
    }),
  )
  zip.file(
    `${LIB_NAME}.WFlib`,
    JSON.stringify({
      oid: LIB,
      local_id: LIB_NAME,
      version: '1.0.0',
      workflow_specifications: specs.map((s) => ({
        oid: s.oid,
        local_id: s.name,
        version: s.version,
        state: s.state,
        steps: [],
        connections: [],
      })),
    }),
  )
  return zip.generateAsync({ type: 'uint8array' })
}

async function preview(bytes: Uint8Array): Promise<ImportPlan> {
  const form = new FormData()
  form.append('file', new File([bytes.buffer as ArrayBuffer], 'bundle.WFlibX', { type: 'application/zip' }))
  const res = await f.app.request('/api/v2/packages/workflow-library/preview', {
    method: 'POST',
    headers: { origin: 'http://localhost:5173' },
    body: form,
  })
  expect(res.status).toBe(200)
  return (await res.json()) as ImportPlan
}

function row(plan: ImportPlan, bundleOid: string): ImportPlanRow {
  const r = plan.rows.find((x) => x.bundleOid === bundleOid)
  if (!r) throw new Error(`no plan row for ${bundleOid}`)
  return r
}

describe('.WFlibX import of a file that is out of date', () => {
  it('refuses the spec whose state changed since export and imports the rest', async () => {
    await seed()
    mockSessionAs(f.userIdGlobal)

    const plan = await preview(
      await makeBundle([
        { oid: 'KD2', name: 'Kitchen Demo', version: '2.0.0', state: 'Effective' },
        { oid: 'KD3', name: 'Kitchen Demo', version: '3.0.0', state: 'Effective' },
        { oid: 'NEW', name: 'Brand new', version: '1.0.0', state: 'Draft' },
      ]),
    )
    expect(row(plan, LIB).status.tag).toBe('no-op')
    expect(row(plan, 'KD3').status.tag).toBe('no-op')
    expect(row(plan, 'NEW').status.tag).toBe('add-to-existing')
    expect(row(plan, 'KD2').status).toEqual({
      tag: 'refused',
      existingOid: 'KD2',
      existingName: 'Kitchen Demo',
      existingVersion: '2.0.0',
      existingState: 'Obsolete',
      refusal: { reason: 'changed-since-export', blockers: [], fileState: 'Effective', effectiveVersionHere: '3.0.0' },
    })

    const res = await f.app.request('/api/v2/packages/workflow-library/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ previewId: plan.previewId, resolutions: {}, teamId: f.teamMainId }),
    })
    expect(res.status).toBe(200)
    const report = (await res.json()) as PostImportReport
    expect(report.refused).toEqual([
      {
        oid: 'KD2',
        name: 'Kitchen Demo',
        version: '2.0.0',
        state: 'Obsolete',
        reason: 'changed-since-export',
        fileVersion: '2.0.0',
        fileState: 'Effective',
        effectiveVersionHere: '3.0.0',
      },
    ])
    expect(report.created.specifications).toBe(1)

    const rows = await rawQuery<{ id: string; state: string }>(
      `SELECT id, state FROM "specification" WHERE "libraryId" = $1 ORDER BY id`,
      [LIB],
    )
    expect(rows.map((r) => [r.id, r.state])).toEqual([
      ['KD2', 'Obsolete'],
      ['KD3', 'Effective'],
      ['NEW', 'Draft'],
    ])
  })
})
