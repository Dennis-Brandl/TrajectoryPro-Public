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
 * scenario-warehouse.test.ts — End-to-end coverage for the warehouse scaffold.
 *
 * Exercises:
 *   - buildScenario() → artifact generation
 *   - /upload via .WFenvir (bulk env path)
 *   - /upload via .WFactionCodeX (per-action path)
 *   - /trajectory/v1/actions/:action_oid/invoke each action with SIMULATION_MODE=false → status=0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import express from 'express'
import cors from 'cors'
import http from 'node:http'
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
import { createProtocolRouter } from '../routes/protocol.js'
import { errorHandler } from '../middleware/error-handler.js'
import { buildScenario } from '../../../../scripts/scenarios/lib/build.js'
import {
  uploadScenarioBulk,
  uploadScenarioPerAction,
} from '../../../../scripts/scenarios/lib/upload.js'
import { scenario as warehouseScenario } from '../../../../scripts/scenarios/warehouse/definition.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCRIPT_PATH = path.resolve(__dirname, '../../../python-sidecar/sandbox_runner.py')

interface TestApp {
  serverUrl: string
  server: http.Server
  manager: InstanceManager
  db: TestDb
  environmentRepo: EnvironmentRepository
  actionRepo: ActionRepository
  codeVersionRepo: CodeVersionRepository
}

async function startTestServer(): Promise<TestApp> {
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
    poolSize: 2,
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
  app.use(
    '/trajectory/v1',
    createProtocolRouter(
      manager,
      actionRepo,
      instanceRepo,
      settingsRepo,
      sseManager,
      environmentRepo
    )
  )
  app.use(errorHandler)

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('server failed to bind')
  const serverUrl = `http://127.0.0.1:${addr.port}`

  return { serverUrl, server, manager, db, environmentRepo, actionRepo, codeVersionRepo }
}

/**
 * Poll GET /trajectory/v1/instances/:id until a terminal state is reached.
 * Returns the flattened state string and outputs as a key→value dict.
 */
