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
 * Start dev servers with proper sequencing.
 *
 * 1. Kill any existing processes on ports 3001 and 5174
 * 2. Start the API server (node --watch) and wait for it to be healthy
 * 3. Start the Vite dev server
 *
 * Usage: node scripts/dev-start.mjs
 */

import { spawn, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

// Thread BETTER_AUTH_SECRET from .env into child processes so dev sessions
// survive server restarts. Without a stable secret, better-auth generates a
// new ephemeral one on every tsx-watch restart and invalidates every cookie.
// Only this one var is threaded on purpose — the port defaults in this
// script are deliberately different from the .env values used by Playwright.
try {
  const raw = readFileSync('.env', 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('BETTER_AUTH_SECRET=')) continue
    let value = trimmed.slice('BETTER_AUTH_SECRET='.length).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (value && !process.env.BETTER_AUTH_SECRET) process.env.BETTER_AUTH_SECRET = value
    break
  }
} catch {
  // .env is optional
}

// Preserve sessions across tsx-watch restarts in development. Without this,
// db.ts wipes the session table on every server boot — fine for production
// (a fresh container should never inherit a logged-in browser cookie) but in
// dev every save of a server file triggers a restart, which signs the user
// out and produces a wave of 401s on every API call until they sign in again.
// Setting the flag here keeps the wipe disabled for `npm run dev:start` only;
// production servers start without dev-start.mjs and remain protected.
if (!process.env.KEEP_SESSIONS_ON_RESTART) {
  process.env.KEEP_SESSIONS_ON_RESTART = 'true'
}

const API_PORT = Number(process.env.PORT) || 3001
const VITE_PORT = Number(process.env.VITE_PORT) || 5174
const HEALTH_URL = `http://localhost:${API_PORT}/api/health`
const MAX_WAIT_MS = 60_000
const POLL_INTERVAL_MS = 500

function killPort(port) {
  try {
    const lines = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    const pids = new Set()
    for (const line of lines.split('\n')) {
      const match = line.trim().match(/(\d+)\s*$/)
      if (match) pids.add(match[1])
    }

    for (const pid of pids) {
      console.log(`  Killing PID ${pid} on port ${port}`)
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' })
      } catch {
        // process may have already exited
      }
    }
  } catch {
    // no process on that port
  }
}

async function waitForHealthy() {
  const start = Date.now()
  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const res = await fetch(HEALTH_URL)
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'ok') return true
      }
    } catch {
      // server not ready yet
    }
    await sleep(POLL_INTERVAL_MS)
  }
  return false
}

// ── Main ────────────────────────────────────────────────────────────────

console.log('=== Trajectory Dev Servers ===\n')

// Step 1: Kill existing processes
console.log('[1/3] Cleaning up old processes...')
killPort(API_PORT)
killPort(VITE_PORT)
await sleep(500) // let OS release ports

// Step 2: Start API server and wait for health check
console.log(`[2/3] Starting API server on port ${API_PORT}...`)
// Use Node's native --watch (it only watches the imported module graph) with the
// tsx loader, NOT `tsx watch`. On Windows `tsx watch` does a recursive startup
// scan over this repo's node_modules that takes 60-120s before the server even
// listens; `node --watch --import tsx` boots the identical server in ~3s and
// still restarts on save.
const server = spawn('node --watch --import tsx src/server/index.ts', [], {
  stdio: 'inherit',
  shell: true,
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(API_PORT) },
})

process.on('SIGINT', () => {
  server.kill()
  process.exit()
})

const healthy = await waitForHealthy()
if (!healthy) {
  console.error(`\n  ERROR: API server did not become healthy within ${MAX_WAIT_MS / 1000}s`)
  server.kill()
  process.exit(1)
}
console.log('  API server is healthy.\n')

// Step 3: Start Vite
console.log(`[3/3] Starting Vite dev server on port ${VITE_PORT}...`)
const vite = spawn(`npx vite --port ${VITE_PORT}`, [], {
  stdio: 'inherit',
  shell: true,
  cwd: process.cwd(),
})

process.on('SIGINT', () => {
  vite.kill()
  server.kill()
  process.exit()
})

// Keep alive — exit when either child exits
server.on('exit', (code) => {
  console.log(`\nAPI server exited (code ${code})`)
  vite.kill()
  process.exit(code ?? 1)
})

vite.on('exit', (code) => {
  console.log(`\nVite exited (code ${code})`)
  server.kill()
  process.exit(code ?? 1)
})
