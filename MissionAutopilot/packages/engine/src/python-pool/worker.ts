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
 * worker.ts — PythonWorker: single Python subprocess wrapper.
 *
 * Manages one sandbox_runner.py subprocess. Communication is via
 * stdin (JSON request line) and stdout (JSON response line), using
 * node:readline to split the subprocess stdout into lines.
 *
 * Lifecycle:
 *   - Constructor spawns the process immediately.
 *   - execute() sends one request and awaits one response (only one at a time).
 *   - kill() / killWithGrace() terminate the subprocess.
 *   - 'close' event is emitted when the subprocess exits (for pool crash recovery).
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Interface as ReadlineInterface } from 'node:readline'
import { EventEmitter } from 'node:events'
import type { SidecarRequest, SidecarResponse } from './types.js'

/** Max bytes to buffer from subprocess stderr for diagnostics */
const MAX_STDERR_BYTES = 64 * 1024

export class PythonWorker extends EventEmitter {
  private readonly process: ChildProcess
  private readonly rl: ReadlineInterface

  private pendingResolve?: (result: SidecarResponse) => void
  private pendingReject?: (err: Error) => void
  private timeoutHandle?: ReturnType<typeof setTimeout>

  private _isDead = false
  private _isBusy = false
  private _executionCount = 0
  private stderrBuffer = ''

