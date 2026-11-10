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
// User ruling 2026-11-10: an Environment resource held by a workflow is NOT released when that
// workflow ends — one workflow may acquire it and another release it. A Release by a workflow that
// holds none of the resource TAKES OVER another instance's holder rows (consumeForeignHolders), so
// the ledger keeps matching the counter and the former holder's own later Release is skipped
// (revoked-hold marker) instead of freeing the unit a second time.
import { expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { submitUserAction } from '../src/core/submit.js';
import { openContext } from '../src/core/context.js';
import { runSweep } from '../src/core/sweep.js';
import {
  workCenter, workflow, workflowInstance, stepInstance, wcResource, wcResourceHolder,
} from 'mission-control-db/src/db/schema/index';
import type { EngineState } from '../src/core/engine-state.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

let runtimeCounter = 0;

async function makeWc(db: AnyDb): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  return wc;
}

/** Seed one queued instance of `spec` under a fresh workflow oid (`workflow_entry_uq` is per oid). */
async function seed(db: AnyDb, wc: { id: string }, spec: Record<string, unknown>, oid: string): Promise<string> {
  const s = { ...spec, oid };
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: s,
  }).returning();
  const n = ++runtimeCounter;
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: s, startingParams: null, runtimeNumber: n, runtimeLabel: `RW-${n}`,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return wi.id;
}

async function instanceRow(db: AnyDb, id: string) {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, id));
  return row;
}

async function stepState(db: AnyDb, id: string, stepOid: string) {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, id));
  return rows.find((r: { stepOid: string }) => r.stepOid === stepOid)?.state;
}

async function resourceRow(db: AnyDb, wcId: string, name: string) {
  const [row] = await db.select().from(wcResource).where(and(eq(wcResource.workCenterId, wcId), eq(wcResource.name, name)));
  return row;
}

/** Every holder row on `name` as [instanceId, amount, heldName], oldest first. */
async function holders(db: AnyDb, wcId: string, name: string) {
  const rows = await db.select().from(wcResourceHolder)
    .where(and(eq(wcResourceHolder.workCenterId, wcId), eq(wcResourceHolder.name, name)))
    .orderBy(wcResourceHolder.id);
  return rows.map((h: { instanceId: string; amount: number; heldName: string | null }) => [h.instanceId, h.amount, h.heldName]);
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────

const ENV = {
  local_id: 'env-lib', oid: 'env-x', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [
    { name: 'Printer', resource_type: 'binary exclusive use' },
    { name: 'Slots', resource_type: 'countable use with pool limits', use_limit: 9 },
    { name: 'Bays', resource_type: 'named pool', names: ['Bay 1', 'Bay 2'] },
  ],
};
const cmd = (command_type: string, resource_name: string, extra: Record<string, unknown> = {}) => ({
  command_type, resource_name, resource_source_oid: 'env-x', ...extra,
});

/** START -> one step carrying `cmds` -> END. `park` makes it a USER_INTERACTION. */
function oneStep(cmds: unknown[], park = false, extra: Record<string, unknown> = {}) {
  return {
    local_id: 'wf', oid: 'placeholder', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: [ENV],
    ...extra,
    steps: [
      step('s1', 'START'),
      step('x', park ? 'USER_INTERACTION' : 'MATH', { resource_command_specifications: cmds }),
      step('e1', 'END'),
    ],
    connections: [{ from_step_id: 's1', to_step_id: 'x' }, { from_step_id: 'x', to_step_id: 'e1' }],
  };
}

async function registry(db: AnyDb) {
  const wc = await makeWc(db);
  await db.insert(wcResource).values([
    { workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' },
    { workCenterId: wc.id, name: 'Slots', resourceType: 'countable use with pool limits', useLimit: 9 },
    { workCenterId: wc.id, name: 'Bays', resourceType: 'named pool', poolNames: ['Bay 1', 'Bay 2'], availableNames: ['Bay 1', 'Bay 2'] },
  ]);
  return wc;
}

// ── Single Use ────────────────────────────────────────────────────────────────────────────────

test('Single Use: A acquires and completes holding it; B\'s Release takes the hold over; C can then acquire', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await registry(db);
    const a = await seed(db, wc, oneStep([cmd('Acquire', 'Printer')]), 'wf-a');
    await pumpUntilQuiet(db, testDeps());
    expect((await instanceRow(db, a)).status).toBe('completed');
    expect(await holders(db, wc.id, 'Printer')).toEqual([[a, 1, null]]);
    expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1);

    const b = await seed(db, wc, oneStep([cmd('Release', 'Printer')]), 'wf-b');
    await pumpUntilQuiet(db, testDeps());
    expect((await instanceRow(db, b)).status).toBe('completed');
    expect(await holders(db, wc.id, 'Printer')).toEqual([]);
    expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);

    const c = await seed(db, wc, oneStep([cmd('Acquire', 'Printer')], true), 'wf-c');
    await pumpUntilQuiet(db, testDeps());
    expect(await stepState(db, c, 'x')).toBe('WAITING_USER'); // granted at once, parked holding it
    expect(await holders(db, wc.id, 'Printer')).toEqual([[c, 1, null]]);
    expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1);
  } finally { await close(); }
});

