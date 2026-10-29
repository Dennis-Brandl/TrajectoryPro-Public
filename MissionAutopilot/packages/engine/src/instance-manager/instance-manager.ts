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

import type { Instance, Queryable } from '@mission/autopilot-storage'
import {
  InstanceRepository,
  ActionRepository,
  EnvironmentRepository,
  CodeVersionRepository,
  LogRepository,
  SettingsRepository,
} from '@mission/autopilot-storage'
import { EngineError } from '../errors.js'
import { PythonWorkerPool } from '../python-pool/pool.js'
import { StateMachine } from '../state-machine/state-machine.js'
import type { CodeExecutor } from '../state-machine/state-machine.js'
import { ExecutionLogger } from './execution-logger.js'
import { resolveInputParameters } from './parameter-resolver.js'
import type {
  InvokeRequest,
  InvokeResult,
  InstanceManagerOptions,
  PropertyMutation,
  PropertySsePublisher,
} from './types.js'
import { PropertyEditError } from './types.js'
import { applyPropertyEdits, type PropertySpecRecord } from './property-edits.js'

// ============================================================
// InstanceManager — central orchestrator for Phase 4
// ============================================================

/**
 * InstanceManager wires together PythonWorkerPool, StateMachine, ExecutionLogger,
 * and parameter resolution into a single public API for the REST protocol (Phase 5).
 *
 * Public API:
 *   - invoke()            — create instance, start async execution, return InvokeResult
 *   - sendCommand()       — delegate to StateMachine.sendCommand()
 *   - getInstance()       — current instance state from repository
 *   - getActiveInstances() — all non-terminal instances
 *   - resizePool()        — runtime pool size change
 *   - shutdown()          — graceful pool shutdown
 */
export class InstanceManager {
  private readonly instanceRepo: InstanceRepository
  private readonly actionRepo: ActionRepository
  private readonly environmentRepo: EnvironmentRepository
  private readonly codeVersionRepo: CodeVersionRepository
  private readonly logRepo: LogRepository
  private readonly settingsRepo: SettingsRepository
  private readonly executionLogger: ExecutionLogger
  private readonly pool: PythonWorkerPool
  private readonly stateMachine: StateMachine
  private readonly callbacks: Pick<
    InstanceManagerOptions,
    'onStateChange' | 'onTerminal' | 'onError'
  >
  /**
   * Optional SSE publisher for property mutation events.
   * Uses the PropertySsePublisher structural interface to avoid importing
   * from the server package (layering boundary: engine must not import from server).
   * The actual SseManager from packages/server satisfies this interface implicitly.
   */
  private readonly sseManager?: PropertySsePublisher
  /**
   * Per-invoke `action_property_overrides`, keyed by runtime instance id.
   * Set in `invoke()` when the caller supplies overrides; deleted in the
   * `onTerminal` callback to bound memory growth.
   */
  private readonly actionPropertyOverrides = new Map<
    string,
    Record<string, Record<string, string>>
  >()
  /**
   * Set by resizePool() the first time a caller explicitly resizes the pool.
   * Latches the async settings-based pool-size reconciliation (constructor)
   * out permanently once set — an explicit resize always wins, matching the
   * old synchronous code's guarantee (there the DB read happened BEFORE the
   * pool existed, so nothing could ever race an explicit resize).
   */
  private explicitPoolResize = false
  /**
   * Serializes applyPropertyMutations() calls in-process.
   *
   * Pre-port, applyPropertyMutations was fully synchronous (findByOid → mutate
   * the in-memory JSON array → update, uninterruptible by the event loop). The
   * Postgres port made both the read and the write real async round-trips, which
   * reopened a lost-update race: two instances finishing near-simultaneously in
   * the same environment can both read the whole `action_property_specifications`
   * array before either writes, so the second write silently erases the first's
   * mutations.
   *
   * This chain restores the old atomicity without any DB-level locking: every
   * call appends its actual work onto the tail of the chain and only starts
   * once the previous call's work has settled (success OR failure), so calls
   * are strictly serialized in invocation order. The tail itself is reset to a
   * settled-agnostic continuation so one call's rejection can never poison the
   * chain for subsequent callers — each caller still gets its own outcome via
   * the `link` promise it awaits/returns.
   */
  private propertyMutationChain: Promise<void> = Promise.resolve()

