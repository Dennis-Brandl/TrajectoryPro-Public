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
// Task 5 (Phase 2a): the durability half — writing the environment-resource tier BACK to the
// registry (persist()) and auto-releasing every hold an instance still carries once it reaches
// a terminal status (settleTerminal). Tasks 1-4 built the registry access layer, the
// registry<->manager bridge, hydration, and routing; nothing before this task ever writes the
// registry — every test here proves an actual `wc_resource`/`wc_resource_waiter`/
// `wc_resource_holder` row changed, not just that in-memory state changed.
import { expect, test, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { submitUserAction } from '../src/core/submit.js';
import { runControlPass } from '../src/core/control.js';
import { runOnce } from '../src/loop.js';
import { requestAbort, requestStop } from 'mission-control-db/src/dao/runtime-control';
import * as wcResources from 'mission-control-db/src/runtime/wc-resources';
import {
  workCenter, workflow, workflowInstance, stepInstance, traceEntry,
  wcResource, wcResourceWaiter, wcResourceHolder,
} from 'mission-control-db/src/db/schema/index';
import { openContext } from '../src/core/context.js';
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
  db: AnyDb, wc: { id: string }, spec: unknown, oid: string, runtimeNumber = 1,
): Promise<{ id: string; workCenterId: string }> {
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id };
}

async function seedQueued(db: AnyDb, spec: unknown, oid: string): Promise<{ id: string; workCenterId: string }> {
  const wc = await makeWc(db);
  return seedQueuedIn(db, wc, spec, oid);
}

async function instanceRow(db: AnyDb, instanceId: string) {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}


async function stepRow(db: AnyDb, instanceId: string, stepOid: string) {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: { stepOid: string }) => r.stepOid === stepOid);
}

async function holdersOf(db: AnyDb, instanceId: string) {
  return db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, instanceId));
}

async function resourceRow(db: AnyDb, workCenterId: string, name: string) {
  const [row] = await db.select().from(wcResource)
    .where(and(eq(wcResource.workCenterId, workCenterId), eq(wcResource.name, name)));
  return row;
}

async function waitersOf(db: AnyDb, workCenterId: string, name: string) {
  return db.select().from(wcResourceWaiter)
    .where(and(eq(wcResourceWaiter.workCenterId, workCenterId), eq(wcResourceWaiter.name, name)));
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────

const ENV_PRINTER = {
  local_id: 'env-printer-lib', oid: 'env-printer', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'Printer', resource_type: 'binary exclusive use' }],
};

// Acquires 'Printer' then parks (WAITING_USER) without releasing it — deterministic control
// over exactly when (and whether) the hold gets released, matching submit.test.ts's RES_BLOCK
// precedent for forcing real contention.
const ACQUIRE_PARK_SPEC = {
  local_id: 'wf', oid: 'wf-acquire-park', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  steps: [
    step('s1', 'START'),
    step('ui', 'USER_INTERACTION', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'ui' },
    { from_step_id: 'ui', to_step_id: 'e1' },
  ],
};

// Same shape, but 'ui' also releases on completion — lets a single submitUserAction call drive
// the release in a SEPARATE transaction from the one that acquired it.
const ACQUIRE_RELEASE_PARK_SPEC = {
  local_id: 'wf', oid: 'wf-acquire-release-park', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  steps: [
    step('s1', 'START'),
    step('ui', 'USER_INTERACTION', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
        { command_type: 'Release', resource_name: 'Printer', resource_source_oid: 'env-printer' },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'ui' },
    { from_step_id: 'ui', to_step_id: 'e1' },
  ],
};

// A second instance contending for the SAME environment resource, with no park of its own —
// it either grabs 'Printer' immediately or queues.
const GRAB_PRINTER_SPEC = {
  local_id: 'wf', oid: 'wf-grab-printer', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  steps: [
    step('s1', 'START'),
    step('grab', 'MATH', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'grab' },
    { from_step_id: 'grab', to_step_id: 'e1' },
  ],
};

// Reaches 'completed' in ONE transaction, still holding 'Printer' (no Release anywhere) — the
// settleIfComplete ordering where settleTerminal fires BEFORE context.persist(tx) ever runs
// this transition (settleIfComplete's own contract: "callers persist AFTER it returns").
const ACQUIRE_HOLD_TO_END_SPEC = {
  local_id: 'wf', oid: 'wf-acquire-hold-end', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  steps: [
    step('s1', 'START'),
    step('s2', 'MATH', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 'e1' },
  ],
};

// Reaches 'errored' (uncaught) in ONE transaction, still holding 'Printer' — the OPPOSITE
// ordering from completion: failStep calls context.persist(tx) BEFORE settleTerminal.
const ACQUIRE_THEN_THROW_SPEC = {
  local_id: 'wf', oid: 'wf-acquire-then-throw', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  steps: [
    step('s1', 'START'),
    step('s2', 'MATH', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
      ],
    }),
    step('s3', 'SCRIPT', { script_config: { source: 'throw new Error("boom");' } }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 's3' },
    { from_step_id: 's3', to_step_id: 'e1' },
  ],
};

// No environment resources referenced at all — the zero-cost path.
const NO_ENV_SPEC = {
  local_id: 'wf', oid: 'wf-no-env-terminal', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('s1', 'START'), step('s2', 'MATH'), step('e1', 'END')],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 'e1' },
  ],
};

