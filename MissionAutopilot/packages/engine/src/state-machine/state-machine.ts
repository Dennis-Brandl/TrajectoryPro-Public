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

import type { Instance } from '@mission/autopilot-storage'
import type { InstanceRepository } from '@mission/autopilot-storage'
import type { CodeVersionRepository } from '@mission/autopilot-storage'
import type { SettingsRepository } from '@mission/autopilot-storage'
import type { ActionRepository } from '@mission/autopilot-storage'
import type { EnvironmentRepository } from '@mission/autopilot-storage'
import { EngineError, InvalidStateTransitionError } from '../errors.js'
import { AUTO_ADVANCE, OPAQUE_AUTO_ADVANCE, validateCommand } from './transitions.js'
import { isTerminal } from './states.js'
import {
  flattenProperties,
  mergePropertyOverrides,
} from '../instance-manager/parameter-resolver.js'

/**
 * Callback used by InstanceManager to expose per-invoke `action_property_overrides`
 * to the state machine. Returns the override map for the given instance, or
 * `undefined` if none was set at invoke time.
 *
 * Overrides are merged into the env-level flattened props before each state's
 * code executes (see `processCurrentState` env-props construction).
 */
export type GetActionPropertyOverrides = (
  instanceId: string
) => Record<string, Record<string, string>> | undefined

/**
 * Recovery states that must NOT loop on their own failure. If code in
 * ABORTING/STOPPING/CLEARING throws, we cannot transition back into the
 * same state — that's an infinite loop. Force the terminal directly.
 */
const RECOVERY_TERMINAL = new Map<string, string>([
  ['ABORTING', 'ABORTED'],
  ['STOPPING', 'COMPLETED'],
  ['CLEARING', 'COMPLETED'],
])

// ============================================================
// Supporting types
// ============================================================

/**
 * Result returned by the code executor callback after running Python code.
 */
export interface CodeExecutionResult {
  success: boolean
  outputs: Record<string, string>
  return_value: boolean | null
  error?: string
  error_type?: string
  traceback?: string
  execution_time_ms: number
  stdout_capture: string
  stderr_capture: string
  /** Property mutations emitted by the Python sidecar (via trajectory.set_property). */
  property_mutations?: Array<{ spec_name: string; entry_name: string; value: string }>
  /**
   * Commands requested by user code via trajectory.request_command(). The state
   * machine dispatches the first entry through `sendCommand` after this
   * execution returns; per-state validity is enforced by `validateCommand`,
   * not by the sidecar.
   */
  requested_commands?: Array<{ command: string; reason?: string }>
}

/**
 * Injectable callback for running Python code in a state.
 * In production: PythonWorkerPool (Plan 03-02/03-03).
 * In tests: vi.fn() returning configurable results.
 */
export type CodeExecutor = (
  instanceId: string,
  state: string,
  sourceCode: string,
  inputs: Record<string, string>,
  outputs: Record<string, string>,
  envProps: Record<string, unknown>,
  actionProps: Record<string, unknown>,
  timeoutMs: number
) => Promise<CodeExecutionResult>

/**
 * Optional event hooks for the state machine.
 * Used for SSE emission (Phase 5) and logging.
 */
export interface StateMachineCallbacks {
  onStateChange?: (instanceId: string, state: string, instance: Instance) => void
  /**
   * May be async: InstanceManager's wrapper writes the execution log entry
   * (repo calls) before delegating to the caller-supplied onTerminal. The
   * state machine awaits this so terminal processing fully completes before
   * processCurrentState()'s promise resolves — matching the pre-Postgres
   * behavior where writeLog() ran synchronously inline.
   */
  onTerminal?: (instanceId: string, state: string, instance: Instance) => void | Promise<void>
  onError?: (instanceId: string, error: Error) => void
  /**
   * Called after each code execution when the sidecar returned property_mutations.
   * InstanceManager uses this to persist mutations to storage and publish SSE.
   * May be async (persisting mutations is now a repo call); awaited at each call site.
   */
  onPropertyMutations?: (
    instanceId: string,
    environmentOid: string,
    actionOid: string,
    mutations: Array<{ spec_name: string; entry_name: string; value: string }>
  ) => void | Promise<void>
}

// ============================================================
// StateMachine class
// ============================================================