  constructor(pythonPath: string = 'python', scriptPath: string) {
    super()

    // Spawn python -u sandbox_runner.py with piped stdio
    this.process = spawn(pythonPath, ['-u', scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Set up readline on stdout for line-by-line JSON parsing
    this.rl = createInterface({ input: this.process.stdout! })

    // Handle each line from the subprocess (should be one JSON response)
    this.rl.on('line', (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return

      if (this.pendingResolve && this.pendingReject) {
        // Clear timeout
        if (this.timeoutHandle !== undefined) {
          clearTimeout(this.timeoutHandle)
          this.timeoutHandle = undefined
        }

        const resolve = this.pendingResolve
        const reject = this.pendingReject
        this.pendingResolve = undefined
        this.pendingReject = undefined

        try {
          const response = JSON.parse(trimmed) as SidecarResponse
          resolve(response)
        } catch {
          reject(new Error(`Failed to parse worker response: ${trimmed}`))
        }
      }
    })

    // Handle spawn errors (e.g. python binary not found)
    this.process.on('error', (err: Error) => {
      this._isDead = true
      if (this.timeoutHandle !== undefined) {
        clearTimeout(this.timeoutHandle)
        this.timeoutHandle = undefined
      }
      if (this.pendingReject) {
        const reject = this.pendingReject
        this.pendingResolve = undefined
        this.pendingReject = undefined
        reject(err)
      }
    })

    // Handle subprocess exit (expected on close or crash)
    this.process.on('close', (code: number | null) => {
      this._isDead = true
      if (this.timeoutHandle !== undefined) {
        clearTimeout(this.timeoutHandle)
        this.timeoutHandle = undefined
      }
      if (this.pendingReject) {
        const reject = this.pendingReject
        this.pendingResolve = undefined
        this.pendingReject = undefined
        reject(new Error(`Worker crashed with exit code ${code}${this.stderrBlock()}`))
      }
      // Emit 'close' so the pool can detect the crash and spawn a replacement
      this.emit('close', code)
    })

    // Collect stderr for diagnostics (capped at 64KB)
    this.process.stderr!.on('data', (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString()
      if (this.stderrBuffer.length > MAX_STDERR_BYTES) {
        this.stderrBuffer = this.stderrBuffer.slice(-MAX_STDERR_BYTES)
      }
    })
  }

  // ============================================================
  // Execute
  // ============================================================

  /**
   * Send a request to the Python subprocess and wait for a response.
   * Only one request can be in flight at a time.
   */
  async execute(request: SidecarRequest): Promise<SidecarResponse> {
    if (this._isDead) {
      throw new Error('Cannot execute on a dead worker')
    }
    if (this._isBusy) {
      throw new Error('Worker is already executing')
    }

    this._isBusy = true
    // Only stderr written during this request may appear in its error
    this.stderrBuffer = ''

    try {
      return await new Promise<SidecarResponse>((resolve, reject) => {
        this.pendingResolve = resolve
        this.pendingReject = reject

        // Skip timeout entirely when timeout is 0 (disabled)
        if (request.timeout_ms > 0) {
          const nodeTimeoutMs = request.timeout_ms + 5000
          this.timeoutHandle = setTimeout(() => {
            this.timeoutHandle = undefined
            if (this.pendingReject) {
              // Mark dead BEFORE release() can run so the pool takes the
              // recycle path (worker.isDead === true) and spawns a fresh
              // replacement. Without this, the subprocess survives in the
              // background (e.g. mid time.sleep), the worker returns to
              // idle, and the next acquire picks an orphan that won't
              // process new requests until the previous call completes
              // — corrupting both timing and response/request pairing.
              this._isDead = true
              try {
                this.process.kill('SIGKILL')
              } catch {
                // Process may already be dead
              }
              const rejectFn = this.pendingReject
              this.pendingResolve = undefined
              this.pendingReject = undefined
              rejectFn(new Error(`Worker timed out after ${nodeTimeoutMs}ms${this.stderrBlock()}`))
            }
          }, nodeTimeoutMs)
        }

        // Write JSON request to subprocess stdin
        const line = JSON.stringify(request) + '\n'
        this.process.stdin!.write(line)
        this._executionCount++
      })
    } finally {
      this._isBusy = false
    }
  }

  /**
   * The last maxBytes of stderr collected since the current execute() began.
   */
  stderrTail(maxBytes = 4096): string {
    const bytes = Buffer.from(this.stderrBuffer, 'utf8')
    if (bytes.length <= maxBytes) return this.stderrBuffer
    // Cutting mid-character leaves a replacement char at the start; drop it.
    return bytes
      .subarray(bytes.length - maxBytes)
      .toString('utf8')
      .replace(/^�+/, '')
  }

  private stderrBlock(): string {
    const tail = this.stderrTail()
    return tail
      ? `
--- worker stderr (last 4 KiB) ---
${tail}`
      : ''
  }

  // ============================================================
  // Termination
  // ============================================================

  /**
   * Send a signal to the subprocess immediately.
   */
  kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    this.process.kill(signal)
  }

  /**
   * Send SIGTERM, then SIGKILL after gracePeriodMs if the process is still alive.
   * Waits for the 'close' event before resolving.
   *
   * Note: On Windows, SIGTERM behaves like SIGKILL. Production is Linux.
   */
  async killWithGrace(gracePeriodMs = 5000): Promise<void> {
    if (this._isDead) return

    return new Promise<void>((resolve) => {
      // Listen for close before sending signal (race safety)
      const onClose = () => {
        clearTimeout(killTimer)
        resolve()
      }

      this.once('close', onClose)

      // Send SIGTERM first
      try {
        this.process.kill('SIGTERM')
      } catch {
        // Process may already be dead
        this.removeListener('close', onClose)
        resolve()
        return
      }

      // Schedule SIGKILL after grace period
      const killTimer = setTimeout(() => {
        if (!this._isDead) {
          try {
            this.process.kill('SIGKILL')
          } catch {
            // Already dead, no-op
          }
        }
      }, gracePeriodMs)
    })
  }

  // ============================================================
  // Getters
  // ============================================================

  get isDead(): boolean {
    return this._isDead
  }

  get isBusy(): boolean {
    return this._isBusy
  }

  get executionCount(): number {
    return this._executionCount
  }

  get pid(): number | undefined {
    return this.process.pid
  }

  // ============================================================
  // Cleanup
  // ============================================================

  /**
   * Dispose this worker: close the readline interface and kill the process.
   */
  dispose(): void {
    this.rl.close()
    if (!this._isDead) {
      try {
        this.process.kill('SIGTERM')
      } catch {
        // Already dead
      }
    }
    this.removeAllListeners()
  }
}
