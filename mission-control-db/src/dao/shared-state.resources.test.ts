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

import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { runtimeCols } from '../../test/helpers/instances.js';
import {
  workCenter, workflow, workflowInstance, environmentSpec, wcResource, wcResourceHolder, wcResourceWaiter,
} from '../db/schema/index.js';
import { listWorkCenterResources, listEnvironmentResources } from './shared-state.js';

// A frozen recipe with a root step, a second root step, and a child step — the step-name
// walk must find all three (holder/waiter rows carry only a step oid).
const SPEC = {
  oid: 'wf-1', steps: [{ oid: 's-mix', local_id: 'Mix Step' }, { oid: 's-pack', local_id: 'Pack' }], connections: [],
  children: [{ oid: 'wf-1-c1', local_id: 'Sub', steps: [{ oid: 's-child', local_id: 'Child Step' }], connections: [] }],
};

async function seed(db: any) {
  const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
  const [env] = await db.insert(environmentSpec).values({
    oid: 'env-1', name: 'Kitchen', workCenterId: wc.id, version: '1.2.0', state: 'Effective',
    specJsonb: { resource_property_specifications: [
      { name: 'Printer', resource_type: 'binary exclusive use' },
      { name: 'Ghost', resource_type: 'sync' },
    ] },
  }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'wf-1', name: 'Fill', workCenterId: wc.id, specJsonb: SPEC }).returning();
  const instance = async (n: number) => {
    const [i] = await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running',
      ...runtimeCols({ specJsonb: SPEC, runtimeNumber: n, masterName: 'Fill' }),
    }).returning();
    return i;
  };
  const resource = (values: Record<string, unknown>) => db.insert(wcResource).values({
    workCenterId: wc.id, definedByEnvSpecId: env.id,
    definedFromName: 'Kitchen', definedFromVersion: '1.2.0', definedFromState: 'Effective',
    ...values,
  });
  return { wc, env, wf, instance, resource };
}

test('lists a resource with the engine summary, holders as RW + step name, waiters in FIFO order', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, env, instance, resource } = await seed(db);
    await resource({ name: 'Printer', resourceType: 'binary exclusive use', inUse: 1 });
    const holder = await instance(7);
    const first = await instance(8);
    const second = await instance(9);
    const [holderRow] = await db.insert(wcResourceHolder).values({ workCenterId: wc.id, name: 'Printer', instanceId: holder.id, stepOid: 's-mix', amount: 1 }).returning();
    // Insert order = identity order = FIFO order. enqueuedAt is set OUT of that order — the
    // second-inserted (higher-id) row gets the EARLIER timestamp — so the FIFO assertion below
    // can only pass if the DAO orders by the identity id, not by enqueuedAt.
    await db.insert(wcResourceWaiter).values({ workCenterId: wc.id, name: 'Printer', instanceId: first.id, stepOid: 's-pack', kind: 'acquire', enqueuedAt: new Date('2026-01-01T00:00:10Z') });
    await db.insert(wcResourceWaiter).values({ workCenterId: wc.id, name: 'Printer', instanceId: second.id, stepOid: 's-child', kind: 'acquire', granted: true, enqueuedAt: new Date('2026-01-01T00:00:00Z') });

    const views = await listWorkCenterResources(db, wc.id);
    expect(views).toHaveLength(1);
    const printer = views![0];
    // queued excludes the granted waiter (spec §6.1 vocabulary parity with the engine's own
    // hydration filter) — of the two waiters, only the non-granted one counts.
    expect(printer.summary).toEqual({ total: 1, inUse: 1, available: 0, queued: 1, state: 'In use' });
    expect(printer.holders).toHaveLength(1);
    expect(printer.holders[0]).toMatchObject({ instanceId: holder.id, runtimeNumber: 7, masterName: 'Fill', stepOid: 's-mix', stepName: 'Mix Step', amount: 1, heldName: null });
    expect(printer.holders[0].acquiredAt).toBeInstanceOf(Date);
    // Phase 4b (D18): release-holder names a holder by its row id, so the view must carry it.
    expect(printer.holders[0].id).toBe(holderRow.id);
    expect(typeof printer.holders[0].id).toBe('number');
    expect(printer.waiters.map((w) => w.runtimeNumber)).toEqual([8, 9]);
    expect(printer.waiters[1]).toMatchObject({ stepName: 'Child Step', kind: 'acquire', granted: true });
    expect(printer.unaccounted).toBe(0);
    expect(printer.ledgerMismatch).toBe(false);
    expect(printer.overCommitted).toBe(false);
    expect(printer.definedBy).toEqual({ envSpecId: env.id, name: 'Kitchen', version: '1.2.0', state: 'Effective' });
    expect(printer.orphaned).toBe(false);
  } finally { await close(); }
});

