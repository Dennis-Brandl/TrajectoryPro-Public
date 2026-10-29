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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  InstanceRepository,
  CodeVersionRepository,
  SettingsRepository,
  ActionRepository,
  EnvironmentRepository,
} from '@mission/autopilot-storage'
import type { Instance } from '@mission/autopilot-storage'
import { createTestDb, type TestDb } from '@mission/autopilot-storage/testing'
import { StateMachine } from '../state-machine/state-machine.js'
import type { CodeExecutor, CodeExecutionResult } from '../state-machine/state-machine.js'
import { InvalidStateTransitionError } from '../errors.js'

// ============================================================
// Test helpers
// ============================================================

/** Default successful code execution result */
function makeSuccessResult(overrides: Partial<CodeExecutionResult> = {}): CodeExecutionResult {
  return {
    success: true,
    outputs: {},
    return_value: true,
    execution_time_ms: 10,
    stdout_capture: '',
    stderr_capture: '',
    ...overrides,
  }
}

/** Default failed code execution result */
function makeFailureResult(overrides: Partial<CodeExecutionResult> = {}): CodeExecutionResult {
  return {
    success: false,
    outputs: {},
    return_value: null,
    error: 'Something went wrong',
    error_type: 'RUNTIME_ERROR',
    traceback:
      'Traceback (most recent call last):\n  File "test.py", line 1\nRuntimeError: Something went wrong',
    execution_time_ms: 5,
    stdout_capture: '',
    stderr_capture: '',
    ...overrides,
  }
}

interface TestDeps {
  db: TestDb
  instanceRepo: InstanceRepository
  codeVersionRepo: CodeVersionRepository
  settingsRepo: SettingsRepository
  codeExecutor: ReturnType<typeof vi.fn<CodeExecutor>>
}

// ============================================================
// Shared PGlite instance — fresh per test (matches the old per-test
// `:memory:` SQLite isolation from createTestDeps()).
// ============================================================

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
})

afterEach(async () => {
  await db.close()
})

function createTestDeps(): TestDeps {
  const instanceRepo = new InstanceRepository(db)
  const codeVersionRepo = new CodeVersionRepository(db)
  const settingsRepo = new SettingsRepository(db)
  const codeExecutor = vi.fn<CodeExecutor>()

  // Default: always return success
  codeExecutor.mockResolvedValue(makeSuccessResult())

  return { db, instanceRepo, codeVersionRepo, settingsRepo, codeExecutor }
}

interface TestSetup {
  instanceId: string
  actionOid: string
  envOid: string
}

/**
 * Create an environment, action, and code versions, then create a test instance.
 * pinnedStates: array of state names that should have code pinned.
 * Returns the instance ID (auto-generated UUID from InstanceRepository).
 */
async function createTestInstance(
  deps: TestDeps,
  options: {
    visibility?: 'observable' | 'opaque'
    initialState?: string
    pinnedStates?: string[]
  } = {}
): Promise<TestSetup> {
  const { instanceRepo, codeVersionRepo, db } = deps
  const visibility = options.visibility ?? 'observable'
  const initialState = options.initialState ?? (visibility === 'observable' ? 'STARTING' : 'POSTED')
  const pinnedStates = options.pinnedStates ?? []

  // Create environment
  const envRepo = new EnvironmentRepository(db)
  const envOid = `env-${Date.now()}-${Math.random()}`
  await envRepo.create({
    oid: envOid,
    local_id: 'test-env',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    schema_version: '1',
    action_property_specifications: [],
    value_property_specifications: [],
    resource_property_specifications: [],
    source_filename: 'test.json',
  })

  // Create action
  const actionRepo = new ActionRepository(db)
  const actionOid = `action-${Date.now()}-${Math.random()}`
  await actionRepo.create({
    oid: actionOid,
    environment_oid: envOid,
    local_id: 'test-action',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    action_visibility: visibility,
    input_parameter_specifications: [],
    output_parameter_specifications: [],
    property_specifications: [],
  })

  // Create and activate code versions for pinned states
  const pinnedCodeVersions: Array<{ state: string; code_version_id: string }> = []
  for (const state of pinnedStates) {
    const cv = await codeVersionRepo.saveAndActivate({
      action_oid: actionOid,
      state,
      source_code: `def execute(inputs, outputs, props, action_props):\n    return True`,
    })
    pinnedCodeVersions.push({ state, code_version_id: cv.id })
  }

  // Create instance with initial state
  const instance = await instanceRepo.create({
    runtime_action_instance_id: `inst-${Date.now()}`,
    action_oid: actionOid,
    environment_oid: envOid,
    workflow_instance_id: 'wf-1',
    step_instance_id: 'step-1',
    step_oid: 'step-oid-1',
    visibility,
    state: initialState,
    input_parameters: [],
    output_parameters: [],
    state_history: [{ state: initialState, timestamp: new Date().toISOString() }],
    pinned_code_versions: pinnedCodeVersions,
    states_with_code_executed: [],
  })

  return { instanceId: instance.runtime_action_instance_id, actionOid, envOid }
}