  constructor(q: Queryable, options: InstanceManagerOptions) {
    // Create all repositories from the shared Queryable connection
    this.instanceRepo = new InstanceRepository(q)
    this.actionRepo = new ActionRepository(q)
    this.environmentRepo = new EnvironmentRepository(q)
    this.codeVersionRepo = new CodeVersionRepository(q)
    this.logRepo = new LogRepository(q)
    this.settingsRepo = new SettingsRepository(q)

    // Build ExecutionLogger from repos
    this.executionLogger = new ExecutionLogger(
      this.actionRepo,
      this.environmentRepo,
      this.codeVersionRepo,
      this.logRepo,
      this.settingsRepo,
      this.instanceRepo
    )

    // Stash callback references for use in invoke()'s fire-and-forget path
    this.callbacks = {
      onStateChange: options.onStateChange,
      onTerminal: options.onTerminal,
      onError: options.onError,
    }

    // Stash optional SSE publisher for property mutation events
    this.sseManager = options.sseManager

    // Determine pool size: SettingsRepository setting > options.poolSize > default 4.
    // NOTE (async-port hazard): SettingsRepository.getNumericValue() is now a DB
    // round-trip and the constructor cannot be async (Task 6's server boot relies
    // on `new InstanceManager(q, options)` staying a plain, synchronous constructor
    // call). The pool is therefore spawned synchronously at options.poolSize ?? 4,
    // and the DB-configured size (when it differs) is applied via a best-effort
    // async resize right after — see the `void this.settingsRepo...` block below.
    // Precedence at rest is unchanged (DB setting wins once it resolves); there is
    // only a brief window right after construction where the pool may run at the
    // options/default size instead of the DB-configured size.
    const initialPoolSize = options.poolSize ?? 4

    // Create Python worker pool
    this.pool = new PythonWorkerPool({
      pythonPath: options.pythonPath ?? 'python',
      scriptPath: options.scriptPath,
      poolSize: initialPoolSize,
    })

    // Best-effort: once the DB-configured pool size resolves, reconcile the
    // already-running pool to it (matches the old synchronous precedence).
    // Fire-and-forget is intentional here — there is no constructor to await
    // it from — but every step inside is caught so it can never produce an
    // unhandled rejection.
    //
    // Two invariants beyond "spawn synchronously, adjust later":
    //  - never spawn workers after shutdown(): PythonWorkerPool.resize() is
    //    itself a no-op once the pool is shutting down (guards every caller,
    //    not just this one) — a late-resolving settings query landing after
    //    shutdown() must not spawn subprocesses nothing will reap.
    //  - an explicit resizePool() call always wins: compare against the
    //    CONSTRUCTION-TIME size (initialPoolSize), not the live pool target,
    //    and bail entirely once `explicitPoolResize` is set — an in-flight
    //    settings read must never clobber a caller's explicit intent.
    void this.settingsRepo
      .getNumericValue('python_pool_size')
      .then((dbPoolSize) => {
        if (this.explicitPoolResize) return
        const target = dbPoolSize ?? initialPoolSize
        if (target !== initialPoolSize) {
          this.pool.resize(target)
        }
      })
      .catch((err) => {
        // Settings table unavailable/misconfigured at startup, or resize()
        // itself threw (e.g. an invalid size) — keep initialPoolSize, but
        // don't swallow this silently.
        console.warn(
          `InstanceManager: python_pool_size reconciliation failed, keeping pool at ${initialPoolSize}:`,
          err
        )
      })

    // The pool's executor is used as-is: action code never re-runs on its own.
    const codeExecutor: CodeExecutor = (...args) => this.pool.executeCode(...args)

    // Create StateMachine with all repos, code executor, and event hooks
    this.stateMachine = new StateMachine(
      this.instanceRepo,
      this.codeVersionRepo,
      this.settingsRepo,
      codeExecutor,
      {
        onStateChange: (instanceId, state, instance) => {
          this.callbacks.onStateChange?.(instanceId, state, instance)
        },
        onTerminal: async (instanceId, state, instance) => {
          // Write execution log entry on every terminal state
          try {
            await this.executionLogger.writeLog(instanceId, state, instance)
          } catch (err) {
            console.error(`ExecutionLogger.writeLog failed for instance ${instanceId}:`, err)
          }
          // Drop any per-invoke action_property_overrides for this instance.
          this.actionPropertyOverrides.delete(instanceId)
          this.callbacks.onTerminal?.(instanceId, state, instance)
        },
        onError: (instanceId, error) => {
          this.callbacks.onError?.(instanceId, error)
        },
        onPropertyMutations: async (instanceId, environmentOid, actionOid, mutations) => {
          await this.applyPropertyMutations(environmentOid, actionOid, instanceId, mutations)
        },
      },
      this.actionRepo,
      this.environmentRepo,
      (instanceId) => this.actionPropertyOverrides.get(instanceId)
    )
  }

