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
 * Periodic instance retention sweep. `InstanceRepository.cleanup()` existed
 * since the first schema but nothing ever called it, so the
 * `instance_retention_hours` setting was inert. Runs on a timer that never
 * keeps the process alive (`unref`), reads the setting on every tick (console
 * edits apply on the next tick), and never throws out of the timer.
 * `0` disables the sweep.
 */
export interface RetentionSweepDeps {
  instanceRepo: { cleanup(retentionHours: number): Promise<number> }
  settingsRepo: { getNumericValue(key: string): Promise<number | null> }
  /** Tick period; default one hour. */
  intervalMs?: number
  log?: (message: string) => void
  logError?: (message: string) => void
}

export const DEFAULT_RETENTION_HOURS = 24
export const DEFAULT_SWEEP_INTERVAL_MS = 60 * 60 * 1000

export function startRetentionSweep(deps: RetentionSweepDeps): {
  runOnce(): Promise<number>
  stop(): void
} {
  const log = deps.log ?? ((m: string) => console.log(m))
  const logError = deps.logError ?? ((m: string) => console.error(m))

  const runOnce = async (): Promise<number> => {
    const hours =
      (await deps.settingsRepo.getNumericValue('instance_retention_hours')) ??
      DEFAULT_RETENTION_HOURS
    if (hours <= 0) return 0
    const deleted = await deps.instanceRepo.cleanup(hours)
    if (deleted > 0)
      log(`[retention] removed ${deleted} completed instance(s) older than ${hours}h`)
    return deleted
  }

  const timer = setInterval(() => {
    void runOnce().catch((err: unknown) => {
      logError(`[retention] sweep failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }, deps.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS)
  timer.unref()

  return { runOnce, stop: () => clearInterval(timer) }
}