// DOES reference an environment resource (hydration runs, context.envKnownNames non-empty) but
// acquires-then-releases within the SAME step, so envHolds is already [] by the time the
// instance reaches 'completed' — the case that actually exercises autoReleaseEnvHoldings' own
// early return, as opposed to NO_ENV_SPEC's "hydration never ran at all" zero-cost path.
const ACQUIRE_RELEASE_AUTO_SPEC = {
  local_id: 'wf', oid: 'wf-acquire-release-auto', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  steps: [
    step('s1', 'START'),
    step('s2', 'MATH', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
        { command_type: 'Release', resource_name: 'Printer', resource_source_oid: 'env-printer' },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 's2' },
    { from_step_id: 's2', to_step_id: 'e1' },
  ],
};

// ── 1: a granted acquire lands a holder row and bumps wc_resource.in_use ───────────────────────

test('a granted acquire lands a wc_resource_holder row and bumps wc_resource.in_use', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });
  const wi = await seedQueuedIn(db, wc, ACQUIRE_PARK_SPEC, 'wf-acquire-park');

  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('running'); // parked at 'ui', holding Printer
  const ui = await stepRow(db, wi.id, 'ui');
  expect(ui.state).toBe('WAITING_USER');

  const holders = await holdersOf(db, wi.id);
  expect(holders).toHaveLength(1);
  expect(holders[0]).toMatchObject({ name: 'Printer', stepOid: 'ui', amount: 1, heldName: null });

  const printer = await resourceRow(db, wc.id, 'Printer');
  expect(printer.inUse).toBe(1);

  await close();
});

// ── 2: a release frees capacity in the registry, not just in memory ────────────────────────────

test('a release frees capacity in the registry (a SEPARATE transaction from the one that acquired it)', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });
  const wi = await seedQueuedIn(db, wc, ACQUIRE_RELEASE_PARK_SPEC, 'wf-acquire-release-park');

  await pumpUntilQuiet(db, testDeps());
  expect((await holdersOf(db, wi.id))).toHaveLength(1);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1);

  // The release runs in a genuinely SEPARATE transaction (submitUserAction), driven by a FRESH
  // openContext hydration that re-reads the holder row this test just proved landed above.
  await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'submit' }, 0, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  expect((await holdersOf(db, wi.id))).toEqual([]);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);

  await close();
});

// ── cross-transaction sharing: the SECOND context genuinely sees the resource as held ─────────
//
// Task 4's implementer flagged this as untestable until write-back existed. Instance A acquires
// and parks (holding Printer, committed to the registry by test 1's own mechanism). Instance B
// is then opened in a COMPLETELY SEPARATE transaction (its own seedQueued + pumpUntilQuiet) and
// must see Printer as already held — genuine cross-instance, cross-transaction sharing, not an
// artifact of any in-memory state surviving between the two.

test('a resource held by one instance is seen as held by a FRESH context opened in a separate transaction', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });

  await seedQueuedIn(db, wc, ACQUIRE_PARK_SPEC, 'wf-acquire-park-a'); // A: id unused after this — B's own hydration is what's under test
  await pumpUntilQuiet(db, testDeps());
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1); // A holds it, committed

  // B is a DIFFERENT instance, opened via its OWN, later transactions.
  const b = await seedQueuedIn(db, wc, GRAB_PRINTER_SPEC, 'wf-grab-printer-b', 2);
  await pumpUntilQuiet(db, testDeps());

  const bAfter = await instanceRow(db, b.id);
  expect(bAfter.status).toBe('running'); // blocked — Printer unavailable
  const grab = await stepRow(db, b.id, 'grab');
  expect(grab.state).toBe('READY'); // blocked, but queue-state stays READY (design convention)
  const trace = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, b.id));
  expect(trace.some((t: { stepOid: string | null; state: string }) => t.stepOid === 'grab' && t.state === 'WAITING')).toBe(true);

  const waiters = await waitersOf(db, wc.id, 'Printer');
  expect(waiters).toHaveLength(1);
  expect(waiters[0]).toMatchObject({ instanceId: b.id, stepOid: 'grab', granted: false });

  // Also prove it directly through openContext (Task 3's own hydration seam), in yet another
  // fresh transaction: a brand-new WorkflowContext for B must hydrate Printer as already in use.
  await db.transaction(async (tx) => {
    const row = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, b.id));
    const context = await openContext(tx, {
      id: b.id, workCenterId: wc.id, specJsonb: GRAB_PRINTER_SPEC,
      engineState: row[0].engineState, propertyStore: row[0].propertyStore,
    }, testDeps());
    expect(context.envResources).not.toBeNull();
    const [printerState] = context.envResources!.getSnapshot().filter((s) => s.name === 'Printer');
    expect(printerState).toMatchObject({ total: 1, inUse: 1, available: 0 });
  });

  await close();
});

// ── 3: a release whose FIFO head belongs to ANOTHER instance flags that waiter granted ────────