function createSM(deps: TestDeps): StateMachine {
  return new StateMachine(
    deps.instanceRepo,
    deps.codeVersionRepo,
    deps.settingsRepo,
    deps.codeExecutor
  )
}

function createSMWithCallbacks(
  deps: TestDeps,
  callbacks: ConstructorParameters<typeof StateMachine>[4]
): StateMachine {
  return new StateMachine(
    deps.instanceRepo,
    deps.codeVersionRepo,
    deps.settingsRepo,
    deps.codeExecutor,
    callbacks
  )
}

/** Get the current state history for an instance */
async function getStateHistory(
  deps: TestDeps,
  instanceId: string
): Promise<Array<{ state: string; timestamp: string }>> {
  const instance = (await deps.instanceRepo.findById(instanceId))!
  return instance.state_history as Array<{ state: string; timestamp: string }>
}

/** Get the current state for an instance */
async function getState(deps: TestDeps, instanceId: string): Promise<string> {
  return (await deps.instanceRepo.findById(instanceId))!.state
}

// ============================================================
// Happy path tests (observable)
// ============================================================

describe('StateMachine - Observable happy path', () => {
  it('auto-advances STARTING -> EXECUTING -> COMPLETING -> COMPLETED when no code at any state', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, { pinnedStates: [] })
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    const instance = (await deps.instanceRepo.findById(instanceId))!
    expect(instance.state).toBe('COMPLETED')

    const history = await getStateHistory(deps, instanceId)
    // Initial state from create() + EXECUTING + COMPLETING + COMPLETED entries
    const states = history.map((h) => h.state)
    expect(states).toContain('STARTING')
    expect(states).toContain('EXECUTING')
    expect(states).toContain('COMPLETING')
    expect(states).toContain('COMPLETED')

    // completed_at should be set
    expect(instance.completed_at).not.toBeNull()
  })

  it('state_history timestamps are valid ISO 8601 and monotonically non-decreasing', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, { pinnedStates: [] })
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    const history = await getStateHistory(deps, instanceId)
    expect(history.length).toBeGreaterThanOrEqual(4)

    for (const entry of history) {
      // Valid ISO 8601
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(new Date(entry.timestamp).getTime()).not.toBeNaN()
    }

    // Monotonically non-decreasing
    for (let i = 1; i < history.length; i++) {
      const prev = new Date(history[i - 1].timestamp).getTime()
      const curr = new Date(history[i].timestamp).getTime()
      expect(curr).toBeGreaterThanOrEqual(prev)
    }
  })

  it('code at EXECUTING runs, return_value true advances to COMPLETED', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    deps.codeExecutor.mockImplementation(async (_id, state) => {
      if (state === 'EXECUTING') {
        return makeSuccessResult({ outputs: { result: '42' }, return_value: true })
      }
      return makeSuccessResult()
    })
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(await getState(deps, instanceId)).toBe('COMPLETED')
    expect(deps.codeExecutor).toHaveBeenCalledTimes(1)
    expect(deps.codeExecutor).toHaveBeenCalledWith(
      instanceId,
      'EXECUTING',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.any(Number)
    )
  })

  it('code at STARTING, EXECUTING, COMPLETING — each runs once, codeExecutor called 3 times', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      pinnedStates: ['STARTING', 'EXECUTING', 'COMPLETING'],
    })
    deps.codeExecutor.mockResolvedValue(makeSuccessResult({ return_value: true }))
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(await getState(deps, instanceId)).toBe('COMPLETED')
    expect(deps.codeExecutor).toHaveBeenCalledTimes(3)

    const calledStates = deps.codeExecutor.mock.calls.map((c) => c[1])
    expect(calledStates).toContain('STARTING')
    expect(calledStates).toContain('EXECUTING')
    expect(calledStates).toContain('COMPLETING')
  })
})

