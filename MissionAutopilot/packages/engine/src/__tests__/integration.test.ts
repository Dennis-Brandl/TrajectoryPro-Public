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
 * integration.test.ts — End-to-end integration test.
 *
 * Verifies the full pipeline:
 *   StateMachine -> PythonWorkerPool -> sandbox_runner.py -> Python code execution
 *
 * Phase success criterion #4: Python code receives inputs and returns outputs
 * through the full StateMachine + PythonWorkerPool + sandbox_runner.py path.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  InstanceRepository,
  CodeVersionRepository,
  SettingsRepository,
  ActionRepository,
  EnvironmentRepository,
} from '@mission/autopilot-storage'
import { createTestDb, type TestDb } from '@mission/autopilot-storage/testing'
import { StateMachine } from '../state-machine/state-machine.js'
import { PythonWorkerPool } from '../python-pool/pool.js'

// ============================================================
// Setup
// ============================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SCRIPT_PATH = path.resolve(__dirname, '../../../python-sidecar/sandbox_runner.py')
const PYTHON_PATH = 'python'

let db: TestDb
let instanceRepo: InstanceRepository
let codeVersionRepo: CodeVersionRepository
let settingsRepo: SettingsRepository
let pool: PythonWorkerPool
let stateMachine: StateMachine

// Shared environment and action (created once, reused across tests)
let envOid: string
let actionOid: string

beforeAll(async () => {
  db = await createTestDb()
  instanceRepo = new InstanceRepository(db)
  codeVersionRepo = new CodeVersionRepository(db)
  settingsRepo = new SettingsRepository(db)

  pool = new PythonWorkerPool({
    pythonPath: PYTHON_PATH,
    scriptPath: SCRIPT_PATH,
    poolSize: 1,
  })

  stateMachine = new StateMachine(
    instanceRepo,
    codeVersionRepo,
    settingsRepo,
    pool.executeCode.bind(pool)
  )

  // Create environment
  const envRepo = new EnvironmentRepository(db)
  envOid = `env-integration-${Date.now()}`
  await envRepo.create({
    oid: envOid,
    local_id: 'integration-env',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    schema_version: '1',
    action_property_specifications: [],
    value_property_specifications: [],
    resource_property_specifications: [],
    source_filename: 'integration.json',
  })

  // Create action
  const actionRepo = new ActionRepository(db)
  actionOid = `action-integration-${Date.now()}`
  await actionRepo.create({
    oid: actionOid,
    environment_oid: envOid,
    local_id: 'integration-action',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    action_visibility: 'observable',
    input_parameter_specifications: [],
    output_parameter_specifications: [],
    property_specifications: [],
  })
})

afterAll(async () => {
  await pool.shutdown()
  await db.close()
})

// ============================================================
// Helpers
// ============================================================

interface InstanceSetup {
  instanceId: string
  codeVersionId: string
}

/**
 * Create a code version pinned to EXECUTING state and create an instance
 * with the given input parameters.
 */
