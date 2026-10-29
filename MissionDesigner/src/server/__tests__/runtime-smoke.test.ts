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

// Runtime smoke test for the Phase 1 v7.0 envelope migration.
//
// What it does: take a workflow seeded into the editor's DB, export it via the
// production HTTP route, write the ZIP to a temp file, then run the runtime
// engine's CLI validator (`engines/web/dist/validate-file.js` in a TrajectoryRuntime checkout)
// against the file. The runtime returns exit 0 + a "VALID" line when the
// package conforms to its AJV schema.
//
// This is the contract that was previously broken (and the user's reason for
// blocking on Phase 1): the runtime could not consume what the editor was
// producing. With this test green, runtime UAT is unblocked.
//
// Point TRAJECTORY_RUNTIME_DIR at a TrajectoryRuntime checkout whose engine is built
// (`cd engines/web && npm run build`); without it, or if the dist file is missing,
// the test is skipped.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  setupTestFixture,
  resetAndSeedFixture,
  mockSessionAs,
  v2Req,
  rawQuery,
  type TestFixture,
} from '../routes/v2/__tests__/testSeed'

const RUNTIME_DIR = process.env.TRAJECTORY_RUNTIME_DIR
const RUNTIME_VALIDATOR = RUNTIME_DIR ? join(RUNTIME_DIR, 'engines/web/dist/validate-file.js') : ''

let f: TestFixture
beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetAndSeedFixture(f)
  mockSessionAs(f.userIdGlobal)
})

function realisticWorkflowData(): string {
  return JSON.stringify({
    nodes: [
      {
        id: 'n-start',
        type: 'start',
        position: { x: 100, y: 100 },
        data: { stepType: 'start', label: 'Start' },
      },
      {
        id: 'n-action',
        type: 'actionProxyWait',
        position: { x: 100, y: 250 },
        data: { stepType: 'actionProxyWait', label: 'Do Thing', actionVisibility: 'observable' },
      },
      {
        id: 'n-end',
        type: 'end',
        position: { x: 100, y: 400 },
        data: { stepType: 'end', label: 'Done' },
      },
    ],
    edges: [
      { id: 'e1', source: 'n-start', target: 'n-action' },
      { id: 'e2', source: 'n-action', target: 'n-end' },
    ],
  })
}

describe('runtime smoke — v7.0 export validates against the TrajectoryRuntime engine', () => {
  it.skipIf(!RUNTIME_VALIDATOR || !existsSync(RUNTIME_VALIDATOR))(
    'exports a v7.0 .WFmasterX that the runtime CLI accepts',
    async () => {
      // Seed realistic editor node data with stepType in node.data — what a real
      // saved workflow looks like.
      await rawQuery('UPDATE specification SET data = $1 WHERE id = $2', [realisticWorkflowData(), f.rootSpecId])

      const res = await v2Req(f, 'GET', `/api/v2/packages/workflow/${f.rootSpecId}`)
      expect(res.status).toBe(200)
      const zipBytes = Buffer.from(await res.arrayBuffer())

      const dir = mkdtempSync(join(tmpdir(), 'wf-smoke-'))
      const zipPath = join(dir, 'Smoke.WFmasterX')
      writeFileSync(zipPath, zipBytes)

      const result = spawnSync('node', [RUNTIME_VALIDATOR, zipPath], {
        encoding: 'utf8',
        timeout: 30_000,
      })

      const stderr = result.stderr ?? ''
      const stdout = result.stdout ?? ''
      const detail = `stdout:\n${stdout}\n---stderr:\n${stderr}`

      expect(result.status, `runtime validator did not exit cleanly. ${detail}`).toBe(0)
      expect(stdout, `runtime validator did not print VALID. ${detail}`).toMatch(/VALID/)
    },
    60_000,
  )
})
