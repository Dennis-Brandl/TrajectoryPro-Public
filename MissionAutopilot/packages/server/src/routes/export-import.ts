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

import { Router } from 'express'
import JSZip from 'jszip'
import { loadZipSafely } from '../lib/safe-zip.js'
import { CONTAINER_VERSION } from '../version.js'
import multer from 'multer'
import type {
  ActionRepository,
  CodeVersionRepository,
  EnvironmentRepository,
  SettingsRepository,
  TransactionRunner,
} from '@mission/autopilot-storage'

export interface ExportImportRouterDeps {
  txRunner: TransactionRunner
  environmentRepo: EnvironmentRepository
  actionRepo: ActionRepository
  codeVersionRepo: CodeVersionRepository
  settingsRepo: SettingsRepository
}

export function createExportImportRouter(deps: ExportImportRouterDeps): Router {
  const { txRunner, environmentRepo, actionRepo, codeVersionRepo, settingsRepo } = deps
  const router = Router()

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB for snapshots
  })

  // --------------------------------------------------------
  // GET /actions/:oid/export — Download .WFactionCode ZIP
  // --------------------------------------------------------
  router.get('/actions/:oid/export', async (req, res, next) => {
    try {
      const oid = req.params.oid as string
      const action = await actionRepo.findByOid(oid)
      if (!action) {
        return void res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Action not found: ${oid}` },
        })
      }

      // Gather active code versions for this action
      const allVersions = await codeVersionRepo.findByAction(action.oid)
      const activeVersions = allVersions.filter((v) => v.is_active)

      // Build manifest
      const manifest = {
        format_version: '1.0',
        exported_at: new Date().toISOString(),
        action: {
          oid: action.oid,
          local_id: action.local_id,
          version: action.version,
          action_visibility: action.action_visibility,
          description: action.description,
          input_parameter_specifications: action.input_parameter_specifications,
          output_parameter_specifications: action.output_parameter_specifications,
          property_specifications: action.property_specifications,
          timeout_seconds: action.timeout_seconds,
        },
        code_files: activeVersions.map((v) => ({
          state: v.state,
          filename: `${v.state}.py`,
          description: v.description,
        })),
      }

      // Build ZIP
      const zip = new JSZip()
      zip.file('manifest.json', JSON.stringify(manifest, null, 2))
      for (const v of activeVersions) {
        zip.file(`${v.state}.py`, v.source_code)
      }

      zip
        .generateAsync({ type: 'nodebuffer' })
        .then((buf) => {
          const filename = `${action.local_id}.WFactionCode`
          res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': String(buf.length),
          })
          res.send(buf)
        })
        .catch(next)
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // POST /actions/:oid/import — Upload .WFactionCode ZIP
  // --------------------------------------------------------
  router.post('/actions/:oid/import', upload.single('file'), async (req, res, next) => {
    try {
      const oid = req.params.oid as string
      const file = req.file
      if (!file) {
        return void res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'No file provided' },
        })
      }

      const action = await actionRepo.findByOid(oid)
      if (!action) {
        return void res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Action not found: ${oid}` },
        })
      }

      loadZipSafely(file.buffer)
        .then(async (zip) => {
          const manifestFile = zip.file('manifest.json')
          if (!manifestFile) {
            return void res.status(400).json({
              error: { code: 'VALIDATION_ERROR', message: 'ZIP missing manifest.json' },
            })
          }

          const manifest = JSON.parse(await manifestFile.async('string'))

          if (manifest.action?.oid !== oid) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Manifest action OID "${manifest.action?.oid}" does not match target "${oid}"`,
              },
            })
          }

          const importedStates: string[] = []
          const skippedStates: string[] = []

          const codeEntries = (manifest.code_files ?? []) as Array<{
            state: string
            filename: string
            description?: string
          }>

          // Collect all source code first (async), then write to DB in transaction
          const sources: Array<{ state: string; source: string; description: string | null }> = []
          for (const entry of codeEntries) {
            const pyFile = zip.file(entry.filename)
            if (!pyFile) {
              skippedStates.push(entry.state)
              continue
            }
            const source = await pyFile.async('string')
            sources.push({
              state: entry.state,
              source,
              description: entry.description ?? null,
            })
          }

          await txRunner.inTransaction(async ({ repos }) => {
            for (const { state, source, description } of sources) {
              const cv = await repos.codeVersions.save({
                action_oid: action.oid,
                state,
                source_code: source,
                created_by: 'import',
                description,
              })
              await repos.codeVersions.activate(cv.id)
              importedStates.push(state)
            }
          })

          res.status(200).json({
            data: {
              action_oid: action.oid,
              imported_states: importedStates,
              skipped_states: skippedStates,
            },
            meta: {},
          })
        })
        .catch(next)
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // GET /snapshot/export — Download .WFsnapshot ZIP
  // --------------------------------------------------------
  router.get('/snapshot/export', async (req, res, next) => {
    try {
      const environments = await environmentRepo.findAll()
      const settings = (await settingsRepo.getAll()).filter((s) => s.key !== 'api_key')

      let totalActions = 0
      let totalCodeFiles = 0

      const zip = new JSZip()

      // Settings
      zip.file('settings.json', JSON.stringify(settings, null, 2))

      // Environments (with included actions in .WFenvir shape)
      for (const env of environments) {
        const actions = await actionRepo.findByEnvironment(env.oid)
        totalActions += actions.length

        const envJson = {
          oid: env.oid,
          local_id: env.local_id,
          version: env.version,
          last_modified_date: env.last_modified_date,
          description: env.description,
          schemaVersion: env.schema_version,
          action_property_specifications: env.action_property_specifications,
          value_property_specifications: env.value_property_specifications,
          resource_property_specifications: env.resource_property_specifications,
          included_actions: actions.map((a) => ({
            // action_name + action_library are required by Mission Designer's
            // master-environment-library schema. action_name mirrors local_id
            // ("when the action body is resolved"); action_library names the
            // library this action belongs to — Mission Autopilot
            // has no separate library concept, so we use the env's local_id.
            action_name: a.local_id,
            action_library: env.local_id,
            oid: a.oid,
            local_id: a.local_id,
            version: a.version,
            last_modified_date: a.last_modified_date,
            description: a.description,
            action_visibility: a.action_visibility,
            input_parameter_specifications: a.input_parameter_specifications,
            output_parameter_specifications: a.output_parameter_specifications,
            property_specifications: a.property_specifications,
            timeout_seconds: a.timeout_seconds,
          })),
        }

        zip.file(`environments/${env.oid}.json`, JSON.stringify(envJson, null, 2))

        // Active code per action
        for (const action of actions) {
          const allVersions = await codeVersionRepo.findByAction(action.oid)
          const activeVersions = allVersions.filter((v) => v.is_active)
          for (const v of activeVersions) {
            zip.file(`code/${action.oid}/${v.state}.py`, v.source_code)
            totalCodeFiles++
          }
        }
      }

      // Manifest
      const manifest = {
        format_version: '1.0',
        exported_at: new Date().toISOString(),
        container_version: CONTAINER_VERSION,
        environment_count: environments.length,
        action_count: totalActions,
        code_file_count: totalCodeFiles,
      }
      zip.file('manifest.json', JSON.stringify(manifest, null, 2))

      zip
        .generateAsync({ type: 'nodebuffer' })
        .then((buf) => {
          const date = new Date().toISOString().slice(0, 10)
          const filename = `TrajectorySnapshot_${date}.WFsnapshot`
          res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': String(buf.length),
          })
          res.send(buf)
        })
        .catch(next)
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // GET /environments/:oid/export-bundle — Download .WFenvirBundleX ZIP
  // --------------------------------------------------------

  async function buildEnvLibraryJson(envOid: string): Promise<{
    json: Record<string, unknown>
    filename: string
    env: Awaited<ReturnType<typeof environmentRepo.findByOid>>
  } | null> {
    const env = await environmentRepo.findByOid(envOid)
    if (!env) return null
    const actions = await actionRepo.findByEnvironment(env.oid)
    const json = {
      local_id: env.local_id,
      oid: env.oid,
      version: env.version,
      last_modified_date: env.last_modified_date,
      schemaVersion: env.schema_version ?? '4.0',
      environment_specifications: [
        {
          oid: env.oid,
          local_id: env.local_id,
          version: env.version,
          last_modified_date: env.last_modified_date,
          description: env.description,
          action_property_specifications: env.action_property_specifications,
          value_property_specifications: env.value_property_specifications,
          resource_property_specifications: env.resource_property_specifications,
          included_actions: actions.map((a) => ({
            // action_name + action_library are required by Mission Designer's
            // master-environment-library schema. action_name mirrors local_id
            // ("when the action body is resolved"); action_library names the
            // library this action belongs to — Mission Autopilot
            // has no separate library concept, so we use the env's local_id.
            action_name: a.local_id,
            action_library: env.local_id,
            oid: a.oid,
            local_id: a.local_id,
            version: a.version,
            last_modified_date: a.last_modified_date,
            description: a.description,
            action_visibility: a.action_visibility,
            input_parameter_specifications: a.input_parameter_specifications,
            output_parameter_specifications: a.output_parameter_specifications,
            property_specifications: a.property_specifications,
            timeout_seconds: a.timeout_seconds,
          })),
        },
      ],
    }
    return { json, filename: `${env.local_id}.WFenvir`, env }
  }

  async function buildEnvironmentBundle(envOid: string): Promise<{
    buffer: Buffer
    filename: string
    manifest: {
      format: 'WFenvirBundleX'
      format_version: 1
      exported_at: string
      container_version: string
      environment_oid: string
      environment_local_id: string
      action_count: number
      code_file_count: number
    }
  } | null> {
    const lib = await buildEnvLibraryJson(envOid)
    if (!lib) return null

    const env = lib.env!
    const actions = await actionRepo.findByEnvironment(env.oid)

    const zip = new JSZip()
    zip.file(lib.filename, JSON.stringify(lib.json, null, 2))

    let codeFileCount = 0
    for (const action of actions) {
      const allVersions = await codeVersionRepo.findByAction(action.oid)
      const activeVersions = allVersions.filter((v) => v.is_active)
      for (const v of activeVersions) {
        zip.file(`code/${action.oid}/${v.state}.py`, v.source_code)
        codeFileCount++
      }
    }

    // .WFenvirBundleX is a new format. format_version is an integer (1, 2, …) —
    // intentionally simpler than the legacy snapshot's "1.0" string convention.
    const manifest = {
      format: 'WFenvirBundleX' as const,
      format_version: 1 as const,
      exported_at: new Date().toISOString(),
      container_version: CONTAINER_VERSION,
      environment_oid: env.oid,
      environment_local_id: env.local_id,
      action_count: actions.length,
      code_file_count: codeFileCount,
    }
    zip.file('manifest.json', JSON.stringify(manifest, null, 2))

    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    const filename = `${env.local_id}.WFenvirBundleX`
    return { buffer, filename, manifest }
  }

  router.get('/environments/:oid/export-bundle', (req, res, next) => {
    const oid = req.params.oid as string
    buildEnvironmentBundle(oid)
      .then((result) => {
        if (!result) {
          return void res.status(404).json({
            error: { code: 'NOT_FOUND', message: `Environment not found: ${oid}` },
          })
        }
        res.set({
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'Content-Length': String(result.buffer.length),
        })
        res.send(result.buffer)
      })
      .catch(next)
  })

  // --------------------------------------------------------
  // GET /environments/:oid/export-envir-x — Download .WFenvirX ZIP
  // --------------------------------------------------------

  async function buildEnvironmentEnvirX(envOid: string): Promise<{
    buffer: Buffer
    filename: string
  } | null> {
    const env = await environmentRepo.findByOid(envOid)
    if (!env) return null

    const actions = await actionRepo.findByEnvironment(env.oid)

    const zip = new JSZip()

    // Root *.WFenvir — single-env shape (NOT library-wrapped)
    const envJson = {
      oid: env.oid,
      local_id: env.local_id,
      version: env.version,
      last_modified_date: env.last_modified_date,
      schemaVersion: env.schema_version ?? '4.0',
      description: env.description ?? null,
      state: env.state ?? 'Draft',
      action_property_specifications: env.action_property_specifications,
      value_property_specifications: env.value_property_specifications,
      resource_property_specifications: env.resource_property_specifications,
    }
    zip.file(`${env.local_id}.WFenvir`, JSON.stringify(envJson, null, 2))

    // actions/*.WFaction — one file per action (standalone shape, no code)
    for (const action of actions) {
      const actionJson = {
        oid: action.oid,
        local_id: action.local_id,
        version: action.version,
        last_modified_date: action.last_modified_date,
        description: action.description ?? null,
        action_visibility: action.action_visibility,
        state: action.state ?? 'Draft',
        input_parameter_specifications: action.input_parameter_specifications,
        output_parameter_specifications: action.output_parameter_specifications,
        property_specifications: action.property_specifications,
        timeout_seconds: action.timeout_seconds ?? null,
      }
      zip.file(`actions/${action.local_id}.WFaction`, JSON.stringify(actionJson, null, 2))
    }

    // manifest.json — identifies this as a single-env package
    zip.file(
      'manifest.json',
      JSON.stringify(
        {
          packageType: 'environment-package',
          formatVersion: 1,
          createdAt: new Date().toISOString(),
          environmentName: env.local_id,
          actionCount: actions.length,
        },
        null,
        2
      )
    )

    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    return { buffer, filename: `${env.local_id}.WFenvirX` }
  }

  router.get('/environments/:oid/export-envir-x', (req, res, next) => {
    const oid = req.params.oid as string
    buildEnvironmentEnvirX(oid)
      .then((result) => {
        if (!result) {
          return void res.status(404).json({
            error: { code: 'NOT_FOUND', message: `Environment not found: ${oid}` },
          })
        }
        res.set({
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'Content-Length': String(result.buffer.length),
        })
        res.send(result.buffer)
      })
      .catch(next)
  })

  // --------------------------------------------------------
  // POST /snapshot/import?confirm=true — Upload .WFsnapshot ZIP
  // --------------------------------------------------------
  router.post('/snapshot/import', upload.single('file'), (req, res, next) => {
    try {
      if (req.query.confirm !== 'true') {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Destructive operation requires ?confirm=true query parameter',
          },
        })
      }

      const file = req.file
      if (!file) {
        return void res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'No file provided' },
        })
      }

      loadZipSafely(file.buffer)
        .then(async (zip) => {
          const manifestFile = zip.file('manifest.json')
          if (!manifestFile) {
            return void res.status(400).json({
              error: { code: 'VALIDATION_ERROR', message: 'ZIP missing manifest.json' },
            })
          }

          const manifest = JSON.parse(await manifestFile.async('string'))
          if (manifest.format_version !== '1.0') {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Unsupported format version: ${manifest.format_version}`,
              },
            })
          }

          // Collect all environment JSON files
          const envFiles = zip.file(/^environments\/.*\.json$/)
          const envDataList: Array<{ data: Record<string, unknown> }> = []
          for (const f of envFiles) {
            const raw = await f.async('string')
            envDataList.push({ data: JSON.parse(raw) })
          }

          // Collect all code files
          const codeFiles = zip.file(/^code\/.*\.py$/)
          const codeDataList: Array<{
            actionOid: string
            state: string
            source: string
          }> = []
          for (const f of codeFiles) {
            const parts = f.name.split('/')
            const actionOid = parts[1]
            const state = parts[2].replace('.py', '')
            const source = await f.async('string')
            codeDataList.push({ actionOid, state, source })
          }

          // Collect settings
          let settingsData: Array<{ key: string; value: string }> = []
          const settingsFile = zip.file('settings.json')
          if (settingsFile) {
            const raw = JSON.parse(await settingsFile.async('string'))
            if (Array.isArray(raw)) {
              settingsData = raw.map((s: { key: string; value: string }) => ({
                key: s.key,
                value: s.value,
              }))
            }
          }

          // Full replace in a single transaction
          let environmentsImported = 0
          let actionsImported = 0
          let codeFilesImported = 0
          let settingsImported = 0

          await txRunner.inTransaction(async ({ repos }) => {
            // 1. Delete all existing data (order matters for FK constraints)
            const existingEnvs = await repos.environments.findAll()
            for (const env of existingEnvs) {
              const actions = await repos.actions.findByEnvironment(env.oid)
              for (const action of actions) {
                await repos.codeVersions.deleteByAction(action.oid)
                await repos.actions.delete(action.oid)
              }
              await repos.environments.delete(env.oid)
            }

            // 2. Re-create environments and actions from snapshot
            for (const { data } of envDataList) {
              await repos.environments.upsert({
                oid: data.oid as string,
                local_id: data.local_id as string,
                version: data.version as string,
                last_modified_date: data.last_modified_date as string,
                schema_version: (data.schemaVersion as string) ?? '4.0',
                description: (data.description as string) ?? null,
                action_property_specifications:
                  (data.action_property_specifications as unknown[]) ?? [],
                value_property_specifications:
                  (data.value_property_specifications as unknown[]) ?? [],
                resource_property_specifications:
                  (data.resource_property_specifications as unknown[]) ?? [],
                source_filename: 'snapshot-import',
              })
              environmentsImported++

              const includedActions =
                (data.included_actions as Array<Record<string, unknown>>) ?? []
              for (const act of includedActions) {
                await repos.actions.upsert({
                  oid: act.oid as string,
                  environment_oid: data.oid as string,
                  local_id: act.local_id as string,
                  version: act.version as string,
                  last_modified_date: act.last_modified_date as string,
                  description: (act.description as string) ?? null,
                  action_visibility: (act.action_visibility as 'opaque' | 'observable') ?? 'opaque',
                  input_parameter_specifications:
                    (act.input_parameter_specifications as unknown[]) ?? [],
                  output_parameter_specifications:
                    (act.output_parameter_specifications as unknown[]) ?? [],
                  property_specifications: (act.property_specifications as unknown[]) ?? [],
                  timeout_seconds: (act.timeout_seconds as number | null) ?? null,
                })
                actionsImported++
              }
            }

            // 3. Create and activate code versions
            for (const { actionOid, state, source } of codeDataList) {
              const cv = await repos.codeVersions.save({
                action_oid: actionOid,
                state,
                source_code: source,
                created_by: 'snapshot-import',
                description: 'Imported from snapshot',
              })
              await repos.codeVersions.activate(cv.id)
              codeFilesImported++
            }

            // 4. Apply settings
            for (const { key, value } of settingsData) {
              // The API key lives in ACTIONS_API_KEY only; never import it.
              if (key === 'api_key') continue
              try {
                await repos.settings.update(key, value)
                settingsImported++
              } catch {
                // Skip unknown settings keys silently
              }
            }
          })

          res.status(200).json({
            data: {
              environments_imported: environmentsImported,
              actions_imported: actionsImported,
              code_files_imported: codeFilesImported,
              settings_imported: settingsImported,
            },
            meta: {},
          })
        })
        .catch((err) => {
          if (
            err instanceof Error &&
            (err.message.includes('end of central directory') ||
              err.message.includes('Corrupted') ||
              err.message.includes('End of data') ||
              err.message.includes('not a valid zip'))
          ) {
            return void res.status(400).json({
              error: { code: 'VALIDATION_ERROR', message: 'Invalid or corrupted ZIP file' },
            })
          }
          next(err)
        })
    } catch (err) {
      next(err)
    }
  })

  return router
}