// ============================================================
// Code-initiated HOLD test
// ============================================================

describe('StateMachine - Code-initiated HOLD', () => {
  it('return_value false in EXECUTING triggers HOLDING -> HELD', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    deps.codeExecutor.mockResolvedValue(makeSuccessResult({ return_value: false }))
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(await getState(deps, instanceId)).toBe('HELD')

    const history = await getStateHistory(deps, instanceId)
    const states = history.map((h) => h.state)
    expect(states).toContain('STARTING')
    expect(states).toContain('EXECUTING')
    expect(states).toContain('HOLDING')
    expect(states).toContain('HELD')
    // Should NOT have proceeded to COMPLETING
    expect(states).not.toContain('COMPLETING')
    expect(states).not.toContain('COMPLETED')
  })
})

// ============================================================
// Code-requested command (trajectory.request_command) tests
// ============================================================

describe('StateMachine - Code-requested commands', () => {
  it('EXECUTING code requesting STOP drives STOPPING -> COMPLETED with no error', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    deps.codeExecutor.mockResolvedValue(
      makeSuccessResult({ requested_commands: [{ command: 'STOP' }] })
    )
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(await getState(deps, instanceId)).toBe('COMPLETED')
    const states = (await getStateHistory(deps, instanceId)).map((h) => h.state)
    expect(states).toContain('STOPPING')
    expect(states).toContain('COMPLETED')
    expect(states).not.toContain('COMPLETING')

    const instance = (await deps.instanceRepo.findById(instanceId))!
    expect(instance.error).toBeNull()
  })

  it('EXECUTING code requesting ABORT drives ABORTING -> ABORTED without recording an exception', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    deps.codeExecutor.mockResolvedValue(
      makeSuccessResult({ requested_commands: [{ command: 'ABORT', reason: 'user cancelled' }] })
    )
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(await getState(deps, instanceId)).toBe('ABORTED')
    const states = (await getStateHistory(deps, instanceId)).map((h) => h.state)
    expect(states).toContain('ABORTING')
    expect(states).toContain('ABORTED')

    // success=true means no traceback should have been recorded
    const instance = (await deps.instanceRepo.findById(instanceId))!
    expect(instance.traceback).toBeNull()
  })

  it('HELD code requesting UNHOLD drives HELD -> UNHOLDING -> EXECUTING (downstream-queue pattern)', async () => {
    // First EXECUTING attempt holds, HELD code releases, EXECUTING completes the second time.
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      pinnedStates: ['EXECUTING', 'HELD'],
    })
    let executingCalls = 0
    deps.codeExecutor.mockImplementation(async (_id, state) => {
      if (state === 'EXECUTING') {
        executingCalls += 1
        // First entry: downstream full -> HOLD. Second entry: proceed.
        return executingCalls === 1
          ? makeSuccessResult({ return_value: false })
          : makeSuccessResult({ return_value: true })
      }
      if (state === 'HELD') {
        return makeSuccessResult({ requested_commands: [{ command: 'UNHOLD' }] })
      }
      return makeSuccessResult()
    })
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(await getState(deps, instanceId)).toBe('COMPLETED')
    const states = (await getStateHistory(deps, instanceId)).map((h) => h.state)
    expect(states).toContain('HOLDING')
    expect(states).toContain('HELD')
    expect(states).toContain('UNHOLDING')
    // EXECUTING appears twice: once before the hold, once after the unhold
    expect(states.filter((s) => s === 'EXECUTING').length).toBe(2)
    expect(executingCalls).toBe(2)
  })

  it('EXECUTING code requesting UNHOLD (invalid for state) aborts with a descriptive error', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    deps.codeExecutor.mockResolvedValue(
      makeSuccessResult({ requested_commands: [{ command: 'UNHOLD' }] })
    )
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(await getState(deps, instanceId)).toBe('ABORTED')
    const instance = (await deps.instanceRepo.findById(instanceId))!
    expect(instance.error).toContain('UNHOLD')
    expect(instance.error).toContain('EXECUTING')
  })

  it('external HOLD deferred during execution wins over a code-requested STOP', async () => {
    // An external command arriving during code execution is deferred and flushed
    // before the engine looks at requested_commands — external overrides internal.
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    const sm = createSM(deps)
    deps.codeExecutor.mockImplementation(async () => {
      // External HOLD arrives mid-execution
      await sm.sendCommand(instanceId, 'HOLD')
      return makeSuccessResult({ requested_commands: [{ command: 'STOP' }] })
    })

    await sm.startInstance(instanceId)

    // External HOLD wins -> HELD; the requested STOP is silently dropped.
    expect(await getState(deps, instanceId)).toBe('HELD')
  })
})

