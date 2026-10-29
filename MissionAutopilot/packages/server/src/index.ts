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

import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { redactUrl } from './log-redact.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  initializeDatabase,
  databaseSchemaStatus,
  createTransactionHelper,
  ActionRepository,
  InstanceRepository,
  SettingsRepository,
  EnvironmentRepository,
  CodeVersionRepository,
  LogRepository,
} from '@mission/autopilot-storage'
import { InstanceManager } from '@mission/autopilot-engine'
import { SseManager } from './sse-manager.js'
import { startRetentionSweep } from './retention-sweep.js'
import { createProtocolRouter } from './routes/protocol.js'
import { createCommandsRouter } from './routes/commands.js'
import { createManagementRouter } from './routes/management.js'
import { createApiKeyAuth } from './middleware/auth.js'
import { errorHandler } from './middleware/error-handler.js'
import { createHostCheck } from './middleware/host-check.js'
import { allowedHosts, isOriginAllowed, readApiKey } from './config.js'

// ============================================================
// ESM __dirname equivalent
// ============================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ============================================================
// Configuration
// ============================================================

const PORT = Number(process.env.PORT ?? 3001)
// Default-closed: bare runs bind loopback. Docker sets HOST=0.0.0.0 (the port
// mapping needs it) and MISSION_AUTOPILOT_BIND carries the real host-side exposure.
const HOST = process.env.HOST ?? '127.0.0.1'
// __dirname is packages/server/src (tsx) or packages/server/dist (compiled)
// Go up to packages/server/, then packages/, then project root
const PACKAGE_ROOT = path.resolve(__dirname, '..')
const PROJECT_ROOT = path.resolve(PACKAGE_ROOT, '..', '..')

// Dev fallback: the compose Postgres published on loopback, with the password
// from POSTGRES_PASSWORD (scripts/setup-secrets.sh writes it to .env). No
// password is hard-coded; set DATABASE_URL to point anywhere else.
function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const password = process.env.POSTGRES_PASSWORD
  if (!password) {
    console.error(
      'Refusing to start: set DATABASE_URL, or POSTGRES_PASSWORD for the local compose Postgres (127.0.0.1:5434).'
    )
    process.exit(1)
  }
  return `postgres://mission:${encodeURIComponent(password)}@127.0.0.1:5434/mission_autopilot`
}
const DATABASE_URL = resolveDatabaseUrl()
const SIDECAR_SCRIPT =
  process.env.SIDECAR_SCRIPT ??
  path.resolve(PROJECT_ROOT, 'packages', 'python-sidecar', 'sandbox_runner.py')

