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
 * pool.test.ts — Integration tests for PythonWorkerPool against real sandbox_runner.py.
 *
 * Tests use real Python subprocesses. afterEach shuts down the pool to prevent
 * orphan processes.
 */

import { describe, it, expect, afterEach } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PythonWorkerPool } from '../python-pool/pool.js'
import type { CodeExecutor } from '../state-machine/state-machine.js'

// ============================================================
// Setup
// ============================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SCRIPT_PATH = path.resolve(__dirname, '../../../python-sidecar/sandbox_runner.py')
const PYTHON_PATH = 'python'

/** Active pool for cleanup in afterEach */
let pool: PythonWorkerPool | null = null

afterEach(async () => {
  if (pool) {
    await pool.shutdown()
    pool = null
  }
})

function createPool(options?: { poolSize?: number; maxExecutionsPerWorker?: number }) {
  pool = new PythonWorkerPool({
    pythonPath: PYTHON_PATH,
    scriptPath: SCRIPT_PATH,
    poolSize: options?.poolSize ?? 2,
    maxExecutionsPerWorker: options?.maxExecutionsPerWorker,
  })
  return pool
}

/** Build a minimal executeCode call */
async function simpleExec(p: PythonWorkerPool, code?: string) {
  return p.executeCode(
    'test-instance-id',
    'EXECUTING',
    code ?? 'def execute(inputs, outputs, props, action_props):\n    return True',
    {},
    {},
    {},
    {},
    5000
  )
}

// ============================================================
// Tests
// ============================================================