test('unaccounted, over-committed and ledger mismatch follow spec 4.1 per type', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, instance, resource } = await seed(db);
    const i = await instance(1);
    // Countable, use_limit shrunk below in_use, one holder of 2 -> 3 unaccounted, over-committed.
    await resource({ name: 'Slots', resourceType: 'countable use with pool limits', useLimit: 3, inUse: 5 });
    await db.insert(wcResourceHolder).values({ workCenterId: wc.id, name: 'Slots', instanceId: i.id, stepOid: 's-mix', amount: 2 });
    // Named pool: A and B held, only A attributed -> B unaccounted. No stray holder.
    await resource({ name: 'Bays', resourceType: 'named pool', poolNames: ['A', 'B', 'C'], availableNames: ['C'] });
    await db.insert(wcResourceHolder).values({ workCenterId: wc.id, name: 'Bays', instanceId: i.id, stepOid: 's-mix', amount: 1, heldName: 'A' });
    // Named pool whose holder claims a FREE name -> ledger mismatch.
    await resource({ name: 'Docks', resourceType: 'named pool', poolNames: ['X', 'Y'], availableNames: ['X', 'Y'] });
    await db.insert(wcResourceHolder).values({ workCenterId: wc.id, name: 'Docks', instanceId: i.id, stepOid: 's-mix', amount: 1, heldName: 'X' });
    // Binary with a stranded holder but in_use 0 -> clamped to 0, mismatch flagged (12.1 item 7).
    await resource({ name: 'Lock', resourceType: 'binary exclusive use', inUse: 0 });
    await db.insert(wcResourceHolder).values({ workCenterId: wc.id, name: 'Lock', instanceId: i.id, stepOid: 's-pack', amount: 1 });
    // Sync: no capacity, only queues; unaccounted is not applicable.
    await resource({ name: 'Chan', resourceType: 'sync' });
    await db.insert(wcResourceWaiter).values({ workCenterId: wc.id, name: 'Chan', instanceId: i.id, stepOid: 's-mix', kind: 'send', payload: 'hi' });
    await db.insert(wcResourceWaiter).values({ workCenterId: wc.id, name: 'Chan', instanceId: i.id, stepOid: 's-pack', kind: 'receive' });
    // Countable with NULL use_limit -> capacity 1 (the hydration default).
    await resource({ name: 'One', resourceType: 'countable use with pool limits', useLimit: null, inUse: 0 });
    // Countable with NULL use_limit AND in_use above the resolved capacity (1) -> over-committed
    // must read through summary.total (which applies the ?? 1 default), not a raw
    // `useLimit !== null` check that would read NULL as "unlimited" (finding 1). The 'One' case
    // above uses inUse: 0 and cannot catch a regression here.
    await resource({ name: 'Two', resourceType: 'countable use with pool limits', useLimit: null, inUse: 2 });

    const byName = Object.fromEntries((await listWorkCenterResources(db, wc.id))!.map((v) => [v.name, v]));
    expect(byName.Slots).toMatchObject({ unaccounted: 3, overCommitted: true, ledgerMismatch: false });
    expect(byName.Slots.summary.state).toBe('5/3 in use');
    expect(byName.Bays).toMatchObject({ unaccounted: 1, ledgerMismatch: false });
    expect(byName.Bays.summary.state).toBe('1 available, 2 in use');
    expect(byName.Docks).toMatchObject({ unaccounted: 0, ledgerMismatch: true });
    expect(byName.Lock).toMatchObject({ unaccounted: 0, ledgerMismatch: true });
    expect(byName.Chan).toMatchObject({ unaccounted: null, ledgerMismatch: false });
    expect(byName.Chan.summary.state).toBe('send:1 recv:1 sync:0');
    expect(byName.One.summary).toMatchObject({ total: 1, state: '0/1 in use' });
    expect(byName.Two).toMatchObject({ overCommitted: true });
    expect(byName.Two.summary.state).toBe('2/1 in use');
    // Ordered by name.
    expect(Object.keys(byName)).toEqual(['Bays', 'Chan', 'Docks', 'Lock', 'One', 'Slots', 'Two']);
  } finally { await close(); }
});

test('the environment view filters to the declared names and lists the unregistered ones', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, env, resource } = await seed(db);
    await resource({ name: 'Printer', resourceType: 'binary exclusive use' });
    await resource({ name: 'Extra', resourceType: 'sync' }); // in the registry, not declared by this spec
    // 'Ghost' is declared by the spec but has no registry row (the no-backfill trap, 12.2 item 14).
    const view = await listEnvironmentResources(db, env.id);
    expect(view!.workCenterId).toBe(wc.id);
    expect(view!.resources.map((r) => r.name)).toEqual(['Printer']);
    expect(view!.unregistered).toEqual(['Ghost']);
    expect(await listEnvironmentResources(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined();
  } finally { await close(); }
});

test('an orphaned row keeps its denormalized provenance name and is still listed on the work center', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, env, resource } = await seed(db);
    await resource({ name: 'Printer', resourceType: 'binary exclusive use' });
    await db.delete(environmentSpec).where(eq(environmentSpec.id, env.id)); // FK: ON DELETE SET NULL
    const [printer] = (await listWorkCenterResources(db, wc.id))!;
    expect(printer.orphaned).toBe(true);
    expect(printer.definedBy).toEqual({ envSpecId: null, name: 'Kitchen', version: '1.2.0', state: 'Effective' });
  } finally { await close(); }
});

test('a missing work center is undefined; an empty registry is []', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc } = await seed(db);
    expect(await listWorkCenterResources(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined();
    expect(await listWorkCenterResources(db, wc.id)).toEqual([]);
  } finally { await close(); }
});