/** Host + database name only — NEVER log the password. */
function safeDbTarget(url: string): string {
  try {
    const u = new URL(url)
    u.password = ''
    return `${u.host}${u.pathname}`
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

// ============================================================
// Startup: database, repositories, managers
// ============================================================

const pool = await initializeDatabase(DATABASE_URL) // top-level await (ESM, Node 22)

// Standalone repositories for protocol router (in addition to InstanceManager's internal repos)
const actionRepo = new ActionRepository(pool)
const instanceRepo = new InstanceRepository(pool)
const settingsRepo = new SettingsRepository(pool)
const environmentRepo = new EnvironmentRepository(pool)
const codeVersionRepo = new CodeVersionRepository(pool)
const logRepo = new LogRepository(pool)

const txRunner = createTransactionHelper(pool)

// The API key is mandatory and comes only from the environment.
const apiKey = readApiKey(process.env)
if (apiKey === null) {
  console.error(
    'Refusing to start: ACTIONS_API_KEY is not set or is shorter than 32 characters. Run scripts/setup-secrets.sh, then restart.'
  )
  process.exit(1)
}

// SSE event bus
const sseManager = new SseManager()

// Pool size: settings-configured value wins, falling back to the engine's
// default of 4. Passed explicitly so InstanceManager's constructor (which
// must stay synchronous) never has to race its own settings read against
// this boot-time value — see InstanceManagerOptions.poolSize.
const poolSize = await settingsRepo.getNumericValue('python_pool_size')

// InstanceManager wired with SseManager callbacks
const manager = new InstanceManager(pool, {
  scriptPath: SIDECAR_SCRIPT,
  poolSize: poolSize ?? 4,
  // sseManager satisfies PropertySsePublisher (structural typing — no explicit cast needed)
  sseManager,
  onStateChange: (instanceId, state, instance) => {
    const history = instance.state_history as Array<{ state: string; timestamp: string }>
    const previousState = history.length >= 2 ? (history[history.length - 2]?.state ?? null) : null
    sseManager.publishStateChange(instanceId, state, previousState, instance)
  },
  onTerminal: (instanceId, state, instance) => {
    const history = instance.state_history as Array<{ state: string; timestamp: string }>
    const previousState = history.length >= 2 ? (history[history.length - 2]?.state ?? null) : null
    sseManager.publishTerminal(instanceId, state, previousState, instance)
  },
  onError: (instanceId, error) => {
    sseManager.publishError(instanceId, error.message)
  },
})

// Instance retention sweep: periodically deletes completed+logged instances
// older than the instance_retention_hours setting. Was specced since the
// first schema but never wired up, so the setting was inert.
const retentionSweep = startRetentionSweep({ instanceRepo, settingsRepo })

// ============================================================
// Express application
// ============================================================

const app = express()

// --------------------------------------------------------
// Middleware (order matters)
// --------------------------------------------------------

// Host/Origin check first so it also covers /health and CORS preflights.
app.use(
  createHostCheck(allowedHosts(process.env), (o) =>
    isOriginAllowed(o, process.env.ACTIONS_ALLOWED_ORIGINS)
  )
)

app.use(
  cors({
    // Default: allow loopback origins only; override with ACTIONS_ALLOWED_ORIGINS
    // (comma-separated). Blocks drive-by requests from arbitrary websites.
    origin: (origin, callback) => {
      callback(null, isOriginAllowed(origin, process.env.ACTIONS_ALLOWED_ORIGINS))
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'Last-Event-ID'],
    exposedHeaders: ['Content-Type'],
  })
)

// Never log the ?token= event-stream credential.
morgan.token('url', (req) => redactUrl((req as { originalUrl?: string }).originalUrl ?? req.url))
app.use(morgan('dev'))
app.use(express.json())

// Health/readiness: verifies DB connectivity AND that the schema is fully
// present. Unauthenticated so the container HEALTHCHECK can probe it. Returns
// 503 over an empty/incomplete database instead of a green TCP port.
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
  } catch {
    return void res.status(503).json({ status: 'error', message: 'database connection failed' })
  }
  const { ok, missingTables } = await databaseSchemaStatus(pool)
  if (!ok) {
    return void res
      .status(503)
      .json({ status: 'error', message: 'database schema incomplete', missingTables })
  }
  return void res.json({ status: 'ok' })
})

// API key auth on all /trajectory/v1/ routes
app.use('/trajectory/v1', createApiKeyAuth(apiKey))

// --------------------------------------------------------
// Routers
// --------------------------------------------------------

app.use(
  '/trajectory/v1',
  createProtocolRouter(manager, actionRepo, instanceRepo, settingsRepo, sseManager, environmentRepo)
)

app.use('/trajectory/v1', createCommandsRouter(manager, sseManager))

// API key auth on all /management/v1/ routes (mirrors /trajectory/v1 above).
// Closes the unauthenticated management surface (incl. the code/test code-exec
// endpoint and snapshot import/export). Always requires ACTIONS_API_KEY.
app.use('/management/v1', createApiKeyAuth(apiKey))

app.use(
  '/management/v1',
  createManagementRouter({
    q: pool,
    txRunner,
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

// --------------------------------------------------------
// Error handler — must be LAST
// --------------------------------------------------------

app.use(errorHandler)

// ============================================================
// Listen
// ============================================================

const server = app.listen(PORT, HOST, () => {
  console.log(`Mission Autopilot server listening on http://${HOST}:${PORT}`)
  console.log(`  Database: ${safeDbTarget(DATABASE_URL)}`)
  console.log(`  Sidecar:  ${SIDECAR_SCRIPT}`)
})

void retentionSweep
  .runOnce()
  .catch((err) => console.error('[retention] initial sweep failed:', err))

// ============================================================
// Graceful shutdown
// ============================================================

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down...`)
  // 1. Stop accepting new connections (existing ones keep running until ended below).
  server.close()
  retentionSweep.stop()
  // 2. End every open SSE stream (closers → res.end()) and drop idle keep-alives.
  sseManager.shutdown()
  server.closeAllConnections()
  // 3. Drain queued property mutations, then close the Python pool and the DB.
  await manager.shutdown()
  await pool.end()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
