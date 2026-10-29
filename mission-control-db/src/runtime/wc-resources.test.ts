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
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { runtimeCols } from '../../test/helpers/instances.js';
import {
  workCenter, workflow, workflowInstance, wcResource, wcResourceWaiter, wcResourceHolder,
} from '../db/schema/index.js';
import {
  lockRegistry, readHolders, applyRegistryWrites, releaseInstanceHoldings,
  readResourceHolders, applyOperatorRegistryWrites,
} from './wc-resources.js';

/**
 * Wrap `db.select` so the SQL of its Nth call (1-indexed) is captured right before it is
 * awaited, by recursively proxying every chained call (`.from`/`.where`/`.orderBy`/...) and
 * reading `.toSQL()` off whatever the FINAL object in the chain turns out to be, at the moment
 * `.then` is accessed. Execution is untouched — the real `.then` still runs.
 *
 * Used ONLY for the regression guard below: a behavioral assertion cannot discriminate a
 * dropped `.orderBy(...)` on `lockRegistry`'s waiter read, because PGlite is single-connection
 * and a bare sequential scan already returns rows in insertion order — which the FIFO test's
 * own setup makes identical to id order. This inspects the SQL `lockRegistry` actually builds
 * instead of the rows it happens to return.
 */
function captureNthSelectSql(db: any, n: number): { sql: string | null } {
  const capture: { sql: string | null } = { sql: null };
  let count = 0;
  const original = db.select.bind(db);
  const wrap = (value: any): any => {
    if (value === null || typeof value !== 'object') return value;
    return new Proxy(value, {
      get(target, prop, receiver) {
        const got = Reflect.get(target, prop, receiver);
        if (prop === 'then') {
          return (...args: any[]) => {
            try { capture.sql = target.toSQL().sql; } catch { /* not a query builder at this step */ }
            return got.apply(target, args);
          };
        }
        return typeof got === 'function' ? (...args: any[]) => wrap(got.apply(target, args)) : got;
      },
    });
  };
  db.select = (...args: any[]) => {
    count += 1;
    const builder = original(...args);
    return count === n ? wrap(builder) : builder;
  };
  return capture;
}

async function seed(db: any) {
  const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
  const [wf] = await db.insert(workflow).values({
    oid: 'wf-1', name: 'Fill', workCenterId: wc.id, specJsonb: {},
  }).returning();
  const mk = async () => {
    const [i] = await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', ...runtimeCols(),
    }).returning();
    return i;
  };
  await db.insert(wcResource).values([
    { workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' },
    { workCenterId: wc.id, name: 'Bay', resourceType: 'named pool',
      poolNames: ['B1', 'B2'], availableNames: ['B1', 'B2'] },
    { workCenterId: wc.id, name: 'Unused', resourceType: 'binary exclusive use' },
  ]);
  return { wc, a: await mk(), b: await mk() };
}

test('lockRegistry returns only the named resources, and waiters in FIFO id order', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, a, b } = await seed(db);
    await db.insert(wcResourceWaiter).values([
      { workCenterId: wc.id, name: 'Printer', instanceId: a.id, stepOid: 's1', kind: 'acquire' },
      { workCenterId: wc.id, name: 'Printer', instanceId: b.id, stepOid: 's2', kind: 'acquire' },
    ]);
    const snap = await lockRegistry(db, wc.id, ['Printer', 'Bay']);
    expect(snap.resources.map((r) => r.name).sort()).toEqual(['Bay', 'Printer']);
    expect(snap.resources.find((r) => r.name === 'Unused')).toBeUndefined();
    // FIFO: the first-inserted waiter must come first, whichever instance it belongs to.
    expect(snap.waiters.map((w) => w.stepOid)).toEqual(['s1', 's2']);
    expect(snap.waiters[0].instanceId).toBe(a.id);
    expect(snap.waiters[0].granted).toBe(false);
  } finally { await close(); }
});

test("lockRegistry's generated SQL orders the waiter read by id — the FIFO test above cannot catch a dropped ORDER BY here (see captureNthSelectSql doc comment); this is the regression guard for that", async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc } = await seed(db);
    // 1st select() inside lockRegistry reads wc_resource; 2nd reads wc_resource_waiter.
    const capture = captureNthSelectSql(db, 2);
    await lockRegistry(db, wc.id, ['Printer']);
    expect(capture.sql).toBeTruthy();
    expect(capture.sql).toMatch(/order by "wc_resource_waiter"\."id" asc/);
  } finally { await close(); }
});

