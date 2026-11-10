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
// 'Acquire Pool Amount' / 'Release Pool Amount' with `amount_property`: the count comes from a
// property key. An Acquire reads it once, at the step's first resource attempt, and keeps it while
// the step waits (EngineState.resolvedAmounts); a bad count fails the step (TRY-catchable) with
// nothing held or queued. A Release reads it when it runs, releases all of it (floor at 0), and a
// bad count releases nothing and records an ERRORED trace row.
import { expect, test, describe } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { submitUserAction } from '../src/core/submit.js';
import { validate } from '../src/spec/validator.js';
import {
  workCenter, workflow, workflowInstance, stepInstance, traceEntry, stepRun,
  wcResource, wcResourceWaiter, wcResourceHolder,
} from 'mission-control-db/src/db/schema/index';
import type { SerializedResources } from '../src/core/resources.js';
import type { EngineState } from '../src/core/engine-state.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

async function makeWc(db: AnyDb): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  return wc;
}

async function seedQueuedIn(
  db: AnyDb, wc: { id: string }, spec: { oid: string }, runtimeNumber = 1,
): Promise<{ id: string; workCenterId: string }> {
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id };
}

async function seedQueued(db: AnyDb, spec: { oid: string }) {
  return seedQueuedIn(db, await makeWc(db), spec);
}

async function instanceRow(db: AnyDb, instanceId: string) {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

async function stepRow(db: AnyDb, instanceId: string, stepOid: string) {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: { stepOid: string }) => r.stepOid === stepOid);
}

async function traceOf(db: AnyDb, instanceId: string): Promise<{ stepOid: string | null; state: string; error: string | null }[]> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId));
  return rows.map((t: { stepOid: string | null; state: string; error: string | null }) => ({ stepOid: t.stepOid, state: t.state, error: t.error }));
}

async function setProperty(db: AnyDb, instanceId: string, key: string, value: string) {
  const row = await instanceRow(db, instanceId);
  await db.update(workflowInstance)
    .set({ propertyStore: { ...(row.propertyStore as Record<string, string>), [key]: value } })
    .where(eq(workflowInstance.id, instanceId));
}

/** The workflow-tier pool state for `key` ("<spec oid>:<name>") out of the persisted manager. */
function pool(engineState: EngineState, key: string): { inUse: number; queue: { stepOid: string; amount: number }[] } {
  const entry = (engineState.resources as SerializedResources).resources.find(([k]) => k === key);
  if (!entry) throw new Error(`no resource ${key}`);
  return entry[1] as unknown as { inUse: number; queue: { stepOid: string; amount: number }[] };
}

async function resourceRow(db: AnyDb, workCenterId: string, name: string) {
  const [row] = await db.select().from(wcResource)
    .where(and(eq(wcResource.workCenterId, workCenterId), eq(wcResource.name, name)));
  return row;
}

const orderCount = (value: string) => [{ name: 'Order', entries: [{ name: 'Count', value }] }];
const SLOTS = { name: 'Slots', resource_type: 'countable use with pool limits', use_limit: 5 };

// ── workflow tier ─────────────────────────────────────────────────────────────────────────────

test('workflow tier: Acquire Pool Amount takes its count from the property', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: 'wf-amt-acq', version: '1.0.0', last_modified_date: '2026-01-01',
    value_property_specifications: orderCount(' 3 '),
    resource_property_specifications: [SLOTS],
    steps: [
      step('s1', 'START'),
      step('ui', 'USER_INTERACTION', {
        resource_command_specifications: [
          { oid: 'cmd-acq', command_type: 'Acquire Pool Amount', resource_name: 'Slots', amount_property: 'Order.Count' },
        ],
      }),
      step('e1', 'END'),
    ],
    connections: [{ from_step_id: 's1', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'e1' }],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, testDeps());

  const mid = await instanceRow(db, wi.id);
  expect(mid.status).toBe('running');
  expect((await stepRow(db, wi.id, 'ui')).state).toBe('WAITING_USER');
  const state = mid.engineState as EngineState;
  expect(pool(state, 'wf-amt-acq:Slots').inUse).toBe(3); // trimmed " 3 "
  expect(state.resolvedAmounts).toEqual({}); // granted at once: nothing kept

  await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'submit' }, 0, testDeps());
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  await close();
});

