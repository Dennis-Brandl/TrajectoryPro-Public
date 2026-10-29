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
// Phase 4a, delta D12: an operator's cancel is delivered IN BAND. The verb deletes the waiter
// row and wakes the instance; the instance's own next processReadyStep finds its token in no
// queue and no pendingGrants and fails the step through failStep — so a TRY of mode ERROR
// catches it like any other failure, and nothing ever locks two instances at once.
//
// The fourth test pins the SIBLING half (plan Ruling P3): the environment-tier Release is
// LEDGER-GUARDED. `release-holder` / `reset` delete another instance's holder row and hand the
// freed unit on; that former holder's own declared Release must then NOT decrement a counter
// somebody else's hold now backs.
import { expect, test } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { submitUserAction } from '../src/core/submit.js';
import { openContext } from '../src/core/context.js';
import {
  workCenter, workflow, workflowInstance, stepInstance, traceEntry,
  wcResource, wcResourceWaiter, wcResourceHolder,
} from 'mission-control-db/src/db/schema/index';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

// `work_center` has no `path` column (the writeback fixtures pass one anyway — a phantom key
// drizzle drops silently because `db` is typed `any`); this file inserts only real columns.
async function makeWc(db: AnyDb): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}` }).returning();
  return wc;
}

async function seedQueuedIn(db: AnyDb, wc: { id: string }, spec: unknown, oid: string, runtimeNumber = 1) {
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id as string, workCenterId: wc.id };
}

const ENV_PRINTER = {
  local_id: 'env-printer-lib', oid: 'env-printer', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'Printer', resource_type: 'binary exclusive use' }],
};

// Acquires Printer then parks at a USER_INTERACTION without releasing — the holder.
const ACQUIRE_PARK_SPEC = {
  local_id: 'wf', oid: 'wf-acquire-park', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  steps: [
    step('s1', 'START'),
    step('ui', 'USER_INTERACTION', { resource_command_specifications: [
      { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
    ] }),
    step('e1', 'END'),
  ],
  connections: [{ from_step_id: 's1', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'e1' }],
};

// Same, but 'ui' ALSO releases on completion — so a single submitUserAction drives the release
// in a transaction of its own. Copied from env-resources-writeback.test.ts (Ruling P3 needs it).
const ACQUIRE_RELEASE_PARK_SPEC = {
  local_id: 'wf', oid: 'wf-acquire-release-park', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  steps: [
    step('s1', 'START'),
    step('ui', 'USER_INTERACTION', { resource_command_specifications: [
      { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
      { command_type: 'Release', resource_name: 'Printer', resource_source_oid: 'env-printer' },
    ] }),
    step('e1', 'END'),
  ],
  connections: [{ from_step_id: 's1', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'e1' }],
};

// Ruling P3b's cross-step shape: the Acquire and the Release sit on DIFFERENT steps, with a
// park in between. Structurally indistinguishable from env-resource-routing.test.ts's
// `releaser` (a Release on a step that never acquires, inside a recipe that acquires elsewhere)
// — which is precisely why neither the recipe's nor the releasing step's command list can serve
// as the guard, and why the revoked-hold marker has to.
const ACQUIRE_HOLD_RELEASE_LATER_SPEC = {
  local_id: 'wf', oid: 'wf-acquire-hold-release-later', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  steps: [
    step('s1', 'START'),
    step('acq', 'MATH', { resource_command_specifications: [
      { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
    ] }),
    step('ui', 'USER_INTERACTION'),
    step('rel', 'MATH', { resource_command_specifications: [
      { command_type: 'Release', resource_name: 'Printer', resource_source_oid: 'env-printer' },
    ] }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'acq' }, { from_step_id: 'acq', to_step_id: 'ui' },
    { from_step_id: 'ui', to_step_id: 'rel' }, { from_step_id: 'rel', to_step_id: 'e1' },
  ],
};

// A COUNTABLE pool, for the partial-release half of the revoked-hold guard. One
// 'Acquire Pool Amount' of 3 records ONE ledger entry (and therefore ONE revoked marker)
// carrying amount 3, which the recipe then gives back one unit at a time across three later
// steps — so the marker has to be decremented, not consumed whole, by each of them.
const ENV_SLOTS = {
  local_id: 'env-slots-lib', oid: 'env-slots', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'Slots', resource_type: 'countable use with pool limits', use_limit: 3 }],
};

const poolCmd = (command_type: string, amount: number) => ({
  command_type, resource_name: 'Slots', resource_source_oid: 'env-slots', amount,
});

const POOL_ACQUIRE_RELEASE_THRICE_SPEC = {
  local_id: 'wf', oid: 'wf-pool-release-thrice', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_SLOTS],
  steps: [
    step('s1', 'START'),
    step('acq', 'MATH', { resource_command_specifications: [poolCmd('Acquire Pool Amount', 3)] }),
    step('ui', 'USER_INTERACTION'),
    step('r1', 'MATH', { resource_command_specifications: [poolCmd('Release Pool Amount', 1)] }),
    step('r2', 'MATH', { resource_command_specifications: [poolCmd('Release Pool Amount', 1)] }),
    step('r3', 'MATH', { resource_command_specifications: [poolCmd('Release Pool Amount', 1)] }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'acq' }, { from_step_id: 'acq', to_step_id: 'ui' },
    { from_step_id: 'ui', to_step_id: 'r1' }, { from_step_id: 'r1', to_step_id: 'r2' },
    { from_step_id: 'r2', to_step_id: 'r3' }, { from_step_id: 'r3', to_step_id: 'e1' },
  ],
};

// Takes the whole pool and parks — the instance the operator hands the revoked units to.
const POOL_PARK_SPEC = {
  local_id: 'wf', oid: 'wf-pool-park', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_SLOTS],
  steps: [
    step('s1', 'START'),
    step('ui', 'USER_INTERACTION', { resource_command_specifications: [poolCmd('Acquire Pool Amount', 3)] }),
    step('e1', 'END'),
  ],
  connections: [{ from_step_id: 's1', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'e1' }],
};

// Queues on Printer with NO try/catch — an operator cancel must surface as an uncaught ERROR.
const GRAB_PRINTER_SPEC = {
  local_id: 'wf', oid: 'wf-grab-printer', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  steps: [
    step('s1', 'START'),
    step('grab', 'MATH', { resource_command_specifications: [
      { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
    ] }),
    step('e1', 'END'),
  ],
  connections: [{ from_step_id: 's1', to_step_id: 'grab' }, { from_step_id: 'grab', to_step_id: 'e1' }],
};

// Same, but the grab step carries a step-level TRY of mode ERROR routed to a CATCH — the cancel
// must land in the catch network, not error the instance.
//
// Two shape constraints the validator imposes on this fixture (both verified against
// src/spec/validator.ts, and both different from a first-cut MATH + CATCH->END sketch):
//   * the trigger is a SCRIPT, not a MATH — `try_specifications` are only legal on the
//     TRY_SCOPED step types (ACTION PROXY / SCRIPT / USER INTERACTION / YES NO / WORKFLOW PROXY
//     / GATE), so a MATH trigger is rejected with TRY_ON_INVALID_STEP at instance start;
//   * the catch network ends in a RETURN — partitionCatchNetworks is RETURN-gated (spec §6.5),
//     so a RETURN-less catch island is not recognised as a catch network at all and its steps
//     are rejected transitively by semanticValidation's ORPHANED_STEP check.
// RETURN COMPLETE force-completes the original trigger and cascades its successors (spec §5.6's
// "Continue"), so the instance runs on to END and settles 'completed' — the brief's intended
// reading, "the instance completed THROUGH the catch network".
const GRAB_WITH_CATCH_SPEC = {
  local_id: 'wf', oid: 'wf-grab-catch', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  value_property_specifications: [
    { name: 'FailureContext', entries: [{ name: 'Message', value: '' }] },
  ],
  steps: [
    step('s1', 'START'),
    step('grab', 'SCRIPT', {
      script_config: { source: '// no-op' },
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
      ],
      try_specifications: [{ mode: 'ERROR', catch_id: 'c1' }],
    }),
    step('catch', 'CATCH', {
      catch_id: 'c1',
      output_parameter_specifications: [{ id: 'Message', target: 'FailureContext.Message' }],
    }),
    step('r1', 'RETURN', { return_config: { command: 'COMPLETE' } }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'grab' }, { from_step_id: 'grab', to_step_id: 'e1' },
    { from_step_id: 'catch', to_step_id: 'r1' },
  ],
};

const CANCEL_ERROR = 'Resource "Printer": wait cancelled by an operator';

async function waiterRows(db: AnyDb, wcId: string) {
  return db.select().from(wcResourceWaiter).where(eq(wcResourceWaiter.workCenterId, wcId));
}
async function stepRow(db: AnyDb, instanceId: string, stepOid: string) {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: { stepOid: string }) => r.stepOid === stepOid);
}
async function instanceRow(db: AnyDb, id: string) {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, id));
  return row;
}
async function resourceRow(db: AnyDb, wcId: string, name: string) {
  const [row] = await db.select().from(wcResource)
    .where(and(eq(wcResource.workCenterId, wcId), eq(wcResource.name, name)));
  return row;
}

/** Holder parked on Printer, contender queued behind it — the registry has one waiter row. */
async function holderAndQueuedContender(
  db: AnyDb, deps: ReturnType<typeof testDeps>, contenderSpec: unknown, contenderOid: string,
) {
  const wc = await makeWc(db);
  await db.insert(wcResource).values({
    workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use',
    inUse: 0, poolNames: [], availableNames: [],
  });
  const holder = await seedQueuedIn(db, wc, ACQUIRE_PARK_SPEC, 'wf-acquire-park', 1);
  await pumpUntilQuiet(db, deps);
  const contender = await seedQueuedIn(db, wc, contenderSpec, contenderOid, 2);
  await pumpUntilQuiet(db, deps);
  const waiters = await waiterRows(db, wc.id);
  expect(waiters.map((w: { instanceId: string; granted: boolean }) => [w.instanceId, w.granted]))
    .toEqual([[contender.id, false]]);
  return { wc, holder, contender };
}

test('a waiter row deleted out of band fails the blocked step as an uncaught ERROR on the next pump', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const { wc, holder, contender } = await holderAndQueuedContender(db, deps, GRAB_PRINTER_SPEC, 'wf-grab-printer');
    // The operator's cancel-waiter, reduced to its registry effect (Task 4 does this for real).
    await db.delete(wcResourceWaiter).where(eq(wcResourceWaiter.workCenterId, wc.id));
    await pumpUntilQuiet(db, deps);

    const grab = await stepRow(db, contender.id, 'grab');
    expect(grab.state).toBe('ERRORED');
    expect(grab.error).toBe(CANCEL_ERROR);
    expect((await instanceRow(db, contender.id)).status).toBe('errored'); // uncaught → terminal
    const traces = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, contender.id));
    expect(traces.some((t: { state: string; error: string | null }) =>
      t.state === 'ERRORED' && t.error === CANCEL_ERROR)).toBe(true);

    // The holder is untouched: still parked, still the only thing on Printer.
    expect((await stepRow(db, holder.id, 'ui')).state).toBe('WAITING_USER');
    expect((await instanceRow(db, holder.id)).status).toBe('running');
    expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1);
    const holders = await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.workCenterId, wc.id));
    expect(holders.map((h: { instanceId: string; stepOid: string }) => [h.instanceId, h.stepOid]))
      .toEqual([[holder.id, 'ui']]);
  } finally { await close(); }
});

test('a cancelled wait routes through a step-level TRY of mode ERROR', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const { wc, contender } = await holderAndQueuedContender(db, deps, GRAB_WITH_CATCH_SPEC, 'wf-grab-catch');
    await db.delete(wcResourceWaiter).where(eq(wcResourceWaiter.workCenterId, wc.id));
    await pumpUntilQuiet(db, deps);

    const inst = await instanceRow(db, contender.id);
    expect(inst.status).toBe('completed'); // catch → RETURN COMPLETE → e1; the instance did NOT error
    // The CATCH genuinely ran, and carried THIS failure's message — mode ERROR was what routed it.
    expect(inst.propertyStore).toMatchObject({ 'FailureContext.Message': CANCEL_ERROR });
    const traces = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, contender.id));
    expect(traces.some((t: { stepOid: string | null }) => t.stepOid === 'catch')).toBe(true);
    // Caught, not propagated: failStep idles the trigger (deleting its row and tracing IDLE) and
    // never traces it ERRORED; RETURN COMPLETE is what later re-seeds the row as COMPLETED.
    expect(traces.some((t: { stepOid: string | null; state: string }) =>
      t.stepOid === 'grab' && t.state === 'IDLE')).toBe(true);
    expect(traces.some((t: { stepOid: string | null; state: string }) =>
      t.stepOid === 'grab' && t.state === 'ERRORED')).toBe(false);
    expect((await stepRow(db, contender.id, 'grab')).state).toBe('COMPLETED');
  } finally { await close(); }
});

test('a GRANTED-but-unconsumed token is NOT treated as cancelled', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const { wc, contender } = await holderAndQueuedContender(db, deps, GRAB_PRINTER_SPEC, 'wf-grab-printer');
    // Simulate the holder's release having granted the contender's row (write-back's handoff)
    // WITHOUT the contender having consumed it yet: granted=true, in_use stays 1 (reserved).
    await db.update(wcResourceWaiter).set({ granted: true }).where(eq(wcResourceWaiter.workCenterId, wc.id));
    await pumpUntilQuiet(db, deps);

    // The contender consumed the grant and ran to completion — never failed.
    expect((await instanceRow(db, contender.id)).status).toBe('completed');
    const grab = await stepRow(db, contender.id, 'grab');
    expect(grab?.state ?? 'COMPLETED').not.toBe('ERRORED');
  } finally { await close(); }
});

test('a holder whose row an operator deleted does NOT double-release on its own Release (ledger-guarded)', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const wc = await makeWc(db);
    await db.insert(wcResource).values({
      workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use',
      inUse: 0, poolNames: [], availableNames: [],
    });
    const holder = await seedQueuedIn(db, wc, ACQUIRE_RELEASE_PARK_SPEC, 'wf-acquire-release-park', 1);
    await pumpUntilQuiet(db, deps); // holder parked at 'ui', holding Printer
    const contender = await seedQueuedIn(db, wc, ACQUIRE_PARK_SPEC, 'wf-acquire-park', 2);
    await pumpUntilQuiet(db, deps); // contender queued behind it
    expect((await db.select().from(wcResourceHolder)
      .where(eq(wcResourceHolder.instanceId, holder.id))).length).toBe(1);

    // The operator's release-holder, reduced to its registry effect (Task 4 does this for real):
    // the holder's row is gone and the freed unit is RESERVED for the contender (granted row,
    // in_use stays 1). The holder's own engine_state still says it holds Printer.
    await db.delete(wcResourceHolder).where(eq(wcResourceHolder.instanceId, holder.id));
    await db.update(wcResourceWaiter).set({ granted: true }).where(eq(wcResourceWaiter.instanceId, contender.id));
    await pumpUntilQuiet(db, deps); // contender consumes its grant and parks, holding Printer
    expect((await stepRow(db, contender.id, 'ui')).state).toBe('WAITING_USER');

    // Now the former holder completes 'ui', whose declared Release would — unguarded — free the
    // unit the contender holds.
    await submitUserAction(db, holder.id, { step_oid: 'ui', action: 'submit' }, 0, deps);
    await pumpUntilQuiet(db, deps);

    expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1); // still the contender's
    const holders = await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.workCenterId, wc.id));
    expect(holders.map((h: { instanceId: string; stepOid: string }) => [h.instanceId, h.stepOid]))
      .toEqual([[contender.id, 'ui']]);
    expect(await waiterRows(db, wc.id)).toEqual([]);
    expect((await instanceRow(db, holder.id)).status).toBe('completed');
    expect((await stepRow(db, contender.id, 'ui')).state).toBe('WAITING_USER');
  } finally { await close(); }
});

test('a cross-step Release (Acquire on one step, Release on a later one) is guarded by the revoked-hold marker', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const wc = await makeWc(db);
    await db.insert(wcResource).values({
      workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use',
      inUse: 0, poolNames: [], availableNames: [],
    });
    const holder = await seedQueuedIn(db, wc, ACQUIRE_HOLD_RELEASE_LATER_SPEC, 'wf-acquire-hold-release-later', 1);
    await pumpUntilQuiet(db, deps); // 'acq' took Printer, parked at 'ui' — the Release is still ahead
    expect((await stepRow(db, holder.id, 'ui')).state).toBe('WAITING_USER');
    const heldRows = await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, holder.id));
    expect(heldRows.map((h: { stepOid: string }) => h.stepOid)).toEqual(['acq']);

    const contender = await seedQueuedIn(db, wc, ACQUIRE_PARK_SPEC, 'wf-acquire-park', 2);
    await pumpUntilQuiet(db, deps); // contender queued behind it

    // The operator's release-holder, reduced to its registry effect (Task 4 does this for real).
    await db.delete(wcResourceHolder).where(eq(wcResourceHolder.instanceId, holder.id));
    await db.update(wcResourceWaiter).set({ granted: true }).where(eq(wcResourceWaiter.instanceId, contender.id));
    await pumpUntilQuiet(db, deps); // contender consumes its grant and parks, holding Printer
    expect((await stepRow(db, contender.id, 'ui')).state).toBe('WAITING_USER');

    // The former holder walks on to 'rel', whose Release names a unit it no longer has. Its
    // ledger is empty AND its releasing step declares no Acquire — only the revoked marker
    // openContext recorded (persisted 'acq' hold, no live row) can stop this.
    await submitUserAction(db, holder.id, { step_oid: 'ui', action: 'submit' }, 0, deps);
    await pumpUntilQuiet(db, deps);

    expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1); // still the contender's
    const holders = await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.workCenterId, wc.id));
    expect(holders.map((h: { instanceId: string; stepOid: string }) => [h.instanceId, h.stepOid]))
      .toEqual([[contender.id, 'ui']]);
    expect(await waiterRows(db, wc.id)).toEqual([]);
    expect((await instanceRow(db, holder.id)).status).toBe('completed');
    expect((await stepRow(db, contender.id, 'ui')).state).toBe('WAITING_USER');
  } finally { await close(); }
});

test('a revoked marker is consumed BY AMOUNT: three partial pool releases free nothing, not two units', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const wc = await makeWc(db);
    await db.insert(wcResource).values({
      workCenterId: wc.id, name: 'Slots', resourceType: 'countable use with pool limits',
      useLimit: 3, inUse: 0, poolNames: [], availableNames: [],
    });
    const holder = await seedQueuedIn(db, wc, POOL_ACQUIRE_RELEASE_THRICE_SPEC, 'wf-pool-release-thrice', 1);
    await pumpUntilQuiet(db, deps); // 'acq' took all 3 in ONE command, parked at 'ui'
    expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(3);
    const held = await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, holder.id));
    expect(held.map((h: { stepOid: string; amount: number }) => [h.stepOid, h.amount])).toEqual([['acq', 3]]);

    const contender = await seedQueuedIn(db, wc, POOL_PARK_SPEC, 'wf-pool-park', 2);
    await pumpUntilQuiet(db, deps); // needs all 3, none free — queues

    // The operator's release-holder: the holder's row goes, and the 3 units are handed to the
    // contender (granted waiter, in_use unchanged) — Task 4 does this for real.
    await db.delete(wcResourceHolder).where(eq(wcResourceHolder.instanceId, holder.id));
    await db.update(wcResourceWaiter).set({ granted: true }).where(eq(wcResourceWaiter.instanceId, contender.id));
    await pumpUntilQuiet(db, deps);
    expect((await stepRow(db, contender.id, 'ui')).state).toBe('WAITING_USER');

    // The former holder now walks r1 -> r2 -> r3, giving back one unit each. Its single revoked
    // marker carries amount 3, so all three must be absorbed by it. Consuming the marker WHOLE on
    // r1 would leave r2 and r3 with neither ledger entry nor marker, and each would fall through
    // to the unconditional reference-model release — freeing 2 units the contender now holds.
    await submitUserAction(db, holder.id, { step_oid: 'ui', action: 'submit' }, 0, deps);
    await pumpUntilQuiet(db, deps);

    expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(3); // never dropped below the ledger
    const holders = await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.workCenterId, wc.id));
    expect(holders.map((h: { instanceId: string; stepOid: string; amount: number }) => [h.instanceId, h.stepOid, h.amount]))
      .toEqual([[contender.id, 'ui', 3]]);
    expect(await waiterRows(db, wc.id)).toEqual([]);
    expect((await instanceRow(db, holder.id)).status).toBe('completed');
    expect((await stepRow(db, contender.id, 'ui')).state).toBe('WAITING_USER');
  } finally { await close(); }
});

// ────────────────────────────────────────────────────────────────────────────
// Final-review findings I1 / I2, and §12.5 item 10's terminal-clear assertion.
//
// A `binary shared use with pool limits` pool of TWO units — the only resource shape ONE
// instance can hold TWICE at the same time, which is what both findings need: I1 wants two
// holds on two DIFFERENT steps of one instance, I2 wants two holds on the SAME step.
const ENV_POOL = {
  local_id: 'env-pool-lib', oid: 'env-pool', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [
    { name: 'Pool', resource_type: 'binary shared use with pool limits', use_limit: 2 },
  ],
};

const poolBinCmd = (command_type: string) => ({
  command_type, resource_name: 'Pool', resource_source_oid: 'env-pool',
});

// I1's shape: ONE instance holding both units of the pool on two PARALLEL branches, with each
// branch's Acquire and Release on the SAME step (activation acquires, completion releases) and
// a park in between — so submitting branch A runs A's OWN Release while branch B's hold is
// still live. Every PARALLEL needs a reachable WAIT ALL (UNMATCHED_PARALLEL otherwise), and
// that WAIT ALL is also what keeps the instance alive (and holding at B) after A completes.
const TWO_BRANCH_HOLD_SPEC = {
  local_id: 'wf', oid: 'wf-two-branch-hold', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_POOL],
  steps: [
    step('s1', 'START'),
    step('p', 'PARALLEL'),
    step('ui-a', 'USER_INTERACTION', { resource_command_specifications: [
      poolBinCmd('Acquire'), poolBinCmd('Release'),
    ] }),
    step('ui-b', 'USER_INTERACTION', { resource_command_specifications: [
      poolBinCmd('Acquire'), poolBinCmd('Release'),
    ] }),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p' },
    { from_step_id: 'p', to_step_id: 'ui-a' },
    { from_step_id: 'p', to_step_id: 'ui-b' },
    { from_step_id: 'ui-a', to_step_id: 'wa' },
    { from_step_id: 'ui-b', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
};

// The same two branches, but NEITHER releases — so a marker revoked on branch A is still
// OUTSTANDING when the instance reaches END while branch B's hold is still live. That is the
// only shape that puts an unconsumed marker through settleTerminal's clear (an instance holding
// NOTHING at terminal takes autoReleaseEnvHoldings' early-out and never reaches it; see the
// §12.5 item-10 test's own comment).
const TWO_BRANCH_PARK_SPEC = {
  local_id: 'wf', oid: 'wf-two-branch-park', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_POOL],
  steps: [
    step('s1', 'START'),
    step('p', 'PARALLEL'),
    step('ui-a', 'USER_INTERACTION', { resource_command_specifications: [poolBinCmd('Acquire')] }),
    step('ui-b', 'USER_INTERACTION', { resource_command_specifications: [poolBinCmd('Acquire')] }),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p' },
    { from_step_id: 'p', to_step_id: 'ui-a' },
    { from_step_id: 'p', to_step_id: 'ui-b' },
    { from_step_id: 'ui-a', to_step_id: 'wa' },
    { from_step_id: 'ui-b', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
};

// I2's shape: ONE step taking TWO units in two separate Acquire commands (legal — see
// attemptResourceCommands, which pushes one envHolds entry per command), given back in two
// Releases on a later step. Two entries, two holder rows, identical in every field but id.
const DOUBLE_HOLD_SPEC = {
  local_id: 'wf', oid: 'wf-double-hold', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_POOL],
  steps: [
    step('s1', 'START'),
    step('acq', 'MATH', { resource_command_specifications: [poolBinCmd('Acquire'), poolBinCmd('Acquire')] }),
    step('ui', 'USER_INTERACTION', { resource_command_specifications: [poolBinCmd('Release'), poolBinCmd('Release')] }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'acq' }, { from_step_id: 'acq', to_step_id: 'ui' },
    { from_step_id: 'ui', to_step_id: 'e1' },
  ],
};

// A contender: takes ONE unit of the pool and parks on it. `workflow_entry_uq` is
// (work_center_id, oid, version, state), so two contenders in one work center need two oids.
const poolParkSpec = (oid: string) => ({
  local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_POOL],
  steps: [
    step('s1', 'START'),
    step('ui', 'USER_INTERACTION', { resource_command_specifications: [poolBinCmd('Acquire')] }),
    step('e1', 'END'),
  ],
  connections: [{ from_step_id: 's1', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'e1' }],
});

/**
 * `pumpUntilQuiet` stops at the FIRST runOnce cycle that reports no work — and a cycle that
 * merely rotates a fully-blocked instance to the back of the claim order (processReadyStep's
 * `!target` head-of-line bump) reports exactly that, having claimed ONE instance. With TWO
 * contenders blocked on the same resource, the one carrying a fresh grant can therefore sit
 * behind the other for a whole pump and never be reached. Every test below has two contenders,
 * so drain the work center with one pump per blocked instance plus one. (The single-contender
 * tests earlier in this file never hit it, which is why the helper is new here.)
 */
async function pumpAll(db: AnyDb, deps: ReturnType<typeof testDeps>, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) await pumpUntilQuiet(db, deps);
}

/** Every holder row in the work center as [instanceId, stepOid], ordered by step oid so the
 *  comparison depends on neither the (random uuid) instance ids nor row insertion order. */
async function holderRows(db: AnyDb, wcId: string) {
  const rows = await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.workCenterId, wcId));
  return rows
    .map((h: { instanceId: string; stepOid: string }) => [h.instanceId, h.stepOid])
    .sort((a: string[], b: string[]) => a[1].localeCompare(b[1]));
}

/** All three pool tests open the same way: the wc_resource row, a holder taking BOTH units,
 *  then two contenders queued behind it in FIFO order. */
async function poolHolderAndTwoContenders(
  db: AnyDb, deps: ReturnType<typeof testDeps>, holderSpec: unknown, holderOid: string,
) {
  const wc = await makeWc(db);
  await db.insert(wcResource).values({
    workCenterId: wc.id, name: 'Pool', resourceType: 'binary shared use with pool limits',
    useLimit: 2, inUse: 0, poolNames: [], availableNames: [],
  });
  const holder = await seedQueuedIn(db, wc, holderSpec, holderOid, 1);
  await pumpAll(db, deps);
  expect((await resourceRow(db, wc.id, 'Pool')).inUse).toBe(2);

  const c1 = await seedQueuedIn(db, wc, poolParkSpec('wf-pool-park-1'), 'wf-pool-park-1', 2);
  await pumpAll(db, deps);
  const c2 = await seedQueuedIn(db, wc, poolParkSpec('wf-pool-park-2'), 'wf-pool-park-2', 3);
  await pumpAll(db, deps);
  expect((await waiterRows(db, wc.id)).map((w: { instanceId: string; granted: boolean }) => [w.instanceId, w.granted]))
    .toEqual([[c1.id, false], [c2.id, false]]);
  return { wc, holder, c1, c2 };
}

/** The operator's release-holder on ONE holder row, reduced to its registry effect (Task 4 does
 *  this for real): that row goes and the freed unit is RESERVED for `grantee` (granted row,
 *  in_use unchanged). Pumps until the grantee has consumed the grant and parked. */
async function operatorReleaseHolderRow(
  db: AnyDb, deps: ReturnType<typeof testDeps>, holderRowId: number, grantee: { id: string },
) {
  await db.delete(wcResourceHolder).where(eq(wcResourceHolder.id, holderRowId));
  await db.update(wcResourceWaiter).set({ granted: true }).where(eq(wcResourceWaiter.instanceId, grantee.id));
  await pumpAll(db, deps);
  expect((await stepRow(db, grantee.id, 'ui')).state).toBe('WAITING_USER');
}

test('I1: a revoked marker for THIS step outranks a live hold of the same resource on ANOTHER step of the instance', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const { wc, holder, c1, c2 } = await poolHolderAndTwoContenders(db, deps, TWO_BRANCH_HOLD_SPEC, 'wf-two-branch-hold');
    expect((await stepRow(db, holder.id, 'ui-a')).state).toBe('WAITING_USER');
    expect((await stepRow(db, holder.id, 'ui-b')).state).toBe('WAITING_USER');
    const held = await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, holder.id));
    expect(held.map((h: { stepOid: string }) => h.stepOid).sort()).toEqual(['ui-a', 'ui-b']);

    // BRANCH A's row only: branch B's hold — the SAME resource, a DIFFERENT step of the SAME
    // instance — is untouched and still live.
    const rowA = held.find((h: { stepOid: string }) => h.stepOid === 'ui-a')!;
    await operatorReleaseHolderRow(db, deps, rowA.id, c1);

    // Branch A completes and runs ITS OWN Release. The exact-step revoked marker has to win: an
    // any-step ledger lookup finds branch B's live entry instead and frees a unit B is still
    // using, handing contender 2 a unit that does not exist.
    await submitUserAction(db, holder.id, { step_oid: 'ui-a', action: 'submit' }, 0, deps);
    await pumpAll(db, deps);

    expect((await resourceRow(db, wc.id, 'Pool')).inUse).toBe(2);
    expect(await holderRows(db, wc.id)).toEqual([[c1.id, 'ui'], [holder.id, 'ui-b']]);
    expect((await waiterRows(db, wc.id)).map((w: { instanceId: string; granted: boolean }) => [w.instanceId, w.granted]))
      .toEqual([[c2.id, false]]);
    expect((await stepRow(db, holder.id, 'ui-b')).state).toBe('WAITING_USER');
    expect((await instanceRow(db, holder.id)).status).toBe('running');
  } finally { await close(); }
});

test('I2: two identical holds on one step are diffed as a MULTISET — one revoked row leaves one marker', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const { wc, holder, c1, c2 } = await poolHolderAndTwoContenders(db, deps, DOUBLE_HOLD_SPEC, 'wf-double-hold');
    expect((await stepRow(db, holder.id, 'ui')).state).toBe('WAITING_USER');
    const held = await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, holder.id));
    expect(held.map((h: { stepOid: string; amount: number }) => [h.stepOid, h.amount]))
      .toEqual([['acq', 1], ['acq', 1]]); // two rows, identical in every field but id

    // Exactly ONE of the two identical rows. A `live.some(...)` diff lets the surviving row
    // satisfy BOTH persisted entries and records NO marker at all.
    await operatorReleaseHolderRow(db, deps, held[0].id, c1);

    // The holder now runs BOTH Releases. Exactly one of them is genuine (it hands contender 2
    // the unit the holder still legitimately holds); the other must be absorbed by the marker.
    await submitUserAction(db, holder.id, { step_oid: 'ui', action: 'submit' }, 0, deps);
    await pumpAll(db, deps);

    expect((await resourceRow(db, wc.id, 'Pool')).inUse).toBe(2); // never dropped below the ledger
    expect(await holderRows(db, wc.id)).toEqual([[c1.id, 'ui'], [c2.id, 'ui']]);
    expect(await waiterRows(db, wc.id)).toEqual([]);
    expect((await instanceRow(db, holder.id)).status).toBe('completed');
    expect((await stepRow(db, c2.id, 'ui')).state).toBe('WAITING_USER');
  } finally { await close(); }
});

test('spec §12.5 item 10: a terminal instance clears BOTH envHolds and its revoked markers from engine_state', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    // Neither branch releases, so the marker recorded for branch A is still OUTSTANDING when
    // the instance reaches END — settleTerminal's clear is the only thing that can remove it.
    // Branch B's still-live hold is what carries this instance PAST autoReleaseEnvHoldings'
    // "nothing held, nothing reserved, nothing queued, nothing deleted" early-out. (The
    // marker-ONLY terminal — every clause of that early-out zero, one marker outstanding — is
    // the R3 test at the end of this file; it takes the same clear because R3 made an
    // outstanding marker one of the early-out's own conditions.)
    const { wc, holder, c1, c2 } = await poolHolderAndTwoContenders(db, deps, TWO_BRANCH_PARK_SPEC, 'wf-two-branch-park');
    const held = await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, holder.id));
    const rowA = held.find((h: { stepOid: string }) => h.stepOid === 'ui-a')!;
    await operatorReleaseHolderRow(db, deps, rowA.id, c1);

    await submitUserAction(db, holder.id, { step_oid: 'ui-a', action: 'submit' }, 0, deps);
    await pumpAll(db, deps);
    // The marker is on disk and unconsumed: branch A declared no Release to absorb it.
    expect((await instanceRow(db, holder.id)).engineState.envHoldsRevoked)
      .toEqual([{ name: 'Pool', stepOid: 'ui-a', amount: 1, heldName: null }]);

    await submitUserAction(db, holder.id, { step_oid: 'ui-b', action: 'submit' }, 0, deps);
    await pumpAll(db, deps);

    const row = await instanceRow(db, holder.id);
    expect(row.status).toBe('completed');
    expect(row.engineState.envHolds).toEqual([]);
    expect(row.engineState.envHoldsRevoked).toEqual([]);
    // Terminal auto-release gave branch B's unit — and ONLY that one — to contender 2.
    expect((await resourceRow(db, wc.id, 'Pool')).inUse).toBe(2);
    expect(await holderRows(db, wc.id)).toEqual([[c1.id, 'ui'], [c2.id, 'ui']]);
    expect(await waiterRows(db, wc.id)).toEqual([]);
  } finally { await close(); }
});

// ────────────────────────────────────────────────────────────────────────────
// Residual round R1 / R2 / R3 — the three findings the fix-wave re-review raised against the
// controller's own rulings. Each one is a way for the revoked-hold marker to be LOST (R1, R3)
// or OUT-RANKED by a live entry it should outrank (R2).

/** Every holder row this instance owns, oldest first. Re-read after any persist(): the
 *  write-back replaces an instance's holder rows WHOLESALE (applyRegistryWrites), so the ids a
 *  previous read handed out are stale even when the content is identical. */
async function heldRowsOf(db: AnyDb, instanceId: string) {
  return db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, instanceId));
}

test('R1: a SECOND revocation of the same step\'s identical hold records a SECOND marker (no dedupe)', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const { wc, holder, c1, c2 } = await poolHolderAndTwoContenders(db, deps, DOUBLE_HOLD_SPEC, 'wf-double-hold');
    const held = await heldRowsOf(db, holder.id);
    expect(held.map((h: { stepOid: string; amount: number }) => [h.stepOid, h.amount]))
      .toEqual([['acq', 1], ['acq', 1]]);

    // Revocation 1 of 2 — one of the two identical rows.
    await operatorReleaseHolderRow(db, deps, held[0].id, c1);

    // A hydration + persist of the holder BETWEEN the two revocations. ANY transition of this
    // instance does this; openContext + persist is that pair with no step to run. It is what
    // makes the SECOND revocation's diff `[{acq}]` vs `[]` (ONE newly-revoked entry) instead of
    // `[{acq},{acq}]` vs `[]`, with the first marker already durably on disk — the shape a
    // dedupe against the markers this state already carries silently swallows.
    const row = await instanceRow(db, holder.id);
    const ctx = await openContext(db, {
      id: holder.id, workCenterId: wc.id, specJsonb: row.specJsonb,
      engineState: row.engineState, propertyStore: row.propertyStore,
    }, deps);
    await ctx.persist(db);
    const mid = await instanceRow(db, holder.id);
    expect(mid.engineState.envHoldsRevoked).toEqual([{ name: 'Pool', stepOid: 'acq', amount: 1, heldName: null }]);
    expect(mid.engineState.envHolds).toEqual([{ name: 'Pool', stepOid: 'acq', amount: 1, heldName: null }]);

    // Revocation 2 of 2. Re-read the row first: persist() replaced it (same content, new id).
    const stillHeld = await heldRowsOf(db, holder.id);
    expect(stillHeld).toHaveLength(1);
    await operatorReleaseHolderRow(db, deps, stillHeld[0].id, c2);

    // Both of the step's Releases must now be absorbed by a marker — there are TWO revoked
    // holds. A dedupe drops the second marker; that Release then finds neither ledger entry nor
    // marker and the unconditional outcome frees a unit contender 2 now holds.
    await submitUserAction(db, holder.id, { step_oid: 'ui', action: 'submit' }, 0, deps);
    await pumpAll(db, deps);

    expect((await resourceRow(db, wc.id, 'Pool')).inUse).toBe(2); // never below the ledger
    expect(await holderRows(db, wc.id)).toEqual([[c1.id, 'ui'], [c2.id, 'ui']]);
    expect(await waiterRows(db, wc.id)).toEqual([]);
    expect((await instanceRow(db, holder.id)).status).toBe('completed');
  } finally { await close(); }
});

// R2's shape: the SPLIT fixture — each branch's Acquire and Release sit on DIFFERENT steps. A
// Release on the revoked branch therefore misses BOTH exact lookups (its own step appears in
// neither list), and the two ANY-step lookups are what decide it: the sibling branch's live
// ledger entry, or this branch's marker.
const TWO_BRANCH_SPLIT_SPEC = {
  local_id: 'wf', oid: 'wf-two-branch-split', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_POOL],
  steps: [
    step('s1', 'START'),
    step('p', 'PARALLEL'),
    step('acq-a', 'MATH', { resource_command_specifications: [poolBinCmd('Acquire')] }),
    step('ui-a', 'USER_INTERACTION', { resource_command_specifications: [poolBinCmd('Release')] }),
    step('acq-b', 'MATH', { resource_command_specifications: [poolBinCmd('Acquire')] }),
    step('ui-b', 'USER_INTERACTION', { resource_command_specifications: [poolBinCmd('Release')] }),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p' },
    { from_step_id: 'p', to_step_id: 'acq-a' },
    { from_step_id: 'p', to_step_id: 'acq-b' },
    { from_step_id: 'acq-a', to_step_id: 'ui-a' },
    { from_step_id: 'acq-b', to_step_id: 'ui-b' },
    { from_step_id: 'ui-a', to_step_id: 'wa' },
    { from_step_id: 'ui-b', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
};

test('R2: an ANY-step revoked marker outranks another step\'s live ledger entry', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const { wc, holder, c1, c2 } = await poolHolderAndTwoContenders(db, deps, TWO_BRANCH_SPLIT_SPEC, 'wf-two-branch-split');
    expect((await stepRow(db, holder.id, 'ui-a')).state).toBe('WAITING_USER');
    expect((await stepRow(db, holder.id, 'ui-b')).state).toBe('WAITING_USER');
    const held = await heldRowsOf(db, holder.id);
    expect(held.map((h: { stepOid: string }) => h.stepOid).sort()).toEqual(['acq-a', 'acq-b']);

    // BRANCH A's row only — branch B's hold, on `acq-b`, stays live.
    const rowA = held.find((h: { stepOid: string }) => h.stepOid === 'acq-a')!;
    await operatorReleaseHolderRow(db, deps, rowA.id, c1);

    // `ui-a` completes and runs branch A's Release. Neither EXACT lookup can match (the marker
    // sits on `acq-a`, the live entry on `acq-b`, and this step is `ui-a`), so the ANY-step
    // order decides it: the marker must win. Answering it from `acq-b`'s live entry frees a unit
    // branch B is still using and hands it to contender 2 — I1's over-subscription window,
    // reproduced for the cross-step shape.
    await submitUserAction(db, holder.id, { step_oid: 'ui-a', action: 'submit' }, 0, deps);
    await pumpAll(db, deps);

    expect((await resourceRow(db, wc.id, 'Pool')).inUse).toBe(2);
    expect(await holderRows(db, wc.id)).toEqual([[holder.id, 'acq-b'], [c1.id, 'ui']]);
    expect((await waiterRows(db, wc.id)).map((w: { instanceId: string; granted: boolean }) => [w.instanceId, w.granted]))
      .toEqual([[c2.id, false]]);
    expect((await stepRow(db, holder.id, 'ui-b')).state).toBe('WAITING_USER');
    expect((await instanceRow(db, holder.id)).status).toBe('running');
  } finally { await close(); }
});

// R3: the marker-ONLY terminal. This holder's single hold was revoked and its recipe declares no
// Release at all, so at terminal it holds nothing, reserves nothing, waits on nothing and gives
// up no row — autoReleaseEnvHoldings' early-out — with one marker still outstanding. Binary
// exclusive 'Printer' (not the two-unit pool the tests above use) is what makes "one hold, one
// contender queued behind it, and NOTHING left on this instance after the revocation"
// expressible at all: on a use_limit 2 pool a single-unit holder leaves a free unit, so no
// contender ever queues.
const ACQUIRE_PARK_CONTENDER_SPEC = { ...ACQUIRE_PARK_SPEC, oid: 'wf-acquire-park-2' };

test('R3: a terminal instance whose ONLY env state is a revoked marker still clears it from engine_state', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const { wc, holder, contender } = await holderAndQueuedContender(
      db, deps, ACQUIRE_PARK_CONTENDER_SPEC, 'wf-acquire-park-2',
    );

    // The operator's release-holder on the holder's ONLY row, handed to the contender.
    await db.delete(wcResourceHolder).where(eq(wcResourceHolder.instanceId, holder.id));
    await db.update(wcResourceWaiter).set({ granted: true }).where(eq(wcResourceWaiter.instanceId, contender.id));
    await pumpUntilQuiet(db, deps);
    expect((await stepRow(db, contender.id, 'ui')).state).toBe('WAITING_USER');

    // The holder walks 'ui' -> END. Its next hydration records the marker; nothing consumes it
    // (the recipe declares no Release), and terminal auto-release has nothing else to do.
    await submitUserAction(db, holder.id, { step_oid: 'ui', action: 'submit' }, 0, deps);
    await pumpUntilQuiet(db, deps);

    const row = await instanceRow(db, holder.id);
    expect(row.status).toBe('completed');
    expect(row.engineState.envHolds).toEqual([]);
    expect(row.engineState.envHoldsRevoked).toEqual([]); // the early-out must not skip the clear
    expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1); // the contender's
    expect(await holderRows(db, wc.id)).toEqual([[contender.id, 'ui']]);
    expect(await waiterRows(db, wc.id)).toEqual([]);
  } finally { await close(); }
});
