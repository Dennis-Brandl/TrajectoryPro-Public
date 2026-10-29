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
 * worker.test.ts — Integration tests for PythonWorker against real sandbox_runner.py.
 *
 * These tests spawn actual Python subprocesses. Each test creates its own worker
 * and disposes it after. afterEach kills any remaining workers.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PythonWorker } from '../python-pool/worker.js'
import type { SidecarRequest } from '../python-pool/types.js'

// ============================================================
// Setup: paths and helpers
// ============================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Resolve path to sandbox_runner.py
// Test file is at packages/engine/src/__tests__/worker.test.ts
// sandbox_runner.py is at packages/python-sidecar/sandbox_runner.py
// Relative: ../../../python-sidecar/sandbox_runner.py
const SCRIPT_PATH = path.resolve(__dirname, '../../../python-sidecar/sandbox_runner.py')

// Python binary — python works on Windows, python3 on Linux/macOS
const PYTHON_PATH = 'python'

/** Tracked workers for cleanup */
const activeWorkers: PythonWorker[] = []

function createWorker(): PythonWorker {
  const worker = new PythonWorker(PYTHON_PATH, SCRIPT_PATH)
  activeWorkers.push(worker)
  return worker
}

afterEach(async () => {
  // Kill any workers that weren't explicitly cleaned up
  for (const worker of activeWorkers) {
    if (!worker.isDead) {
      await worker.killWithGrace(1000)
    }
    worker.dispose()
  }
  activeWorkers.length = 0
})

/** Build a valid SidecarRequest with sensible defaults */
function makeRequest(overrides?: Partial<SidecarRequest>): SidecarRequest {
  return {
    request_id: randomUUID(),
    action_oid: 'test-action',
    action_name: 'Test Action',
    state: 'EXECUTING',
    source_code: 'def execute(inputs, outputs, props, action_props):\n    return True',
    inputs: {},
    outputs: {},
    environment_action_properties: {},
    action_properties: {},
    timeout_ms: 5000,
    ...overrides,
  }
}

// ============================================================
// Tests
// ============================================================

describe('PythonWorker', () => {
  it('creates a worker and executes a simple request', async () => {
    const worker = createWorker()
    const request = makeRequest()
    const response = await worker.execute(request)

    expect(response.success).toBe(true)
    expect(response.return_value).toBe(true)
    expect(response.request_id).toBe(request.request_id)
    expect(response.execution_time_ms).toBeGreaterThanOrEqual(0)
  })

  it('captures outputs from user code', async () => {
    const worker = createWorker()
    const response = await worker.execute(
      makeRequest({
        source_code: [
          'def execute(inputs, outputs, props, action_props):',
          '    outputs["result"] = "42"',
          '    return True',
        ].join('\n'),
      })
    )

    expect(response.success).toBe(true)
    expect(response.outputs['result']).toBe('42')
  })

  it('captures stdout from print()', async () => {
    const worker = createWorker()
    const response = await worker.execute(
      makeRequest({
        source_code: [
          'def execute(inputs, outputs, props, action_props):',
          '    print("hello")',
          '    return True',
        ].join('\n'),
      })
    )

    expect(response.success).toBe(true)
    expect(response.stdout_capture).toContain('hello')
  })

  it('returns SYNTAX_ERROR for invalid Python', async () => {
    const worker = createWorker()
    const response = await worker.execute(
      makeRequest({
        source_code: 'def execute(x\n    return True',
      })
    )

    expect(response.success).toBe(false)
    expect(response.error_type).toBe('SYNTAX_ERROR')
  })

  it('returns RUNTIME_ERROR for exceptions in user code', async () => {
    const worker = createWorker()
    const response = await worker.execute(
      makeRequest({
        source_code: [
          'def execute(inputs, outputs, props, action_props):',
          '    raise ValueError("bad")',
        ].join('\n'),
      })
    )

    expect(response.success).toBe(false)
    expect(response.error_type).toBe('RUNTIME_ERROR')
    expect(response.error).toContain('ValueError')
  })

  it('handles multiple sequential requests on same worker', async () => {
    const worker = createWorker()

    for (let i = 0; i < 3; i++) {
      const response = await worker.execute(
        makeRequest({
          source_code: [
            'def execute(inputs, outputs, props, action_props):',
            `    outputs["iter"] = "${i}"`,
            '    return True',
          ].join('\n'),
        })
      )
      expect(response.success).toBe(true)
      expect(response.outputs['iter']).toBe(String(i))
    }

    expect(worker.executionCount).toBe(3)
  })

  it('isDead reports true after kill', async () => {
    const worker = createWorker()

    // Wait for the worker's close event
    const closedPromise = new Promise<void>((resolve) => {
      worker.once('close', () => resolve())
    })

    worker.kill('SIGTERM')
    await closedPromise

    expect(worker.isDead).toBe(true)
  })

  it('execute on dead worker throws', async () => {
    const worker = createWorker()

    const closedPromise = new Promise<void>((resolve) => {
      worker.once('close', () => resolve())
    })

    worker.kill('SIGTERM')
    await closedPromise

    await expect(worker.execute(makeRequest())).rejects.toThrow('Cannot execute on a dead worker')
  })

  it('killWithGrace terminates worker', async () => {
    const worker = createWorker()
    await worker.killWithGrace(2000)
    expect(worker.isDead).toBe(true)
  }, 10000)

  it('pending promise rejects when worker crashes mid-execution', async () => {
    const worker = createWorker()

    const executePromise = worker.execute(
      makeRequest({
        source_code: [
          'import time',
          'def execute(inputs, outputs, props, action_props):',
          '    time.sleep(30)',
          '    return True',
        ].join('\n'),
        timeout_ms: 30000,
      })
    )

    // Give the subprocess a moment to start executing
    await new Promise<void>((resolve) => setTimeout(resolve, 200))

    // Kill the worker mid-execution
    worker.kill('SIGTERM')

    // The pending execute() promise should reject
    await expect(executePromise).rejects.toThrow()
  }, 30000)

  const crashSource = (note: string) =>
    [
      'import sys, os',
      'def execute(inputs, outputs, props, action_props):',
      `    sys.__stderr__.write(${JSON.stringify(note)})`,
      '    sys.__stderr__.flush()',
      '    os._exit(3)',
    ].join('\n')

  it('a crash error includes the end of the sidecar stderr', async () => {
    const worker = createWorker()
    const err = await worker
      .execute(
        makeRequest({ source_code: crashSource('FATAL: disk on fire\n'), timeout_ms: 10000 })
      )
      .then(
        () => new Error('did not reject'),
        (e: Error) => e
      )
    expect(err.message).toContain('exit code 3')
    expect(err.message).toContain('FATAL: disk on fire')
  }, 20000)

  it('stderr from an earlier request does not leak into a later crash', async () => {
    const worker = createWorker()
    const first = await worker.execute(
      makeRequest({
        source_code: [
          'import sys',
          'def execute(inputs, outputs, props, action_props):',
          "    sys.__stderr__.write('OLD NOISE\\n')",
          '    sys.__stderr__.flush()',
          '    return True',
        ].join('\n'),
        timeout_ms: 10000,
      })
    )
    expect(first.success).toBe(true)
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    const err = await worker
      .execute(
        makeRequest({ source_code: crashSource('FATAL: disk on fire\n'), timeout_ms: 10000 })
      )
      .then(
        () => new Error('did not reject'),
        (e: Error) => e
      )
    expect(err.message).toContain('FATAL: disk on fire')
    expect(err.message).not.toContain('OLD NOISE')
  }, 20000)
})