async function awaitTerminal(
  serverUrl: string,
  instanceId: string,
  timeoutMs = 30_000
): Promise<{ state: string; outputs: Record<string, string> }> {
  const start = Date.now()
  const TERMINAL = new Set(['COMPLETED', 'ABORTED', 'STOPPED'])
  let lastState = 'UNKNOWN'
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${serverUrl}/trajectory/v1/instances/${instanceId}`)
    if (res.ok) {
      const body = (await res.json()) as {
        data: {
          state: { current: string; previous: string | null; entered_at: string }
          outputs: Array<{ key: string; value: string }>
        }
      }
      lastState = body.data.state.current
      if (TERMINAL.has(lastState)) {
        // Convert outputs array [{key, value}] → dict
        const outputsDict: Record<string, string> = {}
        for (const o of body.data.outputs ?? []) {
          outputsDict[o.key] = o.value
        }
        return { state: lastState, outputs: outputsDict }
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(
    `Instance ${instanceId} did not reach terminal in ${timeoutMs}ms (last state: ${lastState})`
  )
}

describe('scenario-warehouse: end-to-end', () => {
  let testApp: TestApp
  let outDir: string
  let buildResult: Awaited<ReturnType<typeof buildScenario>>

  beforeAll(async () => {
    testApp = await startTestServer()
    outDir = await mkdtemp(path.join(tmpdir(), 'warehouse-build-'))
    buildResult = await buildScenario(warehouseScenario, outDir)
  }, 30_000)

  afterAll(async () => {
    await testApp.manager.shutdown()
    await new Promise<void>((resolve) => testApp.server.close(() => resolve()))
    await testApp.db.close()
    await rm(outDir, { recursive: true, force: true })
  }, 30_000)

  it('builds the warehouse scenario into deployable artifacts', async () => {
    const result = buildResult
    expect(result.actions).toHaveLength(10)
    expect(result.codeFiles).toHaveLength(34)
    expect(result.actionPackages).toHaveLength(10)
  })

  it('imports the warehouse via the bulk .WFenvir + per-state code path', async () => {
    const result = buildResult
    const upload = await uploadScenarioBulk(result, testApp.serverUrl)
    expect(upload.envImported).toBe(true)
    expect(upload.codeFailed).toEqual([])
    expect(upload.codeUploaded).toBe(34)
    expect(upload.timeoutsSet).toBe(10)

    // Verify each action exists with the right code count
    for (const action of result.actions) {
      const dbAction = await testApp.actionRepo.findByOid(action.oid)
      expect(dbAction, `action ${action.local_id} not in DB`).not.toBeNull()
      const versions = result.codeFiles.filter((cf) => cf.actionOid === action.oid)
      for (const cf of versions) {
        const active = await testApp.codeVersionRepo.getActive(action.oid, cf.state)
        expect(active, `${action.local_id}/${cf.state} has no active code`).not.toBeNull()
      }
    }
  })

  it('reimports the warehouse via the per-action .WFactionCodeX path (idempotent upsert)', async () => {
    const result = buildResult
    const upload = await uploadScenarioPerAction(result, testApp.serverUrl)
    expect(upload.actionsFailed).toEqual([])
    expect(upload.actionsImported).toBe(10)
  })

  it('invokes each action with SIMULATION_MODE=false and gets status=0', async () => {
    const WAVE_1_EXPECTED_OUTPUTS: Record<string, Record<string, string>> = {
      'act-wh-pick-001': { picked_quantity: '1', pick_status: 'success', status: '0' },
      'act-wh-putaway-001': { stored_quantity: '1', status: '0' },
      'act-wh-move-001': { status: '0' },
    }
    const WAVE_2_EXPECTED_OUTPUTS: Record<string, Record<string, string>> = {
      'act-wh-consolidate-001': { pallet_id: 'PALLET-ORD-9001', status: '0' },
      'act-wh-cyclecount-001': { discrepancy_count: '0', status: '0' },
      'act-wh-receive-001': { received_count: '50', status: '0' },
      'act-wh-ship-001': { tracking_number: 'TRACK-ORD-9001-GROUND', status: '0' },
    }
    const WAVE_3_EXPECTED_OUTPUTS: Record<string, Record<string, string>> = {
      'act-wh-updateinv-001': { status: '0' },
      // ScanBarcode: default barcode '0123456789012' → sku = 'SKU-' + last 4 = 'SKU-9012'
      'act-wh-scan-001': { sku: 'SKU-9012', status: '0' },
      'act-wh-print-001': { status: '0' },
    }

    // Each action × at least one happy-path invocation
    for (const action of warehouseScenario.actions) {
      // Build input_parameters array from declared defaults
      const inputParameters = action.inputs.map((inp) => ({
        name: inp.id,
        value: inp.default_value,
      }))

      const invokeRes = await fetch(
        `${testApp.serverUrl}/trajectory/v1/actions/${action.oid}/invoke`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            environment_oid: warehouseScenario.environment.oid,
            workflow_instance_id: `wf-warehouse-test-${action.local_id}`,
            step_instance_id: `step-${action.local_id}`,
            step_oid: `step-oid-${action.oid}`,
            input_parameters: inputParameters,
          }),
        }
      )
      expect(invokeRes.status, `${action.local_id} invoke failed`).toBe(201)
      const body = (await invokeRes.json()) as { data: { instance_id: string } }
      const terminal = await awaitTerminal(testApp.serverUrl, body.data.instance_id, 60_000)
      expect(terminal.state, `${action.local_id} ended in ${terminal.state}`).toBe('COMPLETED')
      expect(terminal.outputs['status'], `${action.local_id} status`).toBe('0')
      const expected =
        WAVE_1_EXPECTED_OUTPUTS[action.oid] ??
        WAVE_2_EXPECTED_OUTPUTS[action.oid] ??
        WAVE_3_EXPECTED_OUTPUTS[action.oid]
      if (expected) {
        for (const [key, value] of Object.entries(expected)) {
          expect(terminal.outputs[key], `${action.local_id}.${key}`).toBe(value)
        }
      }
    }
  }, 180_000)

  it('PickItem injects failures with SIMULATION_MODE=true (probabilistic)', async () => {
    // Toggle SIMULATION_MODE to 'true' on the env directly via the repository.
    const env = await testApp.environmentRepo.findByOid('env-warehouse-001')
    if (!env) throw new Error('warehouse env missing — Test 2 should have imported it')

    const originalProps = env.action_property_specifications
    const patchedProps = (
      originalProps as Array<{ name: string; entries: Array<{ name: string; value: string }> }>
    ).map((spec) =>
      spec.name === 'SIMULATION_MODE'
        ? {
            ...spec,
            entries: spec.entries.map((e) => (e.name === 'Value' ? { ...e, value: 'true' } : e)),
          }
        : spec
    )

    await testApp.environmentRepo.upsert({
      ...env,
      action_property_specifications: patchedProps,
    })

    // Verify the toggle took effect.
    const reloaded = await testApp.environmentRepo.findByOid('env-warehouse-001')
    const simEntry = (
      reloaded?.action_property_specifications as Array<{
        name: string
        entries: Array<{ name: string; value: string }>
      }>
    )
      ?.find((s) => s.name === 'SIMULATION_MODE')
      ?.entries.find((e) => e.name === 'Value')
    expect(simEntry?.value).toBe('true')

    let failureCount = 0
    let successCount = 0
    const ITERATIONS = 50

    try {
      for (let i = 0; i < ITERATIONS; i++) {
        const invokeRes = await fetch(
          `${testApp.serverUrl}/trajectory/v1/actions/act-wh-pick-001/invoke`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              environment_oid: 'env-warehouse-001',
              workflow_instance_id: `wf-sim-mode-${i}`,
              step_instance_id: `step-sim-${i}`,
              step_oid: `step-oid-sim-${i}`,
              input_parameters: [
                { name: 'shelf_location', value: 'BIN-A1' },
                { name: 'item_sku', value: 'SKU-1001' },
                { name: 'quantity', value: '1' },
              ],
            }),
          }
        )
        expect(invokeRes.status).toBe(201)
        const body = (await invokeRes.json()) as { data: { instance_id: string } }

        // Per-iteration budget covers the time.sleep(60) timeout path:
        // 8s Node timeout on EXECUTING + 8s retry + ABORTING.py + parallel-suite slack.
        const terminal = await awaitTerminal(testApp.serverUrl, body.data.instance_id, 45_000)
        if (terminal.state === 'COMPLETED') successCount += 1
        else failureCount += 1
      }
    } finally {
      // Restore SIMULATION_MODE to original value so other tests aren't poisoned.
      await testApp.environmentRepo.upsert({
        ...env,
        action_property_specifications: originalProps,
      })
    }

    // At 10% failure rate over 50 trials, expected ~5 failures, sigma ~2.1.
    // Assert at least 1 and not all to confirm injection works without flaking.
    expect(
      failureCount,
      `failures=${failureCount} successes=${successCount}`
    ).toBeGreaterThanOrEqual(1)
    expect(failureCount, `failures=${failureCount} successes=${successCount}`).toBeLessThan(
      ITERATIONS
    )
  }, 300_000)
})
