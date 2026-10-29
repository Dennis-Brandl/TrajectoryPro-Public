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

import { Router, type Response } from 'express'
import { execSync } from 'node:child_process'
import multer from 'multer'
import JSZip from 'jszip'
import { loadZipSafely } from '../lib/safe-zip.js'
import {
  emptyActionSyncDiff,
  importAction,
  syncEnvironmentActions,
  type ActionSyncDiff,
} from '../lib/import-actions.js'
import { syncEnvironmentRow } from '../lib/import-environment.js'
import { createExportImportRouter } from './export-import.js'
import type {
  InstanceManager,
  PropertyMutation,
  PropertySpecRecord,
} from '@mission/autopilot-engine'
import {
  OBSERVABLE_STATES,
  OPAQUE_STATES,
  TRANSITION_TABLE,
  OPAQUE_TRANSITION_TABLE,
  PropertyEditError,
  applyPropertyEdits,
} from '@mission/autopilot-engine'

// Valid code-states per visibility = state enum ∪ all states reachable in the
// transition table. Opaque actions transition through ABORTING/STOPPING via
// ABORT/STOP commands even though those aren't in OPAQUE_STATES — so we must
// also accept them as legitimate code-save targets.
function reachableStates(table: Map<string, Map<string, string>>): Set<string> {
  const set = new Set<string>()
  for (const [from, transitions] of table) {
    set.add(from)
    for (const to of transitions.values()) set.add(to)
  }
  return set
}
const VALID_OBSERVABLE_CODE_STATES: ReadonlySet<string> = new Set([
  ...OBSERVABLE_STATES,
  ...reachableStates(TRANSITION_TABLE),
])
const VALID_OPAQUE_CODE_STATES: ReadonlySet<string> = new Set([
  ...OPAQUE_STATES,
  ...reachableStates(OPAQUE_TRANSITION_TABLE),
])
import type {
  EnvironmentRepository,
  ActionRepository,
  CodeVersionRepository,
  InstanceRepository,
  LogRepository,
  SettingsRepository,
  ActionInput,
  FinalStatus,
  LifecycleState,
  Queryable,
  TransactionRunner,
} from '@mission/autopilot-storage'
import type { LogQueryFilters } from '@mission/autopilot-storage'
import { validateBody } from '../validation.js'
import type { SseManager } from '../sse-manager.js'

// ============================================================
// Python version cache (set once on first factory call)
// ============================================================

let cachedPythonVersion: string | null = null

// ============================================================
// Management router factory
// ============================================================

/**
 * createManagementRouter — Express Router with all /management/v1/ endpoints.
 *
 * Endpoints (plan 06-01):
 *   GET  /dashboard                     — MGMT-01
 *   POST /upload                        — MGMT-02
 *   GET  /environments                  — MGMT-03
 *   GET  /environments/:oid             — MGMT-04
 *   DELETE /environments/:oid           — MGMT-05
 *   GET  /actions/:oid                  — MGMT-06
 *   PUT  /actions/:oid/timeout           — per-action timeout
 *
 * Endpoints (plan 06-02):
 *   GET  /code/:action_oid/:state                          — MGMT-07
 *   GET  /code/:action_oid/:state/active                   — MGMT-08
 *   GET  /code/:action_oid/:state/:version_id              — MGMT-08
 *   POST /code/:action_oid/:state                          — MGMT-09
 *   POST /code/:action_oid/:state/:version_id/activate     — MGMT-10
 *   DELETE /code/:action_oid/:state/:version_id            — MGMT-11
 *   POST /code/:action_oid/:state/test                     — MGMT-12
 *
 * Endpoints (plan 06-03):
 *   GET  /instances/active              — MGMT-13a
 *   GET  /instances/history             — MGMT-13b
 *   GET  /instances/:id                 — MGMT-14
 *   POST /instances/:id/command         — MGMT-15
 *   GET  /log                           — MGMT-16
 *   GET  /log/:id                       — MGMT-17
 *   GET  /settings                      — MGMT-18
 *   PUT  /settings/:key                 — MGMT-18
 *
 * Endpoints (console property editing):
 *   PUT  /environments/:oid/properties  — edit environment-level Action Property values
 *   PUT  /actions/:oid/properties       — edit one action's own Action Property values
 */
export interface ManagementRouterDeps {
  q: Queryable
  txRunner: TransactionRunner
  manager: InstanceManager
  environmentRepo: EnvironmentRepository
  actionRepo: ActionRepository
  codeVersionRepo: CodeVersionRepository
  instanceRepo: InstanceRepository
  logRepo: LogRepository
  settingsRepo: SettingsRepository
  sseManager: SseManager
}

// ============================================================
// Property editing helpers (PUT .../properties)
// ============================================================

type ParsedPropertyEdits = { ok: true; edits: PropertyMutation[] } | { ok: false; message: string }

/**
 * Parse `{ edits: [{ property, entry, value }] }` into engine PropertyMutations.
 * Strict: no unknown fields anywhere, every field a string, at least one edit.
 */
function parsePropertyEdits(body: unknown): ParsedPropertyEdits {
  const outer = validateBody(body, { edits: { required: true, type: 'array' } })
  if (!outer.valid) return { ok: false, message: outer.message }
  const raw = outer.data.edits as unknown[]
  if (raw.length === 0) return { ok: false, message: 'edits must contain at least one edit' }

  const edits: PropertyMutation[] = []
  for (const [i, item] of raw.entries()) {
    const inner = validateBody(item, {
      property: { required: true, type: 'string' },
      entry: { required: true, type: 'string' },
      value: { required: true, type: 'string' },
    })
    if (!inner.valid) return { ok: false, message: `edits[${i}]: ${inner.message}` }
    const { property, entry, value } = inner.data as {
      property: string
      entry: string
      value: string
    }
    if (property.length === 0 || entry.length === 0) {
      return { ok: false, message: `edits[${i}]: property and entry must be non-empty` }
    }
    edits.push({ spec_name: property, entry_name: entry, value })
  }
  return { ok: true, edits }
}

/** Map a PropertyEditError to its HTTP response. Returns false for other errors. */
function sendPropertyEditError(res: Response, err: unknown): boolean {
  if (!(err instanceof PropertyEditError)) return false
  const status = err.code === 'ENTRY_NOT_FOUND' ? 400 : 404
  const code = err.code === 'ENVIRONMENT_NOT_FOUND' ? 'NOT_FOUND' : err.code
  res.status(status).json({ error: { code, message: err.message, details: err.details } })
  return true
}