test('a release whose FIFO head belongs to another instance flags that waiter granted, and does not delete it', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });

  const a = await seedQueuedIn(db, wc, ACQUIRE_RELEASE_PARK_SPEC, 'wf-a-release-park');
  await pumpUntilQuiet(db, testDeps()); // A holds Printer, parked at 'ui'

  const b = await seedQueuedIn(db, wc, GRAB_PRINTER_SPEC, 'wf-b-grab', 2);
  await pumpUntilQuiet(db, testDeps()); // B queues behind A

  const queuedBefore = await waitersOf(db, wc.id, 'Printer');
  expect(queuedBefore).toHaveLength(1);
  expect(queuedBefore[0]).toMatchObject({ instanceId: b.id, granted: false });
  const waiterId = queuedBefore[0].id;

  // A releases (its own 'ui' step's completion Release command), in a transaction that has
  // NOTHING to do with B — write-back must hand the grant off via the registry alone.
  await submitUserAction(db, a.id, { step_oid: 'ui', action: 'submit' }, 0, testDeps());

  const aAfter = await instanceRow(db, a.id);
  expect(aAfter.status).toBe('completed');

  // B's waiter row survives, SAME id (FIFO position preserved), now flagged granted — not
  // deleted, since B has not yet consumed the grant itself.
  const queuedAfter = await waitersOf(db, wc.id, 'Printer');
  expect(queuedAfter).toHaveLength(1);
  expect(queuedAfter[0].id).toBe(waiterId);
  expect(queuedAfter[0].granted).toBe(true);

  // A's own holder row is gone; B has not consumed the grant into a holder row yet, so there is
  // still zero holder rows — but the counter reflects the reservation FIFO already made for B.
  expect((await holdersOf(db, a.id))).toEqual([]);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1);

  await close();
});

// ── 4: a terminal instance auto-releases — completed / aborted / stopped / errored ────────────

test('a terminal instance auto-releases: completed (settle-before-persist ordering)', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });
  const wi = await seedQueuedIn(db, wc, ACQUIRE_HOLD_TO_END_SPEC, 'wf-acquire-hold-end');

  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  expect((after.engineState as EngineState).envHolds).toEqual([]);
  expect((await holdersOf(db, wi.id))).toEqual([]);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);

  await close();
});

test('a terminal instance auto-releases: errored (persist-before-settle ordering)', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });
  const wi = await seedQueuedIn(db, wc, ACQUIRE_THEN_THROW_SPEC, 'wf-acquire-then-throw');

  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('errored');
  expect((after.engineState as EngineState).envHolds).toEqual([]);
  expect((await holdersOf(db, wi.id))).toEqual([]);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);

  await close();
});

test('a terminal instance auto-releases: aborted (control pass, settle-before-persist ordering)', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });
  const wi = await seedQueuedIn(db, wc, ACQUIRE_PARK_SPEC, 'wf-abort-holding');

  await pumpUntilQuiet(db, testDeps()); // parks at 'ui', holding Printer
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1);

  await requestAbort(db, wi.id);
  const did = await runControlPass(db, testDeps());
  expect(did).toBe(true);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('aborted');
  expect((after.engineState as EngineState).envHolds).toEqual([]);
  expect((await holdersOf(db, wi.id))).toEqual([]);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);

  await close();
});

test('a terminal instance auto-releases: stopped (control pass, settle-before-persist ordering)', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });
  const wi = await seedQueuedIn(db, wc, ACQUIRE_PARK_SPEC, 'wf-stop-holding');

  await pumpUntilQuiet(db, testDeps()); // parks at 'ui' (WAITING_USER — not a STOP-active state)
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1);

  await requestStop(db, wi.id);
  const did = await runControlPass(db, testDeps());
  expect(did).toBe(true);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('stopped');
  expect((after.engineState as EngineState).envHolds).toEqual([]);
  expect((await holdersOf(db, wi.id))).toEqual([]);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);

  await close();
});

// ── 5: auto-release re-grants a queued foreign instance ────────────────────────────────────────

test('auto-release re-grants: A holds a binary-exclusive resource, B is queued; A aborts; B\'s waiter is flagged granted', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });

  const a = await seedQueuedIn(db, wc, ACQUIRE_PARK_SPEC, 'wf-a-holds');
  await pumpUntilQuiet(db, testDeps()); // A holds Printer, parked

  const b = await seedQueuedIn(db, wc, GRAB_PRINTER_SPEC, 'wf-b-queued', 2);
  await pumpUntilQuiet(db, testDeps()); // B queues behind A

  const queuedBefore = await waitersOf(db, wc.id, 'Printer');
  expect(queuedBefore).toHaveLength(1);
  expect(queuedBefore[0]).toMatchObject({ instanceId: b.id, granted: false });

  await requestAbort(db, a.id);
  const did = await runControlPass(db, testDeps());
  expect(did).toBe(true);

  const aAfter = await instanceRow(db, a.id);
  expect(aAfter.status).toBe('aborted');
  expect((await holdersOf(db, a.id))).toEqual([]);

  const queuedAfter = await waitersOf(db, wc.id, 'Printer');
  expect(queuedAfter).toHaveLength(1);
  expect(queuedAfter[0].instanceId).toBe(b.id);
  expect(queuedAfter[0].granted).toBe(true); // re-granted via A's auto-release
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1); // reserved for B's grant

  // review Critical 1: a granted-but-not-yet-consumed waiter is not the finish line — B's own
  // 'grab' step is still recorded in blockedOnResources, and processReadyStep's READY-row
  // picker skips anything already blocked. Without the Critical 1 fix (resumeGrantedSteps
  // called from the `!target` branch), B would sit here forever: every further pump just
  // rotates its claim order and finds nothing new to do.
  await pumpUntilQuiet(db, testDeps());
  const bAfter = await instanceRow(db, b.id);
  expect(bAfter.status).toBe('completed');
  expect((await waitersOf(db, wc.id, 'Printer'))).toEqual([]);
  expect((await holdersOf(db, b.id))).toEqual([]); // B ran straight through to its own auto-release
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);

  await close();
});