// ============================================================
// Error tests
// ============================================================

describe('StateMachine - Error path', () => {
  it('execution failure in EXECUTING triggers ABORTING -> ABORTED with two-tier error', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    deps.codeExecutor.mockResolvedValue(
      makeFailureResult({
        error: 'ValueError: bad input',
        error_type: 'RUNTIME_ERROR',
        traceback:
          'Traceback (most recent call last):\n  File "test.py", line 1\nValueError: bad input',
      })
    )
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(await getState(deps, instanceId)).toBe('ABORTED')

    const history = await getStateHistory(deps, instanceId)
    const states = history.map((h) => h.state)
    expect(states).toContain('STARTING')
    expect(states).toContain('EXECUTING')
    expect(states).toContain('ABORTING')
    expect(states).toContain('ABORTED')

    const instance = (await deps.instanceRepo.findById(instanceId))!
    // error field: summary (error_type: message)
    expect(instance.error).toBe('RUNTIME_ERROR: ValueError: bad input')
    // traceback field: full Python traceback
    expect(instance.traceback).toContain('Traceback (most recent call last)')
    expect(instance.traceback).toContain('ValueError: bad input')
    // error and traceback are separate fields
    expect(instance.error).not.toContain('Traceback')
  })

  it('execution failure preserves outputs mutations made before raise (finding #3)', async () => {
    // Bug: previously the failure branch in handleCodeExecutionResult never read
    // result.outputs, so user code that set outputs['status']='1' then raised
    // would lose that status — only error/traceback survived. The instance's
    // output_parameters ended up empty, even though the sidecar reported what
    // the user code had achieved before failure.
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    deps.codeExecutor.mockResolvedValue(
      makeFailureResult({
        outputs: { status: '1', progress: 'reached' },
        error: 'RuntimeError: boom',
        error_type: 'RUNTIME_ERROR',
      })
    )
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(await getState(deps, instanceId)).toBe('ABORTED')

    const instance = (await deps.instanceRepo.findById(instanceId))!
    const outputs = (instance.output_parameters as Array<{ key: string; value: unknown }>).reduce(
      (acc, p) => {
        acc[p.key] = String(p.value)
        return acc
      },
      {} as Record<string, string>
    )
    expect(outputs).toEqual({ status: '1', progress: 'reached' })

    // Error info still persisted as before (sanity).
    expect(instance.error).toBe('RUNTIME_ERROR: RuntimeError: boom')
  })

  it('ABORTING.py failure forces ABORTED — does not loop on itself', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      pinnedStates: ['EXECUTING', 'ABORTING'],
    })
    // Both EXECUTING and ABORTING fail. Without the recovery-state fix,
    // ABORTING.py failure re-enters ABORTING → executeCode fails again →
    // re-enter ABORTING → infinite loop until vitest test timeout.
    deps.codeExecutor.mockResolvedValue(
      makeFailureResult({
        error: 'KaBoom',
        error_type: 'RUNTIME_ERROR',
      })
    )
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    // Should reach ABORTED, not be stuck in ABORTING.
    expect(await getState(deps, instanceId)).toBe('ABORTED')

    // ABORTING should appear exactly once in history (the one entry from
    // EXECUTING failure transition). A loop would produce many entries.
    const states = (await getStateHistory(deps, instanceId)).map((h) => h.state)
    const aborting = states.filter((s) => s === 'ABORTING')
    expect(aborting.length).toBeLessThanOrEqual(2)
    expect(states[states.length - 1]).toBe('ABORTED')
  })

  it('a failure whose instance moves on between the check and the abort enters no second ABORTING', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      pinnedStates: ['EXECUTING', 'ABORTING'],
    })
    deps.codeExecutor.mockImplementation(async (_id, state) =>
      state === 'EXECUTING'
        ? makeFailureResult({ error_type: 'RUNTIME_ERROR', error: 'boom', outputs: { x: '1' } })
        : makeSuccessResult()
    )
    // Another path (an ABORT) moves EXECUTING -> ABORTING after the failure
    // was recorded but before the failure branch enters ABORTING itself.
    const realUpdate = deps.instanceRepo.updateOutputParameters.bind(deps.instanceRepo)
    const updateSpy = vi
      .spyOn(deps.instanceRepo, 'updateOutputParameters')
      .mockImplementationOnce(async (...args) => {
        await deps.instanceRepo.updateState(instanceId, 'ABORTING')
        return realUpdate(...args)
      })
    const sm = createSM(deps)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await sm.startInstance(instanceId)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('late failure')
    } finally {
      warn.mockRestore()
      updateSpy.mockRestore()
    }

    const abortingRuns = deps.codeExecutor.mock.calls.filter((c) => c[1] === 'ABORTING')
    expect(abortingRuns.length).toBe(0)
  })

  it('a failure arriving after the instance moved on makes no write and no transition', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      pinnedStates: ['EXECUTING', 'ABORTING'],
    })
    deps.codeExecutor.mockImplementation(async (_id, state) => {
      if (state === 'EXECUTING') {
        await deps.instanceRepo.updateState(instanceId, 'ABORTED', { error: 'cancelled elsewhere' })
        return makeFailureResult({
          error_type: 'WORKER_CRASH',
          error: 'killed',
          outputs: { late: '1' },
        })
      }
      return makeSuccessResult()
    })
    const sm = createSM(deps)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await sm.startInstance(instanceId)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('late failure')
    } finally {
      warn.mockRestore()
    }

    expect(await getState(deps, instanceId)).toBe('ABORTED')
    const instance = await deps.instanceRepo.findById(instanceId)
    expect(instance!.error).toBe('cancelled elsewhere')
    expect(JSON.stringify(instance!.output_parameters ?? [])).not.toContain('late')
    expect(deps.codeExecutor).not.toHaveBeenCalledWith(
      instanceId,
      'ABORTING',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })
})

