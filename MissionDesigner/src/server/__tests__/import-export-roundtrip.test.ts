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

// Round-trip parity for the v7.0 envelope migration. Exporting a workflow then
// importing the produced ZIP into a fresh library must preserve the structural
// content. The runtime contract that the export targets lives in
// TrajectoryRuntime's `spec/docs/editor-export-format.md`; here we just verify that
// the editor's own import path round-trips its own export.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import JSZip from 'jszip'
import { EXPORT_WARNINGS_HEADER, decodeExportWarnings } from '@/lib/packageFormat/export-warnings-header'
import type { FormDocument } from '@mission/form-schema'
import {
  setupTestFixture,
  resetAndSeedFixture,
  mockSessionAs,
  v2Req,
  rawQuery,
  type TestFixture,
} from '../routes/v2/__tests__/testSeed'

let f: TestFixture
beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetAndSeedFixture(f)
  mockSessionAs(f.userIdGlobal)
})

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000000500' +
    '010da25e6c0000000049454e44ae426082',
  'hex',
)

/** Create a fresh shared library owned by userIdGlobal in teamMain and return its id.
 *  teamMain membership is what makes it readable/writable by userIdGlobal under the
 *  team policy engine (team membership governs visibility). */
async function createImportTargetLib(f: TestFixture, id: string): Promise<void> {
  const NOW = Date.now()
  await rawQuery(
    `INSERT INTO "library" (id, "createdByUserId", "teamId", name, "entityType", version, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'Import Target', 'workflow', '1.0.0', $4, $5)`,
    [id, f.userIdGlobal, f.teamMainId, NOW, NOW],
  )
}

/** Seed a second team that userIdOther belongs to (with create + edit rights) so the
 *  cross-team import paths below can import into a library the *other* user can write,
 *  while keeping userIdOther a non-member of teamMain. This is the team-model stand-in
 *  for the old "import as a different account that doesn't have the env lib yet". */