// ── review Critical 2: auto-release must not grant a self-queued waiter back to itself ────────
//
// Adapted from submit.test.ts's RES_BLOCK_SPEC precedent: a USER_INTERACTION branch holds the
// lock while parked, forcing a SIBLING branch of the SAME instance to genuinely queue behind it
// (not just race and lose). Aborting the whole instance while BOTH branches are still live
// exercises the exact shape processReadyStep's own head-of-line comment describes as expected —
// one branch holding, another of the SAME instance queued on the SAME resource.

const SELF_QUEUE_ABORT_SPEC = {
  local_id: 'wf', oid: 'wf-self-queue-abort', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  steps: [
    step('s1', 'START'),
    step('p1', 'PARALLEL'),
    step('branch-a', 'USER_INTERACTION', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
      ],
    }),
    step('branch-b', 'SCRIPT', {
      script_config: { source: 'output.x = 1;' },
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
      ],
    }),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'branch-a' },
    { from_step_id: 'p1', to_step_id: 'branch-b' },
    { from_step_id: 'branch-a', to_step_id: 'wa' },
    { from_step_id: 'branch-b', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
};

test("auto-release does not grant an instance's own queued waiter back to itself (self-queue on abort)", async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });
  const wi = await seedQueuedIn(db, wc, SELF_QUEUE_ABORT_SPEC, 'wf-self-queue-abort');

  await pumpUntilQuiet(db, testDeps());
  const branchA = await stepRow(db, wi.id, 'branch-a');
  expect(branchA.state).toBe('WAITING_USER'); // holds Printer while parked
  const branchB = await stepRow(db, wi.id, 'branch-b');
  expect(branchB.state).toBe('READY'); // blocked, queue-state stays READY (design convention)

  const selfQueued = await waitersOf(db, wc.id, 'Printer');
  expect(selfQueued).toHaveLength(1);
  expect(selfQueued[0]).toMatchObject({ instanceId: wi.id, stepOid: 'branch-b', granted: false });
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1);

  await requestAbort(db, wi.id);
  const did = await runControlPass(db, testDeps());
  expect(did).toBe(true);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('aborted');

  // Without the Critical 2 fix, release()'s own FIFO grant pass would find branch-b's token
  // still at the head of the (un-swept) live manager's queue and re-reserve the capacity for
  // it — inUse stuck at 1 with zero holders AND zero waiters (the waiter row already deleted
  // by releaseInstanceHoldings), a resource wedged for the whole work center forever.
  expect((await holdersOf(db, wi.id))).toEqual([]);
  expect((await waitersOf(db, wc.id, 'Printer'))).toEqual([]);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);

  await close();
});

// ── review round 2, Finding 1: a waiter GRANTED to this instance (not self-queued, never
// consumed) must give its reserved capacity back on terminal too — the mirror case of
// Critical 2's self-queue guard. ────────────────────────────────────────────────────────────

test("a waiter granted to this instance but never consumed gives its reserved capacity back when this instance aborts", async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });

  const y = await seedQueuedIn(db, wc, ACQUIRE_RELEASE_PARK_SPEC, 'wf-y-holds-releases');
  await pumpUntilQuiet(db, testDeps()); // Y holds Printer, parked at 'ui'

  const x = await seedQueuedIn(db, wc, GRAB_PRINTER_SPEC, 'wf-x-queued', 2);
  await pumpUntilQuiet(db, testDeps()); // X queues behind Y

  // Y releases in its OWN transaction — write-back hands the grant to X via the registry alone.
  await submitUserAction(db, y.id, { step_oid: 'ui', action: 'submit' }, 0, testDeps());

  const yAfter = await instanceRow(db, y.id);
  expect(yAfter.status).toBe('completed');
  const granted = await waitersOf(db, wc.id, 'Printer');
  expect(granted).toHaveLength(1);
  expect(granted[0]).toMatchObject({ instanceId: x.id, granted: true }); // X was granted...
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1); // ...capacity reserved for X
  expect((await holdersOf(db, x.id))).toEqual([]); // ...but X never consumed it

  // X aborts BEFORE its own next pump ever runs resumeGrantedSteps — the grant is never turned
  // into an envHolds entry. Without the Finding-1 fix, this reserved unit is lost: X's waiter
  // row gets deleted by releaseInstanceHoldings regardless, but nothing gives the capacity back.
  await requestAbort(db, x.id);
  const did = await runControlPass(db, testDeps());
  expect(did).toBe(true);

  const xAfter = await instanceRow(db, x.id);
  expect(xAfter.status).toBe('aborted');
  expect((await waitersOf(db, wc.id, 'Printer'))).toEqual([]);
  expect((await holdersOf(db, x.id))).toEqual([]);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);

  await close();
});