export class StateMachine {
  private readonly instanceRepo: InstanceRepository
  private readonly codeVersionRepo: CodeVersionRepository
  private readonly settingsRepo: SettingsRepository
  private readonly codeExecutor: CodeExecutor
  private readonly callbacks?: StateMachineCallbacks
  private readonly actionRepo?: ActionRepository
  private readonly environmentRepo?: EnvironmentRepository
  private readonly getActionPropertyOverrides?: GetActionPropertyOverrides

  /** Instance IDs currently executing Python code */
  private readonly executingInstances = new Set<string>()

  /** Deferred commands: command that arrived during code execution, to apply after code finishes */
  private readonly deferredCommands = new Map<string, string>()

  constructor(
    instanceRepo: InstanceRepository,
    codeVersionRepo: CodeVersionRepository,
    settingsRepo: SettingsRepository,
    codeExecutor: CodeExecutor,
    callbacks?: StateMachineCallbacks,
    actionRepo?: ActionRepository, // NEW — optional for backwards compat
    environmentRepo?: EnvironmentRepository, // NEW — optional for backwards compat
    getActionPropertyOverrides?: GetActionPropertyOverrides // NEW — per-invoke property overrides
  ) {
    this.instanceRepo = instanceRepo
    this.codeVersionRepo = codeVersionRepo
    this.settingsRepo = settingsRepo
    this.codeExecutor = codeExecutor
    this.callbacks = callbacks
    this.actionRepo = actionRepo
    this.environmentRepo = environmentRepo
    this.getActionPropertyOverrides = getActionPropertyOverrides
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Kick off the state machine pipeline for an instance that has already been created
   * with its initial state. Processes the current state without creating a duplicate
   * state_history entry.
   */
  async startInstance(instanceId: string): Promise<void> {
    await this.processCurrentState(instanceId)
  }

  /**
   * Validate and execute a client command against the current state.
   * Supports deferred commands (HOLD/STOP/ABORT) while code is executing.
   */
  async sendCommand(instanceId: string, command: string): Promise<void> {
    const instance = await this.instanceRepo.findById(instanceId)
    if (!instance) {
      throw new EngineError('INSTANCE_NOT_FOUND', `Instance not found: ${instanceId}`)
    }

    // validateCommand throws InvalidStateTransitionError if invalid
    const targetState = validateCommand(instance.state, command, instance.visibility)

    // Deferred command check: if code is executing, defer HOLD/STOP/ABORT/CLEAR.
    // CLEAR is defer-eligible because the only state it's valid from (ABORTED)
    // can now have a finalizer; without deferral, CLEAR would race with the
    // finalizer's terminal cleanup.
    if (
      (command === 'HOLD' || command === 'STOP' || command === 'ABORT' || command === 'CLEAR') &&
      this.executingInstances.has(instanceId)
    ) {
      this.deferredCommands.set(instanceId, command)
      return
    }

    // Compare-and-set against the state we validated: a concurrent command
    // that already moved the instance makes this one invalid, not an overwrite.
    await this.enterState(instanceId, targetState, undefined, {
      expectedState: instance.state,
      command,
    })
  }

  // ============================================================
  // Core pipeline
  // ============================================================

  /**
   * Persist a new state and run the state-entry pipeline:
   * 1. Persist state change via instanceRepo.transitionState() (compare-and-set
   *    when `cas` is supplied, unconditional otherwise)
   * 2. Emit onStateChange callback
   * 3. Process the newly entered state (look up code, execute or auto-advance)
   */
  async enterState(
    instanceId: string,
    newState: string,
    updates?: {
      started_at?: string
      completed_at?: string
      error?: string
      traceback?: string
    },
    cas?: { expectedState: string; command: string }
  ): Promise<void> {
    // 1-3. Persist state and append to state_history. Unconditional unless the
    // caller (sendCommand) supplies `cas` to compare-and-set against a
    // validated snapshot.
    const outcome = await this.instanceRepo.transitionState(
      instanceId,
      cas?.expectedState ?? null,
      newState,
      updates
    )
    if (outcome === 'not_found') {
      throw new EngineError(
        'INSTANCE_NOT_FOUND',
        `Instance not found during state transition: ${instanceId}`
      )
    }
    if (outcome === 'stale') {
      // The instance moved on between sendCommand's validation and this
      // persist — surface the same error a re-validated command would throw,
      // using the instance's CURRENT state (not the stale snapshot).
      const current = await this.instanceRepo.findById(instanceId)
      throw new InvalidStateTransitionError(current?.state ?? 'UNKNOWN', cas?.command ?? 'UNKNOWN')
    }
    const updatedInstance = outcome

    // 4. Emit state change callback (for SSE emission in Phase 5)
    this.callbacks?.onStateChange?.(instanceId, newState, updatedInstance)

    // 5-8. Process the new state (code lookup + execute or auto-advance)
    await this.processCurrentState(instanceId)
  }

  // ============================================================
  // Private: state processing logic
  // ============================================================

  /**
   * Core state processing logic.
   * Reads the instance, looks up pinned code for the current state,
   * and either executes the code or auto-advances to the next state.
   */
  private async processCurrentState(instanceId: string): Promise<void> {
    const instance = await this.instanceRepo.findById(instanceId)
    if (!instance) {
      throw new EngineError(
        'INSTANCE_NOT_FOUND',
        `Instance not found in processCurrentState: ${instanceId}`
      )
    }

    const currentState = instance.state
    const visibility = instance.visibility

    // Terminal state handling: run any pinned finalizer code, then emit onTerminal.
    // completed_at acts as the idempotency guard — a second entry to a terminal
    // state skips the finalizer (it already ran).
    if (isTerminal(currentState)) {
      if (!instance.completed_at) {
        // Look up pinned code for the terminal state. Both COMPLETED and ABORTED
        // can carry a finalizer that mirrors the "Check STATE" pattern used by
        // non-terminal states — this is what lets actions set final outputs
        // (e.g. ExportImportAction1 setting received_count/status in COMPLETED).
        const pinnedCodeVersions = instance.pinned_code_versions as Array<{
          state: string
          code_version_id: string
        }>
        const pinnedEntry = pinnedCodeVersions.find((entry) => entry.state === currentState)
        const finalizerCode = pinnedEntry
          ? await this.codeVersionRepo.findById(pinnedEntry.code_version_id)
          : null

        if (finalizerCode) {
          await this.runFinalizerCode(instanceId, currentState, finalizerCode.source_code, instance)
          // A deferred command flushed during the finalizer (e.g. CLEAR while
          // ABORTED finalizer ran) transitions out of the terminal state. The
          // new state's processCurrentState will handle its own terminal
          // cleanup — don't fire onTerminal here.
          const afterFinalizer = (await this.instanceRepo.findById(instanceId))!
          if (afterFinalizer.state !== currentState) {
            return
          }
        }

        await this.instanceRepo.updateState(instanceId, currentState, {
          completed_at: new Date().toISOString(),
        })
        const finalInstance = (await this.instanceRepo.findById(instanceId))!
        await this.callbacks?.onTerminal?.(instanceId, currentState, finalInstance)
      } else {
        await this.callbacks?.onTerminal?.(instanceId, currentState, instance)
      }
      return
    }

    // Look up pinned code version for this state
    const pinnedCodeVersions = instance.pinned_code_versions as Array<{
      state: string
      code_version_id: string
    }>
    const pinnedEntry = pinnedCodeVersions.find((entry) => entry.state === currentState)
    const codeVersion = pinnedEntry
      ? await this.codeVersionRepo.findById(pinnedEntry.code_version_id)
      : null

    if (codeVersion) {
      // Code found: execute it
      await this.executeCode(
        instanceId,
        currentState,
        codeVersion.source_code,
        visibility,
        instance
      )
    } else {
      // No code: auto-advance to next state
      await this.autoAdvance(instanceId, currentState, visibility, instance)
    }
  }

  /**
   * Execute Python code for the current state.
   * Handles success (return_value true/false) and failure (exceptions).
   */
  private async executeCode(
    instanceId: string,
    state: string,
    sourceCode: string,
    visibility: string,
    instance: Instance
  ): Promise<void> {
    // Per-action timeout takes precedence over global setting
    let timeoutMs: number
    if (this.actionRepo) {
      const action = await this.actionRepo.findByOid(instance.action_oid)
      if (action && action.timeout_seconds !== null && action.timeout_seconds !== undefined) {
        // Per-action: 0 = disabled, >0 = seconds * 1000
        timeoutMs = action.timeout_seconds === 0 ? 0 : action.timeout_seconds * 1000
      } else {
        // Fall back to global setting
        timeoutMs = (await this.settingsRepo.getNumericValue('execution_timeout_ms')) ?? 60000
      }
    } else {
      timeoutMs = (await this.settingsRepo.getNumericValue('execution_timeout_ms')) ?? 60000
    }

    // Parse inputs and outputs as Record<string, string>
    const inputs = this.parseParametersAsRecord(instance.input_parameters)
    const outputs = this.parseParametersAsRecord(instance.output_parameters)

    // Resolve envProps and actionProps from repos when provided (Phase 4+)
    // Falls back to empty objects when repos are not provided (Phase 3 tests unaffected)
    let envProps: Record<string, unknown> = {}
    let actionProps: Record<string, unknown> = {}
    if (this.actionRepo && this.environmentRepo) {
      const action = await this.actionRepo.findByOid(instance.action_oid)
      if (action) {
        actionProps = flattenProperties(action.property_specifications)
        const environment = await this.environmentRepo.findByOid(action.environment_oid)
        if (environment) {
          envProps = flattenProperties(environment.action_property_specifications)
        }
      }
    }

    // Apply per-invoke action_property_overrides (test/dev affordance):
    // overrides win over both env action_property_specifications and any
    // entries the action contributed. Stored ephemerally on InstanceManager.
    const overrides = this.getActionPropertyOverrides?.(instanceId)
    if (overrides && Object.keys(overrides).length > 0) {
      envProps = mergePropertyOverrides(
        envProps as Record<string, Record<string, string>>,
        overrides
      )
    }

    // Track that this instance is executing code (for deferred command support)
    this.executingInstances.add(instanceId)

    let result: CodeExecutionResult
    try {
      result = await this.codeExecutor(
        instanceId,
        state,
        sourceCode,
        inputs,
        outputs,
        envProps,
        actionProps,
        timeoutMs
      )
    } finally {
      this.executingInstances.delete(instanceId)
    }

    // Handle deferred command (HOLD/STOP/ABORT that arrived during code execution)
    if (this.deferredCommands.has(instanceId)) {
      // Apply property mutations before the deferred command — writes that completed
      // before the stop are not lost.
      if (this.callbacks?.onPropertyMutations && result.property_mutations?.length) {
        await this.callbacks.onPropertyMutations(
          instanceId,
          instance.environment_oid,
          instance.action_oid,
          result.property_mutations
        )
      }
      const deferredCommand = this.deferredCommands.get(instanceId)!
      this.deferredCommands.delete(instanceId)
      await this.sendCommand(instanceId, deferredCommand)
      return
    }

    // Notify InstanceManager of any property mutations from this execution.
    // Called regardless of success/failure so partial mutations on error paths
    // are still applied (matches Python sidecar behavior).
    if (
      this.callbacks?.onPropertyMutations &&
      result.property_mutations &&
      result.property_mutations.length > 0
    ) {
      await this.callbacks.onPropertyMutations(
        instanceId,
        instance.environment_oid,
        instance.action_oid,
        result.property_mutations
      )
    }

    if (result.success) {
      // Update output parameters with code results
      if (Object.keys(result.outputs).length > 0) {
        const currentInstance = await this.instanceRepo.findById(instanceId)
        if (currentInstance) {
          const currentOutputs = this.parseParametersAsRecord(currentInstance.output_parameters)
          const mergedOutputs = { ...currentOutputs, ...result.outputs }
          await this.instanceRepo.updateOutputParameters(
            instanceId,
            Object.entries(mergedOutputs).map(([k, v]) => ({ key: k, value: v }))
          )
        }
      }

      // Mark this state as having code executed
      const updatedInstance = await this.instanceRepo.findById(instanceId)
      if (updatedInstance) {
        const statesExecuted = updatedInstance.states_with_code_executed as string[]
        if (!statesExecuted.includes(state)) {
          await this.instanceRepo.markStatesWithCodeExecuted(instanceId, [...statesExecuted, state])
        }
      }

      // Code-requested command takes priority over the return_value-driven
      // transitions below. Route through sendCommand so validateCommand enforces
      // per-state legality (e.g. UNHOLD is only valid from HELD). An illegal
      // request is converted to an ABORT so the action never lands in an
      // inconsistent state.
      if (result.requested_commands && result.requested_commands.length > 0) {
        const requested = result.requested_commands[0]
        try {
          await this.sendCommand(instanceId, requested.command)
        } catch (err) {
          if (err instanceof InvalidStateTransitionError) {
            await this.enterState(instanceId, 'ABORTING', {
              error: `Invalid request_command(${requested.command}) from ${state}: ${err.message}`,
            })
            return
          }
          throw err
        }
        return
      }

      if (result.return_value === false && state === 'EXECUTING') {
        // Code-initiated HOLD: return_value false in EXECUTING triggers HOLDING -> HELD
        await this.enterState(instanceId, 'HOLDING')
        return
      }

      // Success with return_value true (or non-false): auto-advance
      await this.autoAdvance(instanceId, state, visibility, instance)
    } else {
      // Execution failure: two-tier error detail per CONTEXT.md
      // error field: summary (error_type: message)
      // traceback field: full Python traceback (separate from summary)
      const errorSummary = result.error_type
        ? `${result.error_type}: ${result.error ?? 'Execution failed'}`
        : (result.error ?? 'Execution failed')

      // Persist error summary and traceback only if the instance is still in the
      // state that ran the code. A failure arriving after the instance moved on
      // (e.g. ABORTED by a cancel that killed the worker) writes nothing.
      const persisted = await this.instanceRepo.transitionState(instanceId, state, state, {
        error: errorSummary,
        traceback: result.traceback ?? null,
      })
      if (persisted === 'stale' || persisted === 'not_found') {
        console.warn(
          `[state-machine] late failure for ${instanceId} in ${state} ignored: instance moved on`
        )
        return
      }

      // Persist any outputs the user code set before the raise. User code that
      // does `outputs['status']='1'; raise RuntimeError(...)` recorded partial
      // progress that callers want to see alongside the error; without this
      // merge the dict reaches the engine via the sidecar but never lands on
      // the instance record.
      if (Object.keys(result.outputs).length > 0) {
        const currentInstance = await this.instanceRepo.findById(instanceId)
        if (currentInstance) {
          const currentOutputs = this.parseParametersAsRecord(currentInstance.output_parameters)
          const mergedOutputs = { ...currentOutputs, ...result.outputs }
          await this.instanceRepo.updateOutputParameters(
            instanceId,
            Object.entries(mergedOutputs).map(([k, v]) => ({ key: k, value: v }))
          )
        }
      }

      // Recovery-state failure must NOT re-enter the same state — that would
      // create an infinite loop (ABORTING.py fails → enterState(ABORTING) →
      // ABORTING.py fails → ...). Force-transition to the terminal instead.
      const forcedTerminal = RECOVERY_TERMINAL.get(state)
      const target = forcedTerminal ?? 'ABORTING'
      try {
        // Compare-and-set: an ABORT (or similar) that moved the instance on
        // since the failure was recorded must not be followed by a second entry.
        await this.enterState(
          instanceId,
          target,
          { error: errorSummary },
          { expectedState: state, command: forcedTerminal ? target : 'ABORT' }
        )
      } catch (err) {
        if (err instanceof InvalidStateTransitionError) {
          console.warn(
            `[state-machine] late failure for ${instanceId} in ${state} ignored: instance moved on`
          )
          return
        }
        throw err
      }
    }
  }

  /**
   * Run pinned code in a terminal state as a finalizer. Mirrors executeCode's
   * setup but does NOT transition state on failure — per the Trajectory state
   * model, reaching a terminal state is not retroactively an error. Persists
   * outputs and property_mutations on both success and failure paths. A
   * deferred command flushed during finalizer execution (only CLEAR from
   * ABORTED is reachable today) is applied after the persist step.
   */
  private async runFinalizerCode(
    instanceId: string,
    state: string,
    sourceCode: string,
    instance: Instance
  ): Promise<void> {
    let timeoutMs: number
    if (this.actionRepo) {
      const action = await this.actionRepo.findByOid(instance.action_oid)
      if (action && action.timeout_seconds !== null && action.timeout_seconds !== undefined) {
        timeoutMs = action.timeout_seconds === 0 ? 0 : action.timeout_seconds * 1000
      } else {
        timeoutMs = (await this.settingsRepo.getNumericValue('execution_timeout_ms')) ?? 60000
      }
    } else {
      timeoutMs = (await this.settingsRepo.getNumericValue('execution_timeout_ms')) ?? 60000
    }

    const inputs = this.parseParametersAsRecord(instance.input_parameters)
    const outputs = this.parseParametersAsRecord(instance.output_parameters)

    let envProps: Record<string, unknown> = {}
    let actionProps: Record<string, unknown> = {}
    if (this.actionRepo && this.environmentRepo) {
      const action = await this.actionRepo.findByOid(instance.action_oid)
      if (action) {
        actionProps = flattenProperties(action.property_specifications)
        const environment = await this.environmentRepo.findByOid(action.environment_oid)
        if (environment) {
          envProps = flattenProperties(environment.action_property_specifications)
        }
      }
    }

    const overrides = this.getActionPropertyOverrides?.(instanceId)
    if (overrides && Object.keys(overrides).length > 0) {
      envProps = mergePropertyOverrides(
        envProps as Record<string, Record<string, string>>,
        overrides
      )
    }

    this.executingInstances.add(instanceId)
    let result: CodeExecutionResult
    try {
      result = await this.codeExecutor(
        instanceId,
        state,
        sourceCode,
        inputs,
        outputs,
        envProps,
        actionProps,
        timeoutMs
      )
    } finally {
      this.executingInstances.delete(instanceId)
    }

    // Persist outputs from the finalizer on both success and failure paths —
    // partial writes before a raise are valuable for debugging.
    if (Object.keys(result.outputs).length > 0) {
      const currentInstance = await this.instanceRepo.findById(instanceId)
      if (currentInstance) {
        const currentOutputs = this.parseParametersAsRecord(currentInstance.output_parameters)
        const mergedOutputs = { ...currentOutputs, ...result.outputs }
        await this.instanceRepo.updateOutputParameters(
          instanceId,
          Object.entries(mergedOutputs).map(([k, v]) => ({ key: k, value: v }))
        )
      }
    }

    if (
      this.callbacks?.onPropertyMutations &&
      result.property_mutations &&
      result.property_mutations.length > 0
    ) {
      await this.callbacks.onPropertyMutations(
        instanceId,
        instance.environment_oid,
        instance.action_oid,
        result.property_mutations
      )
    }

    if (result.success) {
      const updatedInstance = await this.instanceRepo.findById(instanceId)
      if (updatedInstance) {
        const statesExecuted = updatedInstance.states_with_code_executed as string[]
        if (!statesExecuted.includes(state)) {
          await this.instanceRepo.markStatesWithCodeExecuted(instanceId, [...statesExecuted, state])
        }
      }
    } else {
      const errorSummary = result.error_type
        ? `${result.error_type}: ${result.error ?? 'Execution failed'}`
        : (result.error ?? 'Execution failed')
      await this.instanceRepo.updateState(instanceId, state, {
        error: errorSummary,
        traceback: result.traceback ?? null,
      })
    }

    // Flush any command deferred during finalizer execution.
    if (this.deferredCommands.has(instanceId)) {
      const deferredCommand = this.deferredCommands.get(instanceId)!
      this.deferredCommands.delete(instanceId)
      await this.sendCommand(instanceId, deferredCommand)
    }
  }

  /**
   * Auto-advance to the next state based on the auto-advance table.
   * If there is no next state (terminal or wait-states like PAUSED/HELD), stop.
   */
  private async autoAdvance(
    instanceId: string,
    currentState: string,
    visibility: string,
    instance: Instance
  ): Promise<void> {
    const autoAdvanceMap = visibility === 'opaque' ? OPAQUE_AUTO_ADVANCE : AUTO_ADVANCE
    const nextState = autoAdvanceMap.get(currentState)

    if (nextState) {
      // Set started_at on first transition from STARTING/POSTED
      const updates: { started_at?: string } = {}
      if (currentState === 'STARTING' || currentState === 'POSTED') {
        updates.started_at = instance.started_at ?? new Date().toISOString()
      }
      await this.enterState(
        instanceId,
        nextState,
        Object.keys(updates).length ? updates : undefined
      )
    }
    // If no next state: wait-state (PAUSED, HELD) or terminal (should not happen here since
    // processCurrentState handles terminal states before calling autoAdvance)
  }

  /**
   * Parse an instance's parameters array into a Record<string, string> for the code executor.
   * Handles both array-of-{key,value} and plain objects.
   */
  private parseParametersAsRecord(params: unknown[]): Record<string, string> {
    const result: Record<string, string> = {}
    for (const p of params) {
      if (p && typeof p === 'object' && 'key' in p && 'value' in p) {
        const param = p as { key: string; value: unknown }
        result[param.key] = String(param.value)
      }
    }
    return result
  }
}