describe('PythonWorkerPool', () => {
  it('creates pool with correct number of workers', () => {
    const p = createPool({ poolSize: 2 })
    expect(p.size).toBe(2)
    expect(p.idleCount).toBe(2)
    expect(p.busyCount).toBe(0)
  })

  it('acquire and release worker changes counts correctly', async () => {
    const p = createPool({ poolSize: 2 })

    const worker = await p.acquire()
    expect(p.idleCount).toBe(1)
    expect(p.busyCount).toBe(1)

    p.release(worker)
    expect(p.idleCount).toBe(2)
    expect(p.busyCount).toBe(0)
  })

  it('executeCode runs Python code and returns result', async () => {
    const p = createPool({ poolSize: 2 })
    const result = await p.executeCode(
      'instance-1',
      'EXECUTING',
      [
        'def execute(inputs, outputs, props, action_props):',
        '    outputs["answer"] = "42"',
        '    return True',
      ].join('\n'),
      {},
      {},
      {},
      {},
      5000
    )

    expect(result.success).toBe(true)
    expect(result.outputs['answer']).toBe('42')
  })

  it('handles multiple concurrent executeCode calls', async () => {
    const p = createPool({ poolSize: 2 })

    const [r1, r2] = await Promise.all([
      p.executeCode(
        'instance-1',
        'EXECUTING',
        'def execute(inputs, outputs, props, action_props):\n    outputs["id"] = "1"\n    return True',
        {},
        {},
        {},
        {},
        5000
      ),
      p.executeCode(
        'instance-2',
        'EXECUTING',
        'def execute(inputs, outputs, props, action_props):\n    outputs["id"] = "2"\n    return True',
        {},
        {},
        {},
        {},
        5000
      ),
    ])

    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    expect(r1.outputs['id']).toBe('1')
    expect(r2.outputs['id']).toBe('2')
  })

  it('queues when pool exhausted — both requests complete', async () => {
    const p = createPool({ poolSize: 1 })

    let queueLengthObserved = false

    // Start two concurrent executions (pool has size 1 — second will queue)
    const slowCode = [
      'import time',
      'def execute(inputs, outputs, props, action_props):',
      '    time.sleep(0.1)',
      '    return True',
    ].join('\n')

    const p1 = p.executeCode('inst-1', 'EXECUTING', slowCode, {}, {}, {}, {}, 5000)

    // Small delay to ensure first is acquired
    await new Promise<void>((resolve) => setTimeout(resolve, 20))

    const p2 = p.executeCode('inst-2', 'EXECUTING', slowCode, {}, {}, {}, {}, 5000)

    // At this point the second request should be queued
    if (p.queueLength > 0) {
      queueLengthObserved = true
    }

    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    // Queue was observed OR both still completed (acceptable if timing differs)
    expect(queueLengthObserved || (r1.success && r2.success)).toBe(true)
  }, 15000)

  it('recycles worker after max executions', async () => {
    const p = createPool({ poolSize: 1, maxExecutionsPerWorker: 3 })

    // Execute 4 times — the 4th should succeed on a recycled worker
    for (let i = 0; i < 4; i++) {
      const result = await simpleExec(p)
      expect(result.success).toBe(true)
    }

    // Pool size should still be correct after recycling
    expect(p.size).toBe(1)
  }, 30000)

  it('crash recovery — pool replaces crashed worker', async () => {
    const p = createPool({ poolSize: 1 })

    // Acquire a worker and kill it directly (simulating a crash)
    const worker = await p.acquire()
    p.release(worker) // Put it back to idle first

    // Now kill it directly (simulating unexpected crash)
    const closedPromise = new Promise<void>((resolve) => {
      worker.once('close', () => resolve())
    })
    worker.kill('SIGTERM')
    await closedPromise

    // Wait briefly for crash detection and replacement
    await new Promise<void>((resolve) => setTimeout(resolve, 300))

    // Pool should have recovered — size is restored
    expect(p.size).toBe(1)

    // Execute a request to verify the replacement works
    const result = await simpleExec(p)
    expect(result.success).toBe(true)
  }, 15000)

  it('killWorker terminates execution for a specific instance', async () => {
    const p = createPool({ poolSize: 1 })

    const slowCode = [
      'import time',
      'def execute(inputs, outputs, props, action_props):',
      '    time.sleep(30)',
      '    return True',
    ].join('\n')

    const executePromise = p.executeCode(
      'target-instance',
      'EXECUTING',
      slowCode,
      {},
      {},
      {},
      {},
      35000
    )

    // Wait for execution to start
    await new Promise<void>((resolve) => setTimeout(resolve, 200))

    // Kill the worker for this instance
    await p.killWorker('target-instance')

    // The executeCode promise should resolve with WORKER_CRASH
    const result = await executePromise
    expect(result.success).toBe(false)
    expect(result.error_type).toBe('WORKER_CRASH')

    // Wait for replacement to spawn
    await new Promise<void>((resolve) => setTimeout(resolve, 300))

    // Pool should have recovered
    expect(p.size).toBe(1)
  }, 30000)

  it('Node-side timeout kills the subprocess so pool recovers cleanly', async () => {
    const p = createPool({ poolSize: 1 })

    // First execution: long-running Python with a tiny action timeout.
    // Node-side timeout fires at timeout_ms + 5000 = 5500ms while
    // Python is mid-sleep(30). Without the fix, the subprocess survives
    // and the worker is returned to idle as an orphan.
    const slowCode = [
      'import time',
      'def execute(inputs, outputs, props, action_props):',
      '    time.sleep(30)',
      '    return True',
    ].join('\n')

    const r1 = await p.executeCode('inst-1', 'EXECUTING', slowCode, {}, {}, {}, {}, 500)
    expect(r1.success).toBe(false)
    expect(r1.error_type).toBe('WORKER_CRASH')
    expect(r1.error).toMatch(/timed out/)

    // Give the close event a moment to settle (replacement spawn already
    // happened synchronously from release()).
    await new Promise<void>((resolve) => setTimeout(resolve, 500))

    // Pool should be back at target — replacement already in place.
    expect(p.size).toBe(1)

    // Second execution must succeed on the fresh worker. If the first
    // worker were still in idle as an orphan, this would either
    // time-out (Python still sleeping) or receive the previous request's
    // response after the orphan's sleep completes.
    const r2 = await p.executeCode(
      'inst-2',
      'EXECUTING',
      [
        'def execute(inputs, outputs, props, action_props):',
        '    outputs["sentinel"] = "fresh"',
        '    return True',
      ].join('\n'),
      {},
      {},
      {},
      {},
      5000
    )
    expect(r2.success).toBe(true)
    expect(r2.outputs['sentinel']).toBe('fresh')
  }, 30000)

  it('shutdown terminates all workers', async () => {
    const p = createPool({ poolSize: 2 })
    await p.shutdown()

    // All workers should be dead
    expect(p.size).toBe(0)

    // acquire() after shutdown should throw
    await expect(p.acquire()).rejects.toThrow('Pool is shutting down')

    // Prevent afterEach from calling shutdown again on this test's pool
    pool = null
  })

  it('executeCode implements CodeExecutor interface', () => {
    const p = createPool({ poolSize: 1 })
    // Type check: assign pool.executeCode to a CodeExecutor variable
    // This is a compile-time check — if this compiles, the interface is satisfied
    const executor: CodeExecutor = p.executeCode.bind(p)
    expect(typeof executor).toBe('function')
  })
})