test("the reserved capacity cascades to the NEXT queued instance rather than evaporating (three-instance FIFO)", async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });

  const y = await seedQueuedIn(db, wc, ACQUIRE_RELEASE_PARK_SPEC, 'wf-y-holds-cascade');
  await pumpUntilQuiet(db, testDeps()); // Y holds Printer, parked at 'ui'

  const x = await seedQueuedIn(db, wc, GRAB_PRINTER_SPEC, 'wf-x-cascade', 2);
  await pumpUntilQuiet(db, testDeps()); // X queues behind Y (1st in line)

  const z = await seedQueuedIn(db, wc, GRAB_PRINTER_SPEC, 'wf-z-cascade', 3);
  await pumpUntilQuiet(db, testDeps()); // Z queues behind X (2nd in line)

  await submitUserAction(db, y.id, { step_oid: 'ui', action: 'submit' }, 0, testDeps()); // Y releases -> X granted

  const afterY = await waitersOf(db, wc.id, 'Printer');
  expect(afterY).toHaveLength(2);
  expect(afterY.find((w: { instanceId: string }) => w.instanceId === x.id)).toMatchObject({ granted: true });
  expect(afterY.find((w: { instanceId: string }) => w.instanceId === z.id)).toMatchObject({ granted: false }); // still queued behind X

  // X aborts having never consumed its grant — the reservation must cascade to Z, the next
  // waiter in FIFO order, not simply vanish.
  await requestAbort(db, x.id);
  const did = await runControlPass(db, testDeps());
  expect(did).toBe(true);

  const afterX = await waitersOf(db, wc.id, 'Printer');
  expect(afterX).toHaveLength(1);
  expect(afterX[0]).toMatchObject({ instanceId: z.id, granted: true }); // Z inherits the grant
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1); // reserved for Z, not 0

  // Full round trip: Z can actually consume it (round-1's Critical 1 fix — the worker loop must
  // still resume a granted-but-blocked instance on its own next claim).
  await pumpUntilQuiet(db, testDeps());
  const zAfter = await instanceRow(db, z.id);
  expect(zAfter.status).toBe('completed');
  expect((await waitersOf(db, wc.id, 'Printer'))).toEqual([]);
  expect((await holdersOf(db, z.id))).toEqual([]);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);

  await close();
});

// ── review round 3 (Critical): a grant this instance consumes AND auto-releases in the SAME
// transaction must not be double-released via a stale envSnapshot read. ───────────────────────

test("a self-consumed grant that completes the instance in ONE transaction is not double-released", async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });

  const y = await seedQueuedIn(db, wc, ACQUIRE_RELEASE_PARK_SPEC, 'wf-y-holds-doublerelease');
  await pumpUntilQuiet(db, testDeps()); // Y holds Printer, parked at 'ui'

  const w1 = await seedQueuedIn(db, wc, GRAB_PRINTER_SPEC, 'wf-w1-doublerelease', 2);
  await pumpUntilQuiet(db, testDeps()); // W1 queues behind Y (1st in line)

  const w2 = await seedQueuedIn(db, wc, GRAB_PRINTER_SPEC, 'wf-w2-doublerelease', 3);
  await pumpUntilQuiet(db, testDeps()); // W2 queues behind W1 (2nd in line)

  // Y releases in its own transaction — write-back grants W1 via the registry.
  await submitUserAction(db, y.id, { step_oid: 'ui', action: 'submit' }, 0, testDeps());
  const afterY = await waitersOf(db, wc.id, 'Printer');
  expect(afterY).toHaveLength(2);
  expect(afterY.find((w: { instanceId: string }) => w.instanceId === w1.id)).toMatchObject({ granted: true });
  expect(afterY.find((w: { instanceId: string }) => w.instanceId === w2.id)).toMatchObject({ granted: false });

  // W1's own hydration (its next claim) sees its waiter row still `granted: true` from that
  // snapshot — but resumeGrantedSteps (round 1's Critical 1 fix) consumes it, completes 'grab',
  // and cascades all the way to W1's own terminal settle (GRAB_PRINTER_SPEC's only remaining
  // step is END), ALL inside THIS ONE transaction. A stale-snapshot read of "what W1 still has
  // reserved" would see the SAME grant twice: once via state.envHolds (genuinely consumed) and
  // once via the frozen snapshot (never refreshed) — a double release.
  //
  // W1's own auto-release (settleTerminal firing inside that SAME transaction) then correctly
  // hands the now-freed unit to W2, still queued. If left running, the worker loop would go on
  // to ALSO resume-and-complete W2 in a LATER transaction (correct — GRAB_PRINTER_SPEC never
  // releases, so W2 completing auto-releases too, eventually reaching inUse: 0 with no waiters
  // at all — a DIFFERENT, later, equally-correct state). That would mask the exact window this
  // test targets: stop calling runOnce the INSTANT W1's own transaction commits (checking after
  // EACH call, never running a further one once W1 has settled) so the assertions below observe
  // the state exactly as W1's own transaction left it — before W2 ever gets a turn of its own.
  // A competing, still-blocked W2 can make the worker loop "win" a claim on W2 first without
  // doing anything useful (the pre-existing head-of-line bump) — unrelated to this fix, so the
  // loop below just keeps calling runOnce (bounded) until W1 SPECIFICALLY has settled.
  let w1Status = 'running';
  for (let i = 0; i < 50 && w1Status === 'running'; i++) {
    await runOnce(db, testDeps());
    w1Status = (await instanceRow(db, w1.id)).status;
  }
  expect(w1Status).toBe('completed');
  expect((await holdersOf(db, w1.id))).toEqual([]);

  // The double-release signature: inUse driven to 0 (one decrement too many) while W2's waiter
  // row simultaneously claims granted: true — a binary-exclusive resource the registry says is
  // free with a waiter row saying it is held. Correct behavior: inUse stays 1 (reserved for
  // W2), W2's row flips to granted: true, and nothing decrements a second time.
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1);
  const afterW1 = await waitersOf(db, wc.id, 'Printer');
  expect(afterW1).toHaveLength(1);
  expect(afterW1[0]).toMatchObject({ instanceId: w2.id, granted: true });

  await close();
});