async function createInstanceWithCode(
  sourceCode: string,
  inputParams: Array<{ key: string; value: string }> = []
): Promise<InstanceSetup> {
  const cv = await codeVersionRepo.saveAndActivate({
    action_oid: actionOid,
    state: 'EXECUTING',
    source_code: sourceCode,
  })

  const instance = await instanceRepo.create({
    runtime_action_instance_id: `inst-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    action_oid: actionOid,
    environment_oid: envOid,
    workflow_instance_id: 'wf-integration',
    step_instance_id: `step-${Date.now()}`,
    step_oid: 'step-oid-integration',
    visibility: 'observable',
    state: 'STARTING',
    input_parameters: inputParams,
    output_parameters: [],
    state_history: [{ state: 'STARTING', timestamp: new Date().toISOString() }],
    pinned_code_versions: [{ state: 'EXECUTING', code_version_id: cv.id }],
    states_with_code_executed: [],
  })

  return {
    instanceId: instance.runtime_action_instance_id,
    codeVersionId: cv.id,
  }
}

async function getStateHistory(instanceId: string): Promise<string[]> {
  const inst = (await instanceRepo.findById(instanceId))!
  const history = inst.state_history as Array<{ state: string; timestamp: string }>
  return history.map((h) => h.state)
}

// ============================================================
// Integration tests
// ============================================================

describe('StateMachine + PythonWorkerPool + sandbox_runner.py (end-to-end)', () => {
  it('full lifecycle — Python code receives inputs, returns outputs, reaches COMPLETED', async () => {
    const { instanceId } = await createInstanceWithCode(
      [
        'def execute(inputs, outputs, props, action_props):',
        '    name = inputs.get("name", "world")',
        '    outputs["greeting"] = f"hello {name}"',
        '    outputs["computed"] = str(int(inputs.get("x", "0")) * 2)',
        '    return True',
      ].join('\n'),
      [
        { key: 'name', value: 'Alice' },
        { key: 'x', value: '21' },
      ]
    )

    await stateMachine.startInstance(instanceId)

    const finalInstance = (await instanceRepo.findById(instanceId))!

    // Verify final state
    expect(finalInstance.state).toBe('COMPLETED')

    // Verify outputs
    const outputs = finalInstance.output_parameters as Array<{ key: string; value: string }>
    const outputMap = Object.fromEntries(outputs.map((o) => [o.key, o.value]))
    expect(outputMap['greeting']).toBe('hello Alice')
    expect(outputMap['computed']).toBe('42')

    // Verify state history
    const history = await getStateHistory(instanceId)
    expect(history).toContain('STARTING')
    expect(history).toContain('EXECUTING')
    expect(history).toContain('COMPLETING')
    expect(history).toContain('COMPLETED')

    // Verify completed_at is set
    expect(finalInstance.completed_at).toBeTruthy()
  }, 30000)

  it('full lifecycle — code returns false triggers HELD via HOLDING', async () => {
    const { instanceId } = await createInstanceWithCode(
      [
        'def execute(inputs, outputs, props, action_props):',
        '    outputs["status"] = "needs_review"',
        '    return False',
      ].join('\n')
    )

    await stateMachine.startInstance(instanceId)

    const finalInstance = (await instanceRepo.findById(instanceId))!

    // Verify final state
    expect(finalInstance.state).toBe('HELD')

    // Verify outputs
    const outputs = finalInstance.output_parameters as Array<{ key: string; value: string }>
    const outputMap = Object.fromEntries(outputs.map((o) => [o.key, o.value]))
    expect(outputMap['status']).toBe('needs_review')

    // Verify state history
    const history = await getStateHistory(instanceId)
    expect(history).toContain('STARTING')
    expect(history).toContain('EXECUTING')
    expect(history).toContain('HOLDING')
    expect(history).toContain('HELD')
  }, 30000)

  it('full lifecycle — code exception triggers ABORTED via ABORTING', async () => {
    const { instanceId } = await createInstanceWithCode(
      [
        'def execute(inputs, outputs, props, action_props):',
        '    raise ValueError("something went wrong")',
      ].join('\n')
    )

    await stateMachine.startInstance(instanceId)

    const finalInstance = (await instanceRepo.findById(instanceId))!

    // Verify final state
    expect(finalInstance.state).toBe('ABORTED')

    // Verify error contains the exception type
    expect(finalInstance.error).toBeTruthy()
    expect(finalInstance.error).toContain('ValueError')

    // Verify traceback is stored
    expect(finalInstance.traceback).toBeTruthy()
    expect(finalInstance.traceback).toContain('Traceback')

    // Verify state history
    const history = await getStateHistory(instanceId)
    expect(history).toContain('STARTING')
    expect(history).toContain('EXECUTING')
    expect(history).toContain('ABORTING')
    expect(history).toContain('ABORTED')
  }, 30000)

  it('full lifecycle — outputs mutated before raise are preserved on ABORTED', async () => {
    // Cross-layer pin for finding #3 (sandbox returned outputs:{} on error and
    // engine ignored result.outputs on failure). Exercises real subprocess +
    // engine + storage roundtrip in one shot so any regression in either layer
    // surfaces here.
    const { instanceId } = await createInstanceWithCode(
      [
        'def execute(inputs, outputs, props, action_props):',
        '    outputs["status"] = "1"',
        '    outputs["progress"] = "reached"',
        '    raise RuntimeError("boom")',
      ].join('\n')
    )

    await stateMachine.startInstance(instanceId)

    const finalInstance = (await instanceRepo.findById(instanceId))!

    expect(finalInstance.state).toBe('ABORTED')
    expect(finalInstance.error).toContain('RuntimeError')
    expect(finalInstance.error).toContain('boom')

    const outputs = finalInstance.output_parameters as Array<{ key: string; value: string }>
    const outputMap = Object.fromEntries(outputs.map((o) => [o.key, o.value]))
    expect(outputMap['status']).toBe('1')
    expect(outputMap['progress']).toBe('reached')
  }, 30000)
})