  // ============================================================
  // Private: apply property mutations from sidecar
  // ============================================================

  /**
   * Persist property mutations to environment storage and publish SSE events.
   * Called by the StateMachine's onPropertyMutations callback after each code execution.
   *
   * Serialized via `propertyMutationChain` (see field doc) so two calls racing
   * on the same environment can never interleave their read-modify-write —
   * this is the only thing standing in for the old synchronous method's
   * uninterruptibility now that both the read and the write are real awaits.
   *
   * @param environment_oid - OID of the environment to update
   * @param source_action_oid - OID of the action whose code emitted the mutations
   * @param source_instance_id - runtime_action_instance_id of the executing instance
   * @param mutations - list of {spec_name, entry_name, value} mutations from the sidecar
   */
  private applyPropertyMutations(
    environment_oid: string,
    source_action_oid: string,
    source_instance_id: string,
    mutations: PropertyMutation[]
  ): Promise<void> {
    return this.enqueuePropertyWork(() =>
      this.runApplyPropertyMutations(
        environment_oid,
        source_action_oid,
        source_instance_id,
        mutations
      )
    )
  }

  /**
   * Set environment-level Action Property entry values from outside action
   * code — the management API behind the console's property editor.
   *
   * Serialized on the same chain as runtime `set_property()` writes, so a
   * console save can never interleave with an in-flight read-modify-write
   * (see `propertyMutationChain`).
   *
   * Strict, unlike the runtime path: every edit must name an existing property
   * AND an existing entry. An invalid batch throws PropertyEditError and
   * writes nothing. Only `value` is touched — every other field Designer put on
   * the spec or entry is preserved.
   *
   * @returns the persisted `action_property_specifications`
   */
  setPropertyValues(environment_oid: string, edits: PropertyMutation[]): Promise<unknown[]> {
    return this.enqueuePropertyWork(() => this.runSetPropertyValues(environment_oid, edits))
  }

  /**
   * Append `work` onto the tail of `propertyMutationChain` so it cannot start
   * until every previously-queued call has settled (success OR failure).
   * The tail is reset to a settled-agnostic continuation: one caller's
   * rejection must never poison the chain for subsequent callers. Each caller
   * still observes its own outcome via the returned promise.
   */
  private enqueuePropertyWork<T>(work: () => Promise<T>): Promise<T> {
    const link = this.propertyMutationChain.then(work)
    this.propertyMutationChain = link.then(
      () => undefined,
      () => undefined
    )
    return link
  }