// ============================================================
// Command tests
// ============================================================

describe('StateMachine - Commands', () => {
  it('PAUSE from EXECUTING -> PAUSING -> PAUSED (no code)', async () => {
    const deps = createTestDeps()
    // Create instance already in EXECUTING state (no code at STARTING so it auto-advanced)
    const { instanceId } = await createTestInstance(deps, {
      initialState: 'EXECUTING',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.sendCommand(instanceId, 'PAUSE')

    expect(await getState(deps, instanceId)).toBe('PAUSED')
    const states = (await getStateHistory(deps, instanceId)).map((h) => h.state)
    expect(states).toContain('PAUSING')
    expect(states).toContain('PAUSED')
  })

  it('RESUME from PAUSED -> UNPAUSING -> EXECUTING (no code)', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      initialState: 'PAUSED',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.sendCommand(instanceId, 'RESUME')

    // UNPAUSING -> EXECUTING (no code at EXECUTING so it auto-advances to COMPLETING -> COMPLETED)
    // Actually with no code at EXECUTING, it will advance all the way to COMPLETED
    expect(await getState(deps, instanceId)).toBe('COMPLETED')
    const states = (await getStateHistory(deps, instanceId)).map((h) => h.state)
    expect(states).toContain('UNPAUSING')
    expect(states).toContain('EXECUTING')
  })

  it('ABORT from EXECUTING -> ABORTING -> ABORTED', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      initialState: 'EXECUTING',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.sendCommand(instanceId, 'ABORT')

    expect(await getState(deps, instanceId)).toBe('ABORTED')
  })

  it('STOP from EXECUTING -> STOPPING -> COMPLETED', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      initialState: 'EXECUTING',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.sendCommand(instanceId, 'STOP')

    expect(await getState(deps, instanceId)).toBe('COMPLETED')
    const instance = (await deps.instanceRepo.findById(instanceId))!
    expect(instance.completed_at).not.toBeNull()
    const states = (await getStateHistory(deps, instanceId)).map((h) => h.state)
    expect(states).toContain('STOPPING')
    expect(states).toContain('COMPLETED')
  })

  it('CLEAR from ABORTED -> CLEARING -> COMPLETED', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      initialState: 'ABORTED',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.sendCommand(instanceId, 'CLEAR')

    expect(await getState(deps, instanceId)).toBe('COMPLETED')
  })

  it('HOLD from EXECUTING -> HOLDING -> HELD (no code executing)', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      initialState: 'EXECUTING',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.sendCommand(instanceId, 'HOLD')

    expect(await getState(deps, instanceId)).toBe('HELD')
  })

  it('UNHOLD from HELD -> UNHOLDING -> EXECUTING (auto-advances to COMPLETED with no code)', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      initialState: 'HELD',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.sendCommand(instanceId, 'UNHOLD')

    // UNHOLDING -> EXECUTING -> COMPLETING -> COMPLETED (no code)
    expect(await getState(deps, instanceId)).toBe('COMPLETED')
    const states = (await getStateHistory(deps, instanceId)).map((h) => h.state)
    expect(states).toContain('UNHOLDING')
    expect(states).toContain('EXECUTING')
  })

  it('PAUSE from STARTING throws InvalidStateTransitionError', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      initialState: 'STARTING',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await expect(sm.sendCommand(instanceId, 'PAUSE')).rejects.toThrow(InvalidStateTransitionError)
  })

  it('PAUSE from COMPLETED throws InvalidStateTransitionError', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      initialState: 'COMPLETED',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await expect(sm.sendCommand(instanceId, 'PAUSE')).rejects.toThrow(InvalidStateTransitionError)
  })

  it('rejects a command whose validated snapshot went stale before the transition', async () => {
    // Seed an instance in EXECUTING (HOLD is valid there), then move it on to
    // COMPLETED behind sendCommand's back between validation and persistence —
    // simulating a second command that already transitioned the instance.
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      initialState: 'EXECUTING',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    const realFind = deps.instanceRepo.findById.bind(deps.instanceRepo)
    vi.spyOn(deps.instanceRepo, 'findById').mockImplementationOnce(async (id: string) => {
      const snapshot = await realFind(id)
      await deps.instanceRepo.updateState(id, 'COMPLETED', {
        completed_at: new Date().toISOString(),
      })
      return snapshot // stale: says EXECUTING, store says COMPLETED
    })

    await expect(sm.sendCommand(instanceId, 'HOLD')).rejects.toThrow(InvalidStateTransitionError)
    expect((await realFind(instanceId))!.state).toBe('COMPLETED')
  })
})

