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

// Spec 2026-10-21 §6: the lock rule also holds inside the transaction that deletes. A spec that is
// released after the commit's pre-transaction check (simulated by a hook that runs right after
// that check) is still never deleted, and the whole package rolls back.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import JSZip from 'jszip'
import { setupTestFixture, resetAndSeedFixture, mockSessionAs, rawQuery, type TestFixture } from './testSeed'
import type { ImportPlan } from '@/types/wflibx-import'

/** Runs once, right after the commit route's pre-transaction refusal check. */
const race: { afterPreCheck: (() => Promise<void>) | null; calls: number } = { afterPreCheck: null, calls: 0 }

vi.mock('../../../packageFormat/replaceBlockers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../packageFormat/replaceBlockers')>()
  return {
    ...actual,
    refuseBlockedReplaces: async (...args: Parameters<typeof actual.refuseBlockedReplaces>) => {
      const rows = await actual.refuseBlockedReplaces(...args)
      race.calls += 1
      // Call 1 is the preview, call 2 the commit's pre-check.
      if (race.calls === 2 && race.afterPreCheck) await race.afterPreCheck()
      return rows
    },
  }
})

let f: TestFixture

beforeAll(async () => {
  f = await setupTestFixture()
})

beforeEach(async () => {
  await resetAndSeedFixture(f)
  race.afterPreCheck = null
  race.calls = 0
  mockSessionAs(null)
})

const LIB = 'lib-race'
const LIB_NAME = 'Race Lib'
const BUNDLE_LIB = 'BL1'

async function seedLibrary(): Promise<void> {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "library" ("id","teamId","name","entityType","version","createdAt","updatedAt")
     VALUES ($1,$2,$3,'workflow','1.0.0',$4,$4)`,
    [LIB, f.teamMainId, LIB_NAME, now],
  )
}

async function seedSpec(s: { id: string; name: string; state: string; parent?: string; root?: string }) {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "specification"
       ("id","libraryId","name","version","state","data",
        "rootSpecificationId","parentSpecificationId","dataSchemaVersion","createdAt","updatedAt")
     VALUES ($1,$2,$3,'1.0.0',$4,'{"nodes":[]}',$5,$6,3,$7,$7)`,
    [s.id, LIB, s.name, s.state, s.root ?? s.id, s.parent ?? null, now],
  )
}

async function release(id: string): Promise<void> {
  await rawQuery(`UPDATE "specification" SET state = 'Effective' WHERE id = $1`, [id])
}