  /**
   * The read-modify-write behind setPropertyValues(). Only ever invoked from
   * inside the propertyMutationChain — never call this directly.
   */
  private async runSetPropertyValues(
    environment_oid: string,
    edits: PropertyMutation[]
  ): Promise<unknown[]> {
    const env = await this.environmentRepo.findByOid(environment_oid)
    if (!env) {
      throw new PropertyEditError(
        'ENVIRONMENT_NOT_FOUND',
        `Environment not found: ${environment_oid}`
      )
    }
    const specs = env.action_property_specifications as PropertySpecRecord[]

    // `specs` is a fresh JSON.parse from findByOid, so a throw part-way
    // through leaves storage untouched — the batch is all-or-nothing.
    const changedBySpec = applyPropertyEdits(specs, edits, `environment ${environment_oid}`)

    if (changedBySpec.size === 0) return specs

    await this.environmentRepo.update(environment_oid, { action_property_specifications: specs })

    if (this.sseManager) {
      for (const [specName, changedEntries] of changedBySpec) {
        const spec = specs.find((s) => s.name === specName)!
        this.sseManager.publishProperty(environment_oid, specName, {
          entries: spec.entries,
          changed_entries: changedEntries,
          source: 'console',
        })
      }
    }
    return specs
  }

  /**
   * The actual read-modify-write for a single applyPropertyMutations() call.
   * Only ever invoked from inside the propertyMutationChain (see above) —
   * never call this directly, or the lost-update race reopens.
   */
  private async runApplyPropertyMutations(
    environment_oid: string,
    source_action_oid: string,
    source_instance_id: string,
    mutations: PropertyMutation[]
  ): Promise<void> {
    if (mutations.length === 0) return

    // The StateMachine passes the environment oid it loaded from the instance
    // row at transition time. An import can re-key the environment (or the
    // action) while a state execution is still running; the old oid is gone
    // but the instance row has been re-pointed at the new one — resolve
    // through it rather than dropping the write on the floor.
    let env = await this.environmentRepo.findByOid(environment_oid)
    if (!env) {
      const current = await this.instanceRepo.findById(source_instance_id)
      if (!current) return
      env = await this.environmentRepo.findByOid(current.environment_oid)
      if (!env) return
      environment_oid = env.oid
    }

    const specs = env.action_property_specifications as Array<{
      name: string
      oid?: string
      description?: string
      entries: Array<{ name: string; value: string }>
    }>

    // Apply each mutation: update existing entry or append a new one
    const touchedSpecNames = new Set<string>()
    for (const m of mutations) {
      const spec = specs.find((s) => s.name === m.spec_name)
      if (!spec) continue
      const entry = spec.entries.find((e) => e.name === m.entry_name)
      if (entry) {
        entry.value = m.value
      } else {
        spec.entries.push({ name: m.entry_name, value: m.value })
      }
      touchedSpecNames.add(m.spec_name)
    }

    // Persist the updated specs to storage
    await this.environmentRepo.update(environment_oid, { action_property_specifications: specs })

    // Publish one SSE event per touched spec
    if (this.sseManager) {
      for (const specName of touchedSpecNames) {
        const spec = specs.find((s) => s.name === specName)!
        const changedEntries = [
          ...new Set(mutations.filter((m) => m.spec_name === specName).map((m) => m.entry_name)),
        ]
        this.sseManager.publishProperty(environment_oid, specName, {
          entries: spec.entries,
          changed_entries: changedEntries,
          source: 'action_code',
          source_action_oid,
          source_instance_id,
        })
      }
    }
  }

  // ============================================================
  // Private: pin code versions at invocation time
  // ============================================================

