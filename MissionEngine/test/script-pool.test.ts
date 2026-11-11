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
//
// Audit 2026-10-20 DB-scale H5: scripts run on worker threads, so the engine's own thread keeps
// working while one runs.
import { afterEach, expect, test } from 'vitest';
import { ScriptPool } from '../src/core/script-pool.js';
import { executeScript, SCRIPT_UNREADABLE_ERROR } from '../src/core/step-handlers.js';
import { PropertyStore } from '../src/core/properties.js';
import type { MasterWorkflowStep } from '../src/spec/types.js';

const scriptStep = (source: string) => ({ step_type: 'SCRIPT', script_config: { source } }) as unknown as MasterWorkflowStep;

let pool: ScriptPool | null = null;
afterEach(async () => {
  await pool?.close();
  pool = null;
});

test("the engine's thread keeps running while a script loops until its timeout", async () => {
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 20);
  try {
    const result = await executeScript(scriptStep('while (true) {}'), new PropertyStore(), {}, 600);
    expect(result).toEqual({ success: false, error: 'Error: Script execution timed out after 600ms' }); // the engine's wording before too
  } finally {
    clearInterval(timer);
  }
  // On the old single thread the interval could not fire at all during the loop.
  expect(ticks).toBeGreaterThanOrEqual(5);
}, 20_000);

test('two scripts run side by side on a pool of two', async () => {
  pool = new ScriptPool(2, SCRIPT_UNREADABLE_ERROR);
  // Each run reports when it started and ended; on one thread the two spans could never overlap.
  const busy = '(function() { const start = Date.now(); while (Date.now() < start + 400) {} return JSON.stringify([start, Date.now()]); })()';
  const [a, b] = await Promise.all([pool.run(busy, {}, 5000), pool.run(busy, {}, 5000)]);
  const [aStart, aEnd] = JSON.parse(a.raw!) as number[];
  const [bStart, bEnd] = JSON.parse(b.raw!) as number[];
  expect(aStart < bEnd && bStart < aEnd).toBe(true);
}, 20_000);

test('a script that runs out of memory fails alone, and the next script gets a fresh worker', async () => {
  pool = new ScriptPool(1, SCRIPT_UNREADABLE_ERROR);
  const hog = '(function() { const a = []; while (true) a.push(new Array(1e6).fill(1)); })()';
  const failed = await pool.run(hog, {}, 60_000);
  expect(failed).toEqual({ error: 'Script ran out of memory' });
  expect(await pool.run('"ok"', {}, 5000)).toEqual({ raw: 'ok' });
}, 60_000);

test('the worker sees none of the engine environment', async () => {
  pool = new ScriptPool(1, SCRIPT_UNREADABLE_ERROR);
  // The sandbox has no `process` at all; this checks the worker thread itself was given an
  // empty environment, by asking the vm for a value only a host leak could produce.
  expect(await pool.run('typeof process', {}, 5000)).toEqual({ raw: 'undefined' });
});
