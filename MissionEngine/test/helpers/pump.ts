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
import { loadConfig } from '../../src/config.js';
import type { EngineDeps } from '../../src/config.js';
import { nullActionInvoker } from '../../src/actions/invoker.js';
import { runOnce } from '../../src/loop.js';
import type { Db } from '../../src/db.js';

/** Default test deps: the production script timeout, the parking action invoker (unused until
 *  Task 15), and a real clock — `now` is overridable per test so later tasks can fake time
 *  (wake_at math etc.).
 *
 *  P7 flake fix: this used to override SCRIPT_TIMEOUT_MS down to 200ms, which was a genuine,
 *  measured source of full-suite flake. `vm.runInNewContext`'s timeout is enforced by a V8
 *  WATCHDOG THREAD against WALL CLOCK, not CPU time — so when the fork gets descheduled under
 *  full-suite contention, a one-line script like `output.Sum = Text + '!'` blows a 200ms budget
 *  purely from waiting for a core. Instrumented under 24 CPU hogs on 16 cores, trivial scripts
 *  in this very suite measured 239/257/262/267/273/280/286ms and one genuinely tripped
 *  ("Script execution timed out after 200ms"). The resulting failures are silent and confusing,
 *  because a script failure is NOT reported as a script error by the assertions that break:
 *  at ROOT level failStep settles the instance 'errored', and inside a CHILD context it kills
 *  only that branch and leaves the parent parked forever (transition.ts's failStep, deliberate
 *  reference-faithful behavior) — so `expect(status).toBe('completed')` reports 'errored' or
 *  'running' with no hint that a script timed out. No test depends on the low value: the one
 *  test that genuinely exercises the vm timeout (test/step-handlers.test.ts, 'an infinite-loop
 *  script is rejected by the vm timeout') passes its own 200ms budget straight to
 *  executeScript() and never goes through these deps. */
export function testDeps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  return {
    config: loadConfig({ DATABASE_URL: 'unused', SCRIPT_TIMEOUT_MS: '5000' } as any),
    invoker: nullActionInvoker,
    now: () => new Date(),
    ...overrides,
  };
}

/** Loop runOnce until it reports idle (false), or `max` cycles as a runaway guard. Returns
 *  the number of cycles that did work. */
export async function pumpUntilQuiet(db: Db, deps: EngineDeps, max = 10_000): Promise<number> {
  let cycles = 0;
  while (cycles < max) {
    const didWork = await runOnce(db, deps);
    if (!didWork) break;
    cycles++;
  }
  return cycles;
}