// ============================================================
// Deferred HOLD during code execution
// ============================================================

describe('StateMachine - Deferred HOLD during code execution', () => {
  it('HOLD sent while code is executing is deferred until code finishes, then applied', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    const sm = createSM(deps)

    // Create a promise that we can resolve manually to control code execution timing
    let resolveCodeExecution!: (result: CodeExecutionResult) => void
    const codeExecutionPromise = new Promise<CodeExecutionResult>((resolve) => {
      resolveCodeExecution = resolve
    })

    deps.codeExecutor.mockImplementation(async (_id, state) => {
      if (state === 'EXECUTING') {
        return codeExecutionPromise
      }
      return makeSuccessResult()
    })

    // Start instance (begins processing — code at EXECUTING starts executing)
    const startPromise = sm.startInstance(instanceId)

    // Wait a tick for the state machine to reach the code executor
    await new Promise((resolve) => setImmediate(resolve))

    // Verify that code is executing (instance in EXECUTING state)
    expect(await getState(deps, instanceId)).toBe('EXECUTING')

    // Send HOLD while code is still executing — should be deferred immediately
    const holdPromise = sm.sendCommand(instanceId, 'HOLD')
    // sendCommand returns immediately (does not throw) because it's deferred
    await expect(holdPromise).resolves.toBeUndefined()

    // Instance is still in EXECUTING (deferred, not applied yet)
    expect(await getState(deps, instanceId)).toBe('EXECUTING')

    // Now resolve the code execution with success
    resolveCodeExecution(makeSuccessResult({ return_value: true }))
    await startPromise

    // The deferred HOLD should have been applied after code finished
    // State should be HELD (not COMPLETING or COMPLETED)
    expect(await getState(deps, instanceId)).toBe('HELD')

    const states = (await getStateHistory(deps, instanceId)).map((h) => h.state)
    expect(states).toContain('STARTING')
    expect(states).toContain('EXECUTING')
    expect(states).toContain('HOLDING')
    expect(states).toContain('HELD')
    expect(states).not.toContain('COMPLETING')
    expect(states).not.toContain('COMPLETED')
  })
})

// ============================================================
// Opaque action tests
// ============================================================

