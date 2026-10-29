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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { startRetentionSweep } from '../retention-sweep.js'

describe('startRetentionSweep', () => {
  afterEach(() => vi.useRealTimers())

  it('runs cleanup with the configured retention on every tick', async () => {
    vi.useFakeTimers()
    const cleanup = vi.fn(async () => 3)
    const getNumericValue = vi.fn(async () => 12)
    const log = vi.fn()
    const sweep = startRetentionSweep({
      instanceRepo: { cleanup },
      settingsRepo: { getNumericValue },
      intervalMs: 1000,
      log,
    })
    await vi.advanceTimersByTimeAsync(2500)
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(cleanup).toHaveBeenCalledWith(12)
    expect(getNumericValue).toHaveBeenCalledWith('instance_retention_hours')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('3'))
    sweep.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('falls back to 24 hours when the setting is unset and stays quiet when nothing was deleted', async () => {
    const cleanup = vi.fn(async () => 0)
    const log = vi.fn()
    const sweep = startRetentionSweep({
      instanceRepo: { cleanup },
      settingsRepo: { getNumericValue: async () => null },
      intervalMs: 60_000,
      log,
    })
    expect(await sweep.runOnce()).toBe(0)
    expect(cleanup).toHaveBeenCalledWith(24)
    expect(log).not.toHaveBeenCalled()
    sweep.stop()
  })

  it('is disabled by a retention setting of 0: cleanup is never called', async () => {
    const cleanup = vi.fn(async () => 0)
    const log = vi.fn()
    const sweep = startRetentionSweep({
      instanceRepo: { cleanup },
      settingsRepo: { getNumericValue: async () => 0 },
      intervalMs: 60_000,
      log,
    })
    expect(await sweep.runOnce()).toBe(0)
    expect(cleanup).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    sweep.stop()
  })

  it('never throws out of the timer when cleanup fails', async () => {
    vi.useFakeTimers()
    const error = vi.fn()
    const sweep = startRetentionSweep({
      instanceRepo: {
        cleanup: async () => {
          throw new Error('db down')
        },
      },
      settingsRepo: { getNumericValue: async () => 24 },
      intervalMs: 1000,
      log: () => undefined,
      logError: error,
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('db down'))
    sweep.stop()
  })
})