test('A holds (still running), B releases it, C acquires it — A\'s own later Release is skipped and C keeps it', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await registry(db);
    const a = await seed(db, wc, oneStep([cmd('Acquire', 'Printer'), cmd('Release', 'Printer')], true), 'wf-a');
    await pumpUntilQuiet(db, testDeps());
    expect(await stepState(db, a, 'x')).toBe('WAITING_USER');

    await seed(db, wc, oneStep([cmd('Release', 'Printer')]), 'wf-b');
    await pumpUntilQuiet(db, testDeps());
    expect(await holders(db, wc.id, 'Printer')).toEqual([]);

    const c = await seed(db, wc, oneStep([cmd('Acquire', 'Printer')], true), 'wf-c');
    await pumpUntilQuiet(db, testDeps());
    expect(await holders(db, wc.id, 'Printer')).toEqual([[c, 1, null]]);

    // A's step completes and runs its declared Release. Its hold was taken over, so the
    // revoked-hold marker absorbs it — freeing it would take C's unit.
    await submitUserAction(db, a, { step_oid: 'x', action: 'submit' }, 0, testDeps());
    const aRow = await instanceRow(db, a);
    expect(aRow.status).toBe('completed');
    expect((aRow.engineState as EngineState).envHoldsRevoked).toEqual([]); // consumed by the Release
    expect(await holders(db, wc.id, 'Printer')).toEqual([[c, 1, null]]);
    expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1);
  } finally { await close(); }
});

// ── Count pool ────────────────────────────────────────────────────────────────────────────────

test('count pool: a foreign Release consumes holder rows OLDEST first, decrementing; releasing more than is held empties them all', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await registry(db);
    const a = await seed(db, wc, oneStep([cmd('Acquire Pool Amount', 'Slots', { amount: 3 })]), 'wf-a');
    await pumpUntilQuiet(db, testDeps());
    const d = await seed(db, wc, oneStep([cmd('Acquire Pool Amount', 'Slots', { amount: 2 })]), 'wf-d');
    await pumpUntilQuiet(db, testDeps());
    expect(await holders(db, wc.id, 'Slots')).toEqual([[a, 3, null], [d, 2, null]]);
    expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(5);

    await seed(db, wc, oneStep([cmd('Release Pool Amount', 'Slots', { amount: 4 })]), 'wf-b4');
    await pumpUntilQuiet(db, testDeps());
    expect(await holders(db, wc.id, 'Slots')).toEqual([[d, 1, null]]);
    expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(1);

    await seed(db, wc, oneStep([cmd('Release Pool Amount', 'Slots', { amount: 9 })]), 'wf-b9');
    await pumpUntilQuiet(db, testDeps());
    expect(await holders(db, wc.id, 'Slots')).toEqual([]);
    expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(0); // floors at 0, as before
  } finally { await close(); }
});

test('count pool: a PARTLY taken-over hold leaves a marker for the taken part only, so the holder\'s own Release frees only what it still holds', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await registry(db);
    const a = await seed(db, wc, oneStep([
      cmd('Acquire Pool Amount', 'Slots', { amount: 5 }), cmd('Release Pool Amount', 'Slots', { amount: 5 }),
    ], true), 'wf-a');
    await pumpUntilQuiet(db, testDeps());
    expect(await holders(db, wc.id, 'Slots')).toEqual([[a, 5, null]]);

    await seed(db, wc, oneStep([cmd('Release Pool Amount', 'Slots', { amount: 3 })]), 'wf-b');
    await pumpUntilQuiet(db, testDeps());
    expect(await holders(db, wc.id, 'Slots')).toEqual([[a, 2, null]]);
    expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(2);

    // A's next hydration: the row shrank 5 -> 2, a PARTIAL revocation.
    const row = await instanceRow(db, a);
    await db.transaction(async (tx: AnyDb) => {
      const ctx = await openContext(tx, {
        id: a, workCenterId: wc.id, specJsonb: row.specJsonb, engineState: row.engineState, propertyStore: row.propertyStore,
      }, testDeps());
      expect(ctx.state.envHolds).toEqual([{ name: 'Slots', stepOid: 'x', amount: 2, heldName: null }]);
      expect(ctx.state.envHoldsRevoked).toEqual([{ name: 'Slots', stepOid: 'x', amount: 3, heldName: null }]);
    });

    const c = await seed(db, wc, oneStep([cmd('Acquire Pool Amount', 'Slots', { amount: 3 })], true), 'wf-c');
    await pumpUntilQuiet(db, testDeps());
    expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(5);

    // A releases 5: 2 of its own, the other 3 are absorbed by the marker — C's 3 stay.
    await submitUserAction(db, a, { step_oid: 'x', action: 'submit' }, 0, testDeps());
    expect((await instanceRow(db, a)).status).toBe('completed');
    expect(await holders(db, wc.id, 'Slots')).toEqual([[c, 3, null]]);
    expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(3);
  } finally { await close(); }
});

