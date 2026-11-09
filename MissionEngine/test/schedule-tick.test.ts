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

// The engine's schedule timer (spec 2026-11-08 §6.1), end to end through the real worker cycle.
// PGlite has one connection; what two engines do at once is in real-pg.schedules.test.ts.

import { afterEach, expect, test, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import {
  runtimeHistory, runtimeSchedule, scheduleItemRun, workCenter, workflow, workflowInstance,
} from 'mission-control-db/src/db/schema/index';
import { createMasterSchedule } from 'mission-control-db/src/scheduling/master-dao';
import { enableMasterSchedule } from 'mission-control-db/src/scheduling/enable';
import { runScheduleTick } from 'mission-control-db/src/scheduling/tick';
import { loadConfig, type EngineDeps } from '../src/config.js';
import type { Db } from '../src/db.js';
import { startScheduleTimer } from '../src/schedule-tick.js';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';

const ENABLED_AT = new Date('2026-11-08T12:00:00Z');
const DUE = new Date('2026-11-09T08:00:00Z');
const actor = { kind: 'system' } as const;

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

const BLEND_SPEC = {
  local_id: 'Blend', oid: 'wf-blend', version: '1.0.0', last_modified_date: '2026-01-01',
  value_property_specifications: [{ name: 'Greeting', entries: [{ name: 'Text', value: '97' }] }],
  output_parameter_specifications: [{ id: 'Yield', target: 'Result.Yield' }],
  steps: [
    step('start', 'START'),
    step('calc', 'SCRIPT', {
      script_config: { source: "output.Yield = Text + '.5';" },
      input_parameter_specifications: [{ id: 'Text', default_value: 'Greeting.Text', value_type: 'property' }],
      output_parameter_specifications: [{ id: 'Yield', target: 'Result.Yield' }],
    }),
    step('end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'calc' },
    { from_step_id: 'calc', to_step_id: 'end' },
  ],
};

const PACK_SPEC = {
  local_id: 'Pack', oid: 'wf-pack', version: '1.0.0', last_modified_date: '2026-01-01',
  starting_parameter_specifications: [{ id: 'BlendYield', value_type: 'literal', default_value: '' }],
  steps: [step('start', 'START'), step('end', 'END')],
  connections: [{ from_step_id: 'start', to_step_id: 'end' }],
};

async function waitUntil(what: string, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting until ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('a slot fired through the timer runs, its chain starts with the output value, and both complete', async () => {
  const { db, close } = await makeTestDb();
  const anyDb = db as any;
  const stops: Array<() => void> = [];
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1', timeZone: 'UTC' }).returning();
    for (const [name, spec] of [['Blend', BLEND_SPEC], ['Pack', PACK_SPEC]] as const) {
      await db.insert(workflow).values({
        oid: spec.oid, name, workCenterId: wc!.id, version: '1.0.0', state: 'Effective', specJsonb: spec,
      });
    }
    const master = await createMasterSchedule(anyDb, wc!.id, {
      name: 'Nightly',
      recurrence: { type: 'once', at: '2026-11-09T08:00' },
      items: [{
        workflow: { name: 'Blend' },
        chain: [{
          workflow: { name: 'Pack' }, triggerOn: ['completed'],
          params: { BlendYield: { from: 'trigger.output', name: 'Yield' } },
        }],
      }],
    }, actor);
    const { runtime } = await enableMasterSchedule(anyDb, master.id, actor, ENABLED_AT);

    const base = testDeps({ now: () => DUE });
    const deps: EngineDeps = { ...base, config: { ...base.config, scheduleTickMs: 10 } };
    const instances = () => db.select().from(workflowInstance).orderBy(asc(workflowInstance.queuedAt));
    const finished = async (name: string) =>
      (await instances()).some((i) => i.masterName === name && i.status === 'completed');

    stops.push(startScheduleTimer(anyDb, deps));

    await waitUntil('the timer fires the slot', async () => (await instances()).length === 1);
    await pumpUntilQuiet(db, deps);
    expect(await finished('Blend')).toBe(true);

    await waitUntil('the timer starts the chain', async () => (await instances()).length === 2);
    await pumpUntilQuiet(db, deps);
    expect(await finished('Pack')).toBe(true);

    const pack = (await instances()).find((i) => i.masterName === 'Pack')!;
    expect(pack.startingParams).toEqual({ BlendYield: '97.5' });
    const [packHistory] = await db.select().from(runtimeHistory)
      .where(eq(runtimeHistory.workflowInstanceId, pack.id));
    expect(packHistory!.finalState).toBe('completed');

    // The Pack run's ending is seen by a later tick, and with nothing left the Runtime finishes.
    await waitUntil('the Runtime finishes', async () => {
      const [row] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, runtime.id));
      return row!.status === 'finished';
    });
    stops.pop()!();

    const before = {
      instances: (await instances()).length,
      itemRuns: await db.select().from(scheduleItemRun).orderBy(asc(scheduleItemRun.id)),
    };
    expect(await runScheduleTick(anyDb, DUE)).toEqual({ chains: 0, catchup: 0, fired: 0, lost: 0, finished: 0, recorded: 0 });
    expect((await instances()).length).toBe(before.instances);
    expect(await db.select().from(scheduleItemRun).orderBy(asc(scheduleItemRun.id))).toEqual(before.itemRuns);
  } finally {
    stops.forEach((stop) => stop());
    await close();
  }
});