// ── 6: an instance holding nothing settles without touching the registry ───────────────────────

test('an instance whose recipe names no environment resources at all settles without touching the registry (zero-cost path)', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, NO_ENV_SPEC, 'wf-no-env-terminal');

  const releaseSpy = vi.spyOn(wcResources, 'releaseInstanceHoldings');
  const lockSpy = vi.spyOn(wcResources, 'lockRegistry');

  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  expect(releaseSpy).not.toHaveBeenCalled();
  expect(lockSpy).not.toHaveBeenCalled(); // no environment resources referenced -> hydration never even ran

  releaseSpy.mockRestore();
  lockSpy.mockRestore();
  await close();
});

// review Minor: the test above never exercises autoReleaseEnvHoldings' own early return at
// all — lockRegistry was never going to be called regardless, since hydration itself never ran.
// This one DOES hydrate the environment tier (context.envKnownNames is non-empty) but ends the
// transition holding nothing.
//
// Whole-branch review C1 CHANGED this contract deliberately, and this test now pins the new one:
// the waiter/holder delete is UNCONDITIONAL (an instance can hold nothing and still own a waiter
// row — that was the Critical), so releaseInstanceHoldings always runs once for a hydrated
// instance. What is still worth proving is that the early-out AFTER it fires on a genuinely
// empty result: the delete found nothing, so nothing was swept, released, re-granted or written.
// The zero-cost path — a recipe that names no environment resource at all — keeps its stronger
// "never called" guarantee in the test above; that one is a provable no-op, this one is not.
test('an instance whose recipe names an environment resource, but holds none at terminal, still runs the unconditional waiter/holder delete and finds nothing', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });
  const wi = await seedQueuedIn(db, wc, ACQUIRE_RELEASE_AUTO_SPEC, 'wf-acquire-release-auto');

  const releaseSpy = vi.spyOn(wcResources, 'releaseInstanceHoldings');

  await pumpUntilQuiet(db, testDeps());

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  expect((after.engineState as EngineState).envHolds).toEqual([]);
  expect(releaseSpy).toHaveBeenCalledTimes(1);
  // `touched` came back empty — no row belonged to this instance — which is exactly the
  // condition the post-delete early-out tests before doing anything else.
  await expect(releaseSpy.mock.results[0]!.value).resolves.toEqual([]);
  expect(await waitersOf(db, wc.id, 'Printer')).toEqual([]);
  expect(await holdersOf(db, wi.id)).toEqual([]);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);

  releaseSpy.mockRestore();
  await close();
});

// ── whole-branch review, C1: a TERMINAL instance that holds nothing but is still QUEUED ────────
//
// `autoReleaseEnvHoldings` used to early-return on "nothing held, nothing reserved" BEFORE
// `releaseInstanceHoldings` ever ran, so a merely-QUEUED instance's `wc_resource_waiter` row
// outlived its own terminal settle. The holder's later release then shifted that DEAD token off
// the FIFO queue, set `in_use = 1` and flagged the dead instance's row `granted` — and nothing
// pumps a terminal instance (`claimInstanceForWork` filters on running), so the capacity was
// reserved forever: `in_use` non-zero, zero holder rows, zero live waiters, no self-healing
// path. Reachable through ordinary operator behaviour — an abort, or an orderly stop.

test('C1: an instance QUEUED on an environment resource (holding nothing) deletes its waiter row when ABORTED, and the resource returns to 0', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });

  const a = await seedQueuedIn(db, wc, ACQUIRE_PARK_SPEC, 'wf-c1-abort-holder');
  await pumpUntilQuiet(db, testDeps()); // A holds Printer, parked at 'ui'
  const b = await seedQueuedIn(db, wc, GRAB_PRINTER_SPEC, 'wf-c1-abort-queued', 2);
  await pumpUntilQuiet(db, testDeps()); // B queues behind A — holding NOTHING

  expect(await holdersOf(db, b.id)).toEqual([]);
  const queuedBefore = await waitersOf(db, wc.id, 'Printer');
  expect(queuedBefore).toHaveLength(1);
  expect(queuedBefore[0]).toMatchObject({ instanceId: b.id, stepOid: 'grab', granted: false });

  await requestAbort(db, b.id);
  expect(await runControlPass(db, testDeps())).toBe(true);
  expect((await instanceRow(db, b.id)).status).toBe('aborted');

  // The defect itself: B's own terminal settle must take its waiter row with it.
  expect(await waitersOf(db, wc.id, 'Printer')).toEqual([]);

  // ...and the wedge it caused: A's release must find an EMPTY queue and hand the unit back to
  // the pool, not reserve it for a dead instance's orphaned token.
  await requestAbort(db, a.id);
  expect(await runControlPass(db, testDeps())).toBe(true);
  expect((await instanceRow(db, a.id)).status).toBe('aborted');
  expect(await holdersOf(db, a.id)).toEqual([]);
  expect(await waitersOf(db, wc.id, 'Printer')).toEqual([]);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);

  await close();
});