test('workflow tier: a literal amount behaves as before', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: 'wf-amt-literal', version: '1.0.0', last_modified_date: '2026-01-01',
    resource_property_specifications: [SLOTS],
    steps: [
      step('s1', 'START'),
      step('ui', 'USER_INTERACTION', {
        resource_command_specifications: [{ command_type: 'Acquire Pool Amount', resource_name: 'Slots', amount: 4 }],
      }),
      step('rel', 'MATH', {
        resource_command_specifications: [{ command_type: 'Release Pool Amount', resource_name: 'Slots', amount: 1 }],
      }),
      step('e1', 'END'),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'rel' }, { from_step_id: 'rel', to_step_id: 'e1' },
    ],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, testDeps());
  expect(pool((await instanceRow(db, wi.id)).engineState as EngineState, 'wf-amt-literal:Slots').inUse).toBe(4);
  await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'submit' }, 0, testDeps());
  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  expect(pool(after.engineState as EngineState, 'wf-amt-literal:Slots').inUse).toBe(3);
  await close();
});

// 'holder' takes 4 of 5 and parks; 'waiter' asks for Order.Count (2) and queues. The property is
// then changed to 9 between transactions (every transaction reopens the context from the
// database, as after an engine restart). If the engine re-read the property it would ask for 9,
// which never fits a pool of 5; with the count kept from the first attempt it is granted 2.
const FROZEN_SPEC = {
  local_id: 'wf', oid: 'wf-amt-frozen', version: '1.0.0', last_modified_date: '2026-01-01',
  value_property_specifications: orderCount('2'),
  resource_property_specifications: [SLOTS],
  steps: [
    step('s1', 'START'),
    step('p1', 'PARALLEL'),
    step('holder', 'USER_INTERACTION', {
      resource_command_specifications: [
        { command_type: 'Acquire Pool Amount', resource_name: 'Slots', amount: 4 },
        { command_type: 'Release Pool Amount', resource_name: 'Slots', amount: 4 },
      ],
    }),
    step('waiter', 'SCRIPT', {
      script_config: { source: "output.w = 'done';" },
      output_parameter_specifications: [{ id: 'w', target: 'Result.W' }],
      resource_command_specifications: [
        { oid: 'cmd-wait', command_type: 'Acquire Pool Amount', resource_name: 'Slots', amount_property: 'Order.Count' },
      ],
    }),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'holder' },
    { from_step_id: 'p1', to_step_id: 'waiter' },
    { from_step_id: 'holder', to_step_id: 'wa' },
    { from_step_id: 'waiter', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
};

test('workflow tier: the count is kept from the first attempt while the step waits, and granted with it after a release', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, FROZEN_SPEC);
  await pumpUntilQuiet(db, testDeps());

  const mid = await instanceRow(db, wi.id);
  const state = mid.engineState as EngineState;
  expect((await stepRow(db, wi.id, 'waiter')).state).toBe('READY');
  expect(state.blockedOnResources['waiter']).toBeTruthy();
  expect(state.resolvedAmounts).toEqual({ waiter: { 'cmd-wait': 2 } }); // persisted in engine_state
  expect(pool(state, 'wf-amt-frozen:Slots')).toMatchObject({ inUse: 4, queue: [{ stepOid: 'waiter', amount: 2 }] });

  await setProperty(db, wi.id, 'Order.Count', '9');
  await pumpUntilQuiet(db, testDeps()); // a fresh pass over the still-blocked step changes nothing
  expect(pool((await instanceRow(db, wi.id)).engineState as EngineState, 'wf-amt-frozen:Slots').queue)
    .toEqual([{ stepOid: 'waiter', amount: 2 }]);

  await submitUserAction(db, wi.id, { step_oid: 'holder', action: 'submit' }, 0, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  expect(after.propertyStore).toMatchObject({ 'Result.W': 'done', 'Order.Count': '9' });
  const finalState = after.engineState as EngineState;
  expect(pool(finalState, 'wf-amt-frozen:Slots')).toMatchObject({ inUse: 2, queue: [] });
  expect(finalState.resolvedAmounts).toEqual({}); // cleared once granted
  await close();
});

