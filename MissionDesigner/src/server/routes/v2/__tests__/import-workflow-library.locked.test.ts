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

// Spec 2026-10-21 §6: a .WFlibX Replace never deletes or changes an edit-locked spec, and the
// rest of the package still imports.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import JSZip from 'jszip'
import {
  setupTestFixture,
  resetAndSeedFixture,
  mockSessionAs,
  seedAdminUser,
  rawQuery,
  type TestFixture,
} from './testSeed'
import type { ImportPlan, ImportPlanRow, PostImportReport } from '@/types/wflibx-import'

let f: TestFixture

beforeAll(async () => {
  f = await setupTestFixture()
})

beforeEach(async () => {
  await resetAndSeedFixture(f)
  mockSessionAs(null)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LIB = 'lib-locked'
const LIB_NAME = 'Locked Lib'
const BUNDLE_LIB = 'BL1'

async function seedLibrary(id = LIB, name = LIB_NAME): Promise<void> {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "library" ("id","teamId","name","entityType","version","createdAt","updatedAt")
     VALUES ($1,$2,$3,'workflow','1.0.0',$4,$4)`,
    [id, f.teamMainId, name, now],
  )
}

async function seedSpec(s: {
  id: string
  name: string
  version?: string
  state: string
  parent?: string
  root?: string
  libraryId?: string
}): Promise<void> {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "specification"
       ("id","libraryId","name","version","state","data",
        "rootSpecificationId","parentSpecificationId","dataSchemaVersion","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,'{"nodes":[]}',$6,$7,3,$8,$8)`,
    [s.id, s.libraryId ?? LIB, s.name, s.version ?? '1.0.0', s.state, s.root ?? s.id, s.parent ?? null, now],
  )
}

async function seedProxy(owner: string, target: string, nodeId = 'n1'): Promise<void> {
  await rawQuery(
    `INSERT INTO "proxy_reference" ("parentSpecificationId","nodeId","targetSpecificationId") VALUES ($1,$2,$3)`,
    [owner, nodeId, target],
  )
}

/** A one-library .WFlibX bundle holding the given specs. */
async function makeBundle(specs: Array<{ oid: string; name: string; version?: string }>): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    'manifest.json',
    JSON.stringify({
      packageType: 'workflow-library',
      packageVersion: '1.1',
      libraryName: LIB_NAME,
      oidIndex: {
        libraries: [{ oid: BUNDLE_LIB, name: LIB_NAME, entityType: 'workflow', version: '1.0.0' }],
        specifications: specs.map((s) => ({
          oid: s.oid,
          libraryOid: BUNDLE_LIB,
          name: s.name,
          version: s.version ?? '1.0.0',
        })),
      },
    }),
  )
  zip.file(
    `${LIB_NAME}.WFlib`,
    JSON.stringify({
      oid: BUNDLE_LIB,
      local_id: LIB_NAME,
      version: '1.0.0',
      workflow_specifications: specs.map((s) => ({
        oid: s.oid,
        local_id: s.name,
        version: s.version ?? '1.0.0',
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

async function commit(previewId: string, resolutions: Record<string, 'keep' | 'replace'>): Promise<Response> {
  return f.app.request('/api/v2/packages/workflow-library/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify({ previewId, resolutions, teamId: f.teamMainId }),
  })
}

function row(plan: ImportPlan, bundleOid: string): ImportPlanRow {
  const r = plan.rows.find((x) => x.bundleOid === bundleOid)
  if (!r) throw new Error(`no plan row for ${bundleOid}`)
  return r
}

async function specIds(): Promise<string[]> {
  const rows = await rawQuery<{ id: string }>(`SELECT id FROM "specification" WHERE "libraryId" = $1 ORDER BY id`, [
    LIB,
  ])
  return rows.map((r) => r.id)
}

async function proxyRows(): Promise<Array<{ parentSpecificationId: string; targetSpecificationId: string }>> {
  return rawQuery(`SELECT "parentSpecificationId","targetSpecificationId" FROM "proxy_reference" ORDER BY 1`)
}

// ---------------------------------------------------------------------------

describe('.WFlibX import refuses a Replace that touches a locked spec', () => {
  for (const state of ['Approved', 'Effective']) {
    it(`refuses a Replace of an ${state} spec`, async () => {
      await seedLibrary()
      await seedSpec({ id: 'X', name: 'A', state })
      // An incoming proxy reference (same tree, as the trigger demands).
      await seedSpec({ id: 'X-child', name: 'A child', state, parent: 'X', root: 'X' })
      await seedProxy('X-child', 'X')
      mockSessionAs(f.userIdGlobal)

      const plan = await preview(await makeBundle([{ oid: 'BS1', name: 'A' }]))
      const s = row(plan, 'BS1').status
      expect(s.tag).toBe('refused')
      if (s.tag !== 'refused') return
      expect(s.refusal.reason).toBe('locked')
      expect(s.existingOid).toBe('X')
      expect(s.refusal.blockers).toContainEqual(
        expect.objectContaining({ specId: 'X', state, why: 'is-locked', name: 'A', version: '1.0.0' }),
      )
      // The library holds a locked spec, so its Replace is refused too.
      expect(row(plan, BUNDLE_LIB).status.tag).toBe('refused')

      const replace = await commit(plan.previewId, { [BUNDLE_LIB]: 'keep', BS1: 'replace' })
      expect(replace.status).toBe(422)
      expect(await replace.json()).toMatchObject({ error: 'locked_replace' })

      const keep = await commit(plan.previewId, { [BUNDLE_LIB]: 'keep', BS1: 'keep' })
      expect(keep.status).toBe(200)
      const report = (await keep.json()) as PostImportReport
      expect(report.refused).toContainEqual({ oid: 'X', name: 'A', version: '1.0.0', state, reason: 'locked' })

      expect(await specIds()).toEqual(['X', 'X-child'])
      const [x] = await rawQuery<{ state: string; data: string }>(
        `SELECT state, data FROM "specification" WHERE id='X'`,
      )
      expect(x).toEqual({ state, data: '{"nodes":[]}' })
      expect(await proxyRows()).toEqual([{ parentSpecificationId: 'X-child', targetSpecificationId: 'X' }])
    })
  }

  it('refuses a library Replace when the library holds one locked spec', async () => {
    await seedLibrary()
    await seedSpec({ id: 'D', name: 'Draft one', state: 'Draft' })
    await seedSpec({ id: 'E', name: 'Released one', state: 'Effective' })
    mockSessionAs(f.userIdGlobal)

    const plan = await preview(await makeBundle([{ oid: 'BS-new', name: 'Brand new' }]))
    const s = row(plan, BUNDLE_LIB).status
    expect(s.tag).toBe('refused')
    if (s.tag !== 'refused') return
    expect(s.refusal.reason).toBe('locked')
    expect(s.refusal.blockers.map((b) => b.specId)).toEqual(['E'])

    const replace = await commit(plan.previewId, { [BUNDLE_LIB]: 'replace' })
    expect(replace.status).toBe(422)
    expect(await replace.json()).toMatchObject({ error: 'locked_replace' })
    expect(await specIds()).toEqual(['D', 'E'])
  })

  it('refuses a Replace of Draft 2.0.0 whose Effective 1.0.0 is in the same family', async () => {
    await seedLibrary()
    await seedSpec({ id: 'FAM-2', name: 'Fam', version: '2.0.0', state: 'Draft' })
    // Deleting FAM-2 cascades (parentSpecificationId / rootSpecificationId ON DELETE CASCADE) to FAM-1.
    await seedSpec({ id: 'FAM-1', name: 'Fam', version: '1.0.0', state: 'Effective', parent: 'FAM-2', root: 'FAM-2' })
    mockSessionAs(f.userIdGlobal)

    const plan = await preview(await makeBundle([{ oid: 'BS-fam', name: 'Fam', version: '3.0.0' }]))
    const s = row(plan, 'BS-fam').status
    expect(s.tag).toBe('refused')
    if (s.tag !== 'refused') return
    expect(s.existingOid).toBe('FAM-2')
    expect(s.refusal).toEqual({
      reason: 'locked',
      blockers: [{ specId: 'FAM-1', name: 'Fam', version: '1.0.0', state: 'Effective', why: 'family-locked' }],
    })

    const replace = await commit(plan.previewId, { [BUNDLE_LIB]: 'keep', 'BS-fam': 'replace' })
    expect(replace.status).toBe(422)
    expect(await specIds()).toEqual(['FAM-1', 'FAM-2'])
  })

  it('refuses a Replace of a Draft that an Approved spec references by proxy', async () => {
    await seedLibrary()
    await seedSpec({ id: 'R', name: 'Root', state: 'Approved' })
    await seedSpec({ id: 'C', name: 'Child', state: 'Draft', parent: 'R', root: 'R' })
    await seedProxy('R', 'C')
    mockSessionAs(f.userIdGlobal)

    const plan = await preview(await makeBundle([{ oid: 'BS-c', name: 'Child' }]))
    const s = row(plan, 'BS-c').status
    expect(s.tag).toBe('refused')
    if (s.tag !== 'refused') return
    expect(s.refusal.blockers).toEqual([
      { specId: 'R', name: 'Root', version: '1.0.0', state: 'Approved', why: 'owns-proxy-link' },
    ])

    const replace = await commit(plan.previewId, { [BUNDLE_LIB]: 'keep', 'BS-c': 'replace' })
    expect(replace.status).toBe(422)
    expect(await proxyRows()).toEqual([{ parentSpecificationId: 'R', targetSpecificationId: 'C' }])
  })

  it("refuses an administrator's Replace of an Effective spec", async () => {
    await seedLibrary()
    await seedSpec({ id: 'X', name: 'A', state: 'Effective' })
    const admin = await seedAdminUser(f)
    mockSessionAs(admin)

    const plan = await preview(await makeBundle([{ oid: 'BS1', name: 'A' }]))
    const s = row(plan, 'BS1').status
    expect(s.tag === 'refused' && s.refusal.reason).toBe('locked')

    const replace = await commit(plan.previewId, { [BUNDLE_LIB]: 'keep', BS1: 'replace' })
    expect(replace.status).toBe(422)
    expect(await replace.json()).toMatchObject({ error: 'locked_replace' })
    expect(await specIds()).toEqual(['X'])
  })

  it("refuses a Replace without delete rights in the importer's own team", async () => {
    await seedLibrary()
    await seedSpec({ id: 'D', name: 'A', state: 'Draft' })
    // Librarian only: may create libraries (so the preview opens) but not delete specs.
    const now = new Date()
    await rawQuery(
      `INSERT INTO "user" ("id","email","emailVerified","createdAt","updatedAt") VALUES ('test-librarian','lib@example.com',false,$1,$1)`,
      [now],
    )
    await rawQuery(`INSERT INTO "user_team" ("userId","teamId") VALUES ('test-librarian',$1)`, [f.teamMainId])
    await rawQuery(
      `INSERT INTO "user_team_role" ("userId","teamId","roleId") VALUES ('test-librarian',$1,'role-librarian')`,
      [f.teamMainId],
    )
    mockSessionAs('test-librarian')

    const plan = await preview(await makeBundle([{ oid: 'BS1', name: 'A' }]))
    const s = row(plan, 'BS1').status
    expect(s.tag).toBe('refused')
    if (s.tag !== 'refused') return
    expect(s.refusal).toEqual({ reason: 'no-permission', blockers: [] })

    const replace = await commit(plan.previewId, { [BUNDLE_LIB]: 'keep', BS1: 'replace' })
    expect(replace.status).toBe(422)
    expect(await replace.json()).toMatchObject({ error: 'locked_replace' })
    expect(await specIds()).toEqual(['D'])
  })

  it('still replaces a Draft', async () => {
    await seedLibrary()
    await seedSpec({ id: 'D', name: 'A', state: 'Draft' })
    mockSessionAs(f.userIdGlobal)

    const plan = await preview(await makeBundle([{ oid: 'BS1', name: 'A' }]))
    expect(row(plan, 'BS1').status).toMatchObject({ tag: 'conflict', existingOid: 'D' })

    const res = await commit(plan.previewId, { [BUNDLE_LIB]: 'keep', BS1: 'replace' })
    expect(res.status).toBe(200)
    const report = (await res.json()) as PostImportReport
    expect(report.replaced.specifications).toBe(1)
    expect(report.refused).toEqual([])
    expect(await specIds()).toEqual(['BS1'])
  })

  it('compares against the newest version', async () => {
    await seedLibrary()
    // Newest first, so a last-one-wins lookup would pick 1.0.0.
    await seedSpec({ id: 'N-2', name: 'N', version: '2.0.0', state: 'Draft' })
    await seedSpec({ id: 'N-1', name: 'N', version: '1.0.0', state: 'Effective' })
    mockSessionAs(f.userIdGlobal)

    const plan = await preview(await makeBundle([{ oid: 'BS-n', name: 'N', version: '3.0.0' }]))
    expect(row(plan, 'BS-n').status).toMatchObject({ tag: 'conflict', existingOid: 'N-2', existingVersion: '2.0.0' })
  })

  it('the rest of the package imports', async () => {
    await seedLibrary()
    await seedSpec({ id: 'L', name: 'Locked', state: 'Effective' })
    mockSessionAs(f.userIdGlobal)

    const plan = await preview(
      await makeBundle([
        { oid: 'BS-l', name: 'Locked' },
        { oid: 'BS-a', name: 'New A' },
        { oid: 'BS-b', name: 'New B' },
      ]),
    )
    expect(row(plan, 'BS-l').status.tag).toBe('refused')
    expect(row(plan, 'BS-a').status.tag).toBe('add-to-existing')

    // Refused rows need no resolution.
    const res = await commit(plan.previewId, {})
    expect(res.status).toBe(200)
    const report = (await res.json()) as PostImportReport
    expect(report.created.specifications).toBe(2)
    expect(report.refused).toEqual([
      { oid: 'L', name: 'Locked', version: '1.0.0', state: 'Effective', reason: 'locked' },
    ])
    expect(await specIds()).toEqual(['BS-a', 'BS-b', 'L'])
  })
})