test('lockRegistry with an empty name list touches nothing and returns empty', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc } = await seed(db);
    const snap = await lockRegistry(db, wc.id, []);
    expect(snap.resources).toEqual([]);
    expect(snap.waiters).toEqual([]);
  } finally { await close(); }
});

test('lockRegistry ignores a name that has no registry row', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc } = await seed(db);
    const snap = await lockRegistry(db, wc.id, ['Printer', 'NeverDeclared']);
    expect(snap.resources.map((r) => r.name)).toEqual(['Printer']);
  } finally { await close(); }
});

test('applyRegistryWrites updates counters, deletes, grants, inserts and replaces holders', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, a, b } = await seed(db);
    const [w1] = await db.insert(wcResourceWaiter).values({
      workCenterId: wc.id, name: 'Printer', instanceId: a.id, stepOid: 's1', kind: 'acquire',
    }).returning();
    const [w2] = await db.insert(wcResourceWaiter).values({
      workCenterId: wc.id, name: 'Bay', instanceId: b.id, stepOid: 's2', kind: 'acquire',
    }).returning();

    await applyRegistryWrites(db, {
      workCenterId: wc.id, instanceId: a.id,
      counters: [
        { name: 'Printer', inUse: 1, availableNames: [] },
        { name: 'Bay', inUse: 0, availableNames: ['B2'] },
      ],
      deleteWaiterIds: [w1.id],
      grantWaiters: [{ id: w2.id, grantedName: 'B1', grantedPayload: null }],
      insertWaiters: [{ name: 'Printer', stepOid: 's9', kind: 'acquire', amount: null, payload: null }],
      holders: [{ name: 'Printer', stepOid: 's1', amount: 1, heldName: null }],
    });

    const printer = (await db.select().from(wcResource)
      .where(and(eq(wcResource.workCenterId, wc.id), eq(wcResource.name, 'Printer'))))[0];
    expect(printer.inUse).toBe(1);
    const bay = (await db.select().from(wcResource)
      .where(and(eq(wcResource.workCenterId, wc.id), eq(wcResource.name, 'Bay'))))[0];
    expect(bay.availableNames).toEqual(['B2']);

    const waiters = await db.select().from(wcResourceWaiter).orderBy(wcResourceWaiter.id);
    expect(waiters).toHaveLength(2);            // w1 deleted, w2 granted, s9 inserted
    expect(waiters[0].id).toBe(w2.id);
    expect(waiters[0].granted).toBe(true);
    expect(waiters[0].grantedName).toBe('B1');
    expect(waiters[1].stepOid).toBe('s9');
    expect(waiters[1].id).toBeGreaterThan(w2.id); // a new waiter joins the TAIL

    const holders = await db.select().from(wcResourceHolder);
    expect(holders).toHaveLength(1);
    expect(holders[0].stepOid).toBe('s1');
    expect(holders[0].instanceId).toBe(a.id);
  } finally { await close(); }
});

test('applyRegistryWrites replaces only THIS instance holders, never another instance holders', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, a, b } = await seed(db);
    await db.insert(wcResourceHolder).values([
      { workCenterId: wc.id, name: 'Printer', instanceId: a.id, stepOid: 'old', amount: 1 },
      { workCenterId: wc.id, name: 'Printer', instanceId: b.id, stepOid: 'other', amount: 1 },
    ]);
    await applyRegistryWrites(db, {
      workCenterId: wc.id, instanceId: a.id, counters: [], deleteWaiterIds: [],
      grantWaiters: [], insertWaiters: [],
      holders: [{ name: 'Printer', stepOid: 'new', amount: 1, heldName: null }],
    });
    const rows = await db.select().from(wcResourceHolder);
    expect(rows.map((r: any) => r.stepOid).sort()).toEqual(['new', 'other']);
  } finally { await close(); }
});

test('readHolders returns only the given instance rows', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, a, b } = await seed(db);
    await db.insert(wcResourceHolder).values([
      { workCenterId: wc.id, name: 'Printer', instanceId: a.id, stepOid: 's1', amount: 1 },
      { workCenterId: wc.id, name: 'Bay', instanceId: b.id, stepOid: 's2', amount: 1, heldName: 'B1' },
    ]);
    const mine = await readHolders(db, a.id);
    expect(mine).toEqual([{ name: 'Printer', stepOid: 's1', amount: 1, heldName: null }]);
  } finally { await close(); }
});