test('workflow tier: a count above the capacity waits (unchanged behaviour)', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: 'wf-amt-over', version: '1.0.0', last_modified_date: '2026-01-01',
    value_property_specifications: orderCount('7'),
    resource_property_specifications: [SLOTS],
    steps: [
      step('s1', 'START'),
      step('grab', 'MATH', {
        resource_command_specifications: [
          { oid: 'cmd-over', command_type: 'Acquire Pool Amount', resource_name: 'Slots', amount_property: 'Order.Count' },
        ],
      }),
      step('e1', 'END'),
    ],
    connections: [{ from_step_id: 's1', to_step_id: 'grab' }, { from_step_id: 'grab', to_step_id: 'e1' }],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, testDeps());

  const row = await instanceRow(db, wi.id);
  expect(row.status).toBe('running');
  expect((await stepRow(db, wi.id, 'grab')).state).toBe('READY');
  expect((await traceOf(db, wi.id)).filter(t => t.stepOid === 'grab').map(t => t.state)).toEqual(['WAITING']);
  const state = row.engineState as EngineState;
  expect(pool(state, 'wf-amt-over:Slots')).toMatchObject({ inUse: 0, queue: [{ stepOid: 'grab', amount: 7 }] });
  expect(state.resolvedAmounts).toEqual({ grab: { 'cmd-over': 7 } });
  await close();
});

// 'pre' takes 2 Slots. 'grab' then has two activation commands — a literal Acquire of Other and a
// property-sourced Acquire of Slots — plus a declared Release of Slots. With a bad count the step
// fails before acquiring anything: Other stays free, nothing queues, and neither the catch-time
// release nor RETURN COMPLETE's dequeue-time release gives back the Slots 'pre' holds.
const badCountSpec = (oid: string, value: string | null) => ({
  local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
  value_property_specifications: value === null ? [] : orderCount(value),
  resource_property_specifications: [SLOTS, { name: 'Other', resource_type: 'countable use with pool limits', use_limit: 5 }],
  steps: [
    step('s1', 'START'),
    step('pre', 'MATH', {
      resource_command_specifications: [{ command_type: 'Acquire Pool Amount', resource_name: 'Slots', amount: 2 }],
    }),
    step('grab', 'SCRIPT', {
      script_config: { source: "output.g = 'ran';" },
      output_parameter_specifications: [{ id: 'g', target: 'Result.G' }],
      try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }],
      resource_command_specifications: [
        { command_type: 'Acquire Pool Amount', resource_name: 'Other', amount: 1 },
        { command_type: 'Acquire Pool Amount', resource_name: 'Slots', amount_property: 'Order.Count' },
        { command_type: 'Release Pool Amount', resource_name: 'Slots', amount: 1 },
      ],
    }),
    step('e1', 'END'),
    step('c1', 'CATCH', {
      catch_id: 'C1',
      output_parameter_specifications: [{ id: 'Message', target: 'Caught.Message' }, { id: 'Reason', target: 'Caught.Reason' }],
    }),
    step('r1', 'RETURN', { return_config: { command: 'COMPLETE' } }),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'pre' },
    { from_step_id: 'pre', to_step_id: 'grab' },
    { from_step_id: 'grab', to_step_id: 'e1' },
    { from_step_id: 'c1', to_step_id: 'r1' },
  ],
});

