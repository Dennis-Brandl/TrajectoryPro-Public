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
 * pool.ts — PythonWorkerPool: N-worker manager with acquire/release semantics.
 *
 * Manages a pool of PythonWorker instances. Provides:
 *   - acquire/release with FIFO wait queue for pool exhaustion
 *   - Automatic crash recovery (replaces crashed workers)
 *   - Worker recycling after configurable maxExecutionsPerWorker (default 100)
 *   - killWorker(instanceId) for ABORT/STOP (terminates worker running specific instance)
 *   - executeCode() implementing the CodeExecutor interface from Plan 03-01
 *   - Graceful shutdown: terminates all workers
 */

import { randomUUID } from 'node:crypto'
import { PythonWorker } from './worker.js'
import { EngineError, PropertyWriteError } from '../errors.js'
import type { SidecarRequest } from './types.js'
import type { CodeExecutionResult } from '../state-machine/state-machine.js'

export interface PythonWorkerPoolOptions {
  pythonPath?: string
  scriptPath: string
  poolSize: number
  maxExecutionsPerWorker?: number
}

export class PythonWorkerPool {
  private readonly pythonPath: string
  private readonly scriptPath: string
  private _targetPoolSize: number
  private readonly maxExecutionsPerWorker: number

  private readonly idleWorkers: PythonWorker[] = []
  private readonly busyWorkers = new Set<PythonWorker>()
  private readonly waitQueue: Array<{ resolve: (worker: PythonWorker) => void }> = []
  private readonly activeExecutions = new Map<string, PythonWorker>()
  /**
   * Workers that crashed while busy — handleWorkerCrash already spawned
   * their replacement, so release() must NOT spawn a second one.
   */
  private readonly crashHandledWorkers = new Set<PythonWorker>()

  private isShuttingDown = false

  constructor(options: PythonWorkerPoolOptions) {
    this.pythonPath = options.pythonPath ?? 'python'
    this.scriptPath = options.scriptPath
    this._targetPoolSize = options.poolSize
    this.maxExecutionsPerWorker = options.maxExecutionsPerWorker ?? 100

    // Spawn initial workers
    for (let i = 0; i < this._targetPoolSize; i++) {
      const worker = this.spawnWorker()
      this.idleWorkers.push(worker)
    }
  }

  // ============================================================
  // Acquire / Release
  // ============================================================

  /**
   * Acquire an idle worker. If all workers are busy, queue until one is available.
   */
  async acquire(): Promise<PythonWorker> {
    if (this.isShuttingDown) {
      throw new Error('Pool is shutting down')
    }

    if (this.idleWorkers.length > 0) {
      const worker = this.idleWorkers.pop()!
      this.busyWorkers.add(worker)
      return worker
    }

    // All workers busy — queue and wait
    return new Promise<PythonWorker>((resolve) => {
      this.waitQueue.push({ resolve })
    })
  }

  /**
   * Release a worker back to the pool (or recycle it if over maxExecutionsPerWorker).
   */
  release(worker: PythonWorker): void {
    this.busyWorkers.delete(worker)

    // If crash handler already handled this worker (spawned a replacement),
    // do NOT spawn a second replacement — just clean up the tracking set.
    if (this.crashHandledWorkers.has(worker)) {
      this.crashHandledWorkers.delete(worker)
      return
    }

    // Drain check: if pool is over target size, dispose instead of returning to idle
    if (this.size > this._targetPoolSize) {
      if (!worker.isDead) {
        worker.dispose()
      }
      return
    }

    // Check if worker should be recycled (max executions reached or dead)
    if (worker.executionCount >= this.maxExecutionsPerWorker || worker.isDead) {
      // Kill old worker (if still alive)
      if (!worker.isDead) {
        worker.dispose()
      }
      // Spawn a replacement
      const replacement = this.spawnWorker()
      this.serveOrEnqueue(replacement)
      return
    }

    // Return to idle or serve queue
    this.serveOrEnqueue(worker)
  }

  // ============================================================
  // Internal: crash recovery and worker lifecycle
  // ============================================================