const TEAM_OTHER = 'team-other'
async function seedTeamOther(f: TestFixture): Promise<void> {
  const NOW = Date.now()
  await rawQuery(
    `INSERT INTO "team" (id, name, description, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
    [TEAM_OTHER, 'Other Team', 'fixture', NOW, NOW],
  )
  await rawQuery(`INSERT INTO "user_team" ("userId", "teamId") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
    f.userIdOther,
    TEAM_OTHER,
  ])
  for (const roleId of ['role-author', 'role-librarian']) {
    await rawQuery(
      `INSERT INTO "user_team_role" ("userId", "teamId", "roleId") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [f.userIdOther, TEAM_OTHER, roleId],
    )
  }
}

/** Insert a workflow library owned by userIdOther in TEAM_OTHER. */
async function createOtherTeamTargetLib(f: TestFixture, id: string, name: string): Promise<void> {
  const NOW = Date.now()
  await rawQuery(
    `INSERT INTO "library" (id, "createdByUserId", "teamId", name, "entityType", version, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'workflow', '1.0.0', $5, $6)`,
    [id, f.userIdOther, TEAM_OTHER, name, NOW, NOW],
  )
}

interface V7Workflow {
  schemaVersion: string
  local_id: string
  oid: string
  state?: string
  steps: Array<{ local_id: string; oid: string; step_type: string }>
  connections: unknown[]
  children?: V7Workflow[]
}

async function readWorkflowJson(zip: Buffer): Promise<V7Workflow> {
  const z = await JSZip.loadAsync(zip)
  const entry = Object.keys(z.files).find((n) => n.endsWith('.WFmaster'))
  expect(entry).toBeDefined()
  const text = await z.files[entry!].async('string')
  return JSON.parse(text) as V7Workflow
}

async function exportToZip(rootSpecId: string): Promise<Buffer> {
  const res = await v2Req(f, 'GET', `/api/v2/packages/workflow/${rootSpecId}`)
  expect(res.status).toBe(200)
  return Buffer.from(await res.arrayBuffer())
}

async function importFromZip(
  zip: Buffer,
  targetLibraryId: string,
): Promise<{ rootSpecId: string; specCount: number; imageCount: number }> {
  const form = new FormData()
  form.set('file', new Blob([zip as BlobPart], { type: 'application/zip' }), 'workflow.WFmasterX')
  form.set('targetLibraryId', targetLibraryId)
  const res = await f.app.request('/api/v2/packages/import', {
    method: 'POST',
    body: form,
    headers: { origin: 'http://localhost:5173' },
  })
  if (res.status !== 200) {
    const body = await res.text()
    throw new Error(`Import failed with status ${res.status}: ${body}`)
  }
  return (await res.json()) as { rootSpecId: string; specCount: number; imageCount: number }
}

/** Realistic editor-style node data with stepType in node.data — what the
 *  exporter expects from a real saved workflow. */
function buildEditorRootData(): string {
  return JSON.stringify({
    nodes: [
      {
        id: 'n-start',
        type: 'start',
        position: { x: 100, y: 100 },
        data: { stepType: 'start', label: 'Start' },
      },
      {
        id: 'n-end',
        type: 'end',
        position: { x: 100, y: 250 },
        data: { stepType: 'end', label: 'End' },
      },
    ],
    edges: [{ id: 'e1', source: 'n-start', target: 'n-end' }],
  })
}

describe('import / export round-trip parity (v7.0)', () => {
  it('round-trips a single root spec with no images', async () => {
    // Seed the root spec with realistic editor node data.
    await rawQuery('UPDATE "specification" SET data = $1 WHERE id = $2', [buildEditorRootData(), f.rootSpecId])

    const zipA = await exportToZip(f.rootSpecId)
    const wfA = await readWorkflowJson(zipA)

    // v7.0 shape assertions.
    // P4.1 Task 3: export now emits the 5.0 envelope (form_document, not form_layout_config).
    expect(wfA.schemaVersion).toBe('5.0')
    expect(wfA.local_id).toBe('Shared Root')
    expect(wfA.oid).toBe(f.rootSpecId)
    expect(wfA.steps.length).toBe(2)
    expect(wfA.steps.map((s) => s.step_type).sort()).toEqual(['END', 'START'])

    // Import into a fresh library and re-export.
    await createImportTargetLib(f, 'lib-import-1')
    const imported = await importFromZip(zipA, 'lib-import-1')
    expect(imported.specCount).toBe(1)

    const zipB = await exportToZip(imported.rootSpecId)
    const wfB = await readWorkflowJson(zipB)

    // Structural equality (oid differs after import; everything else matches).
    expect(wfB.schemaVersion).toBe('5.0')
    expect(wfB.local_id).toBe(wfA.local_id)
    expect(wfB.steps.length).toBe(wfA.steps.length)
    expect(wfB.steps.map((s) => s.step_type).sort()).toEqual(wfA.steps.map((s) => s.step_type).sort())
  })

  it('round-trips a root + one child + one image', async () => {
    // Build a root that references a USER_INTERACTION step with a form image.
    const NOW = Date.now()
    const rootData = JSON.stringify({
      nodes: [
        {
          id: 'n-start',
          type: 'start',
          position: { x: 100, y: 100 },
          data: { stepType: 'start', label: 'Start' },
        },
        {
          id: 'n-form',
          type: 'userInteractionStep',
          position: { x: 100, y: 250 },
          data: {
            stepType: 'userInteractionStep',
            label: 'Form',
            formLayouts: {
              phone: {
                canvasWidth: 390,
                canvasHeight: 844,
                elements: [
                  {
                    id: 'el-img',
                    type: 'image',
                    x: 0,
                    y: 0,
                    width: 200,
                    height: 200,
                    src: 'cover.png',
                    imageOid: 'oid-cover',
                  },
                ],
              },
              tablet: { canvasWidth: 768, canvasHeight: 1024, elements: [] },
              desktop: { canvasWidth: 768, canvasHeight: 1024, elements: [] },
            },
            // P4.1 Task 6 fixture refit (2026-07-23): export reads formDocument
            // exclusively (Task 3) — a formLayouts-only node round-trips with NO
            // form config at all, same defect class as the Task-8-owned fixture
            // below. Carrying both fields here (same image, both v1 and v2 walks
            // dedupe onto it) models "realistic editor-style node data" as a
            // v2-designed step, which is what this test's image-bundling
            // assertions need — mirrors the fixture-refit pattern task-5-report.md
            // used for the same Task-3 fallout in form-layout-import.test.ts.
            formDocument: {
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
                          id: 'blk-cover',
                          type: 'image',
                          src: 'cover.png',
                          imageOid: 'oid-cover',
                          layout: { aspectRatio: '16/9' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          id: 'n-end',
          type: 'end',
          position: { x: 100, y: 400 },
          data: { stepType: 'end', label: 'End' },
        },
      ],
      edges: [
        { id: 'e1', source: 'n-start', target: 'n-form' },
        { id: 'e2', source: 'n-form', target: 'n-end' },
      ],
    })
    await rawQuery('UPDATE "specification" SET data = $1 WHERE id = $2', [rootData, f.rootSpecId])

    // Add a child workflow.
    const childData = JSON.stringify({
      nodes: [
        { id: 'cn-start', type: 'start', position: { x: 100, y: 100 }, data: { stepType: 'start', label: 'Start' } },
        { id: 'cn-end', type: 'end', position: { x: 100, y: 250 }, data: { stepType: 'end', label: 'End' } },
      ],
      edges: [{ id: 'ce1', source: 'cn-start', target: 'cn-end' }],
    })
    await rawQuery(
      `INSERT INTO "specification" (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('c1', $1, 'Child', '1.0.0', 'Draft', $2, $3, $4, 3, $5, $6)`,
      [f.libSharedId, childData, f.rootSpecId, f.rootSpecId, NOW, NOW],
    )

    // Add an image owned by the root spec.
    await rawQuery(
      'INSERT INTO "image_blob" ("contentHash", data, "mimeType", "byteSize", "createdAt", "refCount") VALUES ($1, $2, $3, $4, $5, 0)',
      ['h1', PNG_BYTES, 'image/png', PNG_BYTES.length, NOW],
    )
    await rawQuery(
      'INSERT INTO "image" (id, "specificationId", filename, "mimeType", "contentHash", "createdAt") VALUES ($1, $2, $3, $4, $5, $6)',
      ['i1', f.rootSpecId, 'cover.png', 'image/png', 'h1', NOW],
    )

    const zipA = await exportToZip(f.rootSpecId)
    const wfA = await readWorkflowJson(zipA)

    // v7.0 shape: 1 root + 1 child.
    // P4.1 Task 3: export now emits the 5.0 envelope (form_document, not form_layout_config).
    expect(wfA.schemaVersion).toBe('5.0')
    expect(wfA.children?.length ?? 0).toBe(1)
    expect(wfA.children?.[0].local_id).toBe('Child')

    // Image is in the ZIP under images/{imageOid}-{filename} per the runtime spec.
    // RESOLVED P4.1 Task 6 (2026-07-23, was a KNOWN GAP left by Task 3): the
    // server-side image walk (buildWorkflowPackage.ts -> collectFormElementImages)
    // now reads the v2 step.form_document shape instead of the retired
    // step.form_layout_config. See task-6-report.md.
    const zipObjA = await JSZip.loadAsync(zipA)
    const hasFormImage = Object.keys(zipObjA.files).some((n) => n.startsWith('images/') && n.endsWith('cover.png'))
    expect(hasFormImage).toBe(true)

    // Import into a fresh library — creates a duplicate tree with new ids.
    await createImportTargetLib(f, 'lib-import-2')
    const imported = await importFromZip(zipA, 'lib-import-2')
    expect(imported.specCount).toBe(2)
    expect(imported.imageCount).toBeGreaterThanOrEqual(1)

    const zipB = await exportToZip(imported.rootSpecId)
    const wfB = await readWorkflowJson(zipB)

    expect(wfB.schemaVersion).toBe('5.0')
    expect(wfB.children?.length ?? 0).toBe(1)
    expect(wfB.children?.[0].local_id).toBe('Child')

    const zipObjB = await JSZip.loadAsync(zipB)
    const hasImageB = Object.keys(zipObjB.files).some((n) => n.startsWith('images/') && n.endsWith('cover.png'))
    expect(hasImageB).toBe(true)
  })

  it('round-trips a workflow with an environment library reference (Phase 2 — auto-create on import)', async () => {
    const NOW = Date.now()

    // Add an env spec inside the shared env library so the export has something
    // to embed under environments/.
    const envSpecData = JSON.stringify({
      included_actions: [{ action_name: 'Toast Bread', action_library: 'Kitchen Actions' }],
      values: [],
      actionProperties: [],
      resources: [],
    })
    await rawQuery(
      `INSERT INTO "specification" (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('env-spec-1', $1, 'Bakery', '1.0.0', 'Draft', $2, 'env-spec-1', NULL, 3, $3, $4)`,
      [f.libEnvSharedId, envSpecData, NOW, NOW],
    )

    // Wire the workflow's root spec to reference that env spec.
    const workflowData = JSON.stringify({
      nodes: [
        { id: 'n-start', type: 'start', position: { x: 100, y: 100 }, data: { stepType: 'start', label: 'Start' } },
        { id: 'n-end', type: 'end', position: { x: 100, y: 250 }, data: { stepType: 'end', label: 'End' } },
      ],
      edges: [{ id: 'e1', source: 'n-start', target: 'n-end' }],
      environmentSpecIds: ['env-spec-1'],
    })
    await rawQuery('UPDATE "specification" SET data = $1 WHERE id = $2', [workflowData, f.rootSpecId])
    await rawQuery(
      `INSERT INTO "specification_environment" ("specificationId", "environmentLibraryId") VALUES ($1, $2)`,
      [f.rootSpecId, f.libEnvSharedId],
    )

    const zipA = await exportToZip(f.rootSpecId)
    const zipObjA = await JSZip.loadAsync(zipA)
    // The export must include the env library under environments/.
    const envLibEntries = Object.keys(zipObjA.files).filter(
      (n) => n.startsWith('environments/') && n.endsWith('.WFenvir'),
    )
    expect(envLibEntries.length).toBe(1)
    expect(envLibEntries[0]).toBe('Shared Env.WFenvir'.replace(/^/, 'environments/'))

    // Import into a fresh library in a *different team* (TEAM_OTHER) so the env
    // library does not pre-exist there — the team-model equivalent of the old
    // "different account that doesn't have the env lib".
    const otherUser = f.userIdOther
    await seedTeamOther(f)
    await createOtherTeamTargetLib(f, 'lib-other-target', 'Other Target')

    mockSessionAs(otherUser)
    const form = new FormData()
    form.set('file', new Blob([zipA as BlobPart], { type: 'application/zip' }), 'workflow.WFmasterX')
    form.set('targetLibraryId', 'lib-other-target')
    const res = await f.app.request('/api/v2/packages/import', {
      method: 'POST',
      body: form,
      headers: { origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      rootSpecId: string
      envLibrariesCreated: number
      envLibrariesReused: number
    }
    expect(body.envLibrariesCreated).toBe(1)
    expect(body.envLibrariesReused).toBe(0)

    // The env library must now exist, created by the other user (attribution via
    // createdByUserId now that libraries are team-owned, not userId-owned).
    const [newEnvLib] = await rawQuery<{ id: string }>(
      `SELECT id FROM "library" WHERE "createdByUserId" = $1 AND name = 'Shared Env' AND "entityType" = 'environment'`,
      [otherUser],
    )
    expect(newEnvLib).toBeDefined()

    // The new workflow root spec must have a specification_environment row
    // pointing at the auto-created env library.
    const [link] = await rawQuery<{ environmentLibraryId: string }>(
      `SELECT "environmentLibraryId" FROM "specification_environment" WHERE "specificationId" = $1`,
      [body.rootSpecId],
    )
    expect(link).toBeDefined()
    expect(link!.environmentLibraryId).toBe(newEnvLib!.id)

    // The editor's SpecificationHeader renders attached environment specs out
    // of `spec.data.environmentSpecIds`. The library-level link above isn't
    // enough — without remapping the workflow's environmentSpecIds[] to the
    // newly-created env spec ids, the imported workflow looks unattached even
    // though specification_environment is correct.
    const [newEnvSpec] = await rawQuery<{ id: string }>(
      `SELECT id FROM "specification" WHERE "libraryId" = $1 AND name = 'Bakery'`,
      [newEnvLib!.id],
    )
    expect(newEnvSpec).toBeDefined()
    const [importedRootRow] = await rawQuery<{ data: string }>('SELECT data FROM "specification" WHERE id = $1', [
      body.rootSpecId,
    ])
    expect(importedRootRow).toBeDefined()
    const importedRootData = JSON.parse(importedRootRow!.data) as {
      environmentSpecIds?: string[]
      _pendingEnvironmentSpecs?: unknown
    }
    expect(importedRootData.environmentSpecIds).toEqual([newEnvSpec!.id])
    // The pending sidecar should be stripped once it's resolved into ids so
    // the persisted spec data isn't carrying duplicate state forever.
    expect(importedRootData._pendingEnvironmentSpecs).toBeUndefined()

    // Re-import into a SECOND library in the SAME team — must be idempotent: env
    // library reused, not duplicated (idempotency keys on (teamId, name, entityType)).
    // A second target library avoids the (libraryId, name, version) uniqueness
    // conflict on the workflow itself.
    await createOtherTeamTargetLib(f, 'lib-other-target-2', 'Other Target 2')
    const form2 = new FormData()
    form2.set('file', new Blob([zipA as BlobPart], { type: 'application/zip' }), 'workflow.WFmasterX')
    form2.set('targetLibraryId', 'lib-other-target-2')
    const res2 = await f.app.request('/api/v2/packages/import', {
      method: 'POST',
      body: form2,
      headers: { origin: 'http://localhost:5173' },
    })
    expect(res2.status).toBe(200)
    const body2 = (await res2.json()) as { envLibrariesCreated: number; envLibrariesReused: number }
    expect(body2.envLibrariesCreated).toBe(0)
    expect(body2.envLibrariesReused).toBe(1)

    // Still exactly one env library named 'Shared Env' created by the other user.
    const [countRow] = await rawQuery<{ c: string }>(
      `SELECT count(*) AS c FROM "library" WHERE "createdByUserId" = $1 AND name = 'Shared Env' AND "entityType" = 'environment'`,
      [otherUser],
    )
    expect(Number(countRow.c)).toBe(1)
  })

  it('round-trips a workflow with env + action library references (Phase 3 — actions/ subdir)', async () => {
    const NOW = Date.now()

    // Create an action library + one action spec, both owned by userIdGlobal in
    // teamMain. The export resolves action libraries via listVisibleLibraries
    // (team-gated), so the action lib must be in the exporter's team to be packaged.
    await rawQuery(
      `INSERT INTO "library" (id, "createdByUserId", "teamId", name, "entityType", version, "createdAt", "updatedAt")
       VALUES ('lib-action-1', $1, $2, 'Kitchen Actions', 'action', '1.0.0', $3, $4)`,
      [f.userIdGlobal, f.teamMainId, NOW, NOW],
    )
    const actionSpecData = JSON.stringify({
      inputs: [{ name: 'Temperature', defaultValue: '350' }],
      outputs: [{ name: 'ActualTemp' }],
      values: [],
      actionVisibility: 'observable',
    })
    await rawQuery(
      `INSERT INTO "specification" (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('action-spec-1', 'lib-action-1', 'Heat Oven', '1.0.0', 'Draft', $1, 'action-spec-1', NULL, 3, $2, $3)`,
      [actionSpecData, NOW, NOW],
    )

    // Create env spec referencing the action by NAME (action_library = 'Kitchen Actions').
    const envSpecData = JSON.stringify({
      included_actions: [{ action_name: 'Heat Oven', action_library: 'Kitchen Actions' }],
      values: [],
      actionProperties: [],
      resources: [],
    })
    await rawQuery(
      `INSERT INTO "specification" (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('env-spec-2', $1, 'Bakery', '1.0.0', 'Draft', $2, 'env-spec-2', NULL, 3, $3, $4)`,
      [f.libEnvSharedId, envSpecData, NOW, NOW],
    )

    // Wire workflow root → env spec.
    const workflowData = JSON.stringify({
      nodes: [
        { id: 'n-start', type: 'start', position: { x: 100, y: 100 }, data: { stepType: 'start', label: 'Start' } },
        { id: 'n-end', type: 'end', position: { x: 100, y: 250 }, data: { stepType: 'end', label: 'End' } },
      ],
      edges: [{ id: 'e1', source: 'n-start', target: 'n-end' }],
      environmentSpecIds: ['env-spec-2'],
    })
    await rawQuery('UPDATE "specification" SET data = $1 WHERE id = $2', [workflowData, f.rootSpecId])
    await rawQuery(
      `INSERT INTO "specification_environment" ("specificationId", "environmentLibraryId") VALUES ($1, $2)`,
      [f.rootSpecId, f.libEnvSharedId],
    )

    // Export — must include both environments/ and actions/ subdir entries
    // and the manifest must list them.
    const zipA = await exportToZip(f.rootSpecId)
    const zipObjA = await JSZip.loadAsync(zipA)
    const envEntries = Object.keys(zipObjA.files).filter((n) => n.startsWith('environments/') && n.endsWith('.WFenvir'))
    const actionEntries = Object.keys(zipObjA.files).filter((n) => n.startsWith('actions/') && n.endsWith('.WFaction'))
    expect(envEntries).toEqual(['environments/Shared Env.WFenvir'])
    expect(actionEntries).toEqual(['actions/Kitchen Actions.WFaction'])

    // Manifest must enumerate them in files[].
    const manifestText = await zipObjA.files['manifest.json'].async('string')
    const manifest = JSON.parse(manifestText) as {
      environmentLibraries: string[]
      actionLibraries: string[]
      files: Array<{ path: string; type: string }>
    }
    expect(manifest.environmentLibraries).toEqual(['Shared Env'])
    expect(manifest.actionLibraries).toEqual(['Kitchen Actions'])
    expect(manifest.files.some((f) => f.path === 'actions/Kitchen Actions.WFaction' && f.type === 'action')).toBe(true)
    expect(manifest.files.some((f) => f.path === 'environments/Shared Env.WFenvir' && f.type === 'environment')).toBe(
      true,
    )

    // The action library JSON itself must contain the action spec.
    const actionLibText = await zipObjA.files['actions/Kitchen Actions.WFaction'].async('string')
    const actionLib = JSON.parse(actionLibText) as {
      local_id: string
      action_specifications: Array<{ local_id: string }>
    }
    expect(actionLib.local_id).toBe('Kitchen Actions')
    expect(actionLib.action_specifications.map((a) => a.local_id)).toContain('Heat Oven')

    // The .WFenvir must inline each action's full MasterActionSpecification
    // body (matching the .WFaction shape) so the env file is self-contained
    // for the runtime / Action Server consumers — not just refs to action_name
    // + action_library. Regression for buildWorkflowPackage forgetting to
    // load action libs into allLibraries before exporting environments.
    const envFileText = await zipObjA.files['environments/Shared Env.WFenvir'].async('string')
    const envLib = JSON.parse(envFileText) as {
      environment_specifications: Array<{
        included_actions: Array<{
          action_name: string
          action_library: string
          local_id?: string
          oid?: string
          version?: string
          last_modified_date?: string
          action_visibility?: string
          input_parameter_specifications?: Array<{ id: string }>
        }>
      }>
    }
    const heatOvenInline = envLib.environment_specifications[0].included_actions.find(
      (a) => a.action_name === 'Heat Oven',
    )
    expect(heatOvenInline).toBeDefined()
    expect(heatOvenInline!.local_id).toBe('Heat Oven')
    expect(heatOvenInline!.oid).toBe('action-spec-1')
    expect(heatOvenInline!.version).toBeDefined()
    expect(heatOvenInline!.last_modified_date).toBeDefined()
    expect(heatOvenInline!.action_visibility).toBe('observable')
    expect(heatOvenInline!.input_parameter_specifications?.[0]?.id).toBe('Temperature')

    // Import into a fresh team (TEAM_OTHER) — both env AND action lib must be
    // auto-created there (they don't pre-exist for that team).
    const otherUser = f.userIdOther
    await seedTeamOther(f)
    await createOtherTeamTargetLib(f, 'lib-other-target-3', 'Other Target 3')

    mockSessionAs(otherUser)
    const form = new FormData()
    form.set('file', new Blob([zipA as BlobPart], { type: 'application/zip' }), 'workflow.WFmasterX')
    form.set('targetLibraryId', 'lib-other-target-3')
    const res = await f.app.request('/api/v2/packages/import', {
      method: 'POST',
      body: form,
      headers: { origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      rootSpecId: string
      envLibrariesCreated: number
      envLibrariesReused: number
      actionLibrariesCreated: number
      actionLibrariesReused: number
    }
    expect(body.envLibrariesCreated).toBe(1)
    expect(body.actionLibrariesCreated).toBe(1)
    expect(body.actionLibrariesReused).toBe(0)

    // Both libs must now exist, created by the other user (attribution via
    // createdByUserId now that libraries are team-owned, not userId-owned).
    const [newActionLib] = await rawQuery<{ id: string }>(
      `SELECT id FROM "library" WHERE "createdByUserId" = $1 AND name = 'Kitchen Actions' AND "entityType" = 'action'`,
      [otherUser],
    )
    expect(newActionLib).toBeDefined()
    const [heatOvenSpec] = await rawQuery<{ name: string }>(
      `SELECT name FROM "specification" WHERE "libraryId" = $1 AND name = 'Heat Oven'`,
      [newActionLib!.id],
    )
    expect(heatOvenSpec).toBeDefined()
  })

  it('round-trips an image stored as a data URI in spec.data.images (user upload flow)', async () => {
    // The form-designer upload path stores images as { filename: dataUri } in
    // spec.data.images and never writes to image_blob/image. Earlier tests
    // simulated images by inserting directly into those tables — that masked a
    // gap in the export builder which only read from image_blob. This test
    // exercises the actual user flow.
    const PNG_BASE64 = PNG_BYTES.toString('base64')
    const dataUri = `data:image/png;base64,${PNG_BASE64}`

    const rootData = JSON.stringify({
      nodes: [
        { id: 'n-start', type: 'start', position: { x: 100, y: 100 }, data: { stepType: 'start', label: 'Start' } },
        {
          id: 'n-form',
          type: 'userInteractionStep',
          position: { x: 100, y: 250 },
          data: {
            stepType: 'userInteractionStep',
            label: 'Form',
            formLayouts: {
              phone: {
                canvasWidth: 390,
                canvasHeight: 844,
                elements: [
                  {
                    id: 'el-img',
                    type: 'image',
                    x: 0,
                    y: 0,
                    width: 200,
                    height: 200,
                    src: 'logo.png',
                    imageOid: 'oid-logo',
                  },
                ],
              },
              tablet: { canvasWidth: 768, canvasHeight: 1024, elements: [] },
              desktop: { canvasWidth: 768, canvasHeight: 1024, elements: [] },
            },
            // P4.1 Task 6 fixture refit (2026-07-23) — see the identical note on
            // the "root + one child + one image" test above.
            formDocument: {
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
                          id: 'blk-logo',
                          type: 'image',
                          src: 'logo.png',
                          imageOid: 'oid-logo',
                          layout: { aspectRatio: '16/9' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        { id: 'n-end', type: 'end', position: { x: 100, y: 400 }, data: { stepType: 'end', label: 'End' } },
      ],
      edges: [
        { id: 'e1', source: 'n-start', target: 'n-form' },
        { id: 'e2', source: 'n-form', target: 'n-end' },
      ],
      // The actual upload path: spec.data.images keyed by filename → data URI.
      images: { 'logo.png': dataUri },
    })
    await rawQuery('UPDATE "specification" SET data = $1 WHERE id = $2', [rootData, f.rootSpecId])
    // No image_blob / image inserts — the bytes live only in spec.data.images.

    const zipA = await exportToZip(f.rootSpecId)
    const zipObjA = await JSZip.loadAsync(zipA)
    // The image must have been decoded and packaged at images/{imageOid}-{filename}.
    // RESOLVED P4.1 Task 6 (2026-07-23) — same server-side image walk fix as the
    // form-image assertion above. See task-6-report.md.
    const imageEntries = Object.keys(zipObjA.files).filter((n) => n.startsWith('images/') && n.endsWith('logo.png'))
    expect(imageEntries).toEqual(['images/oid-logo-logo.png'])
    const packagedBytes = await zipObjA.files['images/oid-logo-logo.png'].async('uint8array')
    expect(Buffer.from(packagedBytes).equals(PNG_BYTES)).toBe(true)

    // Round trip: import into a fresh team, the image must end up in image_blob/image.
    const otherUser = f.userIdOther
    await seedTeamOther(f)
    await createOtherTeamTargetLib(f, 'lib-other-target-data-uri', 'Other Target Data URI')

    mockSessionAs(otherUser)
    const form = new FormData()
    form.set('file', new Blob([zipA as BlobPart], { type: 'application/zip' }), 'workflow.WFmasterX')
    form.set('targetLibraryId', 'lib-other-target-data-uri')
    const res = await f.app.request('/api/v2/packages/import', {
      method: 'POST',
      body: form,
      headers: { origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rootSpecId: string; imageCount: number }
    expect(body.imageCount).toBe(1)

    const [imageRow] = await rawQuery<{ c: string }>(
      `SELECT count(*) AS c FROM "image" i WHERE i."specificationId" = $1 AND i.filename = 'logo.png'`,
      [body.rootSpecId],
    )
    expect(Number(imageRow.c)).toBe(1)

    // The editor renders images out of `spec.data.images` (the upload-flow
    // source of truth), so import must mirror the bytes back as a data URI on
    // the new spec's data blob. Without this, all imported images render as
    // upload placeholders even though the legacy image_blob table is full.
    const [importedRow] = await rawQuery<{ data: string }>('SELECT data FROM "specification" WHERE id = $1', [
      body.rootSpecId,
    ])
    expect(importedRow).toBeDefined()
    const importedData = JSON.parse(importedRow!.data) as { images?: Record<string, string> }
    expect(importedData.images?.['logo.png']).toBe(dataUri)
  })

  it('imports a v7 package without an images/ directory and clears form-element src', async () => {
    // A workflow that references an image but ships in a ZIP with no images/
    // entries at all should import successfully with the src field cleared so
    // the editor shows the upload placeholder. This is the common case for
    // packages stripped of binary assets (e.g. for review or version-control).
    const rootData = JSON.stringify({
      nodes: [
        {
          id: 'n-form',
          type: 'userInteractionStep',
          position: { x: 100, y: 100 },
          data: {
            stepType: 'userInteractionStep',
            label: 'Form',
            formLayouts: {
              phone: {
                canvasWidth: 390,
                canvasHeight: 844,
                elements: [
                  {
                    id: 'el-img',
                    type: 'image',
                    x: 0,
                    y: 0,
                    width: 200,
                    height: 200,
                    src: 'banner.png',
                    imageOid: 'oid-banner',
                  },
                ],
              },
              tablet: { canvasWidth: 768, canvasHeight: 1024, elements: [] },
              desktop: { canvasWidth: 768, canvasHeight: 1024, elements: [] },
            },
            // P4.1 Task 8 fixture refit (2026-07-23) — see the resolution comment
            // below the import call for why this carries a hand-authored
            // formDocument alongside formLayouts rather than relying on
            // migrateFormDocuments() to derive one: the converter builds its v2
            // section/row structure exclusively from v1.desktop.elements (see
            // convertFormLayouts in @mission/form-schema), and this fixture's
            // desktop layout is empty — a real migration run over these exact
            // bytes would silently drop the image instead of preserving it.
            formDocument: {
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
                          id: 'blk-banner',
                          type: 'image',
                          src: 'banner.png',
                          imageOid: 'oid-banner',
                          layout: { aspectRatio: '16/9' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        { id: 'n-end', type: 'end', position: { x: 100, y: 250 }, data: { stepType: 'end', label: 'End' } },
      ],
      edges: [{ id: 'e1', source: 'n-form', target: 'n-end' }],
      images: { 'banner.png': `data:image/png;base64,${PNG_BYTES.toString('base64')}` },
    })
    await rawQuery('UPDATE "specification" SET data = $1 WHERE id = $2', [rootData, f.rootSpecId])

    // Export the workflow normally — produces a ZIP with the image included.
    const zipFull = await exportToZip(f.rootSpecId)

    // Strip the images/ directory from the ZIP before importing. This mirrors
    // what someone would do if they wanted to share a workflow without the
    // binary assets, and proves the import is tolerant.
    const fullZip = await JSZip.loadAsync(zipFull)
    const stripped = new JSZip()
    for (const name of Object.keys(fullZip.files)) {
      if (name.startsWith('images/')) continue
      const entry = fullZip.files[name]
      if (entry.dir) continue
      stripped.file(name, await entry.async('uint8array'))
    }
    const strippedBytes = Buffer.from(await stripped.generateAsync({ type: 'uint8array' }))

    // Import the stripped ZIP into a fresh library (TEAM_OTHER).
    const otherUser = f.userIdOther
    await seedTeamOther(f)
    await createOtherTeamTargetLib(f, 'lib-no-images', 'No Images')
    mockSessionAs(otherUser)
    const form = new FormData()
    form.set('file', new Blob([strippedBytes], { type: 'application/zip' }), 'workflow.WFmasterX')
    form.set('targetLibraryId', 'lib-no-images')
    const res = await f.app.request('/api/v2/packages/import', {
      method: 'POST',
      body: form,
      headers: { origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rootSpecId: string; imageCount: number }
    expect(body.imageCount).toBe(0) // no image bytes were available, none were inserted

    // The form-element image reference must be cleared — runtime/editor will
    // render the upload placeholder rather than a broken reference.
    //
    // RESOLVED P4.1 Task 8 (2026-07-23, was a KNOWN GAP left by Task 3): export
    // reads formDocument exclusively, so a spec must already carry a v2
    // formDocument for its form config to survive a round trip at all. This
    // fixture now hand-authors a formDocument alongside formLayouts (Task 8
    // fixture refit, mirroring the Task 6 refit above) rather than relying on
    // migrateFormDocuments() to derive one inline: the converter builds its v2
    // section/row structure exclusively from v1.desktop.elements (see
    // convertFormLayouts in @mission/form-schema), and this fixture's
    // desktop layout is intentionally empty (only phone carries the image) — a
    // real migration run over these exact bytes would silently drop the image
    // instead of preserving it, defeating the point of this test. This models
    // the real post-migration world (every existing spec gets formDocument
    // minted by migrateFormDocuments() at boot) without coupling this test's
    // outcome to the v1→v2 converter's clustering internals; the migration
    // itself is exercised end-to-end by formDocumentMigration.test.ts.
    //
    // Asserts the v2-shape counterpart of the old v1 assertion:
    // clearMissingImageSrcs (packages.ts) clears a missing v2 image block's src
    // to the palette placeholder and drops its dangling imageOid — v2's src has
    // minLength:1, so '' (the v1 clearing convention) would invalidate the
    // document.
    const [row] = await rawQuery<{ data: string }>('SELECT data FROM "specification" WHERE id = $1', [body.rootSpecId])
    expect(row).toBeDefined()
    const data = JSON.parse(row!.data) as {
      nodes: Array<{
        data?: {
          formDocument?: {
            sections?: Array<{ rows?: Array<{ blocks?: Array<{ type: string; src?: string; imageOid?: string }> }> }>
          }
        }
      }>
    }
    const formNode = data.nodes.find((n) => n.data?.formDocument)
    expect(formNode).toBeDefined()
    const imgBlock = formNode!
      .data!.formDocument!.sections?.flatMap((s) => s.rows ?? [])
      .flatMap((r) => r.blocks ?? [])
      .find((b) => b.type === 'image')
    expect(imgBlock?.src).toBe('No image selected')
    expect(imgBlock?.imageOid).toBeUndefined()
  })

  it('exports the real lifecycle state; import intentionally re-enters Draft (§7)', async () => {
    // Tasks 1-4 wired the exporter to emit spec.state and the parser to read it
    // back into the import plan, but that's only proven at the pure-function
    // level (packageFormat/__tests__/state-roundtrip.test.ts). This test
    // exercises the real DB-backed path end to end.
    //
    // Dennis's call (Option A, 2026-07-22): batch-save's phase2Apply.ts always
    // births CREATEd root specs as Draft — "lifecycle moves only via PATCH
    // /state (design §7)" — and that rule is intentional, not a bug: it closes
    // a state/version-update bypass (an ordinary client create must never be
    // able to claim an already-Approved state and skip the real, rights-gated
    // approval transition). Import reuses that same create path, so an
    // imported root intentionally re-enters Draft even when the source spec
    // was Approved. What import-export actually owes the round-trip is that
    // the EXPORTED PACKAGE carries the real lifecycle state (so a human or a
    // downstream consumer of the .WFmaster file can see it) — that's what
    // Tasks 1-2 built and what this test pins down, alongside the intentional
    // reset-to-Draft invariant so a future change to that invariant is a
    // deliberate, visible decision rather than a silent regression.
    const NOW = Date.now()
    const srcLibId = 'rt-state-srclib'
    const srcSpecId = 'rt-state-src'
    // Column list matches testSeed.ts's specification seed (the file's source
    // of truth for the insert shape): id, libraryId, name, version, state,
    // data, rootSpecificationId, parentSpecificationId, dataSchemaVersion,
    // createdAt, updatedAt. parentSpecificationId = NULL / rootSpecificationId
    // = self marks this as a root spec (bypasses the root-consistency trigger,
    // same as testSeed.ts's own root specs).
    await rawQuery(
      `INSERT INTO "library" (id, "createdByUserId", "teamId", name, "entityType", version, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'RT State SrcLib', 'workflow', '1.0.0', $4, $5)`,
      [srcLibId, f.userIdGlobal, f.teamMainId, NOW, NOW],
    )
    await rawQuery(
      `INSERT INTO "specification"
         (id, "libraryId", name, version, state, data,
          "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [srcSpecId, srcLibId, 'RT State WF', '2.0.0', 'Approved', buildEditorRootData(), srcSpecId, null, 3, NOW, NOW],
    )

    // 1. Export via the real API and confirm the package carries the actual
    //    lifecycle state — the goal this feature exists to deliver.
    const zip = await exportToZip(srcSpecId)
    const wf = await readWorkflowJson(zip)
    expect(wf.state).toBe('Approved')

    // 2. Import structurally round-trips (succeeds and yields a new root id).
    //    importFromZip() itself throws on a non-200 response, so reaching the
    //    destructure already proves success; assert rootSpecId is present too.
    const targetLibId = 'rt-state-target'
    await createImportTargetLib(f, targetLibId)
    const { rootSpecId } = await importFromZip(zip, targetLibId)
    expect(rootSpecId).toBeTruthy()

    // 3. Pin the intended invariant: the persisted imported root is Draft,
    //    NOT Approved. phase2Apply.ts's create path always births roots as
    //    Draft regardless of any state carried on the create payload — see
    //    the comment above. This assertion documents that on purpose.
    const rows = await rawQuery<{ state: string }>(`SELECT state FROM "specification" WHERE id = $1`, [rootSpecId])
    expect(rows[0].state).toBe('Draft')
  })
})

// P4.1 Task 7: server-level pin for the v2 form_document export authority (Task 3)
// over the REAL DB-backed export route/builder (buildWorkflowPackage → exportWorkflowSpec),
// not just the pure-function level already covered by
// src/lib/packageFormat/__tests__/form-document-roundtrip.test.ts. Seeds its own
// root spec (own id, own name) inside the fixture's existing Shared Lib/Main Team —
// no new library/team needed, the top-of-file beforeEach already reseeds those every
// test — with dataSchemaVersion 4 (CURRENT_DATA_SCHEMA_VERSION) to model a spec whose
// data shape is fully current, i.e. produced by the v2 form editor.
describe('form_document server export (P4.1 Task 7)', () => {
  const FORM_DOC: FormDocument = {
    version: 2,
    sections: [
      {
        id: 'content',
        role: 'content',
        rows: [
          {
            id: 'r1',
            blocks: [
              { id: 'b1', type: 'textInput', fieldName: 'Text_1', label: 'Name', layout: { span: { base: 6 } } },
              { id: 'b2', type: 'textInput', fieldName: 'Text_2', label: 'Batch', layout: { span: { base: 6 } } },
            ],
          },
        ],
      },
    ],
  }

  it('exports schemaVersion 5.0 with form_document verbatim and no form_layout_config', async () => {
    const NOW = Date.now()
    const specId = 'spec-form-doc-rt'
    const data = JSON.stringify({
      nodes: [
        {
          id: 'S1',
          type: 'userInteractionStep',
          position: { x: 0, y: 0 },
          data: { stepType: 'userInteractionStep', label: 'Fill', formDocument: FORM_DOC },
        },
      ],
      edges: [],
    })
    await rawQuery(
      `INSERT INTO "specification"
         (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [specId, f.libSharedId, 'Form Doc RT', '1.0.0', 'Draft', data, specId, null, 4, NOW, NOW],
    )

    const zip = await exportToZip(specId)
    const wf = await readWorkflowJson(zip)
    const step = wf.steps[0] as unknown as { form_document?: FormDocument; form_layout_config?: unknown }

    expect(wf.schemaVersion).toBe('5.0')
    expect(step.form_document).toEqual(FORM_DOC)
    expect(step.form_layout_config).toBeUndefined()
  })
})

// GATE follow-up item 5 (server round-trip): the builder must hand the shared exporter a
// warnings sink so rule-4 gate-binding ambiguity reaches the response header, not only the
// server console. Client-side exports already toast these (30d2a93); this is the server path.
describe('gate-binding warnings reach the export response (GATE follow-up item 5)', () => {
  it('a rule-4 ambiguity found during the server export is carried in x-export-warnings', async () => {
    const NOW = Date.now()
    // Two environments in the shared env library both declare the "Sensor" Action Property group.
    for (const [id, name] of [
      ['env-alpha', 'Alpha'],
      ['env-beta', 'Beta'],
    ] as const) {
      const envData = JSON.stringify({
        included_actions: [],
        values: [],
        actionProperties: [{ id: `p-${id}`, name: 'Sensor', entries: [] }],
        resources: [],
      })
      await rawQuery(
        `INSERT INTO "specification" (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, '1.0.0', 'Draft', $4, $1, NULL, 3, $5, $6)`,
        [id, f.libEnvSharedId, name, envData, NOW, NOW],
      )
    }
    // A GATE bound to Sensor.Value with no preceding ACTION PROXY to disambiguate (rule 4).
    const workflowData = JSON.stringify({
      nodes: [
        { id: 'n-start', type: 'start', position: { x: 100, y: 100 }, data: { stepType: 'start', label: 'Start' } },
        {
          id: 'n-gate',
          type: 'gateStep',
          position: { x: 100, y: 250 },
          data: {
            stepType: 'gateStep',
            label: 'Gate',
            inputs: [{ id: 'trig-1', name: 'Trigger', value: 'Sensor.Value', valueType: 'property' }],
          },
        },
        { id: 'n-end', type: 'end', position: { x: 100, y: 400 }, data: { stepType: 'end', label: 'End' } },
      ],
      edges: [
        { id: 'e1', source: 'n-start', target: 'n-gate' },
        { id: 'e2', source: 'n-gate', target: 'n-end' },
      ],
      environmentSpecIds: ['env-alpha', 'env-beta'],
    })
    await rawQuery('UPDATE "specification" SET data = $1 WHERE id = $2', [workflowData, f.rootSpecId])
    await rawQuery(
      `INSERT INTO "specification_environment" ("specificationId", "environmentLibraryId") VALUES ($1, $2)`,
      [f.rootSpecId, f.libEnvSharedId],
    )

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await v2Req(f, 'GET', `/api/v2/packages/workflow/${f.rootSpecId}`)
      expect(res.status).toBe(200)
      const warnings = decodeExportWarnings(res.headers.get(EXPORT_WARNINGS_HEADER))
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toMatch(/is declared by 2 environments — bound to/)
      expect(warnings[0]).toContain('Alpha')
    } finally {
      warn.mockRestore()
    }
  })
})