describe('an unusable Acquire count fails the step; a TRY catches it with nothing held or queued', () => {
  const cases: [string, string | null, string, string][] = [
    ['zero', '0', '0', 'Order.Count'],
    ['a fraction', '2.5', '2.5', 'Order.Count'],
    ['text', 'abc', 'abc', 'Order.Count'],
    ['a negative number', '-1', '-1', 'Order.Count'],
    ['blank', '  ', '  ', 'Order.Count'],
    ['a missing key', null, '', 'Order.Count'],
  ];
  test.each(cases)('%s', async (_label, value, raw, key) => {
    const { db, close } = await makeTestDb();
    const spec = badCountSpec(`wf-amt-bad-${Math.random().toString(36).slice(2, 8)}`, value);
    const wi = await seedQueued(db, spec);
    await pumpUntilQuiet(db, testDeps());

    const after = await instanceRow(db, wi.id);
    expect(after.status).toBe('completed'); // RETURN COMPLETE force-completes 'grab' and runs on to END
    const message = `Acquire of "Slots" could not use "${raw}" from ${key} as a count: it must be a whole number of at least 1`;
    expect(after.propertyStore).toMatchObject({ 'Caught.Message': message, 'Caught.Reason': 'ERROR' });
    expect((after.propertyStore as Record<string, string>)['Result.G']).toBeUndefined(); // the script never ran

    const state = after.engineState as EngineState;
    expect(pool(state, `${spec.oid}:Slots`)).toMatchObject({ inUse: 2, queue: [] }); // only 'pre's 2; no release ran
    expect(pool(state, `${spec.oid}:Other`)).toMatchObject({ inUse: 0, queue: [] }); // the other command never ran
    expect(state.blockedOnResources).toEqual({});
    expect(state.resolvedAmounts).toEqual({});
    expect(state.releasedOnCatch).toEqual({}); // set at catch, consumed by RETURN COMPLETE's dequeue

    const runs = await db.select().from(stepRun).where(eq(stepRun.workflowInstanceId, wi.id));
    expect(runs.find((r: { stepOid: string; result: string }) => r.stepOid === 'grab' && r.result === 'caught'))
      .toMatchObject({ error: message });
    await close();
  });
});

test('an unusable Acquire count with no TRY errors the workflow', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: 'wf-amt-uncaught', version: '1.0.0', last_modified_date: '2026-01-01',
    value_property_specifications: orderCount('two'),
    resource_property_specifications: [SLOTS],
    steps: [
      step('s1', 'START'),
      step('grab', 'MATH', {
        resource_command_specifications: [
          { command_type: 'Acquire Pool Amount', resource_name: 'Slots', amount_property: 'Order.Count' },
        ],
      }),
      step('e1', 'END'),
    ],
    connections: [{ from_step_id: 's1', to_step_id: 'grab' }, { from_step_id: 'grab', to_step_id: 'e1' }],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('errored');
  const message = 'Acquire of "Slots" could not use "two" from Order.Count as a count: it must be a whole number of at least 1';
  expect(await stepRow(db, wi.id, 'grab')).toMatchObject({ state: 'ERRORED', error: message });
  expect(await traceOf(db, wi.id)).toContainEqual({ stepOid: 'grab', state: 'ERRORED', error: message });
  expect(pool(after.engineState as EngineState, 'wf-amt-uncaught:Slots')).toMatchObject({ inUse: 0, queue: [] });
  await close();
});

// 'ui' takes 4 and parks; 'rel' then releases Order.Count when it runs (the property is set after
// the acquire, so the value read is the one at release time).
const releaseSpec = (oid: string) => ({
  local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
  value_property_specifications: orderCount('1'),
  resource_property_specifications: [SLOTS],
  steps: [
    step('s1', 'START'),
    step('ui', 'USER_INTERACTION', {
      resource_command_specifications: [{ command_type: 'Acquire Pool Amount', resource_name: 'Slots', amount: 4 }],
    }),
    step('rel', 'MATH', {
      resource_command_specifications: [
        { command_type: 'Release Pool Amount', resource_name: 'Slots', amount_property: 'Order.Count' },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'rel' }, { from_step_id: 'rel', to_step_id: 'e1' },
  ],
});

async function runRelease(value: string) {
  const { db, close } = await makeTestDb();
  const spec = releaseSpec(`wf-amt-rel-${Math.random().toString(36).slice(2, 8)}`);
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, testDeps());
  await setProperty(db, wi.id, 'Order.Count', value);
  await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'submit' }, 0, testDeps());
  const after = await instanceRow(db, wi.id);
  const trace = await traceOf(db, wi.id);
  await close();
  return { after, inUse: pool(after.engineState as EngineState, `${spec.oid}:Slots`).inUse, trace };
}

test('workflow tier: Release Pool Amount releases the count read when it runs', async () => {
  const { after, inUse } = await runRelease('3');
  expect(after.status).toBe('completed');
  expect(inUse).toBe(1);
});

test('workflow tier: a release count above what is held releases as asked (floors at 0)', async () => {
  const { after, inUse } = await runRelease('9');
  expect(after.status).toBe('completed');
  expect(inUse).toBe(0);
});