  /**
   * Called when a worker's subprocess exits unexpectedly.
   */
  private handleWorkerCrash(worker: PythonWorker): void {
    // Determine if this worker was idle or busy
    const idleIdx = this.idleWorkers.indexOf(worker)
    const wasBusy = this.busyWorkers.has(worker)

    if (idleIdx !== -1) {
      // Worker crashed while idle
      this.idleWorkers.splice(idleIdx, 1)
    } else if (wasBusy) {
      // Worker crashed while busy — mark it so release() knows not to spawn
      // a second replacement (executeCode's finally will call release() after
      // the pending execute() promise rejects)
      this.crashHandledWorkers.add(worker)
    }

    // Clean up any activeExecution tracking for this worker
    for (const [instanceId, w] of this.activeExecutions) {
      if (w === worker) {
        this.activeExecutions.delete(instanceId)
        break
      }
    }

    // Spawn a replacement unless shutting down or over target size after resize-down.
    // For a busy crashed worker, it's still in busyWorkers until release() removes it,
    // so we compare (size - 1) to account for the effective post-crash size.
    const effectiveSize = wasBusy ? this.size - 1 : this.size
    if (!this.isShuttingDown && effectiveSize < this._targetPoolSize) {
      const replacement = this.spawnWorker()
      // If there's a waiter, serve them; otherwise add to idle
      if (this.waitQueue.length > 0) {
        const waiter = this.waitQueue.shift()!
        this.busyWorkers.add(replacement)
        waiter.resolve(replacement)
      } else {
        this.idleWorkers.push(replacement)
      }
    }
  }

  /**
   * Spawn a new PythonWorker and wire up crash recovery.
   */
  private spawnWorker(): PythonWorker {
    const worker = new PythonWorker(this.pythonPath, this.scriptPath)
    worker.once('close', () => {
      this.handleWorkerCrash(worker)
    })
    return worker
  }

