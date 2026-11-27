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
// Spec 2026-11-26: Commander changes a work-center resource's shares, count or names. The
// change and the grant pass it allows run in one registry transaction.
import { expect, test } from 'vitest';
import { eq, and } from 'drizzle-orm';
import type { PGlite } from '@electric-sql/pglite';
import { makeTestDb } from './helpers/db.js';
import { testDeps } from './helpers/pump.js';
import { workCenter, workflow, workflowInstance, wcResource, wcResourceWaiter, wcResourceHolder, appUser } from 'mission-control-db/src/db/schema/index';
import { runWorkCenterResourceVerb } from '../src/core/operator-verbs.js';
import { NOTIFY_GRANT_CHANNEL } from 'mission-control-db/src/runtime/wc-resources';
import { setResourceCapacity } from '../src/core/set-capacity.js';
import { VerbError } from '../src/core/registry-verbs.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;
const SPEC = { local_id: 'wf', oid: 'wf-1', version: '1.0.0', last_modified_date: '2026-01-01', steps: [], connections: [] };

async function seed(db: AnyDb) {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: 'wf-1', name: 'wf-1', version: '1.0.0', state: 'Approved', specJsonb: SPEC }).returning();
  const [u] = await db.insert(appUser).values({ email: `u${Math.random()}@x.io`, displayName: 'Una', loginName: `una${Math.random()}` }).returning();
  const inst = async (n: number) => (await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', specJsonb: SPEC, runtimeNumber: n, runtimeLabel: `RW-${n}`,
    masterName: 'wf-1', masterOid: 'wf-1', masterVersion: '1.0.0', masterState: 'Approved',
  }).returning())[0];
  return { wc, actor: u.id as string, a: await inst(1), b: await inst(2) };
}
const row = async (db: AnyDb, wcId: string, name: string) =>
  (await db.select().from(wcResource).where(and(eq(wcResource.workCenterId, wcId), eq(wcResource.name, name))))[0];
const errOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as VerbError; } return undefined; };
async function wakes(client: PGlite) {
  const got: string[] = [];
  await client.listen(NOTIFY_GRANT_CHANNEL, (p: string) => { got.push(p); });
  return async (n: number) => {
    const start = Date.now();
    while (got.length < n && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 50));
    return got;
  };
}

test('raising a countable count grants the queued waiter at once and stamps who set it', async () => {
  const { db, client, close } = await makeTestDb();
  try {
    const { wc, actor, b } = await seed(db);
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Scales', resourceType: 'countable use with pool limits', useLimit: 1, inUse: 1 });
    const [w] = await db.insert(wcResourceWaiter).values({ workCenterId: wc.id, name: 'Scales', instanceId: b.id, stepOid: 's-b', kind: 'acquire', amount: 1 }).returning();
    const woke = await wakes(client);
    const out = await setResourceCapacity(db, testDeps(), null, { workCenterId: wc.id, name: 'Scales', useLimit: 2, actorUserId: actor });
    expect(out.ok).toBe(true);
    const r = await row(db, wc.id, 'Scales');
    expect([r.useLimit, r.inUse, r.capacitySetBy]).toEqual([2, 2, actor]);
    expect(r.capacitySetAt).not.toBeNull();
    expect((await db.select().from(wcResourceWaiter).where(eq(wcResourceWaiter.id, w.id)))[0].granted).toBe(true);
    expect(await woke(1)).toEqual([b.id]);
  } finally { await close(); }
});

test('lowering shares below what is in use keeps the holds; nothing new is granted', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, actor, b } = await seed(db);
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Oven', resourceType: 'binary shared use with pool limits', useLimit: 4, inUse: 3 });
    const [w] = await db.insert(wcResourceWaiter).values({ workCenterId: wc.id, name: 'Oven', instanceId: b.id, stepOid: 's-b', kind: 'acquire' }).returning();
    await setResourceCapacity(db, testDeps(), null, { workCenterId: wc.id, name: 'Oven', useLimit: 2, actorUserId: actor });
    const r = await row(db, wc.id, 'Oven');
    expect([r.useLimit, r.inUse]).toEqual([2, 3]);
    expect((await db.select().from(wcResourceWaiter).where(eq(wcResourceWaiter.id, w.id)))[0].granted).toBe(false);
  } finally { await close(); }
});

test('adding a name grants it to the queued waiter; a removed held name is retired', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, actor, b } = await seed(db);
    // D1 is held (in the roster, not available); the pool is otherwise empty, so b waits.
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Docks', resourceType: 'named pool', poolNames: ['D1'], availableNames: [], inUse: 0 });
    const [w] = await db.insert(wcResourceWaiter).values({ workCenterId: wc.id, name: 'Docks', instanceId: b.id, stepOid: 's-b', kind: 'acquire' }).returning();
    await setResourceCapacity(db, testDeps(), null, { workCenterId: wc.id, name: 'Docks', names: [' North ', 'South'], actorUserId: actor });
    const r = await row(db, wc.id, 'Docks');
    expect(r.poolNames).toEqual(['North', 'South']);
    expect(r.availableNames).not.toContain('D1');
    const [wr] = await db.select().from(wcResourceWaiter).where(eq(wcResourceWaiter.id, w.id));
    expect(wr.granted).toBe(true);
    expect(['North', 'South']).toContain(wr.grantedName);
    expect(r.availableNames).toHaveLength(1);
  } finally { await close(); }
});