test('workflow tier: an unusable release count releases nothing and records an ERRORED trace row; the step still completes', async () => {
  const { after, inUse, trace } = await runRelease('2.5');
  expect(after.status).toBe('completed');
  expect(inUse).toBe(4);
  expect(trace.filter(t => t.stepOid === 'rel').map(t => t.state)).toEqual(['COMPLETED']);
  expect(trace).toContainEqual({
    stepOid: null, state: 'ERRORED',
    error: 'Step "rel": Release of "Slots" could not use "2.5" from Order.Count as a count: it must be a whole number of at least 1 — nothing was released',
  });
});

// ── shared environment tier ───────────────────────────────────────────────────────────────────

const ENV_SLOTS = {
  local_id: 'env-slots-lib', oid: 'env-slots', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'Slots', resource_type: 'countable use with pool limits', use_limit: 5 }],
};

async function seedSlots(db: AnyDb, workCenterId: string) {
  await db.insert(wcResource).values({ workCenterId, name: 'Slots', resourceType: 'countable use with pool limits', useLimit: 5 });
}

// Acquires Order.Count (env tier) in 'grab', then parks at 'ui' so the hold is visible.
const envGrabSpec = (oid: string, count: string, release: Record<string, unknown> | null = null) => ({
  local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_SLOTS],
  value_property_specifications: orderCount(count),
  steps: [
    step('s1', 'START'),
    step('grab', 'MATH', {
      resource_command_specifications: [
        { oid: 'cmd-env', command_type: 'Acquire Pool Amount', resource_name: 'Slots', resource_source_oid: 'env-slots', amount_property: 'Order.Count' },
        ...(release ? [{ command_type: 'Release Pool Amount', resource_name: 'Slots', resource_source_oid: 'env-slots', ...release }] : []),
      ],
    }),
    step('ui', 'USER_INTERACTION'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'grab' }, { from_step_id: 'grab', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'e1' },
  ],
});

test('environment tier: Acquire Pool Amount takes its count from the property; the holder row carries it', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await seedSlots(db, wc.id);
  const wi = await seedQueuedIn(db, wc, envGrabSpec('wf-env-amt', '3'));
  await pumpUntilQuiet(db, testDeps());

  expect((await stepRow(db, wi.id, 'ui')).state).toBe('WAITING_USER');
  const holders = await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, wi.id));
  expect(holders).toHaveLength(1);
  expect(holders[0]).toMatchObject({ name: 'Slots', stepOid: 'grab', amount: 3 });
  expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(3);
  expect(((await instanceRow(db, wi.id)).engineState as EngineState).envHolds)
    .toEqual([{ name: 'Slots', stepOid: 'grab', amount: 3, heldName: null }]);
  await close();
});

const ENV_HOLD4_SPEC = {
  local_id: 'wf', oid: 'wf-env-hold4', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_SLOTS],
  steps: [
    step('s1', 'START'),
    step('ui', 'USER_INTERACTION', {
      resource_command_specifications: [
        { command_type: 'Acquire Pool Amount', resource_name: 'Slots', resource_source_oid: 'env-slots', amount: 4 },
        { command_type: 'Release Pool Amount', resource_name: 'Slots', resource_source_oid: 'env-slots', amount: 4 },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [{ from_step_id: 's1', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'e1' }],
};

test('environment tier: a queued count is kept from the first attempt (waiter row) and granted with it after another run releases', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await seedSlots(db, wc.id);

  const a = await seedQueuedIn(db, wc, ENV_HOLD4_SPEC);
  await pumpUntilQuiet(db, testDeps()); // A holds 4 of 5, parked
  const b = await seedQueuedIn(db, wc, envGrabSpec('wf-env-amt-b', '2'), 2);
  await pumpUntilQuiet(db, testDeps()); // B asks for 2 — 4+2 > 5, so it queues

  const waiters = await db.select().from(wcResourceWaiter).where(eq(wcResourceWaiter.workCenterId, wc.id));
  expect(waiters).toHaveLength(1);
  expect(waiters[0]).toMatchObject({ instanceId: b.id, stepOid: 'grab', amount: 2, granted: false });
  expect(((await instanceRow(db, b.id)).engineState as EngineState).resolvedAmounts).toEqual({ grab: { 'cmd-env': 2 } });

  await setProperty(db, b.id, 'Order.Count', '5'); // would fit after A's release, but is not what B asked for

  await submitUserAction(db, a.id, { step_oid: 'ui', action: 'submit' }, 0, testDeps()); // A releases 4
  expect((await instanceRow(db, a.id)).status).toBe('completed');
  await pumpUntilQuiet(db, testDeps()); // B consumes its grant

  expect((await stepRow(db, b.id, 'ui')).state).toBe('WAITING_USER');
  const holders = await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, b.id));
  expect(holders).toHaveLength(1);
  expect(holders[0]).toMatchObject({ name: 'Slots', stepOid: 'grab', amount: 2 });
  expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(2);
  const bState = (await instanceRow(db, b.id)).engineState as EngineState;
  expect(bState.envHolds).toEqual([{ name: 'Slots', stepOid: 'grab', amount: 2, heldName: null }]);
  expect(bState.resolvedAmounts).toEqual({});
  await close();
});

