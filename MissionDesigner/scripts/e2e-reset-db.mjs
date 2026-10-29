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

// Resets the E2E Postgres database so each Playwright run starts from a fresh,
// un-bootstrapped DB (→ the /setup wizard that global-setup.ts drives). The
// URL comes from DATABASE_URL (set by playwright.config.ts webServer.env).
// DROP SCHEMA public CASCADE; CREATE SCHEMA public wipes all tables and data
// instantly; the app's bootstrapDatabase() recreates everything on first boot.
//
// On Windows, a prior run's API server can outlive Playwright's webServer
// teardown (the `node --watch` grandchild is spawned through a shell and isn't
// reliably tree-killed). That orphan holds ports 3001/5174 open. So we free
// those ports first (dev-start.mjs also does this, but only AFTER this script
// runs). A no-op when DATABASE_URL is unset.

import { execSync } from 'node:child_process'
import pg from 'pg'

const db = process.env.DATABASE_URL
if (!db) process.exit(0)

const API_PORT = Number(process.env.PORT) || 3001
const VITE_PORT = Number(process.env.VITE_PORT) || 5174

function killPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    const pids = new Set()
    for (const line of out.split('\n')) {
      const m = line.trim().match(/(\d+)\s*$/)
      if (m) pids.add(m[1])
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' })
        console.log(`e2e-reset-db: killed PID ${pid} on port ${port}`)
      } catch {
        // process already exited
      }
    }
  } catch {
    // nothing listening on that port
  }
}

killPort(API_PORT)
killPort(VITE_PORT)

const client = new pg.Client({ connectionString: db })
try {
  await client.connect()
  // lock_timeout guards against a stray connection holding a lock on the public
  // schema: fail fast with a clear error instead of hanging the 120s webServer boot.
  await client.query("SET lock_timeout = '15s'; DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
  console.log(`e2e-reset-db: Postgres schema reset at ${db}`)
} catch (err) {
  console.error(
    `e2e-reset-db: cannot reach Postgres at ${db} — is the e2e container up?\n${err.message}`,
  )
  process.exit(1)
} finally {
  await client.end()
}
