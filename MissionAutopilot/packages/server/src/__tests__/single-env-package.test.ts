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

/**
 * single-env-package.test.ts — Tests for the new .WFenvirX single-env package
 * upload path (Task 3.8), plus regression coverage for legacy .WFenvirBundleX
 * and legacy .WFenvirX (env-library) via manifest-based disambiguation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import request from 'supertest'
import JSZip from 'jszip'
import {
  ActionRepository,
  InstanceRepository,
  SettingsRepository,
  EnvironmentRepository,
  CodeVersionRepository,
  LogRepository,
  createTestTransactionHelper,
} from '@mission/autopilot-storage'
import { createTestDb, type TestDb } from '@mission/autopilot-storage/testing'
import { InstanceManager } from '@mission/autopilot-engine'
import type { Instance } from '@mission/autopilot-storage'
import { SseManager } from '../sse-manager.js'
import { createManagementRouter } from '../routes/management.js'
import { errorHandler } from '../middleware/error-handler.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCRIPT_PATH = path.resolve(__dirname, '../../../../python-sidecar/sandbox_runner.py')

interface TestHarness {
  app: express.Express
  db: TestDb
  manager: InstanceManager
  environmentRepo: EnvironmentRepository
  actionRepo: ActionRepository
  codeVersionRepo: CodeVersionRepository
}

async function createHarness(): Promise<TestHarness> {
  const db = await createTestDb()
  const environmentRepo = new EnvironmentRepository(db)
  const actionRepo = new ActionRepository(db)
  const codeVersionRepo = new CodeVersionRepository(db)
  const instanceRepo = new InstanceRepository(db)
  const logRepo = new LogRepository(db)
  const settingsRepo = new SettingsRepository(db)
  const sseManager = new SseManager()

  const manager = new InstanceManager(db, {
    scriptPath: SCRIPT_PATH,
    poolSize: 1,
    onStateChange: (instanceId: string, state: string, instance: Instance) => {
      const history = instance.state_history as Array<{ state: string; timestamp: string }>
      const prev = history.length >= 2 ? (history[history.length - 2]?.state ?? '') : ''
      sseManager.publishStateChange(instanceId, state, prev, instance)
    },
    onTerminal: (instanceId: string, state: string, instance: Instance) => {
      const history = instance.state_history as Array<{ state: string; timestamp: string }>
      const prev = history.length >= 2 ? (history[history.length - 2]?.state ?? '') : ''
      sseManager.publishTerminal(instanceId, state, prev, instance)
    },
    onError: (instanceId: string, error: Error) => {
      sseManager.publishError(instanceId, error.message)
    },
  })

  const app = express()
  app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }))
  app.use(express.json())
  app.use(
    '/management/v1',
    createManagementRouter({
      q: db,
      txRunner: createTestTransactionHelper(db),
      manager,
      environmentRepo,
      actionRepo,
      codeVersionRepo,
      instanceRepo,
      logRepo,
      settingsRepo,
      sseManager,
    })
  )
  app.use(errorHandler)

  return { app, db, manager, environmentRepo, actionRepo, codeVersionRepo }
}

// -----------------------------------------------------------------------
// Helper: build a .WFenvirX single-env package (packageType = environment-package)
// -----------------------------------------------------------------------
async function buildSingleEnvPackage(opts: {
  envOid: string
  envLocalId: string
  envVersion: string
  actions: Array<{
    oid: string
    local_id: string
    version: string
    action_visibility?: 'observable' | 'opaque'
  }>
}): Promise<Buffer> {
  const zip = new JSZip()

  zip.file(
    'manifest.json',
    JSON.stringify({
      packageType: 'environment-package',
      format_version: 1,
      environment_oid: opts.envOid,
      environment_local_id: opts.envLocalId,
    })
  )

  zip.file(
    `${opts.envLocalId}.WFenvir`,
    JSON.stringify({
      oid: opts.envOid,
      local_id: opts.envLocalId,
      version: opts.envVersion,
      last_modified_date: '2026-05-22T00:00:00.000Z',
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      description: null,
    })
  )

  for (const action of opts.actions) {
    zip.file(
      `actions/${action.local_id}.WFaction`,
      JSON.stringify({
        oid: action.oid,
        local_id: action.local_id,
        version: action.version,
        last_modified_date: '2026-05-22T00:00:00.000Z',
        action_visibility: action.action_visibility ?? 'opaque',
        input_parameter_specifications: [],
        output_parameter_specifications: [],
        property_specifications: [],
      })
    )
  }

  return zip.generateAsync({ type: 'nodebuffer' })
}

// -----------------------------------------------------------------------
// Helper: build a legacy .WFenvirX (env-library) with packageType = environment-library
// -----------------------------------------------------------------------
async function buildLegacyEnvLibraryX(opts: {
  libraryOid: string
  libraryLocalId: string
  envOid: string
  envLocalId: string
  envVersion: string
  actions: Array<{ oid: string; local_id: string; version: string }>
  withManifest?: boolean
}): Promise<Buffer> {
  const zip = new JSZip()

  if (opts.withManifest ?? true) {
    zip.file(
      'manifest.json',
      JSON.stringify({
        packageType: 'environment-library',
        format_version: 1,
      })
    )
  }

  zip.file(
    `${opts.libraryLocalId}.WFenvir`,
    JSON.stringify({
      local_id: opts.libraryLocalId,
      oid: opts.libraryOid,
      version: '1',
      last_modified_date: '2026-05-22T00:00:00.000Z',
      schemaVersion: '4.0',
      environment_specifications: [
        {
          oid: opts.envOid,
          local_id: opts.envLocalId,
          version: opts.envVersion,
          last_modified_date: '2026-05-22T00:00:00.000Z',
          description: null,
          action_property_specifications: [],
          value_property_specifications: [],
          resource_property_specifications: [],
          included_actions: opts.actions.map((a) => ({
            oid: a.oid,
            local_id: a.local_id,
            version: a.version,
            last_modified_date: '2026-05-22T00:00:00.000Z',
            action_visibility: 'opaque',
            input_parameter_specifications: [],
            output_parameter_specifications: [],
            property_specifications: [],
          })),
        },
      ],
    })
  )

  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('single-env-package upload (Task 3.8)', () => {
  let harness: TestHarness

  beforeEach(async () => {
    harness = await createHarness()
  })

  afterEach(async () => {
    await harness.manager.shutdown()
    await harness.db.close()
  })

  // -----------------------------------------------------------------------
  // Test 1: New .WFenvirX single-env package creates env + actions, NO code
  // -----------------------------------------------------------------------
  it('accepts a .WFenvirX single-env package and creates env + actions without code', async () => {
    const buf = await buildSingleEnvPackage({
      envOid: 'se-env-0001',
      envLocalId: 'SingleEnvA',
      envVersion: '1',
      actions: [
        {
          oid: 'se-act-0001',
          local_id: 'ActionAlpha',
          version: '1',
          action_visibility: 'observable',
        },
        { oid: 'se-act-0002', local_id: 'ActionBeta', version: '1', action_visibility: 'opaque' },
      ],
    })

    const res = await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', buf, { filename: 'SingleEnvA.WFenvirX', contentType: 'application/zip' })

    expect(res.status).toBe(200)
    expect(res.body.data.imported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'environment',
          oid: 'se-env-0001',
          local_id: 'SingleEnvA',
          status: 'created',
          actions_count: 2,
        }),
      ])
    )

    // Environment exists in DB
    const env = await harness.environmentRepo.findByOid('se-env-0001')
    expect(env).not.toBeNull()
    expect(env?.local_id).toBe('SingleEnvA')

    // Actions exist in DB
    const actionAlpha = await harness.actionRepo.findByOid('se-act-0001')
    expect(actionAlpha).not.toBeNull()
    expect(actionAlpha?.action_visibility).toBe('observable')

    const actionBeta = await harness.actionRepo.findByOid('se-act-0002')
    expect(actionBeta).not.toBeNull()

    // KEY ASSERTION: No code rows created (single-env packages carry no code)
    expect(await harness.codeVersionRepo.findByAction('se-act-0001')).toHaveLength(0)
    expect(await harness.codeVersionRepo.findByAction('se-act-0002')).toHaveLength(0)
  })

  // -----------------------------------------------------------------------
  // Test 2: New extension .WFenvirLibX is a real ZIP containing a *.WFenvir
  // inner file (env-library shape). Must parse and import the env correctly.
  // -----------------------------------------------------------------------
  it('accepts upload of .WFenvirLibX extension (renamed env-library ZIP)', async () => {
    // Build a real ZIP containing an inner LibraryX.WFenvir with env-library JSON
    const libraryPayload = {
      local_id: 'LibraryX',
      oid: 'lib-env-x-0001',
      version: '1',
      last_modified_date: '2026-05-22T00:00:00.000Z',
      schemaVersion: '4.0',
      environment_specifications: [
        {
          oid: 'lib-env-x-spec-0001',
          local_id: 'LibEnvX',
          version: '1',
          last_modified_date: '2026-05-22T00:00:00.000Z',
          description: null,
          action_property_specifications: [],
          value_property_specifications: [],
          resource_property_specifications: [],
          included_actions: [
            {
              oid: 'lib-act-x-0001',
              local_id: 'LibActionX',
              version: '1',
              last_modified_date: '2026-05-22T00:00:00.000Z',
              action_visibility: 'opaque',
              input_parameter_specifications: [],
              output_parameter_specifications: [],
              property_specifications: [],
            },
          ],
        },
      ],
    }

    const zip = new JSZip()
    zip.file('LibraryX.WFenvir', JSON.stringify(libraryPayload))
    const zipBytes = await zip.generateAsync({ type: 'nodebuffer' })

    const res = await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', zipBytes, 'LibraryX.WFenvirLibX')

    // .WFenvirLibX is now a real ZIP → routed to the legacy env-library ZIP path
    expect(res.status).toBe(200)
    expect(res.body.data.imported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'environment',
          oid: 'lib-env-x-spec-0001',
        }),
      ])
    )

    // Env and action exist in DB
    const env = await harness.environmentRepo.findByOid('lib-env-x-spec-0001')
    expect(env).not.toBeNull()
    expect(env?.local_id).toBe('LibEnvX')
    expect(await harness.actionRepo.findByOid('lib-act-x-0001')).not.toBeNull()
  })

  // -----------------------------------------------------------------------
  // Test 3: Legacy .WFenvirBundleX still works (regression)
  // -----------------------------------------------------------------------
  it('still accepts the legacy .WFenvirBundleX with code segments', async () => {
    const envOid = 'bundle-env-0001'
    const actionOid = 'bundle-act-0001'

    const zip = new JSZip()
    zip.file(
      'BundleEnv.WFenvir',
      JSON.stringify({
        local_id: 'BundleEnv',
        oid: 'bundle-lib-0001',
        version: '1',
        last_modified_date: '2026-05-22T00:00:00.000Z',
        schemaVersion: '4.0',
        environment_specifications: [
          {
            oid: envOid,
            local_id: 'BundleEnv',
            version: '1',
            last_modified_date: '2026-05-22T00:00:00.000Z',
            description: null,
            action_property_specifications: [],
            value_property_specifications: [],
            resource_property_specifications: [],
            included_actions: [
              {
                oid: actionOid,
                local_id: 'BundleAction',
                version: '1',
                last_modified_date: '2026-05-22T00:00:00.000Z',
                action_visibility: 'observable',
                input_parameter_specifications: [],
                output_parameter_specifications: [],
                property_specifications: [],
              },
            ],
          },
        ],
      })
    )
    zip.file(`code/${actionOid}/STARTING.py`, "outputs['status'] = '0'  # bundle code")
    const buf = await zip.generateAsync({ type: 'nodebuffer' })

    const res = await request(harness.app).post('/management/v1/upload').attach('files', buf, {
      filename: 'BundleEnv.WFenvirBundleX',
      contentType: 'application/zip',
    })

    expect(res.status).toBe(200)
    expect(res.body.data.imported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'environment',
          oid: envOid,
          status: 'created',
        }),
      ])
    )

    // Code rows ARE created for bundles (key difference from single-env)
    const activeCode = await harness.codeVersionRepo.getActive(actionOid, 'STARTING')
    expect(activeCode).not.toBeNull()
    expect(activeCode?.source_code).toContain('bundle code')
  })

  // -----------------------------------------------------------------------
  // Test 4: Legacy .WFenvirX (env-library) still works via manifest detection
  // -----------------------------------------------------------------------
  it('still accepts a legacy .WFenvirX (env-library) via manifest detection', async () => {
    const buf = await buildLegacyEnvLibraryX({
      libraryOid: 'legacy-lib-0001',
      libraryLocalId: 'LegacyLib',
      envOid: 'legacy-env-0001',
      envLocalId: 'LegacyEnv',
      envVersion: '1',
      actions: [{ oid: 'legacy-act-0001', local_id: 'LegacyAction', version: '1' }],
      withManifest: true, // manifest says packageType = environment-library
    })

    const res = await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', buf, { filename: 'LegacyLib.WFenvirX', contentType: 'application/zip' })

    expect(res.status).toBe(200)
    expect(res.body.data.imported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'environment',
          oid: 'legacy-env-0001',
          local_id: 'LegacyEnv',
          status: 'created',
        }),
      ])
    )

    const env = await harness.environmentRepo.findByOid('legacy-env-0001')
    expect(env).not.toBeNull()

    // Actions come from included_actions in env-library shape, not from standalone entries
    const action = await harness.actionRepo.findByOid('legacy-act-0001')
    expect(action).not.toBeNull()
  })

  // -----------------------------------------------------------------------
  // Test 5: Legacy .WFenvirX with no manifest still works (no-manifest legacy)
  // -----------------------------------------------------------------------
  it('still accepts a legacy .WFenvirX with no manifest (no-manifest legacy path)', async () => {
    const buf = await buildLegacyEnvLibraryX({
      libraryOid: 'no-manifest-lib-0001',
      libraryLocalId: 'NoManifestLib',
      envOid: 'no-manifest-env-0001',
      envLocalId: 'NoManifestEnv',
      envVersion: '1',
      actions: [{ oid: 'no-manifest-act-0001', local_id: 'NoManifestAction', version: '1' }],
      withManifest: false, // no manifest at all
    })

    const res = await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', buf, { filename: 'NoManifestLib.WFenvirX', contentType: 'application/zip' })

    expect(res.status).toBe(200)

    const env = await harness.environmentRepo.findByOid('no-manifest-env-0001')
    expect(env).not.toBeNull()
  })

  // -----------------------------------------------------------------------
  // Test 6: Extension rejection still fires for unknown extension
  // -----------------------------------------------------------------------
  it('rejects upload with an unknown extension and includes all valid extensions in message', async () => {
    const res = await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', Buffer.from('{}'), 'Bad.WFunknown')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.message).toContain('.WFenvirLibX')
    expect(res.body.error.message).toContain('.WFactionLibX')
    expect(res.body.error.message).toContain('.WFstepLibX')
    expect(res.body.error.message).toContain('.WFenvirBundleX')
  })

  // -----------------------------------------------------------------------
  // Test 7: Single-env package update (re-upload) works as upsert
  // -----------------------------------------------------------------------
  it('re-uploading a .WFenvirX single-env package updates the existing env', async () => {
    const buf1 = await buildSingleEnvPackage({
      envOid: 'se-env-update-0001',
      envLocalId: 'UpdateableEnv',
      envVersion: '1',
      actions: [{ oid: 'se-act-update-0001', local_id: 'ActionV1', version: '1' }],
    })

    await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', buf1, { filename: 'UpdateableEnv.WFenvirX', contentType: 'application/zip' })
      .expect(200)

    // Re-upload with version 2 and a different action
    const buf2 = await buildSingleEnvPackage({
      envOid: 'se-env-update-0001',
      envLocalId: 'UpdateableEnv',
      envVersion: '2',
      actions: [{ oid: 'se-act-update-0002', local_id: 'ActionV2', version: '1' }],
    })

    const res2 = await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', buf2, { filename: 'UpdateableEnv.WFenvirX', contentType: 'application/zip' })

    expect(res2.status).toBe(200)
    expect(res2.body.data.imported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'environment',
          oid: 'se-env-update-0001',
          version: '2',
          status: 'updated',
        }),
      ])
    )

    // Old action is gone (orphan deleted), new action is present
    expect(await harness.actionRepo.findByOid('se-act-update-0001')).toBeNull()
    expect(await harness.actionRepo.findByOid('se-act-update-0002')).not.toBeNull()
  })
})