test('C1: the same holds for an ORDERLY STOP of a queued-but-holding-nothing instance (a resource-blocked step is READY, which the stop drain cancels rather than drains)', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });

  const a = await seedQueuedIn(db, wc, ACQUIRE_PARK_SPEC, 'wf-c1-stop-holder');
  await pumpUntilQuiet(db, testDeps()); // A holds Printer, parked at 'ui'
  const b = await seedQueuedIn(db, wc, GRAB_PRINTER_SPEC, 'wf-c1-stop-queued', 2);
  await pumpUntilQuiet(db, testDeps()); // B queues behind A — holding NOTHING

  expect(await waitersOf(db, wc.id, 'Printer')).toHaveLength(1);

  await requestStop(db, b.id);
  expect(await runControlPass(db, testDeps())).toBe(true);
  expect((await instanceRow(db, b.id)).status).toBe('stopped');
  expect(await waitersOf(db, wc.id, 'Printer')).toEqual([]);

  await requestAbort(db, a.id);
  expect(await runControlPass(db, testDeps())).toBe(true);
  expect(await waitersOf(db, wc.id, 'Printer')).toEqual([]);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);

  await close();
});

// ── whole-branch review, I1: a countable resource this instance only WAITED on still needs a
// FIFO grant pass when that wait is cancelled. Countable's strict no-skip rule makes "free
// capacity + a non-empty queue" a legitimate steady state, so removing a too-large head must
// re-run the pass or the smaller, satisfiable request behind it strands indefinitely. ─────────

const ENV_SLOTS = {
  local_id: 'env-slots-lib', oid: 'env-slots', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'Slots', resource_type: 'countable use with pool limits', use_limit: 5 }],
};