export function createManagementRouter(deps: ManagementRouterDeps): Router {
  const {
    q,
    txRunner,
    manager,
    environmentRepo,
    actionRepo,
    codeVersionRepo,
    instanceRepo,
    logRepo,
    settingsRepo,
    sseManager,
  } = deps

  // Cache python version on first factory call
  if (cachedPythonVersion === null) {
    try {
      cachedPythonVersion = execSync('python --version', { encoding: 'utf-8' }).trim()
    } catch {
      /* null */
    }
  }

  // Multer with memory storage, 10 MB limit
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  })

  const router = Router()

  // Mount export/import sub-router
  router.use(
    createExportImportRouter({
      txRunner,
      environmentRepo,
      actionRepo,
      codeVersionRepo,
      settingsRepo,
    })
  )

  // --------------------------------------------------------
  // MGMT-00: GET /server-info
  //
  // Reports this server's externally-reachable REST base URL so the console
  // top-bar can display the correct address for workflow authors to copy
  // into an env's action_server_specifications.
  //
  // In dev the console runs on Vite (default :5176) and proxies /trajectory
  // and /management to the Express server on PORT (default :3002 via .env).
  // Without this endpoint the top bar fell back to `window.location.origin`,
  // which showed the *console's* URL — useless to runtime clients because
  // (a) it depends on Vite being up, and (b) `http://localhost:5176/` only
  // serves the console SPA, not the REST API root.
  //
  // Source of truth for the URL:
  //   1. PUBLIC_BASE_URL env var (operator override, used when the console is
  //      reached through a reverse proxy or a non-default hostname).
  //   2. `http://localhost:${PORT}` otherwise — works for the standard
  //      dev (npm run dev) and docker-compose setups.
  //
  // FLEET_BASE_URL is a second, distinct address: the one the Mission Engine
  // and Mission Commander use to reach this server from inside the Docker
  // network, where `localhost` resolves to a different machine than the
  // operator's browser. The superproject compose sets it to
  // `http://mission-autopilot-server:3002`; it is null in standalone/dev runs
  // where there is no fleet network to reach this server from.
  // --------------------------------------------------------
  router.get('/server-info', (_req, res) => {
    const port = Number(process.env.PORT ?? 3001)
    const publicBaseUrl =
      process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.length > 0
        ? process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')
        : `http://localhost:${port}`
    const fleet = process.env.FLEET_BASE_URL?.replace(/\/+$/, '')
    res.status(200).json({
      data: {
        rest_base_url: publicBaseUrl,
        protocol_path: '/trajectory/v1/',
        port,
        fleet_base_url: fleet && fleet.length > 0 ? fleet : null,
      },
      meta: {},
    })
  })

  // --------------------------------------------------------
  // MGMT-01: GET /dashboard
  // --------------------------------------------------------
  router.get('/dashboard', async (req, res, next) => {
    try {
      const uptimeSeconds = Math.floor(process.uptime())
      const startedAt = new Date(Date.now() - uptimeSeconds * 1000).toISOString()

      // DB name + size
      let dbName: string | null = null
      let dbSizeBytes: number | null = null
      try {
        const info = await q.query(
          'SELECT current_database() AS name, pg_database_size(current_database())::bigint AS size'
        )
        dbName = (info.rows[0] as { name: string }).name
        dbSizeBytes = Number((info.rows[0] as { size: unknown }).size)
      } catch {
        /* size stays null (e.g. PGlite in tests may not support pg_database_size) */
      }

      // Pool status
      const poolStatus = manager.poolStatus

      // Environments / actions
      const totalEnvironments = await environmentRepo.count()
      const totalActions = await actionRepo.count()

      // Instances
      const activeInstances = await instanceRepo.countActive()

      // Completed / aborted today
      const todayMidnightUtc = new Date()
      todayMidnightUtc.setUTCHours(0, 0, 0, 0)
      const todayStr = todayMidnightUtc.toISOString()

      const completedTodayResult = await logRepo.query({
        finalStatus: 'COMPLETED',
        startDate: todayStr,
      })
      const completedToday = completedTodayResult.total

      const abortedTodayResult = await logRepo.query({
        finalStatus: 'ABORTED',
        startDate: todayStr,
      })
      const abortedToday = abortedTodayResult.total

      // Log info
      const totalLogEntries = await logRepo.count()
      const maxLogEntries = await settingsRepo.getNumericValue('log_max_size')
      const oldestEntryResult = await logRepo.query({ limit: 1 })
      const oldestEntry =
        oldestEntryResult.entries.length > 0
          ? oldestEntryResult.entries[oldestEntryResult.entries.length - 1]
          : null
      const oldestEntryAt = oldestEntry ? oldestEntry.completed_at : null

      // Recent log entries
      const countParam = req.query['count']
      const recentCount = Math.min(
        Math.max(1, parseInt(typeof countParam === 'string' ? countParam : '10', 10) || 10),
        100
      )
      const recentEntries = await logRepo.getRecent(recentCount)
      const recentLogEntries = recentEntries.map((e) => ({
        id: e.id,
        runtime_action_instance_id: e.runtime_action_instance_id,
        action_name: e.action_name,
        environment_name: e.environment_name,
        started_at: e.started_at,
        completed_at: e.completed_at,
        duration_ms: e.duration_ms,
        final_status: e.final_status,
        error: e.error,
      }))

      res.status(200).json({
        data: {
          container: {
            uptime_seconds: uptimeSeconds,
            started_at: startedAt,
            node_version: process.version,
            python_version: cachedPythonVersion,
            db_name: dbName,
            db_size_bytes: dbSizeBytes,
            memory_rss_bytes: process.memoryUsage().rss,
          },
          python_pool: {
            size: poolStatus.size,
            idle: poolStatus.idle,
            busy: poolStatus.busy,
            queued: poolStatus.queued,
          },
          environments: {
            total_count: totalEnvironments,
            total_actions: totalActions,
          },
          instances: {
            active_count: activeInstances,
            completed_today: completedToday,
            aborted_today: abortedToday,
          },
          log: {
            total_entries: totalLogEntries,
            max_entries: maxLogEntries,
            oldest_entry_at: oldestEntryAt,
          },
          recent_log_entries: recentLogEntries,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // MGMT-02: POST /upload
  // --------------------------------------------------------
  router.post('/upload', upload.array('files'), async (req, res, next) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined

      if (!files || files.length === 0) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'No files provided',
            details: {},
          },
        })
      }

      // Validate file extensions
      for (const file of files) {
        const ext = file.originalname.split('.').pop()?.toLowerCase() ?? ''
        if (
          ext !== 'wfenvir' &&
          ext !== 'wfenvirx' &&
          ext !== 'wfenvirlibx' &&
          ext !== 'wfaction' &&
          ext !== 'wfactionlibx' &&
          ext !== 'wfactioncodex' &&
          ext !== 'wfsteplibx' &&
          ext !== 'wfenvirbundlex'
        ) {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid file extension for "${file.originalname}". Expected .WFenvir, .WFenvirX, .WFenvirLibX, .WFenvirBundleX, .WFaction, .WFactionLibX, .WFactionCodeX, or .WFstepLibX`,
              details: { filename: file.originalname },
            },
          })
        }
      }

      // Parse all files first (fail-fast before any DB writes).
      // .WFenvir / .WFenvirX carry library-format JSON ({ …, environment_specifications: [...] })
      // and flatten to one ParsedFile entry per environment.
      type ParsedFile =
        | {
            file: Express.Multer.File
            type: 'wfenvir'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: any
            schemaVersion?: string
          }
        | {
            file: Express.Multer.File
            type: 'wfaction'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: any
          }
        | {
            file: Express.Multer.File
            type: 'wfactioncodex'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: any
            codeFiles: Array<{ state: string; source: string }>
          }
        | {
            file: Express.Multer.File
            type: 'wfenvirbundlex'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: any // the inner .WFenvir JSON object (library shape)
            schemaVersion: string
            codeByActionOid: Record<string, Array<{ state: string; source: string }>>
          }
        | {
            file: Express.Multer.File
            type: 'wfenvirx-single-env'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            envData: any // the root *.WFenvir JSON object (single-env shape)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            actions: any[] // actions/*.WFaction JSON objects
          }

      const parsed: ParsedFile[] = []
      for (const file of files) {
        const ext = file.originalname.split('.').pop()?.toLowerCase() ?? ''

        if (ext === 'wfaction') {
          let data: unknown
          try {
            data = JSON.parse(file.buffer.toString('utf-8'))
          } catch {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Failed to parse JSON in file "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }
          if (typeof data !== 'object' || data === null) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `File "${file.originalname}" must contain a JSON object`,
                details: { filename: file.originalname },
              },
            })
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const obj = data as Record<string, any>
          for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
            if (obj[field] === undefined) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Missing required field "${field}" in .WFaction file "${file.originalname}"`,
                  details: { filename: file.originalname },
                },
              })
            }
          }
          parsed.push({ file, type: 'wfaction', data: obj })
          continue
        }

        if (ext === 'wfactioncodex') {
          let zip: JSZip
          try {
            zip = await loadZipSafely(file.buffer)
          } catch {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Failed to read ZIP archive in "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }

          // Find the inner *.WFaction entry
          const actionEntry = Object.values(zip.files).find((entry) => {
            if (entry.dir) return false
            const innerExt = entry.name.split('.').pop()?.toLowerCase() ?? ''
            return innerExt === 'wfaction'
          })
          if (!actionEntry) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `ZIP "${file.originalname}" contains no action.WFaction entry`,
                details: { filename: file.originalname },
              },
            })
          }

          let actionData: unknown
          try {
            actionData = JSON.parse(await actionEntry.async('text'))
          } catch {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Failed to parse JSON in "${actionEntry.name}" of "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }
          if (typeof actionData !== 'object' || actionData === null) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `"${actionEntry.name}" must contain a JSON object in "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const codexObj = actionData as Record<string, any>
          for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
            if (codexObj[field] === undefined) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Missing required field "${field}" in action.WFaction of "${file.originalname}"`,
                  details: { filename: file.originalname },
                },
              })
            }
          }

          // Collect code/*.py entries
          const codeFiles: Array<{ state: string; source: string }> = []
          for (const entry of Object.values(zip.files)) {
            if (entry.dir) continue
            const match = /^code\/([^/]+)\.py$/.exec(entry.name)
            if (!match) continue
            const state = match[1]!
            const source = await entry.async('text')
            codeFiles.push({ state, source })
          }

          parsed.push({ file, type: 'wfactioncodex', data: codexObj, codeFiles })
          continue
        }

        if (ext === 'wfenvirbundlex') {
          let zip: JSZip
          try {
            zip = await loadZipSafely(file.buffer)
          } catch {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Failed to read ZIP archive in "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }

          // Find the inner *.WFenvir entry
          const innerEntry = Object.values(zip.files).find((entry) => {
            if (entry.dir) return false
            const innerExt = entry.name.split('.').pop()?.toLowerCase() ?? ''
            return innerExt === 'wfenvir'
          })
          if (!innerEntry) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Bundle "${file.originalname}" has no inner *.WFenvir entry`,
                details: { filename: file.originalname },
              },
            })
          }

          let libData: unknown
          try {
            libData = JSON.parse(await innerEntry.async('text'))
          } catch {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Failed to parse inner .WFenvir JSON in "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }
          if (typeof libData !== 'object' || libData === null) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Inner .WFenvir in "${file.originalname}" must contain a JSON object`,
                details: { filename: file.originalname },
              },
            })
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lib = libData as Record<string, any>

          // Validate the same required fields as .WFenvirX
          const libRequired = [
            'local_id',
            'oid',
            'version',
            'last_modified_date',
            'environment_specifications',
          ]
          for (const field of libRequired) {
            if (lib[field] === undefined) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Missing required field "${field}" in inner .WFenvir of "${file.originalname}"`,
                  details: { filename: file.originalname },
                },
              })
            }
          }
          // schemaVersion is optional. When present, gate against legacy 2.0/below;
          // when absent, default to "4.0" (mirrors the .WFenvirX branch).
          const rawSchemaVersion = lib['schemaVersion'] as unknown
          let schemaVersion: string
          if (rawSchemaVersion === undefined) {
            schemaVersion = '4.0'
          } else if (typeof rawSchemaVersion !== 'string') {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `schemaVersion must be a string in "${file.originalname}"`,
                details: { filename: file.originalname, schemaVersion: rawSchemaVersion },
              },
            })
          } else {
            const ver = parseFloat(rawSchemaVersion)
            if (Number.isNaN(ver) || ver < 3.0) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Unsupported schemaVersion "${rawSchemaVersion}" in "${file.originalname}". Minimum accepted version is "3.0".`,
                  details: { filename: file.originalname, schemaVersion: rawSchemaVersion },
                },
              })
            }
            schemaVersion = rawSchemaVersion
          }

          // Collect code files grouped by action OID
          const codeByActionOid: Record<string, Array<{ state: string; source: string }>> = {}
          for (const entry of Object.values(zip.files)) {
            if (entry.dir) continue
            const match = /^code\/([^/]+)\/([^/]+)\.py$/.exec(entry.name)
            if (!match) continue
            const actionOid = match[1]!
            const state = match[2]!
            const source = await entry.async('text')
            ;(codeByActionOid[actionOid] ??= []).push({ state, source })
          }

          parsed.push({ file, type: 'wfenvirbundlex', data: lib, schemaVersion, codeByActionOid })
          continue
        }

        // ext === 'wfenvirx' — dual-meaning ZIP: check manifest.packageType to disambiguate.
        // packageType === 'environment-package' → new single-env shape (Layer 3).
        // packageType === 'environment-library' OR no manifest → legacy env-library shape.
        if (ext === 'wfenvirx') {
          let zip: JSZip
          try {
            zip = await loadZipSafely(file.buffer)
          } catch {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Failed to read ZIP archive in "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }

          // Read manifest.json if present to detect packageType
          const manifestEntry = zip.file('manifest.json')
          let packageType: string | undefined
          if (manifestEntry) {
            try {
              const manifestJson = JSON.parse(await manifestEntry.async('text'))
              packageType =
                typeof manifestJson.packageType === 'string' ? manifestJson.packageType : undefined
            } catch {
              // manifest parse failure — fall through to legacy path
            }
          }

          if (packageType === 'environment-package') {
            // ---- New single-env package path ----
            // Root *.WFenvir contains the single environment definition.
            const envEntry = Object.values(zip.files).find((entry) => {
              if (entry.dir) return false
              const innerExt = entry.name.split('.').pop()?.toLowerCase() ?? ''
              const isRootLevel = !entry.name.includes('/')
              return innerExt === 'wfenvir' && isRootLevel
            })
            if (!envEntry) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Single-env package "${file.originalname}" contains no root *.WFenvir entry`,
                  details: { filename: file.originalname },
                },
              })
            }

            let envData: unknown
            try {
              envData = JSON.parse(await envEntry.async('text'))
            } catch {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Failed to parse JSON in "${envEntry.name}" of "${file.originalname}"`,
                  details: { filename: file.originalname },
                },
              })
            }
            if (typeof envData !== 'object' || envData === null) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `"${envEntry.name}" in "${file.originalname}" must contain a JSON object`,
                  details: { filename: file.originalname },
                },
              })
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const envObj = envData as Record<string, any>
            for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
              if (envObj[field] === undefined) {
                return void res.status(400).json({
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: `Missing required field "${field}" in "${envEntry.name}" of "${file.originalname}"`,
                    details: { filename: file.originalname },
                  },
                })
              }
            }

            // Collect actions/*.WFaction entries
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const actionObjects: any[] = []
            for (const entry of Object.values(zip.files)) {
              if (entry.dir) continue
              const innerExt = entry.name.split('.').pop()?.toLowerCase() ?? ''
              if (innerExt !== 'wfaction') continue
              // Only pick up files under an actions/ subdirectory
              if (!entry.name.startsWith('actions/')) continue
              let actionData: unknown
              try {
                actionData = JSON.parse(await entry.async('text'))
              } catch {
                return void res.status(400).json({
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: `Failed to parse JSON in "${entry.name}" of "${file.originalname}"`,
                    details: { filename: file.originalname },
                  },
                })
              }
              if (typeof actionData !== 'object' || actionData === null) {
                return void res.status(400).json({
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: `"${entry.name}" in "${file.originalname}" must contain a JSON object`,
                    details: { filename: file.originalname },
                  },
                })
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const actionObj = actionData as Record<string, any>
              for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
                if (actionObj[field] === undefined) {
                  return void res.status(400).json({
                    error: {
                      code: 'VALIDATION_ERROR',
                      message: `Missing required field "${field}" in "${entry.name}" of "${file.originalname}"`,
                      details: { filename: file.originalname },
                    },
                  })
                }
              }
              actionObjects.push(actionObj)
            }

            parsed.push({
              file,
              type: 'wfenvirx-single-env',
              envData: envObj,
              actions: actionObjects,
            })
            continue
          }

          // ---- Legacy env-library path (packageType === 'environment-library' or absent) ----
          // First inner *.WFenvir or *.WFenvirX entry wins (matches Designer's exporter behavior).
          const innerEntry = Object.values(zip.files).find((entry) => {
            if (entry.dir) return false
            const innerExt = entry.name.split('.').pop()?.toLowerCase() ?? ''
            return innerExt === 'wfenvir' || innerExt === 'wfenvirx'
          })
          if (!innerEntry) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `ZIP "${file.originalname}" contains no .WFenvir entry`,
                details: { filename: file.originalname },
              },
            })
          }
          const libraryJsonFromZip = await innerEntry.async('text')

          let libDataFromZip: unknown
          try {
            libDataFromZip = JSON.parse(libraryJsonFromZip)
          } catch {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Failed to parse JSON in file "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }
          if (typeof libDataFromZip !== 'object' || libDataFromZip === null) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `File "${file.originalname}" must contain a JSON object`,
                details: { filename: file.originalname },
              },
            })
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const libFromZip = libDataFromZip as Record<string, any>

          const libZipRequired = [
            'local_id',
            'oid',
            'version',
            'last_modified_date',
            'environment_specifications',
          ]
          for (const field of libZipRequired) {
            if (libFromZip[field] === undefined) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Missing required field "${field}" in environment library "${file.originalname}"`,
                  details: { filename: file.originalname },
                },
              })
            }
          }

          // schemaVersion validation (same as the .WFenvir bare branch below)
          const rawSchemaVersionFromZip = libFromZip['schemaVersion'] as unknown
          let schemaVersionFromZip: string
          if (rawSchemaVersionFromZip === undefined) {
            schemaVersionFromZip = '4.0'
          } else if (typeof rawSchemaVersionFromZip !== 'string') {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `schemaVersion must be a string in "${file.originalname}"`,
                details: { filename: file.originalname, schemaVersion: rawSchemaVersionFromZip },
              },
            })
          } else {
            const ver = parseFloat(rawSchemaVersionFromZip)
            if (Number.isNaN(ver) || ver < 3.0) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Unsupported schemaVersion "${rawSchemaVersionFromZip}" in "${file.originalname}". Minimum accepted version is "3.0".`,
                  details: { filename: file.originalname, schemaVersion: rawSchemaVersionFromZip },
                },
              })
            }
            schemaVersionFromZip = rawSchemaVersionFromZip
          }

          if (!Array.isArray(libFromZip['environment_specifications'])) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `"environment_specifications" must be an array in "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }

          const envSpecsFromZip = libFromZip['environment_specifications'] as unknown[]
          for (let idx = 0; idx < envSpecsFromZip.length; idx++) {
            const envSpec = envSpecsFromZip[idx]
            if (typeof envSpec !== 'object' || envSpec === null) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Each environment_specifications entry must be an object in "${file.originalname}"`,
                  details: { filename: file.originalname, index: idx },
                },
              })
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const env = envSpec as Record<string, any>

            for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
              if (env[field] === undefined) {
                return void res.status(400).json({
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: `Missing required field "${field}" in environment_specifications[${idx}] of "${file.originalname}"`,
                    details: { filename: file.originalname, index: idx },
                  },
                })
              }
            }
            if (!Array.isArray(env['included_actions'])) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `"included_actions" must be an array in environment_specifications[${idx}] of "${file.originalname}"`,
                  details: { filename: file.originalname, index: idx },
                },
              })
            }
            for (const action of env['included_actions'] as unknown[]) {
              if (typeof action !== 'object' || action === null) {
                return void res.status(400).json({
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: `Each included_action must be an object in environment_specifications[${idx}] of "${file.originalname}"`,
                    details: { filename: file.originalname, index: idx },
                  },
                })
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const act = action as Record<string, any>
              for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
                if (act[field] === undefined) {
                  return void res.status(400).json({
                    error: {
                      code: 'VALIDATION_ERROR',
                      message: `Missing required action field "${field}" in environment_specifications[${idx}] of "${file.originalname}"`,
                      details: { filename: file.originalname, index: idx },
                    },
                  })
                }
              }
            }

            parsed.push({
              file,
              type: 'wfenvir',
              data: env,
              schemaVersion: schemaVersionFromZip,
            })
          }
          continue
        }

        // ext === 'wfenvirlibx' — renamed .WFenvirX env-library ZIP.
        // Contains an inner *.WFenvir JSON file in env-library shape.
        // Treated exactly like the legacy .WFenvirX no-manifest / 'environment-library' path.
        if (ext === 'wfenvirlibx') {
          let zip: JSZip
          try {
            zip = await loadZipSafely(file.buffer)
          } catch {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Failed to read ZIP archive in "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }

          // First inner *.WFenvir or *.WFenvirX entry wins (mirrors legacy .WFenvirX behavior).
          const innerEntry = Object.values(zip.files).find((entry) => {
            if (entry.dir) return false
            const innerExt = entry.name.split('.').pop()?.toLowerCase() ?? ''
            return innerExt === 'wfenvir' || innerExt === 'wfenvirx'
          })
          if (!innerEntry) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `ZIP "${file.originalname}" contains no .WFenvir entry`,
                details: { filename: file.originalname },
              },
            })
          }
          const libJsonFromZip = await innerEntry.async('text')

          let libDataFromZip: unknown
          try {
            libDataFromZip = JSON.parse(libJsonFromZip)
          } catch {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Failed to parse JSON in file "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }
          if (typeof libDataFromZip !== 'object' || libDataFromZip === null) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `File "${file.originalname}" must contain a JSON object`,
                details: { filename: file.originalname },
              },
            })
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const libFromZip = libDataFromZip as Record<string, any>

          const libZipRequired = [
            'local_id',
            'oid',
            'version',
            'last_modified_date',
            'environment_specifications',
          ]
          for (const field of libZipRequired) {
            if (libFromZip[field] === undefined) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Missing required field "${field}" in environment library "${file.originalname}"`,
                  details: { filename: file.originalname },
                },
              })
            }
          }

          // schemaVersion validation (mirrors the .WFenvirX legacy-library branch)
          const rawSchemaVersionFromZip = libFromZip['schemaVersion'] as unknown
          let schemaVersionFromZip: string
          if (rawSchemaVersionFromZip === undefined) {
            schemaVersionFromZip = '4.0'
          } else if (typeof rawSchemaVersionFromZip !== 'string') {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `schemaVersion must be a string in "${file.originalname}"`,
                details: {
                  filename: file.originalname,
                  schemaVersion: rawSchemaVersionFromZip,
                },
              },
            })
          } else {
            const ver = parseFloat(rawSchemaVersionFromZip)
            if (Number.isNaN(ver) || ver < 3.0) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Unsupported schemaVersion "${rawSchemaVersionFromZip}" in "${file.originalname}". Minimum accepted version is "3.0".`,
                  details: {
                    filename: file.originalname,
                    schemaVersion: rawSchemaVersionFromZip,
                  },
                },
              })
            }
            schemaVersionFromZip = rawSchemaVersionFromZip
          }

          if (!Array.isArray(libFromZip['environment_specifications'])) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `"environment_specifications" must be an array in "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }

          const envSpecsFromZip = libFromZip['environment_specifications'] as unknown[]
          for (let idx = 0; idx < envSpecsFromZip.length; idx++) {
            const envSpec = envSpecsFromZip[idx]
            if (typeof envSpec !== 'object' || envSpec === null) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Each environment_specifications entry must be an object in "${file.originalname}"`,
                  details: { filename: file.originalname, index: idx },
                },
              })
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const env = envSpec as Record<string, any>

            for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
              if (env[field] === undefined) {
                return void res.status(400).json({
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: `Missing required field "${field}" in environment_specifications[${idx}] of "${file.originalname}"`,
                    details: { filename: file.originalname, index: idx },
                  },
                })
              }
            }
            if (!Array.isArray(env['included_actions'])) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `"included_actions" must be an array in environment_specifications[${idx}] of "${file.originalname}"`,
                  details: { filename: file.originalname, index: idx },
                },
              })
            }
            for (const action of env['included_actions'] as unknown[]) {
              if (typeof action !== 'object' || action === null) {
                return void res.status(400).json({
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: `Each included_action must be an object in environment_specifications[${idx}] of "${file.originalname}"`,
                    details: { filename: file.originalname, index: idx },
                  },
                })
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const act = action as Record<string, any>
              for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
                if (act[field] === undefined) {
                  return void res.status(400).json({
                    error: {
                      code: 'VALIDATION_ERROR',
                      message: `Missing required action field "${field}" in environment_specifications[${idx}] of "${file.originalname}"`,
                      details: { filename: file.originalname, index: idx },
                    },
                  })
                }
              }
            }

            parsed.push({
              file,
              type: 'wfenvir',
              data: env,
              schemaVersion: schemaVersionFromZip,
            })
          }
          continue
        }

        // ext === 'wfactionlibx' — renamed action-library format.
        // No parser exists for this format in this container (the legacy .WFactionX / action-library
        // was never supported as a container upload). Reject with a clear error directing the user
        // to upload individual .WFaction files instead.
        if (ext === 'wfactionlibx') {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `".WFactionLibX" (action library) is not supported as a container upload. Upload individual .WFaction files instead.`,
              details: { filename: file.originalname },
            },
          })
        }

        // ext === 'wfsteplibx' — renamed step-library format.
        // No parser exists for this format in this container (the legacy .WFslibX / step-library
        // was never supported as a container upload). Reject with a clear error.
        if (ext === 'wfsteplibx') {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `".WFstepLibX" (step library) is not supported as a container upload.`,
              details: { filename: file.originalname },
            },
          })
        }

        // ext === 'wfenvir' (bare library JSON)
        const libraryJson: string = file.buffer.toString('utf-8')

        let libData: unknown
        try {
          libData = JSON.parse(libraryJson)
        } catch {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `Failed to parse JSON in file "${file.originalname}"`,
              details: { filename: file.originalname },
            },
          })
        }
        if (typeof libData !== 'object' || libData === null) {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `File "${file.originalname}" must contain a JSON object`,
              details: { filename: file.originalname },
            },
          })
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lib = libData as Record<string, any>

        const libRequired = [
          'local_id',
          'oid',
          'version',
          'last_modified_date',
          'environment_specifications',
        ]
        for (const field of libRequired) {
          if (lib[field] === undefined) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Missing required field "${field}" in environment library "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }
        }

        // schemaVersion is optional. When present, gate against legacy 2.0/below;
        // when absent (real Designer env-library exports omit it today), default to "4.0".
        const rawSchemaVersion = lib['schemaVersion'] as unknown
        let schemaVersion: string
        if (rawSchemaVersion === undefined) {
          schemaVersion = '4.0'
        } else if (typeof rawSchemaVersion !== 'string') {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `schemaVersion must be a string in "${file.originalname}"`,
              details: { filename: file.originalname, schemaVersion: rawSchemaVersion },
            },
          })
        } else {
          const ver = parseFloat(rawSchemaVersion)
          if (Number.isNaN(ver) || ver < 3.0) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Unsupported schemaVersion "${rawSchemaVersion}" in "${file.originalname}". Minimum accepted version is "3.0".`,
                details: { filename: file.originalname, schemaVersion: rawSchemaVersion },
              },
            })
          }
          schemaVersion = rawSchemaVersion
        }

        if (!Array.isArray(lib['environment_specifications'])) {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `"environment_specifications" must be an array in "${file.originalname}"`,
              details: { filename: file.originalname },
            },
          })
        }

        const envSpecs = lib['environment_specifications'] as unknown[]
        for (let idx = 0; idx < envSpecs.length; idx++) {
          const envSpec = envSpecs[idx]
          if (typeof envSpec !== 'object' || envSpec === null) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Each environment_specifications entry must be an object in "${file.originalname}"`,
                details: { filename: file.originalname, index: idx },
              },
            })
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const env = envSpec as Record<string, any>

          for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
            if (env[field] === undefined) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Missing required field "${field}" in environment_specifications[${idx}] of "${file.originalname}"`,
                  details: { filename: file.originalname, index: idx },
                },
              })
            }
          }
          if (!Array.isArray(env['included_actions'])) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `"included_actions" must be an array in environment_specifications[${idx}] of "${file.originalname}"`,
                details: { filename: file.originalname, index: idx },
              },
            })
          }
          for (const action of env['included_actions'] as unknown[]) {
            if (typeof action !== 'object' || action === null) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Each included_action must be an object in environment_specifications[${idx}] of "${file.originalname}"`,
                  details: { filename: file.originalname, index: idx },
                },
              })
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const act = action as Record<string, any>
            for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
              if (act[field] === undefined) {
                return void res.status(400).json({
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: `Missing required action field "${field}" in environment_specifications[${idx}] of "${file.originalname}"`,
                    details: { filename: file.originalname, index: idx },
                  },
                })
              }
            }
          }

          parsed.push({
            file,
            type: 'wfenvir',
            data: env,
            schemaVersion: schemaVersion as string,
          })
        }
      }

      // All-or-nothing transaction
      type ImportSummary = {
        type: string
        oid: string
        local_id: string
        version: string
        actions_count?: number
        status: 'created' | 'updated'
        /** Environments only: the oid this environment was re-keyed from (same name, new oid). */
        rekeyed_from?: string | null
      }

      type DiffSummary = ActionSyncDiff

      const imported: ImportSummary[] = []
      const diffs: DiffSummary[] = []

      // Environment names listed more than once in this upload are never
      // re-keyed onto a stored environment (the pairing would be ambiguous).
      const incomingEnvNames: string[] = []
      const incomingEnvOids = new Set<string>()
      const noteIncomingEnv = (spec: Record<string, unknown>) => {
        incomingEnvNames.push(spec['local_id'] as string)
        incomingEnvOids.add(spec['oid'] as string)
      }
      for (const item of parsed) {
        if (item.type === 'wfenvir') {
          noteIncomingEnv(item.data as Record<string, unknown>)
        } else if (item.type === 'wfenvirbundlex') {
          const specs = (item.data as Record<string, unknown>)['environment_specifications']
          if (Array.isArray(specs)) {
            for (const spec of specs as Record<string, unknown>[]) noteIncomingEnv(spec)
          }
        } else if (item.type === 'wfenvirx-single-env') {
          noteIncomingEnv(item.envData as Record<string, unknown>)
        }
      }
      const duplicateIncomingNames = new Set(
        incomingEnvNames.filter((name, i) => incomingEnvNames.indexOf(name) !== i)
      )
      // Old oids of re-keyed environments; their SSE property buses are torn
      // down after the transaction commits.
      const rekeyedEnvOids: string[] = []

      // Helper: upsert one env spec + its actions; return the list of upserted action OIDs.
      // Used by both the wfenvir branch and the new wfenvirbundlex branch. Takes the
      // TRANSACTION-BOUND repos (never the outer pool-bound ones) so every write in
      // one /upload call commits or rolls back together.
      const processEnvSpec = async (
        txRepos: {
          environments: typeof environmentRepo
          actions: typeof actionRepo
          codeVersions: typeof codeVersionRepo
          instances: typeof instanceRepo
          log: typeof logRepo
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        envData: Record<string, any>,
        schemaVersion: string,
        sourceFilename: string,
        codeBearingOids?: ReadonlySet<string>
      ): Promise<string[]> => {
        // Upsert environment
        const envInput = {
          oid: envData['oid'] as string,
          local_id: envData['local_id'] as string,
          version: envData['version'] as string,
          last_modified_date: envData['last_modified_date'] as string,
          schema_version: schemaVersion,
          action_property_specifications: (envData['action_property_specifications'] ??
            []) as unknown[],
          value_property_specifications: (envData['value_property_specifications'] ??
            []) as unknown[],
          resource_property_specifications: (envData['resource_property_specifications'] ??
            []) as unknown[],
          source_filename: sourceFilename,
          description: (envData['description'] as string | undefined) ?? null,
          state: (envData['state'] as LifecycleState | undefined) ?? 'Draft',
        }

        const { created: envCreated, rekeyedFrom } = await syncEnvironmentRow(txRepos, envInput, {
          duplicateIncomingNames,
          incomingOids: incomingEnvOids,
        })
        if (rekeyedFrom) rekeyedEnvOids.push(rekeyedFrom)

        // Reconcile the included actions with what's stored — matched by oid,
        // then by name; authored code is never wiped (see lib/import-actions.ts).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const includedActions = (envData['included_actions'] ?? []) as Record<string, any>[]
        const incoming: ActionInput[] = includedActions.map((action) => ({
          oid: action['oid'] as string,
          environment_oid: envData['oid'] as string,
          local_id: action['local_id'] as string,
          version: action['version'] as string,
          last_modified_date: action['last_modified_date'] as string,
          action_visibility: (action['action_visibility'] ?? 'opaque') as 'opaque' | 'observable',
          input_parameter_specifications: (action['input_parameter_specifications'] ??
            []) as unknown[],
          output_parameter_specifications: (action['output_parameter_specifications'] ??
            []) as unknown[],
          property_specifications: (action['property_specifications'] ?? []) as unknown[],
          description: (action['description'] as string | undefined) ?? null,
          state: (action['state'] as LifecycleState | undefined) ?? 'Draft',
        }))
        const { storedOids, diff } = await syncEnvironmentActions(
          txRepos,
          envData['oid'] as string,
          incoming,
          { codeBearingOids }
        )

        diffs.push(diff)
        imported.push({
          type: 'environment',
          oid: envData['oid'] as string,
          local_id: envData['local_id'] as string,
          version: envData['version'] as string,
          actions_count: includedActions.length,
          status: envCreated ? 'created' : 'updated',
          rekeyed_from: rekeyedFrom,
        })

        return storedOids
      }

      await txRunner.inTransaction(async ({ repos }) => {
        for (const item of parsed) {
          if (item.type === 'wfenvir') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const envData = item.data as Record<string, any>
            await processEnvSpec(
              repos,
              envData,
              item.schemaVersion as string,
              item.file.originalname
            )
          } else if (item.type === 'wfenvirbundlex') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const lib = item.data as Record<string, any>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const envSpecs = lib['environment_specifications'] as Record<string, any>[]
            if (!Array.isArray(envSpecs)) {
              // Defense-in-depth: parsing guarantees this, but bail loudly if invariants break.
              throw new Error(
                `Bundle transaction: environment_specifications missing or not an array (file: ${item.file.originalname})`
              )
            }
            const codeBearingOids = new Set(
              Object.entries(item.codeByActionOid)
                .filter(([, files]) => files.length > 0)
                .map(([oid]) => oid)
            )
            for (const envData of envSpecs) {
              const upsertedActionOids = await processEnvSpec(
                repos,
                envData,
                item.schemaVersion,
                item.file.originalname,
                codeBearingOids
              )
              // Create code versions for any actions that have code in the bundle
              for (const actionOid of upsertedActionOids) {
                const codeFiles = item.codeByActionOid[actionOid] ?? []
                for (const cf of codeFiles) {
                  await repos.codeVersions.saveAndActivate({
                    action_oid: actionOid,
                    state: cf.state,
                    source_code: cf.source,
                    created_by: 'import',
                    description: null,
                  })
                }
              }
            }
          } else if (item.type === 'wfenvirx-single-env') {
            // New single-env package: upsert environment + standalone actions, NO code rows.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const envData = item.envData as Record<string, any>

            // Upsert environment
            const envInput = {
              oid: envData['oid'] as string,
              local_id: envData['local_id'] as string,
              version: envData['version'] as string,
              last_modified_date: envData['last_modified_date'] as string,
              schema_version: (envData['schemaVersion'] as string | undefined) ?? '4.0',
              action_property_specifications: (envData['action_property_specifications'] ??
                []) as unknown[],
              value_property_specifications: (envData['value_property_specifications'] ??
                []) as unknown[],
              resource_property_specifications: (envData['resource_property_specifications'] ??
                []) as unknown[],
              source_filename: item.file.originalname,
              description: (envData['description'] as string | undefined) ?? null,
              state: (envData['state'] as LifecycleState | undefined) ?? 'Draft',
            }
            const { created: envCreated, rekeyedFrom } = await syncEnvironmentRow(repos, envInput, {
              duplicateIncomingNames,
              incomingOids: incomingEnvOids,
            })
            if (rekeyedFrom) rekeyedEnvOids.push(rekeyedFrom)

            // Reconcile the standalone actions (from actions/*.WFaction entries in the ZIP)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const singleEnvActions = item.actions as Record<string, any>[]
            const incoming: ActionInput[] = singleEnvActions.map((action) => ({
              oid: action['oid'] as string,
              environment_oid: envData['oid'] as string,
              local_id: action['local_id'] as string,
              version: action['version'] as string,
              last_modified_date: action['last_modified_date'] as string,
              action_visibility: (action['action_visibility'] ?? 'opaque') as
                | 'opaque'
                | 'observable',
              input_parameter_specifications: (action['input_parameter_specifications'] ??
                []) as unknown[],
              output_parameter_specifications: (action['output_parameter_specifications'] ??
                []) as unknown[],
              property_specifications: (action['property_specifications'] ?? []) as unknown[],
              description: (action['description'] as string | undefined) ?? null,
              state: (action['state'] as LifecycleState | undefined) ?? 'Draft',
            }))
            const { diff } = await syncEnvironmentActions(repos, envData['oid'] as string, incoming)

            diffs.push(diff)
            imported.push({
              type: 'environment',
              oid: envData['oid'] as string,
              local_id: envData['local_id'] as string,
              version: envData['version'] as string,
              actions_count: singleEnvActions.length,
              status: envCreated ? 'created' : 'updated',
              rekeyed_from: rekeyedFrom,
            })
            // NOTE: No code rows are created — this is intentional for single-env packages.
          } else if (item.type === 'wfaction' || item.type === 'wfactioncodex') {
            // Both bare .WFaction and .WFactionCodeX upsert the action via the same path.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const actionData = item.data as Record<string, any>
            const actionInput = {
              oid: actionData['oid'] as string,
              environment_oid: (actionData['environment_oid'] as string | undefined) ?? '',
              local_id: actionData['local_id'] as string,
              version: actionData['version'] as string,
              last_modified_date: actionData['last_modified_date'] as string,
              action_visibility: (actionData['action_visibility'] ?? 'opaque') as
                | 'opaque'
                | 'observable',
              input_parameter_specifications: (actionData['input_parameter_specifications'] ??
                []) as unknown[],
              output_parameter_specifications: (actionData['output_parameter_specifications'] ??
                []) as unknown[],
              property_specifications: (actionData['property_specifications'] ?? []) as unknown[],
              description: (actionData['description'] as string | undefined) ?? null,
              state: (actionData['state'] as LifecycleState | undefined) ?? 'Draft',
            }
            const carriesCode = item.type === 'wfactioncodex' && item.codeFiles.length > 0
            const {
              created: actionCreated,
              rekeyedFrom,
              signatureChanged,
            } = await importAction(repos, actionInput, { carriesCode })
            imported.push({
              type: 'action',
              oid: actionData['oid'] as string,
              local_id: actionData['local_id'] as string,
              version: actionData['version'] as string,
              status: actionCreated ? 'created' : 'updated',
            })
            diffs.push({
              ...emptyActionSyncDiff(),
              added: actionCreated ? [actionInput.local_id] : [],
              rekeyed: rekeyedFrom ? [actionInput.local_id] : [],
              signature_changed: signatureChanged ? [actionInput.local_id] : [],
            })

            // For .WFactionCodeX, also save+activate each code version.
            if (item.type === 'wfactioncodex') {
              for (const { state, source } of item.codeFiles) {
                await repos.codeVersions.saveAndActivate({
                  action_oid: actionInput.oid,
                  state,
                  source_code: source,
                  created_by: 'import',
                  description: null,
                })
              }
            }
          }
        }
      })

      // A re-keyed environment's old oid can still have property buses with
      // live subscribers; nobody will publish on it again.
      for (const oldOid of rekeyedEnvOids) sseManager.destroyPropertyBuses(oldOid)

      // Combine diffs
      const combinedDiff: DiffSummary = {
        added: diffs.flatMap((d) => d.added),
        removed: diffs.flatMap((d) => d.removed),
        modified: diffs.flatMap((d) => d.modified),
        rekeyed: diffs.flatMap((d) => d.rekeyed),
        orphaned: diffs.flatMap((d) => d.orphaned),
        signature_changed: diffs.flatMap((d) => d.signature_changed),
      }

      res.status(200).json({
        data: {
          imported,
          diff: combinedDiff,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // MGMT-03: GET /environments
  // --------------------------------------------------------
  router.get('/environments', async (_req, res, next) => {
    try {
      const environments = await environmentRepo.findAll()
      const enriched = await Promise.all(
        environments.map(async (env) => ({
          ...env,
          action_count: await actionRepo.countByEnvironment(env.oid),
        }))
      )
      res.status(200).json({
        data: enriched,
        meta: { total: enriched.length },
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // MGMT-04: GET /environments/:oid
  // --------------------------------------------------------
  router.get('/environments/:oid', async (req, res, next) => {
    try {
      const oid = req.params.oid as string
      const env = await environmentRepo.findByOid(oid)
      if (!env) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Environment not found',
            details: {},
          },
        })
      }

      const actions = await actionRepo.findByEnvironment(oid)
      const actionSummaries = await Promise.all(
        actions.map(async (action) => {
          const codeVersions = await codeVersionRepo.findByAction(action.oid)
          const statesWithCode = [...new Set(codeVersions.map((cv) => cv.state))]
          return {
            oid: action.oid,
            local_id: action.local_id,
            version: action.version,
            action_visibility: action.action_visibility,
            input_param_count: action.input_parameter_specifications.length,
            output_param_count: action.output_parameter_specifications.length,
            states_with_code: statesWithCode,
            signature_change: action.signature_change,
            orphaned_at: action.orphaned_at,
          }
        })
      )

      res.status(200).json({
        data: {
          ...env,
          actions: actionSummaries,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // MGMT-05: DELETE /environments/:oid
  // --------------------------------------------------------
  router.delete('/environments/:oid', async (req, res, next) => {
    try {
      const oid = req.params.oid as string

      // Check environment exists
      const env = await environmentRepo.findByOid(oid)
      if (!env) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Environment not found',
            details: {},
          },
        })
      }

      // Check for active instances
      const actions = await actionRepo.findByEnvironment(oid)
      for (const action of actions) {
        const instances = await instanceRepo.findByAction(action.oid)
        const hasActive = instances.some((i) => i.completed_at === null)
        if (hasActive) {
          return void res.status(409).json({
            error: {
              code: 'CONFLICT',
              message: 'Cannot delete environment with active instances',
              details: {},
            },
          })
        }
      }

      // Delete in transaction with explicit ordering
      let actionsRemoved = 0
      let codeVersionsRemoved = 0
      let instancesRemoved = 0

      const blockedByActive = await txRunner.inTransaction(async ({ q, repos }) => {
        // Lock the environment row, then its action rows (ORDER BY oid): an instance
        // insert takes a key-share lock on both through its foreign keys, so it either
        // committed before this point (seen by the re-check) or waits for this delete.
        await q.query('SELECT 1 FROM environments WHERE oid = $1 FOR UPDATE', [oid])
        await q.query(
          'SELECT oid FROM actions WHERE environment_oid = $1 ORDER BY oid FOR UPDATE',
          [oid]
        )
        if (await repos.instances.hasActiveByEnvironment(oid)) return true

        // Fetch action list before any deletions
        const actionList = await repos.actions.findByEnvironment(oid)

        // Delete code versions for each action first
        for (const action of actionList) {
          codeVersionsRemoved += await repos.codeVersions.deleteByAction(action.oid)
        }

        // instances.action_oid / instances.environment_oid have no ON DELETE CASCADE
        // (by spec — see migrations.test.ts "does NOT cascade delete instances").
        // Active instances were already rejected above (409); terminal records get cleaned
        // up here so the action delete below doesn't trip the FK constraint.
        instancesRemoved = await repos.instances.deleteByEnvironment(oid)

        // Delete all actions for the environment
        actionsRemoved = await repos.actions.deleteByEnvironment(oid)

        // Delete the environment itself
        await repos.environments.delete(oid)
        return false
      })

      if (blockedByActive) {
        return void res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'Cannot delete environment with active instances',
            details: {},
          },
        })
      }

      // Tear down per-property SSE buses for this env so active subscribers
      // receive no further events and heartbeat timers are cleared.
      sseManager.destroyPropertyBuses(oid)

      res.status(200).json({
        data: {
          deleted: true,
          environment_oid: oid,
          actions_removed: actionsRemoved,
          code_versions_removed: codeVersionsRemoved,
          instances_removed: instancesRemoved,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // PUT /environments/:oid/properties — edit environment-level
  // Action Property values (the shared `props` set).
  //
  // Goes through InstanceManager.setPropertyValues() so a console save
  // serializes with runtime set_property() writes and publishes the
  // REST-12 SSE event (source: 'console'). Values only, all-or-nothing.
  // --------------------------------------------------------
  router.put('/environments/:oid/properties', async (req, res, next) => {
    try {
      const oid = req.params.oid as string
      const parsed = parsePropertyEdits(req.body)
      if (!parsed.ok) {
        return void res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: parsed.message, details: {} },
        })
      }
      if (!(await environmentRepo.findByOid(oid))) {
        return void res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Environment not found: ${oid}`, details: {} },
        })
      }

      let specs: unknown[]
      try {
        specs = await manager.setPropertyValues(oid, parsed.edits)
      } catch (err) {
        if (sendPropertyEditError(res, err)) return
        throw err
      }
      res.status(200).json({ data: { oid, action_property_specifications: specs }, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // A signature_change flag only means something while the action has code
  // to reconcile; once the last version is gone, drop it.
  async function clearSignatureFlagIfNoCode(actionOid: string): Promise<void> {
    if ((await codeVersionRepo.countByAction(actionOid)) === 0) {
      await actionRepo.update(actionOid, { signature_change: null })
    }
  }

  // --------------------------------------------------------
  // DELETE /actions/:oid/signature-change — the author has reconciled the
  // code with the imported signature; clear the import flag.
  // --------------------------------------------------------
  router.delete('/actions/:oid/signature-change', async (req, res, next) => {
    try {
      const oid = req.params.oid as string
      const updated = await actionRepo.update(oid, { signature_change: null })
      if (!updated) {
        return void res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Action not found', details: {} },
        })
      }
      res.status(200).json({ data: { oid, signature_change: null }, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // DELETE /actions/:oid — remove one action (typically an import orphan
  // the author no longer wants) with its code and terminal instance rows.
  // Mirrors DELETE /environments/:oid: active instances block with 409.
  // --------------------------------------------------------
  router.delete('/actions/:oid', async (req, res, next) => {
    try {
      const oid = req.params.oid as string
      const action = await actionRepo.findByOid(oid)
      if (!action) {
        return void res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Action not found', details: {} },
        })
      }
      const instances = await instanceRepo.findByAction(oid)
      if (instances.some((i) => i.completed_at === null)) {
        return void res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'Cannot delete action with active instances',
            details: {},
          },
        })
      }

      let codeVersionsRemoved = 0
      let instancesRemoved = 0
      await txRunner.inTransaction(async ({ repos }) => {
        codeVersionsRemoved = await repos.codeVersions.deleteByAction(oid)
        // instances.action_oid has no ON DELETE CASCADE — clear terminal rows first.
        instancesRemoved = await repos.instances.deleteByAction(oid)
        await repos.actions.delete(oid)
      })

      res.status(200).json({
        data: {
          deleted: true,
          action_oid: oid,
          code_versions_removed: codeVersionsRemoved,
          instances_removed: instancesRemoved,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // MGMT-06: GET /actions/:oid
  // --------------------------------------------------------
  router.get('/actions/:oid', async (req, res, next) => {
    try {
      const oid = req.params.oid as string
      const action = await actionRepo.findByOid(oid)
      if (!action) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Action not found',
            details: {},
          },
        })
      }

      // Enrich with environment name
      const environment = await environmentRepo.findByOid(action.environment_oid)
      const environmentName = environment?.local_id ?? 'Unknown'

      // Code summary
      const codeVersions = await codeVersionRepo.findByAction(oid)
      const statesWithCode = [...new Set(codeVersions.map((cv) => cv.state))]
      const totalVersions = codeVersions.length
      const lastCodeUpdate =
        codeVersions.length > 0
          ? codeVersions.reduce((latest, cv) => (cv.created_at > latest.created_at ? cv : latest))
              .created_at
          : null

      res.status(200).json({
        data: {
          ...action,
          environment_name: environmentName,
          code_summary: {
            states_with_code: statesWithCode,
            total_versions: totalVersions,
            last_code_update: lastCodeUpdate,
          },
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // PUT /actions/:oid/timeout — set per-action timeout
  // --------------------------------------------------------
  router.put('/actions/:oid/timeout', async (req, res, next) => {
    try {
      const actionOid = req.params.oid as string
      const action = await actionRepo.findByOid(actionOid)
      if (!action) {
        return void res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Action not found: ${actionOid}` },
        })
      }

      const { timeout_seconds } = req.body as { timeout_seconds: number | null }

      // Validate: null (global default), 0 (disabled), or positive integer
      if (timeout_seconds !== null) {
        if (
          typeof timeout_seconds !== 'number' ||
          !Number.isInteger(timeout_seconds) ||
          timeout_seconds < 0
        ) {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'timeout_seconds must be null, 0, or a positive integer',
            },
          })
        }
      }

      await actionRepo.update(actionOid, { timeout_seconds })

      const updated = await actionRepo.findByOid(actionOid)
      res.json({ data: { oid: actionOid, timeout_seconds: updated?.timeout_seconds ?? null } })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // PUT /actions/:oid/properties — edit one action's own Action
  // Property values (the read-only-from-code `action_props` set).
  //
  // Per-action properties have no runtime writer, so a plain repository
  // update suffices — no serialization chain, no SSE (REST-12 is
  // environment-scoped). Values only, all-or-nothing.
  // --------------------------------------------------------
  router.put('/actions/:oid/properties', async (req, res, next) => {
    try {
      const oid = req.params.oid as string
      const parsed = parsePropertyEdits(req.body)
      if (!parsed.ok) {
        return void res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: parsed.message, details: {} },
        })
      }
      const action = await actionRepo.findByOid(oid)
      if (!action) {
        return void res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Action not found: ${oid}`, details: {} },
        })
      }

      // Fresh JSON.parse from findByOid — a throw part-way leaves storage untouched.
      const specs = action.property_specifications as PropertySpecRecord[]
      try {
        applyPropertyEdits(specs, parsed.edits, `action ${oid}`)
      } catch (err) {
        if (sendPropertyEditError(res, err)) return
        throw err
      }
      await actionRepo.update(oid, { property_specifications: specs })
      res.status(200).json({ data: { oid, property_specifications: specs }, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // Code management endpoints (MGMT-07 through MGMT-12)
  //
  // CRITICAL: literal paths (/active, /test) MUST be registered
  // BEFORE parameterized paths (/:version_id) to prevent Express
  // from treating "active" or "test" as a version_id value.
  // --------------------------------------------------------

  // MGMT-08 (literal): GET /code/:action_oid/:state/active
  router.get('/code/:action_oid/:state/active', async (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string

      const version = await codeVersionRepo.getActive(action_oid, state)
      if (!version) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'No active code version for this action+state',
            details: {},
          },
        })
      }

      res.status(200).json({ data: version, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-12 (literal): POST /code/:action_oid/:state/test
  router.post('/code/:action_oid/:state/test', async (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = (req.body ?? {}) as Record<string, any>

      let sourceCode: string

      if (body['source_code'] !== undefined) {
        // Full execution mode: source_code provided in body
        if (typeof body['source_code'] !== 'string') {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'source_code must be a string',
              details: {},
            },
          })
        }
        sourceCode = body['source_code'] as string
      } else {
        // Syntax check mode: use active version's source code
        const activeVersion = await codeVersionRepo.getActive(action_oid, state)
        if (!activeVersion) {
          return void res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'No active code version for this action+state',
              details: {},
            },
          })
        }
        sourceCode = activeVersion.source_code
      }

      const testInputs =
        body['test_inputs'] !== undefined
          ? (body['test_inputs'] as Record<string, string>)
          : undefined
      const testProps =
        body['test_props'] !== undefined
          ? (body['test_props'] as Record<string, unknown>)
          : undefined
      const testActionProps =
        body['test_action_props'] !== undefined
          ? (body['test_action_props'] as Record<string, unknown>)
          : undefined
      const timeoutMs =
        body['timeout_ms'] !== undefined ? (body['timeout_ms'] as number) : undefined

      const testResult = await manager.testCode(
        sourceCode,
        testInputs,
        testProps,
        testActionProps,
        timeoutMs
      )

      res.status(200).json({ data: testResult, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-08 (parameterized): GET /code/:action_oid/:state/:version_id
  router.get('/code/:action_oid/:state/:version_id', async (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string
      const version_id = req.params.version_id as string

      const version = await codeVersionRepo.findById(version_id)
      if (!version || version.action_oid !== action_oid || version.state !== state) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Code version not found',
            details: {},
          },
        })
      }

      res.status(200).json({ data: version, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-10 (parameterized): POST /code/:action_oid/:state/:version_id/activate
  router.post('/code/:action_oid/:state/:version_id/activate', async (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string
      const version_id = req.params.version_id as string

      const version = await codeVersionRepo.findById(version_id)
      if (!version || version.action_oid !== action_oid || version.state !== state) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Code version not found',
            details: {},
          },
        })
      }

      await codeVersionRepo.activate(version_id)

      res.status(200).json({
        data: {
          id: version_id,
          version_number: version.version_number,
          is_active: true,
          activated_at: new Date().toISOString(),
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-11 (parameterized): DELETE /code/:action_oid/:state/:version_id
  router.delete('/code/:action_oid/:state/:version_id', async (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string
      const version_id = req.params.version_id as string

      const version = await codeVersionRepo.findById(version_id)
      if (!version || version.action_oid !== action_oid || version.state !== state) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Code version not found',
            details: {},
          },
        })
      }

      // Cannot delete the active version
      if (version.is_active) {
        return void res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'Cannot delete the active version',
            details: {},
          },
        })
      }

      // Cannot delete a version pinned by a running instance
      const activeInstances = await instanceRepo.findActive()
      const isPinned = activeInstances.some((inst) => {
        const pinned = inst.pinned_code_versions as Array<{
          state: string
          code_version_id: string
        }>
        return pinned.some((p) => p.code_version_id === version_id)
      })
      if (isPinned) {
        return void res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'Cannot delete version pinned by running instance',
            details: {},
          },
        })
      }

      await q.query('DELETE FROM code_versions WHERE id = $1', [version_id])
      await clearSignatureFlagIfNoCode(action_oid)

      res.status(200).json({ data: { deleted: true, id: version_id }, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // MGMT-CLEAR: DELETE /code/:action_oid/:state
  // Wipes all versions (active + history) for a state. Idempotent.
  // --------------------------------------------------------
  router.delete('/code/:action_oid/:state', async (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string

      const action = await actionRepo.findByOid(action_oid)
      if (!action) {
        return void res.status(404).json({
          error: {
            code: 'ACTION_NOT_FOUND',
            message: `Action not found: ${action_oid}`,
            details: {},
          },
        })
      }

      // Guard: refuse if any version-to-be-cleared is pinned by a running instance
      const versionsForState = await codeVersionRepo.getVersionHistory(action_oid, state)
      if (versionsForState.length > 0) {
        const versionIds = new Set(versionsForState.map((v) => v.id))
        const activeInstances = await instanceRepo.findActive()
        const isPinned = activeInstances.some((inst) => {
          const pinned = inst.pinned_code_versions as Array<{
            state: string
            code_version_id: string
          }>
          return pinned.some((p) => versionIds.has(p.code_version_id))
        })
        if (isPinned) {
          return void res.status(409).json({
            error: {
              code: 'CONFLICT',
              message: 'Cannot clear code: one or more versions are pinned by a running instance',
              details: {},
            },
          })
        }
      }

      const deleted_version_count = await codeVersionRepo.clearByActionAndState(action_oid, state)
      await clearSignatureFlagIfNoCode(action_oid)

      res.status(200).json({
        data: { deleted_version_count },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-07: GET /code/:action_oid/:state  (list versions — metadata only)
  router.get('/code/:action_oid/:state', async (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string

      // Validate action exists
      const action = await actionRepo.findByOid(action_oid)
      if (!action) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Action not found',
            details: {},
          },
        })
      }

      const versions = await codeVersionRepo.getVersionHistory(action_oid, state)
      const metadata = versions.map((v) => ({
        id: v.id,
        version_number: v.version_number,
        is_active: v.is_active,
        created_at: v.created_at,
        created_by: v.created_by,
        description: v.description,
        code_size: v.source_code.length,
      }))

      res.status(200).json({
        data: { action_oid, state, versions: metadata },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-09: POST /code/:action_oid/:state  (save new version)
  router.post('/code/:action_oid/:state', async (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string

      // Validate action exists
      const action = await actionRepo.findByOid(action_oid)
      if (!action) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Action not found',
            details: {},
          },
        })
      }

      // Validate :state matches the action's visibility state machine.
      // Reject states that the action can never reach so code isn't silently
      // saved for a never-executed state (a real silent-fail trap caught by
      // the 2026-05-23 smoke test).
      const validStates =
        action.action_visibility === 'opaque'
          ? VALID_OPAQUE_CODE_STATES
          : VALID_OBSERVABLE_CODE_STATES
      if (!validStates.has(state)) {
        const sorted = [...validStates].sort()
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: `State '${state}' is not valid for action visibility '${action.action_visibility}'. Valid states: ${sorted.join(', ')}`,
            details: {
              state,
              action_visibility: action.action_visibility,
              valid_states: sorted,
            },
          },
        })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = (req.body ?? {}) as Record<string, any>

      if (body['source_code'] === undefined || body['source_code'] === null) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'source_code is required',
            details: {},
          },
        })
      }

      if (typeof body['source_code'] !== 'string') {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'source_code must be a string',
            details: {},
          },
        })
      }

      if (
        body['description'] !== undefined &&
        body['description'] !== null &&
        typeof body['description'] !== 'string'
      ) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'description must be a string',
            details: {},
          },
        })
      }

      if (
        body['created_by'] !== undefined &&
        body['created_by'] !== null &&
        typeof body['created_by'] !== 'string'
      ) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'created_by must be a string',
            details: {},
          },
        })
      }

      const saved = await codeVersionRepo.saveAndActivate({
        action_oid,
        state,
        source_code: body['source_code'] as string,
        description: (body['description'] as string | undefined) ?? undefined,
        created_by: (body['created_by'] as string | undefined) ?? undefined,
      })

      res.status(201).json({
        data: {
          id: saved.id,
          version_number: saved.version_number,
          is_active: saved.is_active,
          created_at: saved.created_at,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // Instance monitoring endpoints (MGMT-13 through MGMT-15)
  //
  // CRITICAL: literal paths (/active, /history) MUST be registered
  // BEFORE parameterized paths (/:id) to prevent Express from treating
  // "active" or "history" as an instance id value.
  // --------------------------------------------------------

  // MGMT-13a: GET /instances/active (currently running instances — completed_at IS NULL)
  router.get('/instances/active', async (req, res, next) => {
    try {
      const environmentOid = req.query['environment_oid'] as string | undefined
      const actionOid = req.query['action_oid'] as string | undefined

      // Build dynamic query for active instances with optional filters
      const whereClauses: string[] = ['completed_at IS NULL']
      const params: unknown[] = []
      let paramIdx = 1

      if (actionOid) {
        whereClauses.push(`action_oid = $${paramIdx++}`)
        params.push(actionOid)
      }
      if (environmentOid) {
        whereClauses.push(`environment_oid = $${paramIdx++}`)
        params.push(environmentOid)
      }

      const where = `WHERE ${whereClauses.join(' AND ')}`
      const result = await q.query(
        `SELECT * FROM instances ${where} ORDER BY created_at DESC`,
        params
      )
      const rows = result.rows as Array<{
        runtime_action_instance_id: string
        action_oid: string
        environment_oid: string
        workflow_instance_id: string
        step_instance_id: string
        step_oid: string
        visibility: string
        state: string
        input_parameters: string
        output_parameters: string
        state_history: string
        pinned_code_versions: string
        states_with_code_executed: string
        created_at: string
        started_at: string | null
        completed_at: string | null
        error: string | null
        traceback: string | null
        is_logged: boolean
      }>

      // Parse JSON fields and enrich with names
      const enrichedInstances = await Promise.all(
        rows.map(async (row) => {
          const action = await actionRepo.findByOid(row.action_oid)
          const env = await environmentRepo.findByOid(row.environment_oid)
          return {
            runtime_action_instance_id: row.runtime_action_instance_id,
            action_oid: row.action_oid,
            environment_oid: row.environment_oid,
            workflow_instance_id: row.workflow_instance_id,
            step_instance_id: row.step_instance_id,
            step_oid: row.step_oid,
            visibility: row.visibility,
            state: row.state,
            input_parameters: JSON.parse(row.input_parameters) as unknown[],
            output_parameters: JSON.parse(row.output_parameters) as unknown[],
            state_history: JSON.parse(row.state_history) as unknown[],
            pinned_code_versions: JSON.parse(row.pinned_code_versions) as unknown[],
            states_with_code_executed: JSON.parse(row.states_with_code_executed) as unknown[],
            created_at: row.created_at,
            started_at: row.started_at,
            completed_at: row.completed_at,
            error: row.error,
            traceback: row.traceback,
            is_logged: row.is_logged,
            action_name: action?.local_id ?? 'Unknown',
            environment_name: env?.local_id ?? 'Unknown',
          }
        })
      )

      res.status(200).json({
        data: enrichedInstances,
        meta: { total: enrichedInstances.length },
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-13b: GET /instances/history (terminal instances — completed_at IS NOT NULL)
  router.get('/instances/history', async (req, res, next) => {
    try {
      const environmentOid = req.query['environment_oid'] as string | undefined
      const actionOid = req.query['action_oid'] as string | undefined

      // Pagination
      const page = Math.max(1, Number(req.query['page']) || 1)
      const pageSize = Math.min(200, Math.max(1, Number(req.query['page_size']) || 50))

      // Sorting
      const SORTABLE_FIELDS = new Set(['created_at', 'completed_at', 'state', 'action_oid'])
      const sortField = SORTABLE_FIELDS.has(req.query['sort'] as string)
        ? (req.query['sort'] as string)
        : 'completed_at'
      const sortOrder = req.query['order'] === 'asc' ? 'ASC' : 'DESC'

      // Build WHERE clause
      const whereClauses: string[] = ['completed_at IS NOT NULL']
      const params: unknown[] = []
      let paramIdx = 1

      if (actionOid) {
        whereClauses.push(`action_oid = $${paramIdx++}`)
        params.push(actionOid)
      }
      if (environmentOid) {
        whereClauses.push(`environment_oid = $${paramIdx++}`)
        params.push(environmentOid)
      }

      const where = `WHERE ${whereClauses.join(' AND ')}`

      // Count query
      const countResult = await q.query(
        `SELECT COUNT(*)::int AS cnt FROM instances ${where}`,
        params
      )
      const total = (countResult.rows[0] as { cnt: number }).cnt

      // Paginated select
      const offset = (page - 1) * pageSize
      const limitIdx = paramIdx++
      const offsetIdx = paramIdx++
      const result = await q.query(
        `SELECT * FROM instances ${where} ORDER BY ${sortField} ${sortOrder} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...params, pageSize, offset]
      )
      const rows = result.rows as Array<{
        runtime_action_instance_id: string
        action_oid: string
        environment_oid: string
        workflow_instance_id: string
        step_instance_id: string
        step_oid: string
        visibility: string
        state: string
        input_parameters: string
        output_parameters: string
        state_history: string
        pinned_code_versions: string
        states_with_code_executed: string
        created_at: string
        started_at: string | null
        completed_at: string | null
        error: string | null
        traceback: string | null
        is_logged: boolean
      }>

      // Parse JSON fields and enrich with names
      const enrichedInstances = await Promise.all(
        rows.map(async (row) => {
          const action = await actionRepo.findByOid(row.action_oid)
          const env = await environmentRepo.findByOid(row.environment_oid)
          return {
            runtime_action_instance_id: row.runtime_action_instance_id,
            action_oid: row.action_oid,
            environment_oid: row.environment_oid,
            workflow_instance_id: row.workflow_instance_id,
            step_instance_id: row.step_instance_id,
            step_oid: row.step_oid,
            visibility: row.visibility,
            state: row.state,
            input_parameters: JSON.parse(row.input_parameters) as unknown[],
            output_parameters: JSON.parse(row.output_parameters) as unknown[],
            state_history: JSON.parse(row.state_history) as unknown[],
            pinned_code_versions: JSON.parse(row.pinned_code_versions) as unknown[],
            states_with_code_executed: JSON.parse(row.states_with_code_executed) as unknown[],
            created_at: row.created_at,
            started_at: row.started_at,
            completed_at: row.completed_at,
            error: row.error,
            traceback: row.traceback,
            is_logged: row.is_logged,
            action_name: action?.local_id ?? 'Unknown',
            environment_name: env?.local_id ?? 'Unknown',
          }
        })
      )

      res.status(200).json({
        data: enrichedInstances,
        meta: {
          total,
          page,
          page_size: pageSize,
          total_pages: Math.ceil(total / pageSize),
        },
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-14: GET /instances/:id (management detail view)
  router.get('/instances/:id', async (req, res, next) => {
    try {
      const id = req.params.id as string
      const instance = await instanceRepo.findById(id)
      if (!instance) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Instance not found',
            details: {},
          },
        })
      }

      const action = await actionRepo.findByOid(instance.action_oid)
      const env = await environmentRepo.findByOid(instance.environment_oid)

      res.status(200).json({
        data: {
          ...instance,
          action_name: action?.local_id ?? 'Unknown',
          environment_name: env?.local_id ?? 'Unknown',
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-15: POST /instances/:id/command (from console)
  router.post('/instances/:id/command', async (req, res, next) => {
    try {
      const id = req.params.id as string

      const validation = validateBody(req.body, {
        command: { required: true, type: 'string' },
        reason: { required: false, type: 'string' },
      })
      if (!validation.valid) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.message,
            details: {},
          },
        })
      }

      const command = validation.data['command'] as string

      // Validate command before instance lookup
      const VALID_COMMANDS = new Set([
        'PAUSE',
        'RESUME',
        'HOLD',
        'UNHOLD',
        'ABORT',
        'STOP',
        'CLEAR',
      ])
      if (!VALID_COMMANDS.has(command)) {
        return void res.status(422).json({
          error: {
            code: 'INVALID_COMMAND',
            message: `Unknown command: ${command}`,
            details: { command },
          },
        })
      }

      // Check instance exists
      const instance = await manager.getInstance(id)
      if (!instance) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Instance not found',
            details: {},
          },
        })
      }

      // Delegate to InstanceManager (InvalidStateTransitionError -> 409 via errorHandler)
      await manager.sendCommand(id, command)

      res.status(200).json({
        data: {
          instance_id: id,
          command,
          accepted: true,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-15b: DELETE /instances/:id (force-remove an instance row, regardless of state)
  //
  // The protocol-level DELETE at /trajectory/v1/instances/:id calls
  // manager.cancelInstance, which sends ABORT through the state machine and
  // kills the worker but leaves the row in the DB. That's fine for normal
  // shutdown, but it can't recover from instances stuck in non-terminal
  // states (e.g. ABORTING after a worker crash) because the env-delete route
  // rejects with 409 on any "active" (completed_at IS NULL) instance. This
  // route gives operators a single hammer to clean those rows out so the
  // owning environment can subsequently be deleted.
  router.delete('/instances/:id', async (req, res, next) => {
    try {
      const id = req.params.id as string
      const instance = await manager.getInstance(id)
      if (!instance) {
        return void res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Instance not found', details: {} },
        })
      }
      const deleted = await manager.forceDeleteInstance(id)
      // Tear down the per-instance SSE bus so no heartbeat/listener lingers
      // referencing the now-removed row.
      sseManager.destroyInstanceBus(id)
      res.status(200).json({
        data: { deleted, instance_id: id },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // Log endpoints (MGMT-16 through MGMT-17)
  // --------------------------------------------------------

  // MGMT-16: GET /log (query log entries)
  router.get('/log', async (req, res, next) => {
    try {
      // Pagination
      const page = Math.max(1, Number(req.query['page']) || 1)
      const pageSize = Math.min(200, Math.max(1, Number(req.query['page_size']) || 50))

      // Build filters
      const filters: LogQueryFilters = {}
      if (req.query['action_name']) filters.actionName = req.query['action_name'] as string
      if (req.query['environment_oid'])
        filters.environmentOid = req.query['environment_oid'] as string
      if (req.query['status']) filters.finalStatus = req.query['status'] as FinalStatus
      if (req.query['from']) filters.startDate = req.query['from'] as string
      if (req.query['to']) filters.endDate = req.query['to'] as string
      filters.limit = pageSize
      filters.offset = (page - 1) * pageSize

      const { entries, total } = await logRepo.query(filters)
      const totalPages = Math.ceil(total / pageSize)

      // Build log_config section
      const maxEntries = await settingsRepo.getNumericValue('log_max_size')
      const currentEntries = await logRepo.count()

      // Get oldest entry timestamp
      const oldestQuery = await logRepo.query({ limit: 1, offset: Math.max(0, currentEntries - 1) })
      const oldestEntryAt =
        oldestQuery.entries.length > 0 ? oldestQuery.entries[0].completed_at : null

      res.status(200).json({
        data: entries,
        meta: {
          page,
          page_size: pageSize,
          total_entries: total,
          total_pages: totalPages,
          log_config: {
            max_entries: maxEntries,
            current_entries: currentEntries,
            oldest_entry_at: oldestEntryAt,
          },
        },
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-17: GET /log/:id (single entry)
  router.get('/log/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id as string)
      if (isNaN(id)) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Log entry id must be a number',
            details: {},
          },
        })
      }

      const entry = await logRepo.findById(id)
      if (!entry) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Log entry not found',
            details: {},
          },
        })
      }

      res.status(200).json({ data: entry, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // Settings endpoints (MGMT-18)
  // --------------------------------------------------------

  // MGMT-18: GET /settings (list all)
  router.get('/settings', async (_req, res, next) => {
    try {
      // Redact the api_key value — never expose the secret over the API. Report
      // only whether one is configured.
      const allSettings = await settingsRepo.getAll()
      const settings = allSettings.map((s) =>
        s.key === 'api_key' ? { ...s, value: '', default_value: '', configured: true } : s
      )
      res.status(200).json({ data: settings, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-18: PUT /settings/:key (update)
  router.put('/settings/:key', async (req, res, next) => {
    try {
      const key = req.params.key as string

      if (key === 'api_key') {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The API key is set with ACTIONS_API_KEY in .env and cannot be changed here.',
            details: {},
          },
        })
      }

      const validation = validateBody(req.body, {
        value: { required: true, type: 'string' },
      })
      if (!validation.valid) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.message,
            details: {},
          },
        })
      }

      const value = validation.data['value'] as string

      // Capture previous value before update
      const previousValue = await settingsRepo.getValue(key)

      // Update — throws NotFoundError (404) or ValidationError (400) if invalid
      await settingsRepo.update(key, value)

      // Apply side effects
      if (key === 'python_pool_size') {
        manager.resizePool(Number(value))
      } else if (key === 'log_max_size') {
        await logRepo.trimToSize(Number(value))
      }

      const data = { key, value, previous_value: previousValue, applied: true }
      res.status(200).json({ data, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  return router
}