/** A db whose first transaction call is all a tick gets to make: it shows when a tick begins. */
function stubDb(transaction: () => Promise<unknown>): Db {
  return { transaction } as unknown as Db;
}

const timerDeps = (env: Record<string, string> = {}): EngineDeps =>
  testDeps({ config: loadConfig({ DATABASE_URL: 'unused', ...env } as NodeJS.ProcessEnv) });

test('SCHEDULER_ENABLED=false does not start the timer', async () => {
  vi.useFakeTimers();
  const said = vi.spyOn(console, 'log').mockImplementation(() => {});
  const transaction = vi.fn(() => Promise.resolve());
  const stop = startScheduleTimer(stubDb(transaction), timerDeps({ SCHEDULER_ENABLED: 'false' }));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(transaction).not.toHaveBeenCalled();
  expect(said).toHaveBeenCalledTimes(1);
  expect(said.mock.calls[0]![0]).toContain('SCHEDULER_ENABLED=false');
  stop();
});

test('the timer ticks every 5 seconds by default, and stop stops it', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const transaction = vi.fn(() => Promise.reject(new Error('default interval probe')));
  const stop = startScheduleTimer(stubDb(transaction), timerDeps());

  await vi.advanceTimersByTimeAsync(4_999);
  expect(transaction).toHaveBeenCalledTimes(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(transaction).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(transaction).toHaveBeenCalledTimes(2);

  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(transaction).toHaveBeenCalledTimes(2);
});

test('SCHEDULE_TICK_MS sets the interval', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const transaction = vi.fn(() => Promise.reject(new Error('short interval probe')));
  const stop = startScheduleTimer(stubDb(transaction), timerDeps({ SCHEDULE_TICK_MS: '100' }));
  await vi.advanceTimersByTimeAsync(300);
  expect(transaction).toHaveBeenCalledTimes(3);
  stop();
});

test('a tick is skipped while the previous one is still running', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let finishTick: (err: Error) => void = () => {};
  const transaction = vi.fn(() => new Promise((_, reject) => { finishTick = reject; }));
  const stop = startScheduleTimer(stubDb(transaction), timerDeps());

  await vi.advanceTimersByTimeAsync(20_000);
  expect(transaction).toHaveBeenCalledTimes(1);

  finishTick(new Error('slow tick probe'));
  await vi.advanceTimersByTimeAsync(5_000);
  expect(transaction).toHaveBeenCalledTimes(2);
  stop();
});

test('a failing tick is logged once per distinct message, and the timer carries on', async () => {
  vi.useFakeTimers();
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  let message = 'schedule tick failure one';
  const transaction = vi.fn(() => Promise.reject(new Error(message)));
  const stop = startScheduleTimer(stubDb(transaction), timerDeps());

  await vi.advanceTimersByTimeAsync(15_000);
  expect(transaction).toHaveBeenCalledTimes(3);
  expect(logged).toHaveBeenCalledTimes(1);
  expect(logged.mock.calls[0]![0]).toBe('[mission-engine] schedule tick error: schedule tick failure one');

  message = 'schedule tick failure two';
  await vi.advanceTimersByTimeAsync(10_000);
  expect(transaction).toHaveBeenCalledTimes(5);
  expect(logged).toHaveBeenCalledTimes(2);
  expect(logged.mock.calls[1]![0]).toContain('schedule tick failure two');
  stop();
});