describe('StateMachine - Opaque actions', () => {
  it('auto-advances POSTED -> RECEIVED -> IN_PROGRESS -> COMPLETED (no code)', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      visibility: 'opaque',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(await getState(deps, instanceId)).toBe('COMPLETED')
    const states = (await getStateHistory(deps, instanceId)).map((h) => h.state)
    expect(states).toContain('POSTED')
    expect(states).toContain('RECEIVED')
    expect(states).toContain('IN_PROGRESS')
    expect(states).toContain('COMPLETED')
  })

  it('opaque instance with code at IN_PROGRESS — code runs, advances to COMPLETED', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      visibility: 'opaque',
      pinnedStates: ['IN_PROGRESS'],
    })
    deps.codeExecutor.mockResolvedValue(makeSuccessResult({ return_value: true }))
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(await getState(deps, instanceId)).toBe('COMPLETED')
    expect(deps.codeExecutor).toHaveBeenCalledTimes(1)
    expect(deps.codeExecutor).toHaveBeenCalledWith(
      instanceId,
      'IN_PROGRESS',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.any(Number)
    )
  })
})

// ============================================================
// Callback tests
// ============================================================

describe('StateMachine - Callbacks', () => {
  it('onStateChange is called for each state entry', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, { pinnedStates: [] })

    const onStateChange = vi.fn()
    const sm = createSMWithCallbacks(deps, { onStateChange })

    await sm.startInstance(instanceId)

    // Should be called for EXECUTING, COMPLETING, COMPLETED (and potentially STARTING terminal handling)
    expect(onStateChange).toHaveBeenCalled()

    // Verify it was called with the instance ID and valid state names
    for (const call of onStateChange.mock.calls) {
      const [calledId, state, instance] = call as [string, string, Instance]
      expect(calledId).toBe(instanceId)
      expect(typeof state).toBe('string')
      expect(instance).toHaveProperty('runtime_action_instance_id', instanceId)
    }

    // Should include at least EXECUTING, COMPLETING, COMPLETED
    const statesCalled = onStateChange.mock.calls.map((c) => (c as unknown[])[1] as string)
    expect(statesCalled).toContain('EXECUTING')
    expect(statesCalled).toContain('COMPLETING')
    expect(statesCalled).toContain('COMPLETED')
  })

  it('onTerminal is called when reaching COMPLETED', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, { pinnedStates: [] })

    const onTerminal = vi.fn()
    const sm = createSMWithCallbacks(deps, { onTerminal })

    await sm.startInstance(instanceId)

    expect(onTerminal).toHaveBeenCalledTimes(1)
    const [calledId, state] = onTerminal.mock.calls[0] as [string, string, Instance]
    expect(calledId).toBe(instanceId)
    expect(state).toBe('COMPLETED')
  })

  it('onTerminal is called when reaching ABORTED', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    deps.codeExecutor.mockResolvedValue(makeFailureResult())

    const onTerminal = vi.fn()
    const sm = createSMWithCallbacks(deps, { onTerminal })

    await sm.startInstance(instanceId)

    expect(onTerminal).toHaveBeenCalledTimes(1)
    const [calledId, state] = onTerminal.mock.calls[0] as [string, string, Instance]
    expect(calledId).toBe(instanceId)
    expect(state).toBe('ABORTED')
  })
})

// ============================================================
// Terminal-state finalizer tests
// ============================================================