test('environment tier: Release Pool Amount from a property releases that count and reconciles the hold', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await seedSlots(db, wc.id);
  // Acquire Order.Count (3) and release Order.Count (3) in the same step.
  const wi = await seedQueuedIn(db, wc, envGrabSpec('wf-env-amt-rel', '3', { amount_property: 'Order.Count' }));
  await pumpUntilQuiet(db, testDeps());

  expect((await stepRow(db, wi.id, 'ui')).state).toBe('WAITING_USER');
  expect(await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, wi.id))).toEqual([]);
  expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(0);
  expect(((await instanceRow(db, wi.id)).engineState as EngineState).envHolds).toEqual([]);
  await close();
});

test('environment tier: an unusable release count releases nothing and keeps the hold', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await seedSlots(db, wc.id);
  const spec = envGrabSpec('wf-env-amt-badrel', '3', { amount_property: 'Release.Count' });
  const wi = await seedQueuedIn(db, wc, spec);
  await pumpUntilQuiet(db, testDeps());

  expect((await stepRow(db, wi.id, 'ui')).state).toBe('WAITING_USER');
  const holders = await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, wi.id));
  expect(holders).toHaveLength(1);
  expect(holders[0]).toMatchObject({ name: 'Slots', stepOid: 'grab', amount: 3 });
  expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(3);
  expect(await traceOf(db, wi.id)).toContainEqual({
    stepOid: null, state: 'ERRORED',
    error: 'Step "grab": Release of "Slots" could not use "" from Release.Count as a count: it must be a whole number of at least 1 — nothing was released',
  });
  await close();
});

// ── load-time validator ───────────────────────────────────────────────────────────────────────

describe('validator: amount_property', () => {
  const specWith = (cmd: Record<string, unknown>) => ({
    local_id: 'wf', oid: 'wf-val', version: '1.0.0', last_modified_date: '2026-01-01',
    resource_property_specifications: [SLOTS],
    steps: [
      step('s1', 'START'),
      step('m', 'MATH', { resource_command_specifications: [{ resource_name: 'Slots', ...cmd }] }),
      step('e1', 'END'),
    ],
    connections: [{ from_step_id: 's1', to_step_id: 'm' }, { from_step_id: 'm', to_step_id: 'e1' }],
  });

  test.each(['Acquire Pool Amount', 'Release Pool Amount'])('%s accepts amount_property with no amount', (command_type) => {
    expect(validate(specWith({ command_type, amount_property: 'Order.Count' }))).toMatchObject({ valid: true });
  });

  test.each([
    ['a number', 5],
    ['an empty string', ''],
    ['a blank string', '   '],
    ['null', null],
  ])('rejects an amount_property that is %s', (_label, amount_property) => {
    expect(validate(specWith({ command_type: 'Acquire Pool Amount', amount_property })))
      .toMatchObject({ valid: false, error_code: 'INVALID_RESOURCE_COMMAND' });
  });

  test('literal amounts keep their checks', () => {
    expect(validate(specWith({ command_type: 'Acquire Pool Amount', amount: 2 }))).toMatchObject({ valid: true });
    expect(validate(specWith({ command_type: 'Acquire Pool Amount', amount: 0 })))
      .toMatchObject({ valid: false, error_code: 'INVALID_RESOURCE_COMMAND' });
    expect(validate(specWith({ command_type: 'Release Pool Amount' })))
      .toMatchObject({ valid: false, error_code: 'INVALID_RESOURCE_COMMAND' });
  });
});