test('releaseInstanceHoldings clears the instance holders and waiters and names what it touched', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, a, b } = await seed(db);
    await db.insert(wcResourceHolder).values([
      { workCenterId: wc.id, name: 'Printer', instanceId: a.id, stepOid: 's1', amount: 1 },
      { workCenterId: wc.id, name: 'Bay', instanceId: b.id, stepOid: 'keep', amount: 1 },
    ]);
    await db.insert(wcResourceWaiter).values({
      workCenterId: wc.id, name: 'Bay', instanceId: a.id, stepOid: 's3', kind: 'acquire',
    });
    const touched = await releaseInstanceHoldings(db, a.id);
    expect([...touched].sort()).toEqual(['Bay', 'Printer']);
    expect(await db.select().from(wcResourceHolder)).toHaveLength(1);
    expect((await db.select().from(wcResourceHolder))[0].stepOid).toBe('keep');
    expect(await db.select().from(wcResourceWaiter)).toHaveLength(0);
  } finally { await close(); }
});

test('readResourceHolders returns every instance\'s holder rows on ONE resource, by id, with ids', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, a, b } = await seed(db);
    await db.insert(wcResource).values([
      { workCenterId: wc.id, name: 'Slots', resourceType: 'countable use with pool limits', useLimit: 5, inUse: 3, poolNames: [], availableNames: [] },
      { workCenterId: wc.id, name: 'Other', resourceType: 'binary exclusive use', inUse: 1, poolNames: [], availableNames: [] },
    ]);
    await db.insert(wcResourceHolder).values([
      { workCenterId: wc.id, name: 'Slots', instanceId: b.id, stepOid: 's-b', amount: 2, heldName: null },
      { workCenterId: wc.id, name: 'Slots', instanceId: a.id, stepOid: 's-a', amount: 1, heldName: null },
      { workCenterId: wc.id, name: 'Other', instanceId: a.id, stepOid: 's-o', amount: 1, heldName: null },
    ]);
    const rows = await readResourceHolders(db, wc.id, 'Slots');
    expect(rows.map((r) => [r.instanceId, r.stepOid, r.amount])).toEqual([[b.id, 's-b', 2], [a.id, 's-a', 1]]);
    expect(rows.every((r) => typeof r.id === 'number' && r.acquiredAt instanceof Date)).toBe(true);
    expect(await readResourceHolders(db, wc.id, 'Nope')).toEqual([]);
  } finally { await close(); }
});

test('applyOperatorRegistryWrites touches only what it is given: counters, listed waiters, listed holders', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, a } = await seed(db);
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Bays', resourceType: 'named pool', poolNames: ['A', 'B'], availableNames: [], inUse: 0 });
    const [h1, h2] = await db.insert(wcResourceHolder).values([
      { workCenterId: wc.id, name: 'Bays', instanceId: a.id, stepOid: 's1', amount: 1, heldName: 'A' },
      { workCenterId: wc.id, name: 'Bays', instanceId: a.id, stepOid: 's2', amount: 1, heldName: 'B' },
    ]).returning();
    const [w1, w2] = await db.insert(wcResourceWaiter).values([
      { workCenterId: wc.id, name: 'Bays', instanceId: a.id, stepOid: 's3', kind: 'acquire', amount: null, payload: null },
      { workCenterId: wc.id, name: 'Bays', instanceId: a.id, stepOid: 's4', kind: 'acquire', amount: null, payload: null },
    ]).returning();
    await applyOperatorRegistryWrites(db, {
      workCenterId: wc.id,
      counters: [{ name: 'Bays', inUse: 1, availableNames: ['A'] }],
      deleteWaiterIds: [w1.id],
      grantWaiters: [{ id: w2.id, grantedName: 'A', grantedPayload: null }],
      deleteHolderIds: [h1.id],
    });
    const [r] = await db.select().from(wcResource).where(and(eq(wcResource.workCenterId, wc.id), eq(wcResource.name, 'Bays')));
    expect([r.inUse, r.availableNames]).toEqual([1, ['A']]);
    const holders = await db.select({ id: wcResourceHolder.id }).from(wcResourceHolder);
    expect(holders.map((h) => h.id)).toEqual([h2.id]); // h1 gone, h2 untouched — no wholesale replacement
    const waiters = await db.select({ id: wcResourceWaiter.id, granted: wcResourceWaiter.granted, grantedName: wcResourceWaiter.grantedName }).from(wcResourceWaiter);
    expect(waiters).toEqual([{ id: w2.id, granted: true, grantedName: 'A' }]);
  } finally { await close(); }
});