/** Acquires 3 of the 5 slots and parks (WAITING_USER) without releasing — the holder. */
const SLOTS_PARK_SPEC = {
  local_id: 'wf', oid: 'wf-slots-park', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_SLOTS],
  steps: [
    step('s1', 'START'),
    step('ui', 'USER_INTERACTION', {
      resource_command_specifications: [
        { command_type: 'Acquire Pool Amount', resource_name: 'Slots', resource_source_oid: 'env-slots', amount: 3 },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [{ from_step_id: 's1', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'e1' }],
};

const slotsGrabSpec = (oid: string, amount: number) => ({
  local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_SLOTS],
  steps: [
    step('s1', 'START'),
    step('grab', 'MATH', {
      resource_command_specifications: [
        { command_type: 'Acquire Pool Amount', resource_name: 'Slots', resource_source_oid: 'env-slots', amount },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [{ from_step_id: 's1', to_step_id: 'grab' }, { from_step_id: 'grab', to_step_id: 'e1' }],
});

test('I1: aborting an instance that only WAITED on a countable resource re-runs its FIFO grant pass, so the smaller request behind it is no longer stranded', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({
    workCenterId: wc.id, name: 'Slots', resourceType: 'countable use with pool limits', useLimit: 5,
  });

  const a = await seedQueuedIn(db, wc, SLOTS_PARK_SPEC, 'wf-slots-park');
  await pumpUntilQuiet(db, testDeps()); // A holds 3 of 5, parked
  expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(3);

  const b = await seedQueuedIn(db, wc, slotsGrabSpec('wf-slots-b3', 3), 'wf-slots-b3', 2);
  await pumpUntilQuiet(db, testDeps()); // B wants 3 — 3+3 > 5, so it queues
  const c = await seedQueuedIn(db, wc, slotsGrabSpec('wf-slots-c1', 1), 'wf-slots-c1', 3);
  await pumpUntilQuiet(db, testDeps()); // C wants 1 — it FITS, but no-skip keeps it behind B

  const queued = await waitersOf(db, wc.id, 'Slots');
  expect(queued.map((w: { instanceId: string }) => w.instanceId)).toEqual([b.id, c.id]);
  expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(3);

  // B goes terminal holding nothing. Its row must go (C1) AND the queue it was blocking must
  // get a fresh grant pass (I1) — otherwise C sits behind a head that no longer exists, with
  // two free units in the pool and nothing left that will ever call release() on Slots.
  await requestAbort(db, b.id);
  expect(await runControlPass(db, testDeps())).toBe(true);
  expect((await instanceRow(db, b.id)).status).toBe('aborted');

  const afterAbort = await waitersOf(db, wc.id, 'Slots');
  expect(afterAbort).toHaveLength(1);
  expect(afterAbort[0]).toMatchObject({ instanceId: c.id, granted: true });
  expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(4); // 3 held by A + 1 reserved for C

  await close();
});

// ── whole-branch review, C2: knownStepOids is an incomplete cover of this instance's own
// environment tokens — tearDownActiveChild deletes a childActive link (and every row under it)
// and sweeps NOTHING, so a torn-down child step's queued token is invisible to every sweep
// scoped by knownStepOids from that moment on. A GOTO back onto the WORKFLOW PROXY is the
// ordinary route: re-activation calls clearStepScopedState, which drops blockedOnResources for
// the dead step with no paired queue sweep in either tier; a foreign release then grants to the
// orphaned token, resumeGrantedSteps drops the unconsumable grant with a warning, diffRegistry
// reads "granted at load, gone from pendingGrants" as CONSUMED and deletes the row — and the
// counter echo leaves in_use elevated with zero holders and zero waiters. ─────────────────────

const CHILD_ENV_ACQUIRE = {
  local_id: 'ChildRef', oid: 'child-env-acquire', version: '1.0.0', last_modified_date: '2026-01-01',
  parentChildSpecId: null, state: 'Effective',
  steps: [
    step('cs1', 'START'),
    // Parks BEFORE the acquire, so the re-activated (attempt 2) child stops here and never
    // re-queues 'cgrab' — which is what leaves attempt 1's token genuinely orphaned rather
    // than coincidentally re-adopted by an identical token from the next attempt.
    step('cpark', 'USER_INTERACTION'),
    step('cgrab', 'MATH', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
      ],
    }),
    step('ce1', 'END'),
  ],
  connections: [
    { from_step_id: 'cs1', to_step_id: 'cpark' },
    { from_step_id: 'cpark', to_step_id: 'cgrab' },
    { from_step_id: 'cgrab', to_step_id: 'ce1' },
  ],
};

const GOTO_PROXY_SPEC = {
  local_id: 'wf', oid: 'wf-goto-proxy-orphan', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  steps: [
    step('s1', 'START'),
    step('p1', 'PARALLEL'),
    step('proxy', 'WORKFLOW PROXY', { local_id: 'ChildRef' }),
    step('ui2', 'USER_INTERACTION', { try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
    step('c1', 'CATCH', { catch_id: 'C1' }),
    step('r1', 'RETURN', { return_config: { command: 'GOTO', goto_step_oid: 'proxy' } }),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'proxy' },
    { from_step_id: 'p1', to_step_id: 'ui2' },
    { from_step_id: 'proxy', to_step_id: 'wa' },
    { from_step_id: 'ui2', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
    { from_step_id: 'c1', to_step_id: 'r1' },
  ],
  children: [CHILD_ENV_ACQUIRE],
};

test('C2: a child step queued on an environment resource loses its waiter row when its WORKFLOW PROXY is torn down and re-activated by a GOTO — a later foreign release cannot wedge the resource', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });

  // A foreign instance holds Printer and can release it on demand.
  const a = await seedQueuedIn(db, wc, ACQUIRE_RELEASE_PARK_SPEC, 'wf-c2-holder');
  await pumpUntilQuiet(db, testDeps());
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1);

  const b = await seedQueuedIn(db, wc, GOTO_PROXY_SPEC, 'wf-goto-proxy-orphan', 2);
  await pumpUntilQuiet(db, testDeps());
  expect((await stepRow(db, b.id, 'cpark')).state).toBe('WAITING_USER'); // child attempt 1 parked
  expect((await stepRow(db, b.id, 'ui2')).state).toBe('WAITING_USER');

  // Attempt 1's child reaches the Acquire and QUEUES behind A.
  await submitUserAction(db, b.id, { step_oid: 'cpark', action: 'submit' }, 0, testDeps());
  const queued = await waitersOf(db, wc.id, 'Printer');
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ instanceId: b.id, stepOid: 'cgrab', granted: false });
  expect((await instanceRow(db, b.id)).engineState.blockedOnResources).toHaveProperty('cgrab');

  // The sibling branch fails into its CATCH, whose RETURN GOTOs back onto the WORKFLOW PROXY:
  // tearDownActiveChild drops attempt 1 wholesale and the proxy re-activates a fresh child,
  // which parks at 'cpark' again and never re-queues 'cgrab'.
  await submitUserAction(db, b.id, { step_oid: 'ui2', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, testDeps());
  const bMid = await instanceRow(db, b.id);
  expect(bMid.status).toBe('running');
  expect((await stepRow(db, b.id, 'cpark')).state).toBe('WAITING_USER'); // attempt 2, fresh
  // The re-activation cleared the block record for the dead step...
  expect(bMid.engineState.blockedOnResources).not.toHaveProperty('cgrab');
  // ...so its waiter row must have gone with it. THIS is the orphan.
  expect(await waitersOf(db, wc.id, 'Printer')).toEqual([]);

  // A releases. With the orphan still queued, the FIFO pass hands the unit to a step that no
  // longer exists; the grant is then dropped on B's next claim and the row deleted, leaving
  // in_use = 1 with zero holders and zero waiters — wedged for the whole work center.
  await submitUserAction(db, a.id, { step_oid: 'ui', action: 'submit' }, 0, testDeps());
  expect((await instanceRow(db, a.id)).status).toBe('completed');
  await pumpUntilQuiet(db, testDeps());

  expect(await waitersOf(db, wc.id, 'Printer')).toEqual([]);
  expect(await holdersOf(db, b.id)).toEqual([]);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);

  await close();
});