/** Bundle order is apply order: the new spec is written BEFORE the Replace, so a rollback shows. */
async function makeBundle(specs: Array<{ oid: string; name: string }>): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    'manifest.json',
    JSON.stringify({
      packageType: 'workflow-library',
      packageVersion: '1.1',
      libraryName: LIB_NAME,
      oidIndex: {
        libraries: [{ oid: BUNDLE_LIB, name: LIB_NAME, entityType: 'workflow', version: '1.0.0' }],
        specifications: specs.map((s) => ({ oid: s.oid, libraryOid: BUNDLE_LIB, name: s.name, version: '1.0.0' })),
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
        version: '1.0.0',
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

async function specsInLib(): Promise<Array<{ id: string; state: string }>> {
  return rawQuery(`SELECT id, state FROM "specification" WHERE "libraryId" = $1 ORDER BY id`, [LIB])
}

async function proxyRows(): Promise<Array<{ parentSpecificationId: string; targetSpecificationId: string }>> {
  return rawQuery(`SELECT "parentSpecificationId","targetSpecificationId" FROM "proxy_reference" ORDER BY 1`)
}

describe('.WFlibX commit re-checks locks inside the transaction', () => {
  it('refuses when the target spec is released after the pre-check, and rolls back the package', async () => {
    await seedLibrary()
    await seedSpec({ id: 'T', name: 'A', state: 'Draft' })
    await seedSpec({ id: 'T-child', name: 'A child', state: 'Draft', parent: 'T', root: 'T' })
    await rawQuery(
      `INSERT INTO "proxy_reference" ("parentSpecificationId","nodeId","targetSpecificationId") VALUES ('T-child','n1','T')`,
    )
    mockSessionAs(f.userIdGlobal)

    const plan = await preview(
      await makeBundle([
        { oid: 'BS-0new', name: 'Brand new' },
        { oid: 'BS-a', name: 'A' },
      ]),
    )
    expect(plan.rows.find((r) => r.bundleOid === 'BS-a')?.status.tag).toBe('conflict')

    race.afterPreCheck = () => release('T')
    const res = await commit(plan.previewId, { [BUNDLE_LIB]: 'keep', 'BS-a': 'replace' })
    expect(race.calls).toBe(2)
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: 'locked_replace', code: 'locked_replace' })

    expect(await specsInLib()).toEqual([
      { id: 'T', state: 'Effective' },
      { id: 'T-child', state: 'Draft' },
    ])
    expect(await proxyRows()).toEqual([{ parentSpecificationId: 'T-child', targetSpecificationId: 'T' }])
    // Full rollback: the new spec written before the Replace is gone too.
    expect(await rawQuery(`SELECT 1 FROM "specification" WHERE id IN ('BS-0new','BS-a')`)).toHaveLength(0)
  })

  it('refuses when a cascade target is released after the pre-check', async () => {
    await seedLibrary()
    await seedSpec({ id: 'T', name: 'A', state: 'Draft' })
    await seedSpec({ id: 'T-child', name: 'A child', state: 'Draft', parent: 'T', root: 'T' })
    mockSessionAs(f.userIdGlobal)

    const plan = await preview(await makeBundle([{ oid: 'BS-a', name: 'A' }]))
    race.afterPreCheck = () => release('T-child')
    const res = await commit(plan.previewId, { [BUNDLE_LIB]: 'keep', 'BS-a': 'replace' })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({
      error: 'locked_replace',
      blockers: [expect.objectContaining({ specId: 'T-child', why: 'family-locked' })],
    })
    expect((await specsInLib()).map((s) => s.id)).toEqual(['T', 'T-child'])
  })

  it('refuses when a proxy-link owner is released after the pre-check', async () => {
    await seedLibrary()
    await seedSpec({ id: 'R', name: 'Root', state: 'Draft' })
    await seedSpec({ id: 'C', name: 'Child', state: 'Draft', parent: 'R', root: 'R' })
    await rawQuery(
      `INSERT INTO "proxy_reference" ("parentSpecificationId","nodeId","targetSpecificationId") VALUES ('R','n1','C')`,
    )
    mockSessionAs(f.userIdGlobal)

    const plan = await preview(await makeBundle([{ oid: 'BS-c', name: 'Child' }]))
    race.afterPreCheck = () => release('R')
    const res = await commit(plan.previewId, { [BUNDLE_LIB]: 'keep', 'BS-c': 'replace' })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({
      blockers: [expect.objectContaining({ specId: 'R', why: 'owns-proxy-link' })],
    })
    expect(await proxyRows()).toEqual([{ parentSpecificationId: 'R', targetSpecificationId: 'C' }])
    expect((await specsInLib()).map((s) => s.id)).toEqual(['C', 'R'])
  })

  it('refuses a library Replace when one of its specs is released after the pre-check', async () => {
    await seedLibrary()
    await seedSpec({ id: 'D1', name: 'One', state: 'Draft' })
    await seedSpec({ id: 'D2', name: 'Two', state: 'Draft' })
    mockSessionAs(f.userIdGlobal)

    const plan = await preview(await makeBundle([{ oid: 'BS-n', name: 'New' }]))
    expect(plan.rows.find((r) => r.bundleOid === BUNDLE_LIB)?.status.tag).toBe('conflict')
    race.afterPreCheck = () => release('D2')
    const res = await commit(plan.previewId, { [BUNDLE_LIB]: 'replace' })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: 'locked_replace' })
    expect(await rawQuery(`SELECT 1 FROM "library" WHERE id = $1`, [LIB])).toHaveLength(1)
    expect((await specsInLib()).map((s) => s.id)).toEqual(['D1', 'D2'])
    expect(await rawQuery(`SELECT 1 FROM "library" WHERE id = $1`, [BUNDLE_LIB])).toHaveLength(0)
  })
})
