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
 * instance-manager.test.ts — Integration tests for InstanceManager.
 *
 * Uses real PGlite (embedded Postgres) database and real Python via sandbox_runner.py.
 * Follows the established pattern from state-machine.test.ts and integration.test.ts.
 *
 * Note: All tests use 30000ms timeout because createManager() spawns real Python workers
 * and shutdown() waits for them to finish (up to 10s).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ActionRepository,
  EnvironmentRepository,
  CodeVersionRepository,
  LogRepository,
} from '@mission/autopilot-storage'
import { createTestDb, type TestDb } from '@mission/autopilot-storage/testing'
import type { Instance } from '@mission/autopilot-storage'
import { InstanceManager } from '../instance-manager/instance-manager.js'
import { EngineError } from '../errors.js'
import type { InvokeRequest } from '../instance-manager/types.js'

// ============================================================
// Constants
// ============================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SCRIPT_PATH = path.resolve(__dirname, '../../../python-sidecar/sandbox_runner.py')

// ============================================================
// Shared state across tests
// ============================================================

let db: TestDb
let actionRepo: ActionRepository
let envRepo: EnvironmentRepository
let codeVersionRepo: CodeVersionRepository

let envOid: string
let actionOid: string
let opaqueActionOid: string
let actionOidWithParams: string

// ============================================================
// beforeAll — set up shared DB and test fixtures
// ============================================================

beforeAll(async () => {
  db = await createTestDb()
  actionRepo = new ActionRepository(db)
  envRepo = new EnvironmentRepository(db)
  codeVersionRepo = new CodeVersionRepository(db)

  // Create shared environment
  envOid = `env-im-test-${Date.now()}`
  await envRepo.create({
    oid: envOid,
    local_id: 'im-test-env',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    schema_version: '1',
    action_property_specifications: [],
    value_property_specifications: [],
    resource_property_specifications: [],
    source_filename: 'im-test.json',
  })

  // Create shared observable action
  actionOid = `action-im-obs-${Date.now()}`
  await actionRepo.create({
    oid: actionOid,
    environment_oid: envOid,
    local_id: 'im-observable-action',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    action_visibility: 'observable',
    input_parameter_specifications: [],
    output_parameter_specifications: [],
    property_specifications: [],
  })

  // Create shared opaque action
  opaqueActionOid = `action-im-opq-${Date.now()}`
  await actionRepo.create({
    oid: opaqueActionOid,
    environment_oid: envOid,
    local_id: 'im-opaque-action',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    action_visibility: 'opaque',
    input_parameter_specifications: [],
    output_parameter_specifications: [],
    property_specifications: [],
  })

  // Create action with parameter specs (for parameter resolution tests)
  actionOidWithParams = `action-im-params-${Date.now()}`
  await actionRepo.create({
    oid: actionOidWithParams,
    environment_oid: envOid,
    local_id: 'im-params-action',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    action_visibility: 'observable',
    input_parameter_specifications: [
      { id: 'required_param', default_value: null },
      { id: 'optional_param', default_value: 'default_value' },
    ],
    output_parameter_specifications: [],
    property_specifications: [],
  })

  // Activate a code version for EXECUTING state on the main observable action
  await codeVersionRepo.saveAndActivate({
    action_oid: actionOid,
    state: 'EXECUTING',
    source_code: 'def execute(inputs, outputs, props, action_props):\n    return True',
  })

  // Activate a code version for EXECUTING state on the params action
  await codeVersionRepo.saveAndActivate({
    action_oid: actionOidWithParams,
    state: 'EXECUTING',
    source_code: 'def execute(inputs, outputs, props, action_props):\n    return True',
  })
})

afterAll(async () => {
  await db.close()
})

// ============================================================
// createManager helper — creates a fresh InstanceManager per test
// ============================================================