describe('StateMachine - Terminal-state finalizer', () => {
  it('opaque: runs pinned code at COMPLETED and persists outputs (ExportImportAction1 scenario)', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      visibility: 'opaque',
      pinnedStates: ['COMPLETED'],
    })
    deps.codeExecutor.mockResolvedValue(
      makeSuccessResult({ outputs: { received_count: '22', status: '0' } })
    )
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    const instance = (await deps.instanceRepo.findById(instanceId))!
    expect(instance.state).toBe('COMPLETED')
    expect(instance.completed_at).not.toBeNull()
    expect(instance.output_parameters).toEqual(
      expect.arrayContaining([
        { key: 'received_count', value: '22' },
        { key: 'status', value: '0' },
      ])
    )

    const completedCalls = deps.codeExecutor.mock.calls.filter(
      (c) => (c as unknown[])[1] === 'COMPLETED'
    )
    expect(completedCalls).toHaveLength(1)
  })

  it('observable: runs pinned code at COMPLETED and persists outputs', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      visibility: 'observable',
      pinnedStates: ['COMPLETED'],
    })
    deps.codeExecutor.mockResolvedValue(makeSuccessResult({ outputs: { result: 'ok' } }))
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    const instance = (await deps.instanceRepo.findById(instanceId))!
    expect(instance.state).toBe('COMPLETED')
    expect(instance.output_parameters).toEqual([{ key: 'result', value: 'ok' }])
  })

  it('runs pinned code at ABORTED and persists outputs', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      visibility: 'observable',
      initialState: 'ABORTED',
      pinnedStates: ['ABORTED'],
    })
    deps.codeExecutor.mockResolvedValue(makeSuccessResult({ outputs: { cleanup: 'done' } }))
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    const instance = (await deps.instanceRepo.findById(instanceId))!
    expect(instance.state).toBe('ABORTED')
    expect(instance.output_parameters).toEqual([{ key: 'cleanup', value: 'done' }])
  })

  it('finalizer failure keeps terminal state and records error+traceback', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      visibility: 'observable',
      pinnedStates: ['COMPLETED'],
    })
    deps.codeExecutor.mockResolvedValue(
      makeFailureResult({
        error: 'oops',
        error_type: 'RUNTIME_ERROR',
        traceback: 'Traceback (most recent call last)\nRuntimeError: oops',
        outputs: { partial: 'value' },
      })
    )
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    const instance = (await deps.instanceRepo.findById(instanceId))!
    // Reaching COMPLETED is not retroactively an error — state must stay COMPLETED.
    expect(instance.state).toBe('COMPLETED')
    expect(instance.error).toBe('RUNTIME_ERROR: oops')
    expect(instance.traceback).toBe('Traceback (most recent call last)\nRuntimeError: oops')
    // Partial outputs written before the raise are preserved.
    expect(instance.output_parameters).toEqual([{ key: 'partial', value: 'value' }])
    expect(instance.completed_at).not.toBeNull()
  })

  it('fires onTerminal exactly once after finalizer with outputs visible', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      visibility: 'opaque',
      pinnedStates: ['COMPLETED'],
    })
    deps.codeExecutor.mockResolvedValue(makeSuccessResult({ outputs: { x: '1' } }))

    const onTerminal = vi.fn()
    const sm = createSMWithCallbacks(deps, { onTerminal })

    await sm.startInstance(instanceId)

    expect(onTerminal).toHaveBeenCalledTimes(1)
    const [, state, finalInstance] = onTerminal.mock.calls[0] as [string, string, Instance]
    expect(state).toBe('COMPLETED')
    // onTerminal must see the instance with the finalizer's outputs already
    // persisted — that's what makes ExecutionLogger and SSE see them.
    expect(finalInstance.output_parameters).toEqual([{ key: 'x', value: '1' }])
  })

  it('invokes onPropertyMutations from finalizer code', async () => {
    const deps = createTestDeps()
    const { instanceId, envOid, actionOid } = await createTestInstance(deps, {
      visibility: 'observable',
      pinnedStates: ['COMPLETED'],
    })
    const mutations = [{ spec_name: 'ActionProperty1', entry_name: 'Value', value: 'final' }]
    deps.codeExecutor.mockResolvedValue(makeSuccessResult({ property_mutations: mutations }))

    const onPropertyMutations = vi.fn()
    const sm = createSMWithCallbacks(deps, { onPropertyMutations })

    await sm.startInstance(instanceId)

    expect(onPropertyMutations).toHaveBeenCalledTimes(1)
    expect(onPropertyMutations).toHaveBeenCalledWith(instanceId, envOid, actionOid, mutations)
  })

  it('does not re-run finalizer when reentering terminal state with completed_at set', async () => {
    const deps = createTestDeps()
    const { instanceId } = await createTestInstance(deps, {
      visibility: 'opaque',
      pinnedStates: ['COMPLETED'],
    })
    deps.codeExecutor.mockResolvedValue(makeSuccessResult({ outputs: { x: '1' } }))
    const sm = createSM(deps)

    await sm.startInstance(instanceId)
    const callsAfterFirst = deps.codeExecutor.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)

    // Re-trigger processCurrentState — completed_at is set, so finalizer must not re-run.
    await sm.startInstance(instanceId)
    expect(deps.codeExecutor.mock.calls.length).toBe(callsAfterFirst)
  })
})
