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
// Follow-up fix (spec 2026-09-05, task-2 review): startActionMonitoring's only await is now a
// live DB read (ActionClient.isAllowed -> the policy source), and its only caller (loop.ts)
// invokes it as a bare fire-and-forget `void startActionMonitoring(...)` with nothing to attach
// a `.catch` to. A rejecting policy read must therefore never escape this function — it must be
// caught, logged, and the function must resolve (skipping the SSE fast path; the durable poll
// path in loop.ts is the correctness backstop).
//
// Round-1 review finding: making the policy check async opened a close-then-register window —
// a concurrent closeMonitoring (operator ABORT / loop.ts timeout) arriving while the DB round
// trip is in flight used to find nothing registered yet, so the LATE registerSseHandle call
// after the await would install a subscription for an already-torn-down step (a leaked
// activeSubscriptions entry + an open HTTP event stream). Covered below by simulating exactly
// that interleaving with a manually-resolved policy promise.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { startActionMonitoring, closeMonitoring, hasActiveSubscription } from '../src/actions/monitor.js';
import { ActionClient } from '../src/actions/client.js';
import { testDeps } from './helpers/pump.js';
import type { Db } from '../src/db.js';
import type { ActionServerPolicy } from 'mission-control-db/src/dao/system-settings';

afterEach(() => { vi.restoreAllMocks(); });

describe('startActionMonitoring never rejects on a failed policy read (spec 2026-09-05 follow-up)', () => {
  it('a rejecting policy source is caught, logged, and the function resolves', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new ActionClient(async () => { throw new Error('db down'); }, vi.fn());
    const deps = testDeps({});
    // The function must return (via the catch below) before ever touching db or deps for
    // anything beyond passing them through to subscribeSse's callback closure — which is never
    // reached here, since the policy read throws before subscribeSse is ever called.
    const db = {} as unknown as Db;

    await expect(startActionMonitoring(db, deps, client, 'step-1', 'http://x:1', 'ai-1')).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toContain('policy read failed');
    expect(errorSpy.mock.calls[0]![0]).toContain('step-1');
    expect(errorSpy.mock.calls[0]![0]).toContain('db down');
    expect(hasActiveSubscription('step-1')).toBe(false);
  });

  it('isAllowed false skips subscribe without logging an error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // strict trust, empty allowlist -> isAllowed resolves false without throwing.
    const client = new ActionClient([], vi.fn());
    const deps = testDeps({});
    const db = {} as unknown as Db;

    await expect(startActionMonitoring(db, deps, client, 'step-3', 'http://y:1', 'ai-3')).resolves.toBeUndefined();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(hasActiveSubscription('step-3')).toBe(false);
  });

  it('a closeMonitoring during the policy read prevents the late registration', async () => {
    let resolvePolicy!: (policy: ActionServerPolicy) => void;
    const policyPromise = new Promise<ActionServerPolicy>((resolve) => { resolvePolicy = resolve; });
    // Never resolves until the test explicitly calls resolvePolicy below — simulates the DB
    // round trip still being in flight when the teardown races in.
    const client = new ActionClient(() => policyPromise, vi.fn());
    const deps = testDeps({});
    const db = {} as unknown as Db;

    const pending = startActionMonitoring(db, deps, client, 'step-2', 'http://x:1', 'ai-2');
    // registerSseHandle's placeholder is installed synchronously before the policy read's
    // await, so the slot already exists here even without yielding — asserted for clarity.
    expect(hasActiveSubscription('step-2')).toBe(true);

    // The race: an operator ABORT / loop.ts timeout tears the step down WHILE the policy read
    // is still in flight.
    closeMonitoring('step-2');
    expect(hasActiveSubscription('step-2')).toBe(false);

    // The policy read finally comes back — allowed — well after the teardown.
    resolvePolicy({ trust: 'strict', allowlist: ['http://x:1'] });
    await pending;

    // The fix under test: no late registration reopens the slot for an already-torn-down step.
    expect(hasActiveSubscription('step-2')).toBe(false);
  });
});