function createManager(
  callbacks: {
    onStateChange?: (instanceId: string, state: string, instance: Instance) => void
    onTerminal?: (instanceId: string, state: string, instance: Instance) => void
    onError?: (instanceId: string, error: Error) => void
  } = {}
): InstanceManager {
  return new InstanceManager(db, {
    scriptPath: SCRIPT_PATH,
    // poolSize is overridden by DB setting (python_pool_size = 4)
    // so we don't set it here to rely on the DB default
    ...callbacks,
  })
}

function makeRequest(overrides: Partial<InvokeRequest> = {}): InvokeRequest {
  return {
    action_oid: actionOid,
    workflow_instance_id: `wf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    step_instance_id: `step-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    step_oid: `step-oid-${Date.now()}`,
    input_parameters: [],
    ...overrides,
  }
}

// ============================================================
// Test suite
// ============================================================

describe('InstanceManager', () => {
  // ----------------------------------------------------------
  // Test 1: invoke() creates instance and returns InvokeResult immediately
  // ----------------------------------------------------------

  it('invoke() creates instance and returns InvokeResult immediately', async () => {
    const manager = createManager()
    try {
      const result = await manager.invoke(makeRequest())

      expect(result.runtime_action_instance_id).toBeTruthy()
      expect(typeof result.runtime_action_instance_id).toBe('string')
      expect(result.action_oid).toBe(actionOid)
      expect(result.status).toBe('STARTING')
      expect(result.created_at).toBeTruthy()
      expect(result.sse_endpoint).toBe(
        `/trajectory/v1/instances/${result.runtime_action_instance_id}/events`
      )
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  // ----------------------------------------------------------
  // Test 2: invoke() with opaque action returns POSTED status (no sse_endpoint)
  // ----------------------------------------------------------

  it('invoke() with opaque action returns POSTED status without sse_endpoint', async () => {
    const manager = createManager()
    try {
      const result = await manager.invoke(makeRequest({ action_oid: opaqueActionOid }))

      expect(result.status).toBe('POSTED')
      expect(result.sse_endpoint).toBeUndefined()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  // ----------------------------------------------------------
  // Test 3: invoke() with invalid action_oid throws ACTION_NOT_FOUND
  // ----------------------------------------------------------

  it('invoke() with invalid action_oid throws ACTION_NOT_FOUND EngineError', async () => {
    const manager = createManager()
    try {
      await expect(
        manager.invoke(makeRequest({ action_oid: 'non-existent-action-oid' }))
      ).rejects.toThrow(EngineError)

      await expect(
        manager.invoke(makeRequest({ action_oid: 'non-existent-action-oid' }))
      ).rejects.toMatchObject({ code: 'ACTION_NOT_FOUND' })
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  // ----------------------------------------------------------
  // Test 4: invoke() resolves parameters with defaults
  // ----------------------------------------------------------

  it('invoke() resolves parameters with defaults from action specs', async () => {
    const manager = createManager()
    try {
      const result = await manager.invoke(
        makeRequest({
          action_oid: actionOidWithParams,
          input_parameters: [{ name: 'required_param', value: 'provided_value' }],
          // optional_param is not provided — should use default 'default_value'
        })
      )

      const instance = await manager.getInstance(result.runtime_action_instance_id)
      expect(instance).toBeTruthy()

      const params = instance!.input_parameters as Array<{ key: string; value: string }>
      const paramMap = Object.fromEntries(params.map((p) => [p.key, p.value]))

      expect(paramMap['required_param']).toBe('provided_value')
      expect(paramMap['optional_param']).toBe('default_value')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  // ----------------------------------------------------------
  // Test 5: invoke() pins code versions at invocation time
  // ----------------------------------------------------------

  it('invoke() pins active code versions at invocation time', async () => {
    const manager = createManager()
    try {
      const result = await manager.invoke(makeRequest())

      const instance = await manager.getInstance(result.runtime_action_instance_id)
      expect(instance).toBeTruthy()

      const pinned = instance!.pinned_code_versions as Array<{
        state: string
        code_version_id: string
      }>
      expect(pinned.length).toBeGreaterThan(0)

      // The EXECUTING state should have a pinned version matching our active code version
      const executingPin = pinned.find((p) => p.state === 'EXECUTING')
      expect(executingPin).toBeTruthy()
      expect(executingPin!.code_version_id).toBeTruthy()

      // Verify the pinned ID references an actual code version
      const codeVersion = await codeVersionRepo.findById(executingPin!.code_version_id)
      expect(codeVersion).toBeTruthy()
      expect(codeVersion!.is_active).toBe(true)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  // ----------------------------------------------------------
  // Test 6: instance reaches COMPLETED after async execution
  // ----------------------------------------------------------

  it('instance reaches COMPLETED after async execution completes', async () => {
    let terminalResolve: (state: string) => void
    const terminalPromise = new Promise<string>((resolve) => {
      terminalResolve = resolve
    })

    const manager = createManager({
      onTerminal: (_instanceId, state) => {
        terminalResolve(state)
      },
    })

    try {
      const result = await manager.invoke(makeRequest())

      const finalState = await terminalPromise

      expect(finalState).toBe('COMPLETED')

      const instance = await manager.getInstance(result.runtime_action_instance_id)
      expect(instance!.state).toBe('COMPLETED')
      expect(instance!.completed_at).toBeTruthy()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  // ----------------------------------------------------------
  // Test 7: execution log is written on terminal state
  // ----------------------------------------------------------

  it('execution log is written after instance reaches terminal state', async () => {
    let terminalResolve: (instanceId: string) => void
    const terminalPromise = new Promise<string>((resolve) => {
      terminalResolve = resolve
    })

    const manager = createManager({
      onTerminal: (instanceId) => {
        terminalResolve(instanceId)
      },
    })

    try {
      const result = await manager.invoke(makeRequest())

      const instanceId = await terminalPromise

      // Query the log repository for the written entry
      const logRepo = new LogRepository(db)
      const { entries } = await logRepo.query({ actionOid })
      const logEntry = entries.find((l) => l.runtime_action_instance_id === instanceId)

      expect(logEntry).toBeTruthy()
      expect(logEntry!.action_oid).toBe(actionOid)
      expect(logEntry!.final_status).toBe('COMPLETED')
      expect(logEntry!.runtime_action_instance_id).toBe(result.runtime_action_instance_id)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  // ----------------------------------------------------------
  // Test 8: sendCommand() delegates to state machine
  // ----------------------------------------------------------

  it('sendCommand() transitions instance via state machine (HOLD -> HELD)', async () => {
    let executingResolve: (() => void) | undefined
    let heldResolve: ((instance: Instance) => void) | undefined

    const executingReached = new Promise<void>((resolve) => {
      executingResolve = resolve
    })
    const heldReached = new Promise<Instance>((resolve) => {
      heldResolve = resolve
    })

    const manager = createManager({
      onStateChange: (instanceId, state, instance) => {
        if (state === 'EXECUTING') {
          executingResolve?.()
        }
        if (state === 'HELD') {
          heldResolve?.(instance)
        }
      },
    })

    try {
      const result = await manager.invoke(makeRequest())
      const instanceId = result.runtime_action_instance_id

      // Wait until EXECUTING state is entered, then send HOLD
      // (the deferred command mechanism captures commands while code runs)
      await executingReached

      await manager.sendCommand(instanceId, 'HOLD')

      // Wait for HELD state
      const heldInstance = await heldReached

      expect(heldInstance.state).toBe('HELD')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  // ----------------------------------------------------------
  // Test 9: getInstance() returns current instance
  // ----------------------------------------------------------

  it('getInstance() returns current instance with correct fields', async () => {
    const manager = createManager()
    try {
      const request = makeRequest()
      const result = await manager.invoke(request)

      const instance = await manager.getInstance(result.runtime_action_instance_id)

      expect(instance).not.toBeNull()
      expect(instance!.runtime_action_instance_id).toBe(result.runtime_action_instance_id)
      expect(instance!.action_oid).toBe(actionOid)
      expect(instance!.workflow_instance_id).toBe(request.workflow_instance_id)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  // ----------------------------------------------------------
  // Test 10: getInstance() returns null for unknown ID
  // ----------------------------------------------------------

  it('getInstance() returns null for unknown instance ID', async () => {
    // This test does not need a Python pool — no shutdown needed
    const manager = createManager()
    const result = await manager.getInstance('non-existent-uuid')
    expect(result).toBeNull()
    // We intentionally do not shut down to keep test fast.
    // Workers are idle and will be GC'd. Pool shutdown is tested separately.
  })

  // ----------------------------------------------------------
  // Test 11: resizePool() changes pool target size
  // ----------------------------------------------------------

  it('resizePool() changes pool target size', async () => {
    const manager = createManager()
    try {
      // Initial pool size is whatever the DB setting says (default: 4)
      const initialSize = manager.poolSize
      expect(initialSize).toBeGreaterThan(0)

      const newSize = initialSize + 3
      manager.resizePool(newSize)

      expect(manager.poolSize).toBe(newSize)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  // ----------------------------------------------------------
  // Test 12: poolStatus getter returns pool state
  // ----------------------------------------------------------

  it('poolStatus getter returns correct pool status shape', async () => {
    const manager = createManager()
    try {
      const status = manager.poolStatus

      expect(status).toHaveProperty('size')
      expect(status).toHaveProperty('idle')
      expect(status).toHaveProperty('busy')
      expect(status).toHaveProperty('queued')
      expect(typeof status.size).toBe('number')
      expect(typeof status.idle).toBe('number')
      expect(typeof status.busy).toBe('number')
      expect(typeof status.queued).toBe('number')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  // ----------------------------------------------------------
  // Test 13: shutdown() completes without error
  // ----------------------------------------------------------

  it('shutdown() completes without error', async () => {
    const manager = createManager()
    await expect(manager.shutdown()).resolves.not.toThrow()
  }, 30000)

  // ----------------------------------------------------------
  // Test 14: getActiveInstances() returns non-terminal instances
  // ----------------------------------------------------------

  it('getActiveInstances() returns instances that have not yet completed', async () => {
    let terminalResolve: (() => void) | undefined
    const terminalPromise = new Promise<void>((resolve) => {
      terminalResolve = resolve
    })

    const manager = createManager({
      onTerminal: () => {
        terminalResolve?.()
      },
    })

    try {
      const result = await manager.invoke(makeRequest())

      // Right after invoke, instance should be active (not yet terminal)
      const activeAfterInvoke = await manager.getActiveInstances()
      const found = activeAfterInvoke.some(
        (i) => i.runtime_action_instance_id === result.runtime_action_instance_id
      )
      expect(found).toBe(true)

      // After completion, instance should no longer be active
      await terminalPromise

      const activeAfterComplete = await manager.getActiveInstances()
      const stillActive = activeAfterComplete.some(
        (i) => i.runtime_action_instance_id === result.runtime_action_instance_id
      )
      expect(stillActive).toBe(false)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  // ----------------------------------------------------------
  // Test 15: Multiple concurrent invocations run independently
  // ----------------------------------------------------------

  it('multiple concurrent invocations each create distinct instances', async () => {
    const terminalCount = { value: 0 }
    let allDoneResolve: (() => void) | undefined
    const allDonePromise = new Promise<void>((resolve) => {
      allDoneResolve = resolve
    })

    const manager = createManager({
      onTerminal: () => {
        terminalCount.value++
        if (terminalCount.value === 3) {
          allDoneResolve?.()
        }
      },
    })

    try {
      const [r1, r2, r3] = await Promise.all([
        manager.invoke(makeRequest()),
        manager.invoke(makeRequest()),
        manager.invoke(makeRequest()),
      ])

      // All should have distinct IDs
      const ids = new Set([
        r1.runtime_action_instance_id,
        r2.runtime_action_instance_id,
        r3.runtime_action_instance_id,
      ])
      expect(ids.size).toBe(3)

      // Wait for all to complete
      await allDonePromise

      // All should be in terminal state
      for (const r of [r1, r2, r3]) {
        const instance = await manager.getInstance(r.runtime_action_instance_id)
        expect(instance!.state).toBe('COMPLETED')
      }
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  // ----------------------------------------------------------
  // Test: action_property_overrides flow through to code's props
  // ----------------------------------------------------------

  it('action_property_overrides on invoke reach user code via props', async () => {
    // Set up a dedicated env + action whose code copies an env property into outputs.
    const overrideEnvOid = `env-override-${Date.now()}`
    await envRepo.create({
      oid: overrideEnvOid,
      local_id: 'override-test-env',
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      schema_version: '1',
      action_property_specifications: [
        {
          name: 'SIMULATION_MODE',
          entries: [
            { name: 'Value', value: 'false' },
            { name: 'Description', value: 'Default off' },
          ],
        },
      ],
      value_property_specifications: [],
      resource_property_specifications: [],
      source_filename: 'override-test.json',
    })

    const overrideActionOid = `action-override-${Date.now()}`
    await actionRepo.create({
      oid: overrideActionOid,
      environment_oid: overrideEnvOid,
      local_id: 'override-test-action',
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      action_visibility: 'opaque', // single IN_PROGRESS state, faster terminal
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
    })

    await codeVersionRepo.saveAndActivate({
      action_oid: overrideActionOid,
      state: 'IN_PROGRESS',
      source_code:
        'def execute(inputs, outputs, props, action_props):\n' +
        "    outputs['observed_sim'] = props.get('SIMULATION_MODE', {}).get('Value', 'absent')\n",
    })

    // ---------------------------------------------------------
    // Case A: no override → observed value should be the baseline 'false'.
    // ---------------------------------------------------------
    {
      let terminalResolve: (id: string) => void
      const terminalPromise = new Promise<string>((resolve) => {
        terminalResolve = resolve
      })
      const manager = createManager({
        onTerminal: (id) => {
          terminalResolve(id)
        },
      })
      try {
        const r = await manager.invoke({
          action_oid: overrideActionOid,
          workflow_instance_id: `wf-override-${Date.now()}-a`,
          step_instance_id: `step-override-${Date.now()}-a`,
          step_oid: `step-oid-${Date.now()}-a`,
          input_parameters: [],
        })
        await terminalPromise
        const instance = (await manager.getInstance(r.runtime_action_instance_id))!
        const outputs = instance.output_parameters as Array<{ key: string; value: string }>
        const observed = outputs.find((o) => o.key === 'observed_sim')
        expect(observed?.value).toBe('false')
      } finally {
        await manager.shutdown()
      }
    }

    // ---------------------------------------------------------
    // Case B: override SIMULATION_MODE.Value to 'true' → user code sees the override.
    // ---------------------------------------------------------
    {
      let terminalResolve: (id: string) => void
      const terminalPromise = new Promise<string>((resolve) => {
        terminalResolve = resolve
      })
      const manager = createManager({
        onTerminal: (id) => {
          terminalResolve(id)
        },
      })
      try {
        const r = await manager.invoke({
          action_oid: overrideActionOid,
          workflow_instance_id: `wf-override-${Date.now()}-b`,
          step_instance_id: `step-override-${Date.now()}-b`,
          step_oid: `step-oid-${Date.now()}-b`,
          input_parameters: [],
          action_property_overrides: {
            SIMULATION_MODE: { Value: 'true' },
          },
        })
        await terminalPromise
        const instance = (await manager.getInstance(r.runtime_action_instance_id))!
        const outputs = instance.output_parameters as Array<{ key: string; value: string }>
        const observed = outputs.find((o) => o.key === 'observed_sim')
        expect(observed?.value).toBe('true')
      } finally {
        await manager.shutdown()
      }
    }
  }, 60000)
})

// ============================================================
// Action code never runs twice (no automatic re-run)
// ============================================================

describe('action code never runs twice', () => {
  async function makeCountingAction(
    tag: string,
    tail: string
  ): Promise<{ oid: string; file: string }> {
    const file = path.join(
      os.tmpdir(),
      `autopilot-once-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
    )
    const oid = `action-im-once-${tag}-${Date.now()}`
    await actionRepo.create({
      oid,
      environment_oid: envOid,
      local_id: `im-once-${tag}`,
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      action_visibility: 'observable',
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
    })
    const code =
      'import time\n' +
      'def execute(inputs, outputs, props, action_props):\n' +
      `    with open(${JSON.stringify(file)}, 'a') as f:\n` +
      "        f.write('x\\n')\n" +
      tail
    await codeVersionRepo.saveAndActivate({
      action_oid: oid,
      state: 'EXECUTING',
      source_code: code,
    })
    return { oid, file }
  }

  const lineCount = (file: string): number =>
    fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).length : 0

  async function runToTerminal(
    tag: string,
    tail: string,
    beforeTerminal?: (manager: InstanceManager, id: string, file: string) => Promise<void>
  ): Promise<{ state: string; error: string | null; lines: number; file: string }> {
    const { oid, file } = await makeCountingAction(tag, tail)
    let resolveTerminal: (s: string) => void
    const terminal = new Promise<string>((r) => {
      resolveTerminal = r
    })
    const manager = createManager({ onTerminal: (_id, state) => resolveTerminal(state) })
    try {
      const result = await manager.invoke(makeRequest({ action_oid: oid }))
      const id = result.runtime_action_instance_id
      if (beforeTerminal) await beforeTerminal(manager, id, file)
      const state = await terminal
      if (beforeTerminal) await new Promise((r) => setTimeout(r, 1500))
      const instance = await manager.getInstance(id)
      return { state, error: instance!.error ?? null, lines: lineCount(file), file }
    } finally {
      await manager.shutdown()
    }
  }

  it('a RUNTIME_ERROR runs the code once and ends ABORTED', async () => {
    const r = await runToTerminal('rte', "    raise RuntimeError('boom')\n")
    try {
      expect(r.state).toBe('ABORTED')
      expect(r.lines).toBe(1)
      expect(r.error).toContain('boom')
    } finally {
      fs.rmSync(r.file, { force: true })
    }
  }, 60000)

  it('a WORKER_CRASH runs the code once and ends ABORTED', async () => {
    const r = await runToTerminal('crash', '    import os\n    os._exit(3)\n')
    try {
      expect(r.state).toBe('ABORTED')
      expect(r.lines).toBe(1)
      expect(r.error).toContain('WORKER_CRASH')
    } finally {
      fs.rmSync(r.file, { force: true })
    }
  }, 60000)

  it('cancel during EXECUTING runs the code once and ends ABORTED', async () => {
    // Cancel reaches the state machine through the deferred-command path (the killed worker's failure is not written); a late-failure warning is still possible, so silence console output.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await runToTerminal('cancel', '    time.sleep(30)\n', async (manager, id, file) => {
      const deadline = Date.now() + 10000
      while (lineCount(file) < 1 && Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 50))
      }
      expect(lineCount(file)).toBe(1)
      await manager.cancelInstance(id)
    })
    try {
      for (const call of warn.mock.calls) expect(String(call[0])).toContain('late failure')
      expect(r.state).toBe('ABORTED')
      expect(r.lines).toBe(1)
    } finally {
      warn.mockRestore()
      fs.rmSync(r.file, { force: true })
    }
  }, 60000)
})