  /**
   * Snapshots all currently active code versions for the given action.
   * Returns one entry per active version: { state, code_version_id }.
   */
  private async pinCodeVersions(
    actionOid: string
  ): Promise<Array<{ state: string; code_version_id: string }>> {
    const activeVersions = await this.codeVersionRepo.getAllActiveVersions(actionOid)
    return activeVersions.map((v) => ({
      state: v.state,
      code_version_id: v.id,
    }))
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Create a new runtime instance, start async execution, and return InvokeResult
   * immediately (fire-and-forget pattern — does NOT await startInstance).
   */
  async invoke(request: InvokeRequest): Promise<InvokeResult> {
    // 1. Validate action exists
    const action = await this.actionRepo.findByOid(request.action_oid)
    if (!action) {
      throw new EngineError('ACTION_NOT_FOUND', `Action not found: ${request.action_oid}`)
    }

    // 2. Resolve input parameters (applies defaults, validates required fields)
    const resolvedInputs = resolveInputParameters(
      request.input_parameters,
      action.input_parameter_specifications
    )

    // 3. Pin active code versions at invocation time
    const pinnedVersions = await this.pinCodeVersions(request.action_oid)

    // 4. Create instance in storage
    // NOTE: InstanceRepository.create() generates its own UUID internally;
    // the runtime_action_instance_id field in InstanceInput is ignored.
    const instance = await this.instanceRepo.create({
      runtime_action_instance_id: 'placeholder', // Overridden by repo
      action_oid: request.action_oid,
      environment_oid: action.environment_oid,
      workflow_instance_id: request.workflow_instance_id,
      step_instance_id: request.step_instance_id,
      step_oid: request.step_oid,
      visibility: action.action_visibility,
      state: action.action_visibility === 'observable' ? 'STARTING' : 'POSTED',
      input_parameters: resolvedInputs,
      output_parameters: [],
      state_history: [], // InstanceRepository.create() builds initial history itself
      pinned_code_versions: pinnedVersions,
      states_with_code_executed: [],
    })

    const instanceId = instance.runtime_action_instance_id

    // 4b. Stash per-invoke action_property_overrides so the state machine can
    //     merge them into envProps each time it runs code for this instance.
    //     Cleared in the onTerminal callback.
    if (
      request.action_property_overrides &&
      Object.keys(request.action_property_overrides).length > 0
    ) {
      this.actionPropertyOverrides.set(instanceId, request.action_property_overrides)
    }

    // 5. Start async execution — fire-and-forget (do NOT await)
    this.stateMachine.startInstance(instanceId).catch((err) => {
      console.error(`State machine error for instance ${instanceId}:`, err)
      this.callbacks.onError?.(instanceId, err instanceof Error ? err : new Error(String(err)))
    })

    // 6. Return InvokeResult immediately with the actual instance UUID
    const result: InvokeResult = {
      runtime_action_instance_id: instanceId,
      action_oid: request.action_oid,
      status: instance.state,
      created_at: instance.created_at,
    }

    if (action.action_visibility === 'observable') {
      result.sse_endpoint = `/trajectory/v1/instances/${instanceId}/events`
    }

    return result
  }

  /**
   * Send a client command to a running instance.
   * Delegates to StateMachine.sendCommand().
   */
  async sendCommand(instanceId: string, command: string): Promise<void> {
    await this.stateMachine.sendCommand(instanceId, command)
  }

  /**
   * Get the current state of a specific instance.
   */
  async getInstance(instanceId: string): Promise<Instance | null> {
    return this.instanceRepo.findById(instanceId)
  }

  /**
   * Get all instances that have not yet reached a terminal state.
   */
  async getActiveInstances(): Promise<Instance[]> {
    return this.instanceRepo.findActive()
  }

  /**
   * Resize the Python worker pool at runtime.
   * Growing: spawns new workers immediately.
   * Shrinking: drains idle workers; busy workers finish naturally.
   *
   * Latches `explicitPoolResize` so the constructor's async settings-based
   * pool-size reconciliation (if still in flight) never overwrites this
   * caller's explicit intent when its settings read resolves later.
   */
  resizePool(newSize: number): void {
    this.explicitPoolResize = true
    this.pool.resize(newSize)
  }

  /**
   * Force-cancel an instance: sends ABORT command through the state machine
   * then kills the worker process. Used by DELETE /instances/:id for immediate
   * termination semantics.
   */
  async cancelInstance(instanceId: string): Promise<void> {
    // Send ABORT command through state machine (may throw if already terminal)
    try {
      await this.sendCommand(instanceId, 'ABORT')
    } catch {
      // Instance may already be in terminal state — that's fine for cancel
    }
    // Force-kill the subprocess if still running
    await this.pool.killWorker(instanceId)
  }

  /**
   * Force-delete an instance row from the database, regardless of its state.
   *
   * Used by the management `DELETE /instances/:id` route to clean up instances
   * stuck in non-terminal states (e.g. ABORTING after the worker died before
   * completing the state transition). Such instances block environment
   * deletion because env-delete rejects with 409 when any owned action has an
   * "active" (completed_at IS NULL) instance.
   *
   * Best-effort kills any worker still executing for this instance, drops any
   * per-invoke action_property_overrides, then removes the row. Returns true
   * when a row was deleted, false when the instance was not found.
   *
   * SSE bus cleanup is the caller's responsibility (see SseManager.destroyInstanceBus)
   * because the engine package does not depend on the SSE manager.
   */
  async forceDeleteInstance(instanceId: string): Promise<boolean> {
    const instance = await this.instanceRepo.findById(instanceId)
    if (!instance) return false

    // Best-effort: if a worker is still running this instance's code, kill it.
    // killWorker is a no-op when nothing is active for this id.
    try {
      await this.pool.killWorker(instanceId)
    } catch {
      // Kill failures must not block row removal — the whole point of this
      // route is to recover from broken states.
    }

    // Drop any per-invoke action_property_overrides stashed for this instance
    // (would otherwise leak until process restart).
    this.actionPropertyOverrides.delete(instanceId)

    return (await this.instanceRepo.deleteById(instanceId)) > 0
  }

  /**
   * Dry-run code execution without creating an instance record.
   * Acquires a pool worker, runs the provided source code, releases the worker.
   * Used by MGMT-12 code test endpoint.
   *
   * NOTE: Calls this.pool.executeCode() directly; dry-run failures return the
   * error immediately to the caller.
   */
  async testCode(
    sourceCode: string,
    testInputs?: Record<string, string>,
    testProps?: Record<string, unknown>,
    testActionProps?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<{
    success: boolean
    outputs?: Record<string, string>
    return_value?: unknown
    stdout?: string
    stderr?: string
    error?: string
    error_type?: string
    execution_time_ms: number
  }> {
    let effectiveTimeout: number
    try {
      const dbTimeout = await this.settingsRepo.getNumericValue('execution_timeout_ms')
      effectiveTimeout = timeoutMs ?? dbTimeout ?? 60000
    } catch {
      effectiveTimeout = timeoutMs ?? 60000
    }
    const startTime = Date.now()
    const result = await this.pool.executeCode(
      `test-${Date.now()}`, // synthetic instanceId
      'TEST', // synthetic state
      sourceCode,
      testInputs ?? {},
      {}, // empty outputs accumulator
      testProps ?? {},
      testActionProps ?? {},
      effectiveTimeout
    )
    const execution_time_ms = Date.now() - startTime

    if (result.success) {
      return {
        success: true,
        outputs: result.outputs ?? {},
        return_value: result.return_value,
        stdout: result.stdout_capture ?? '',
        stderr: result.stderr_capture ?? '',
        execution_time_ms,
      }
    }
    return {
      success: false,
      error: result.error ?? 'Unknown error',
      error_type: result.error_type,
      stdout: result.stdout_capture ?? '',
      stderr: result.stderr_capture ?? '',
      execution_time_ms,
    }
  }

  /**
   * Gracefully shut down: drain queued property mutations first, then shut
   * down the Python worker pool. A mutation still on `propertyMutationChain`
   * would otherwise reject against an ended pool at SIGTERM — draining first
   * lets it land before the pool goes away.
   */
  async shutdown(): Promise<void> {
    await this.propertyMutationChain
    await this.pool.shutdown()
  }

  // ============================================================
  // Getters
  // ============================================================

  /** Current target pool size */
  get poolSize(): number {
    return this.pool.targetPoolSize
  }

  /** Current pool status snapshot */
  get poolStatus(): { size: number; idle: number; busy: number; queued: number } {
    return {
      size: this.pool.size,
      idle: this.pool.idleCount,
      busy: this.pool.busyCount,
      queued: this.pool.queueLength,
    }
  }
}
