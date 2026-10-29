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
 * instance-manager-pool-resize.test.ts — Guards on the async, settings-based
 * pool-size reconciliation InstanceManager's constructor kicks off (fire-and-
 * forget, since the constructor itself cannot be async).
 *
 * Covers a fix-review finding: a late-resolving `python_pool_size` settings
 * read must never (a) spawn workers after shutdown() has already torn the
 * pool down, or (b) clobber an explicit resizePool() call issued in the
 * meantime. Both tests seed `python_pool_size` to a value that differs from
 * the manager's construction-time pool size, so the reconciliation branch
 * that would call PythonWorkerPool.resize() is actually live — the seeded
 * default ('4') equals the code's own fallback, which would make the branch
 * a no-op and prove nothing.
 *
 * Uses its own isolated PGlite instance (not the shared db in
 * instance-manager.test.ts) specifically so mutating the global
 * `python_pool_size` setting here cannot bleed into other test files.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestDb, type TestDb } from '@mission/autopilot-storage/testing'
import { InstanceManager } from '../instance-manager/instance-manager.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SCRIPT_PATH = path.resolve(__dirname, '../../../python-sidecar/sandbox_runner.py')

// A DB-configured size that differs from every construction-time poolSize
// used below, so the reconciliation always has something to (wrongly) do if
// the guards are missing.
const DB_POOL_SIZE = '7'

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()
  await db.query(`UPDATE settings SET value = $1 WHERE key = 'python_pool_size'`, [DB_POOL_SIZE])
})

afterAll(async () => {
  await db.close()
})

/** Let the fire-and-forget settings-based reconciliation (a real PGlite
 * round-trip) resolve and its .then/.catch run. PGlite is in-process and
 * fast; 250ms is generous headroom without making the suite slow. */
async function letReconciliationSettle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250))
}

describe('InstanceManager — late pool-size reconciliation guards', () => {
  it('does not spawn workers when the settings read resolves after shutdown()', async () => {
    // poolSize: 1 keeps this test's own subprocess footprint minimal; 1 !==
    // DB_POOL_SIZE (7), so the reconciliation branch is live.
    const manager = new InstanceManager(db, { scriptPath: SCRIPT_PATH, poolSize: 1 })

    // Shut down immediately — well before the settings query can resolve.
    await manager.shutdown()

    await letReconciliationSettle()

    // Must stay fully torn down: shutdown() is the final word, not the late
    // reconciliation trying to grow the pool back to the DB value (7).
    expect(manager.poolStatus.size).toBe(0)
    expect(manager.poolStatus.idle).toBe(0)
    expect(manager.poolStatus.busy).toBe(0)
    expect(manager.poolSize).toBe(1) // resize() no-ops during shutdown — target never changes
  }, 30000)

  it('an explicit resizePool() before the settings read resolves is not overwritten', async () => {
    const manager = new InstanceManager(db, { scriptPath: SCRIPT_PATH, poolSize: 2 })
    try {
      // Race the constructor's in-flight settings reconciliation (target: 7)
      // with an explicit resize to a THIRD value the DB setting would never
      // itself produce, issued synchronously — guaranteed to run before any
      // real DB round-trip can resolve.
      manager.resizePool(3)

      await letReconciliationSettle()

      // The explicit call must win — the late-resolving settings value (7)
      // must not overwrite it.
      expect(manager.poolSize).toBe(3)
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})