// ── Named pool ────────────────────────────────────────────────────────────────────────────────

test('named pool: a foreign Release of "Bay 2" takes over only the row holding "Bay 2"', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await registry(db);
    const a = await seed(db, wc, oneStep([cmd('Acquire', 'Bays', { target: 'Order.Bay' })], false, {
      value_property_specifications: [{ name: 'Order', entries: [{ name: 'Bay', value: '' }] }],
    }), 'wf-a');
    await pumpUntilQuiet(db, testDeps());
    const d = await seed(db, wc, oneStep([cmd('Acquire', 'Bays', { target: 'Order.Bay' })], false, {
      value_property_specifications: [{ name: 'Order', entries: [{ name: 'Bay', value: '' }] }],
    }), 'wf-d');
    await pumpUntilQuiet(db, testDeps());
    expect(await holders(db, wc.id, 'Bays')).toEqual([[a, 1, 'Bay 1'], [d, 1, 'Bay 2']]);

    await seed(db, wc, oneStep([cmd('Release', 'Bays', { target: 'Order.Bay' })], false, {
      value_property_specifications: [{ name: 'Order', entries: [{ name: 'Bay', value: 'Bay 2' }] }],
    }), 'wf-b');
    await pumpUntilQuiet(db, testDeps());
    expect(await holders(db, wc.id, 'Bays')).toEqual([[a, 1, 'Bay 1']]);
    expect((await resourceRow(db, wc.id, 'Bays')).availableNames).toEqual(['Bay 2']);
  } finally { await close(); }
});

// ── tiers and retention ──────────────────────────────────────────────────────────────────────

test('a workflow-tier resource is unchanged: it never reaches the registry and dies with its instance', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await registry(db);
    const spec = {
      local_id: 'wf', oid: 'placeholder', version: '1.0.0', last_modified_date: '2026-01-01',
      resource_property_specifications: [{ name: 'Ink', resource_type: 'binary exclusive use' }],
      steps: [
        step('s1', 'START'),
        step('x', 'MATH', { resource_command_specifications: [{ command_type: 'Acquire', resource_name: 'Ink' }] }),
        step('e1', 'END'),
      ],
      connections: [{ from_step_id: 's1', to_step_id: 'x' }, { from_step_id: 'x', to_step_id: 'e1' }],
    };
    const a = await seed(db, wc, spec, 'wf-ink');
    await pumpUntilQuiet(db, testDeps());
    const row = await instanceRow(db, a);
    expect(row.status).toBe('completed');
    expect((row.engineState as EngineState).envHolds).toEqual([]);
    expect(await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, a))).toEqual([]);
  } finally { await close(); }
});

test('the retention sweep keeps a finished instance that still holds an environment resource, and sweeps it once the hold is taken over', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await registry(db);
    await db.update(workCenter).set({ finishedRetentionSecs: 0 }).where(eq(workCenter.id, wc.id));
    const a = await seed(db, wc, oneStep([cmd('Acquire', 'Printer')]), 'wf-a');
    await pumpUntilQuiet(db, testDeps());
    expect((await instanceRow(db, a)).status).toBe('completed');

    const later = () => new Date(Date.now() + 60_000);
    await runSweep(db, later, { workCenterIds: [wc.id] });
    expect(await instanceRow(db, a)).toBeDefined(); // still holds Printer: kept
    expect(await holders(db, wc.id, 'Printer')).toEqual([[a, 1, null]]);

    const b = await seed(db, wc, oneStep([cmd('Release', 'Printer')]), 'wf-b');
    await pumpUntilQuiet(db, testDeps());
    await runSweep(db, later, { workCenterIds: [wc.id] });
    expect(await instanceRow(db, a)).toBeUndefined(); // holds nothing any more: swept
    expect(await instanceRow(db, b)).toBeUndefined();
    expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);
  } finally { await close(); }
});