test('refusals: unknown resource, sync and binary exclusive, wrong field, bad numbers, bad names', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, actor } = await seed(db);
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Bell', resourceType: 'sync' });
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use' });
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Scales', resourceType: 'countable use with pool limits', useLimit: 2 });
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Docks', resourceType: 'named pool', poolNames: ['D1'], availableNames: ['D1'] });
    const set = (input: Record<string, unknown>) =>
      errOf(setResourceCapacity(db, testDeps(), null, { workCenterId: wc.id, actorUserId: actor, ...input } as never));
    expect((await set({ name: 'Nope', useLimit: 2 }))?.code).toBe('RESOURCE_NOT_FOUND');
    expect((await set({ name: 'Bell', useLimit: 2 }))?.code).toBe('NOT_SUPPORTED');
    expect((await set({ name: 'Printer', useLimit: 2 }))?.code).toBe('NOT_SUPPORTED');
    expect((await set({ name: 'Scales', names: ['A'] }))?.code).toBe('VALIDATION');
    expect((await set({ name: 'Docks', useLimit: 3 }))?.code).toBe('VALIDATION');
    for (const n of [0, -1, 1.5, 2147483648]) expect((await set({ name: 'Scales', useLimit: n }))?.code).toBe('VALIDATION');
    expect((await set({ name: 'Docks', names: [] }))?.code).toBe('VALIDATION');
    expect((await set({ name: 'Docks', names: ['A', ' A'] }))?.code).toBe('VALIDATION');
    expect((await set({ name: 'Docks', names: ['  '] }))?.code).toBe('VALIDATION');
    expect((await set({ name: 'Docks', names: ['x'.repeat(201)] }))?.code).toBe('VALIDATION');
    expect((await set({ name: 'Docks', names: Array.from({ length: 501 }, (_, i) => `D${i}`) }))?.code).toBe('VALIDATION');
    const s = await row(db, wc.id, 'Scales');
    expect([s.useLimit, s.capacitySetAt]).toEqual([2, null]); // a refusal writes nothing
  } finally { await close(); }
});

test('a held name that is removed is retired: its release later discards it and nobody else gets it', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, actor, a, b } = await seed(db);
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Docks', resourceType: 'named pool', poolNames: ['D1'], availableNames: [] });
    const [h] = await db.insert(wcResourceHolder).values({ workCenterId: wc.id, name: 'Docks', instanceId: a.id, stepOid: 's-a', amount: 1, heldName: 'D1' }).returning();
    await setResourceCapacity(db, testDeps(), null, { workCenterId: wc.id, name: 'Docks', names: ['North'], actorUserId: actor });
    await db.insert(wcResourceWaiter).values({ workCenterId: wc.id, name: 'Docks', instanceId: b.id, stepOid: 's-b', kind: 'acquire' });
    await runWorkCenterResourceVerb(db, testDeps(), null, { verb: 'release-holder', name: 'Docks', holderId: h.id, workCenterId: wc.id, actorUserId: actor });
    const r = await row(db, wc.id, 'Docks');
    expect(r.poolNames).toEqual(['North']);
    expect(r.availableNames).not.toContain('D1');
    const granted = await db.select().from(wcResourceWaiter).where(eq(wcResourceWaiter.granted, true));
    expect(granted.map((w) => w.grantedName)).not.toContain('D1');
  } finally { await close(); }
});

test('a held name removed and then added back stays held: it is not handed to a second run', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, actor, a, b } = await seed(db);
    // D1 held by a (holder row), D2 held with no holder row (untracked); nothing free, b waits.
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Docks', resourceType: 'named pool', poolNames: ['D1', 'D2'], availableNames: [] });
    await db.insert(wcResourceHolder).values({ workCenterId: wc.id, name: 'Docks', instanceId: a.id, stepOid: 's-a', amount: 1, heldName: 'D1' });
    const [w] = await db.insert(wcResourceWaiter).values({ workCenterId: wc.id, name: 'Docks', instanceId: b.id, stepOid: 's-b', kind: 'acquire' }).returning();
    await setResourceCapacity(db, testDeps(), null, { workCenterId: wc.id, name: 'Docks', names: ['D2'], actorUserId: actor });
    await setResourceCapacity(db, testDeps(), null, { workCenterId: wc.id, name: 'Docks', names: ['D1', 'D2'], actorUserId: actor });
    const r = await row(db, wc.id, 'Docks');
    expect(r.availableNames).toEqual([]);
    expect((await db.select().from(wcResourceWaiter).where(eq(wcResourceWaiter.id, w.id)))[0].granted).toBe(false);
  } finally { await close(); }
});
