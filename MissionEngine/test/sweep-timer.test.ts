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
// Data-safety 3, Task 8: the sweep timer — first run ~5 s after start, then every 30 s, no overlap.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('../src/core/sweep.js', () => ({ runSweep: vi.fn() }));

import { runSweep } from '../src/core/sweep.js';
import { startSweepTimer } from '../src/loop.js';

const mocked = vi.mocked(runSweep);
const deps: any = { now: () => new Date() };

beforeEach(() => {
  vi.useFakeTimers();
  mocked.mockReset();
  mocked.mockResolvedValue(0);
});
afterEach(() => {
  vi.useRealTimers();
});

test('first sweep about 5 s after start', async () => {
  const stop = startSweepTimer({} as any, deps);
  await vi.advanceTimersByTimeAsync(4_999);
  expect(mocked).toHaveBeenCalledTimes(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(mocked).toHaveBeenCalledTimes(1);
  stop();
});

test('then every 30 s', async () => {
  const stop = startSweepTimer({} as any, deps);
  await vi.advanceTimersByTimeAsync(35_000);
  expect(mocked).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocked).toHaveBeenCalledTimes(3);
  stop();
});

test('a tick is skipped while a sweep runs', async () => {
  mocked.mockReturnValue(new Promise(() => {}));
  const stop = startSweepTimer({} as any, deps);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(mocked).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocked).toHaveBeenCalledTimes(1);
  stop();
});

test('stop clears the timers', async () => {
  const stop = startSweepTimer({} as any, deps);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(mocked).toHaveBeenCalledTimes(1);
  stop();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(mocked).toHaveBeenCalledTimes(1);
});

test('stop before the first run cancels it', async () => {
  const stop = startSweepTimer({} as any, deps);
  stop();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(mocked).toHaveBeenCalledTimes(0);
});

test('a sweep error is logged and the timer continues', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocked.mockRejectedValueOnce(new Error('boom'));
  const stop = startSweepTimer({} as any, deps);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(mocked).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocked).toHaveBeenCalledTimes(2);
  stop();
  log.mockRestore();
});