  /**
   * If there are waiters in the queue, give this worker to the first waiter.
   * Otherwise, add it to the idle pool.
   */
  private serveOrEnqueue(worker: PythonWorker): void {
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!
      this.busyWorkers.add(worker)
      waiter.resolve(worker)
    } else {
      this.idleWorkers.push(worker)
    }
  }

  // ============================================================
  // CodeExecutor bridge
  // ============================================================

  /**
   * Implements the CodeExecutor interface from Plan 03-01.
   * Acquires a worker, sends the request, maps the response to CodeExecutionResult.
   */
  async executeCode(
    instanceId: string,
    state: string,
    sourceCode: string,
    inputs: Record<string, string>,
    outputs: Record<string, string>,
    envProps: Record<string, unknown>,
    actionProps: Record<string, unknown>,
    timeoutMs: number
  ): Promise<CodeExecutionResult> {
    const worker = await this.acquire()

    const request: SidecarRequest = {
      request_id: randomUUID(),
      action_oid: '', // Populated by caller in Phase 4
      action_name: '',
      state,
      source_code: sourceCode,
      inputs,
      outputs,
      environment_action_properties: envProps as Record<string, Record<string, string>>,
      action_properties: actionProps as Record<string, Record<string, string>>,
      timeout_ms: timeoutMs,
    }

    // Track which worker is executing for this instance (for killWorker support)
    this.activeExecutions.set(instanceId, worker)

    try {
      const response = await worker.execute(request)

      // PROPERTY_WRITE_ERROR: sidecar reports a property persistence failure.
      // Surface as an EngineError rather than a silent execution failure.
      if (!response.success && response.error_type === 'PROPERTY_WRITE_ERROR') {
        throw new PropertyWriteError(response.error ?? 'Property write failed')
      }

      return {
        success: response.success,
        outputs: response.outputs,
        return_value: response.return_value,
        error: response.error,
        error_type: response.error_type,
        traceback: response.traceback,
        execution_time_ms: response.execution_time_ms,
        stdout_capture: response.stdout_capture,
        stderr_capture: response.stderr_capture,
        property_mutations: response.property_mutations ?? [],
        requested_commands: (response.requested_commands ?? []).map((c) => ({
          command: c.command,
          reason: c.reason ?? undefined,
        })),
      }
    } catch (err) {
      // Re-throw EngineErrors (e.g. PROPERTY_WRITE_ERROR) directly
      if (err instanceof EngineError) {
        throw err
      }
      // Worker crash or timeout — return WORKER_CRASH result
      const error = err instanceof Error ? err.message : 'Worker execution failed'
      return {
        success: false,
        outputs: {},
        return_value: null,
        error,
        error_type: 'WORKER_CRASH',
        execution_time_ms: 0,
        stdout_capture: '',
        stderr_capture: '',
      }
    } finally {
      this.activeExecutions.delete(instanceId)
      this.release(worker)
    }
  }

  // ============================================================
  // Kill worker for a specific instance (ABORT/STOP support)
  // ============================================================

  /**
   * Terminate the worker currently executing code for the given instanceId.
   * The executeCode() promise will reject with a WORKER_CRASH result.
   * The pool automatically spawns a replacement worker.
   */
  async killWorker(instanceId: string): Promise<void> {
    const worker = this.activeExecutions.get(instanceId)
    if (!worker) {
      // No active execution for this instance — no-op
      return
    }
    this.activeExecutions.delete(instanceId)
    await worker.killWithGrace()
  }

  // ============================================================
  // Graceful shutdown
  // ============================================================

  /**
   * Shut down the pool: reject all queued waiters, kill idle workers,
   * then wait for busy workers to finish before killing them.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true

    // Reject all waiters
    for (const waiter of this.waitQueue) {
      waiter.resolve = () => {
        // No-op — the Promise is never resolved; we must reject it
      }
    }
    this.waitQueue.length = 0

    // Kill all idle workers immediately
    for (const worker of [...this.idleWorkers]) {
      worker.dispose()
    }
    this.idleWorkers.length = 0

    // Wait for busy workers with a timeout, then kill remaining
    const busyList = [...this.busyWorkers]
    if (busyList.length > 0) {
      const shutdownTimeout = 10000
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, shutdownTimeout))
      const busyDone = Promise.all(
        busyList.map(
          (w) =>
            new Promise<void>((resolve) => {
              if (w.isDead) {
                resolve()
              } else {
                w.once('close', () => resolve())
              }
            })
        )
      )

      await Promise.race([busyDone, timeoutPromise])

      // Kill any remaining busy workers
      for (const worker of busyList) {
        if (!worker.isDead) {
          worker.dispose()
        }
      }
    }
  }

  // ============================================================
  // Runtime resize
  // ============================================================

  /**
   * Resize the pool to a new target size.
   * Growing: spawns new workers immediately.
   * Shrinking: kills idle workers immediately; busy workers drain naturally via release().
   *
   * No-op once shutdown() has been called: shutdown() kills every worker and
   * nothing reaps replacements spawned afterward, so a resize (e.g. a
   * late-resolving async caller like InstanceManager's settings-based pool-size
   * reconciliation) must never spawn new subprocesses post-shutdown. Guarding
   * here — rather than only at each call site — protects every caller.
   */
  resize(newSize: number): void {
    if (this.isShuttingDown) return
    if (newSize <= 0) throw new Error('Pool size must be at least 1')
    if (newSize === this._targetPoolSize) return

    const currentTotal = this.idleWorkers.length + this.busyWorkers.size

    if (newSize > currentTotal) {
      // Scale up: spawn new workers
      const toSpawn = newSize - currentTotal
      for (let i = 0; i < toSpawn; i++) {
        const worker = this.spawnWorker()
        this.serveOrEnqueue(worker)
      }
    } else if (newSize < currentTotal) {
      // Scale down: kill idle workers first; busy workers drain naturally
      let toKill = currentTotal - newSize
      while (toKill > 0 && this.idleWorkers.length > 0) {
        const worker = this.idleWorkers.pop()!
        worker.dispose()
        toKill--
      }
      // Remaining busy workers: handled by release() drain check
    }

    this._targetPoolSize = newSize
  }

  // ============================================================
  // Getters
  // ============================================================

  /** Total workers (idle + busy) */
  get size(): number {
    return this.idleWorkers.length + this.busyWorkers.size
  }

  get targetPoolSize(): number {
    return this._targetPoolSize
  }

  get idleCount(): number {
    return this.idleWorkers.length
  }

  get busyCount(): number {
    return this.busyWorkers.size
  }

  get queueLength(): number {
    return this.waitQueue.length
  }
}
