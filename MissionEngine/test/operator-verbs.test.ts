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
// Phase 4a Task 4: the work-center verb runner against PGlite — rows in, rows out, traces on
// the affected instances, a wake per affected/granted instance. The manager arithmetic is
// Task 3's; this file proves the transaction wiring around it.
import { expect, test } from 'vitest';
import { eq, and, asc } from 'drizzle-orm';
import type { PGlite } from '@electric-sql/pglite';
import { makeTestDb } from './helpers/db.js';
import { testDeps, pumpUntilQuiet } from './helpers/pump.js';
import {
  workCenter, workflow, workflowInstance, stepInstance, traceEntry, wcResource, wcResourceWaiter, wcResourceHolder,
  wcValueProperty, appUser,
} from 'mission-control-db/src/db/schema/index';
import { NOTIFY_GRANT_CHANNEL } from 'mission-control-db/src/runtime/wc-resources';
import {
  runWorkCenterResourceVerb, runInstanceResourceVerb, setWorkCenterValueProperty, setInstanceValueProperty,
} from '../src/core/operator-verbs.js';
import { VerbError } from '../src/core/registry-verbs.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;
const ACTOR = '99999999-9999-4999-8999-999999999999';
const SPEC = { local_id: 'wf', oid: 'wf-1', version: '1.0.0', last_modified_date: '2026-01-01', steps: [], connections: [] };

async function seed(db: AnyDb) {
  // Ruling P6: `work_center` has no `path` column — do not copy the older seeds that pass one.
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: 'wf-1', name: 'wf-1', version: '1.0.0', state: 'Approved', specJsonb: SPEC }).returning();
  const inst = async (n: number) => (await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', specJsonb: SPEC, runtimeNumber: n, runtimeLabel: `RW-${n}`,
    masterName: 'wf-1', masterOid: 'wf-1', masterVersion: '1.0.0', masterState: 'Approved',
  }).returning())[0];
  return { wc, a: await inst(1), b: await inst(2) };
}
const resourceRow = async (db: AnyDb, wcId: string, name: string) =>
  (await db.select().from(wcResource).where(and(eq(wcResource.workCenterId, wcId), eq(wcResource.name, name))))[0];
// Ordered by the identity column (insertion order), so the order-index assertion below reads a
// deterministic sequence rather than whatever order a heap scan happens to return.
const traces = async (db: AnyDb, instanceId: string) =>
  db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(asc(traceEntry.id));

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Real PGlite LISTEN (the pattern api-internal.test.ts's force-release test pins). Asserting
 * the delivered payloads — rather than spying on anything — is what makes a SKIPPED wake fail:
 * an instance the runner forgot to `pg_notify` simply never shows up here.
 */
async function notified(client: PGlite, channel: string) {
  const received: string[] = [];
  await client.listen(channel, (payload: string) => { received.push(payload); });
  return {
    /** Wait for `expected` payloads, then settle — the settle tick is what proves nothing
     *  EXTRA arrived, instead of merely not having arrived yet. */
    async payloads(expected: number): Promise<string[]> {
      await waitFor(() => received.length >= expected);
      await new Promise((r) => setTimeout(r, 50));
      return received;
    },
  };
}

test('release-holder: holder row gone, counter handed to the queued instance, trace + wake on both', async () => {
  const { db, client, close } = await makeTestDb();
  try {
    const { wc, a, b } = await seed(db);
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use', inUse: 1, poolNames: [], availableNames: [] });
    const [h] = await db.insert(wcResourceHolder).values({ workCenterId: wc.id, name: 'Printer', instanceId: a.id, stepOid: 's-a', amount: 1, heldName: null }).returning();
    const [w] = await db.insert(wcResourceWaiter).values({ workCenterId: wc.id, name: 'Printer', instanceId: b.id, stepOid: 's-b', kind: 'acquire', amount: null, payload: null }).returning();
    const wakes = await notified(client, NOTIFY_GRANT_CHANNEL);
    const out = await runWorkCenterResourceVerb(db, testDeps(), null, { verb: 'release-holder', name: 'Printer', holderId: h.id, workCenterId: wc.id, actorUserId: ACTOR });
    expect(out.ok).toBe(true);
    expect(await db.select().from(wcResourceHolder)).toEqual([]);
    expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1); // re-reserved for b
    const [wr] = await db.select().from(wcResourceWaiter).where(eq(wcResourceWaiter.id, w.id));
    expect(wr.granted).toBe(true);
    const ta = await traces(db, a.id);
    expect(ta).toHaveLength(1);
    expect([ta[0].state, ta[0].stepOid, ta[0].orderIndex]).toEqual(['OPERATOR', 's-a', 1]);
    expect(ta[0].error).toMatch(/release-holder "Printer".*by 9999/);
    expect((await wakes.payloads(2)).sort()).toEqual([a.id, b.id].sort());
  } finally { await close(); }
});

test('an operator trace lands at max(order_index)+1 so the instance\'s own later entries sort after it', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, a } = await seed(db);
    await db.insert(traceEntry).values([{ workflowInstanceId: a.id, stepOid: 's-a', state: 'EXECUTING', orderIndex: 7 }]);
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use', inUse: 1, poolNames: [], availableNames: [] });
    const [h] = await db.insert(wcResourceHolder).values({ workCenterId: wc.id, name: 'Printer', instanceId: a.id, stepOid: 's-a', amount: 1, heldName: null }).returning();
    await runWorkCenterResourceVerb(db, testDeps(), null, { verb: 'release-holder', name: 'Printer', holderId: h.id, workCenterId: wc.id, actorUserId: ACTOR });
    const rows = await traces(db, a.id);
    expect(rows.map((r: { state: string; orderIndex: number }) => [r.state, r.orderIndex])).toEqual([['EXECUTING', 7], ['OPERATOR', 8]]);
  } finally { await close(); }
});

test('errors roll the transaction back and carry the verb code: unknown resource, unknown holder, nothing to release', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, a } = await seed(db);
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use', inUse: 1, poolNames: [], availableNames: [] });
    await db.insert(wcResourceHolder).values({ workCenterId: wc.id, name: 'Printer', instanceId: a.id, stepOid: 's-a', amount: 1, heldName: null });
    const deps = testDeps();
    await expect(runWorkCenterResourceVerb(db, deps, null, { verb: 'reset', name: 'Nope', workCenterId: wc.id, actorUserId: ACTOR }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(runWorkCenterResourceVerb(db, deps, null, { verb: 'release-holder', name: 'Printer', holderId: 4242, workCenterId: wc.id, actorUserId: ACTOR }))
      .rejects.toMatchObject({ code: 'HOLDER_NOT_FOUND' });
    await expect(runWorkCenterResourceVerb(db, deps, null, { verb: 'release', name: 'Printer', workCenterId: wc.id, actorUserId: ACTOR }))
      .rejects.toBeInstanceOf(VerbError);
    expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1); // nothing moved
    expect(await traces(db, a.id)).toEqual([]);
  } finally { await close(); }
});

test('the wedge: release with no holders and no waiters frees the counter; reset drops every holder', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, a, b } = await seed(db);
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Wedged', resourceType: 'binary exclusive use', inUse: 1, poolNames: [], availableNames: [] });
    const out = await runWorkCenterResourceVerb(db, testDeps(), null, { verb: 'release', name: 'Wedged', workCenterId: wc.id, actorUserId: ACTOR });
    expect(out.summary).toMatch(/untracked/);
    expect((await resourceRow(db, wc.id, 'Wedged')).inUse).toBe(0);
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Slots', resourceType: 'countable use with pool limits', useLimit: 4, inUse: 3, poolNames: [], availableNames: [] });
    await db.insert(wcResourceHolder).values([
      { workCenterId: wc.id, name: 'Slots', instanceId: a.id, stepOid: 's-a', amount: 2, heldName: null },
      { workCenterId: wc.id, name: 'Slots', instanceId: b.id, stepOid: 's-b', amount: 1, heldName: null },
    ]);
    const reset = await runWorkCenterResourceVerb(db, testDeps(), null, { verb: 'reset', name: 'Slots', workCenterId: wc.id, actorUserId: ACTOR });
    expect(reset.affectedInstanceIds.sort()).toEqual([a.id, b.id].sort());
    expect(await db.select().from(wcResourceHolder).where(eq(wcResourceHolder.name, 'Slots'))).toEqual([]);
    expect((await resourceRow(db, wc.id, 'Slots')).inUse).toBe(0);
    expect((await traces(db, b.id)).map((t: { state: string }) => t.state)).toEqual(['OPERATOR']);
  } finally { await close(); }
});

test('clear-sync deletes granted rows too and wakes every waiter\'s instance', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, a, b } = await seed(db);
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Chan', resourceType: 'sync', inUse: 0, poolNames: [], availableNames: [] });
    await db.insert(wcResourceWaiter).values([
      { workCenterId: wc.id, name: 'Chan', instanceId: a.id, stepOid: 's-a', kind: 'send', amount: null, payload: 'p', granted: true, grantedPayload: 'p' },
      { workCenterId: wc.id, name: 'Chan', instanceId: b.id, stepOid: 's-b', kind: 'receive', amount: null, payload: null },
    ]);
    const out = await runWorkCenterResourceVerb(db, testDeps(), null, { verb: 'clear-sync', name: 'Chan', workCenterId: wc.id, actorUserId: ACTOR });
    expect(await db.select().from(wcResourceWaiter)).toEqual([]);
    expect(out.affectedInstanceIds.sort()).toEqual([a.id, b.id].sort());
  } finally { await close(); }
});

// ── Task 5: the instance-scoped route (spec §7.1). Two tiers behind one endpoint — a
// workflow-scoped key runs as a synthetic transition ON the instance, an environment name
// delegates to the work-center path above with no instance lock at all (delta D16). ──

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});
// A WORKFLOW-scoped binary resource: 'hold' acquires it and parks; 'wait' queues behind it.
const LOCAL_CONTENTION_SPEC = {
  local_id: 'wf', oid: 'wf-local', version: '1.0.0', last_modified_date: '2026-01-01',
  // 'Other' is declared but touched by NO step — it exists purely so the scoping test below
  // has a second, empty queue to name (review Important 1).
  resource_property_specifications: [
    { name: 'Tool', resource_type: 'binary exclusive use' },
    { name: 'Other', resource_type: 'binary exclusive use' },
  ],
  steps: [
    step('s1', 'START'),
    step('split', 'PARALLEL'),
    step('hold', 'USER_INTERACTION', { resource_command_specifications: [{ command_type: 'Acquire', resource_name: 'Tool' }] }),
    step('wait', 'MATH', { resource_command_specifications: [{ command_type: 'Acquire', resource_name: 'Tool' }, { command_type: 'Release', resource_name: 'Tool' }] }),
    // The two branches must REJOIN: validator.ts's UNMATCHED_PARALLEL rule requires a WAIT ALL
    // reachable from every PARALLEL (hasMatchingWaitAll stops at END), so a fan-out to two bare
    // ENDs never starts at all — the instance settles 'errored' before either step exists.
    step('wa', 'WAIT ALL'), step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'split' }, { from_step_id: 'split', to_step_id: 'hold' }, { from_step_id: 'split', to_step_id: 'wait' },
    { from_step_id: 'hold', to_step_id: 'wa' }, { from_step_id: 'wait', to_step_id: 'wa' }, { from_step_id: 'wa', to_step_id: 'e1' },
  ],
};
async function seedLocal(db: AnyDb, deps: ReturnType<typeof testDeps>) {
  // Ruling P6: no `path` column on work_center.
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: 'wf-local', name: 'wf-local', version: '1.0.0', state: 'Approved', specJsonb: LOCAL_CONTENTION_SPEC }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(), specJsonb: LOCAL_CONTENTION_SPEC,
    runtimeNumber: 1, runtimeLabel: 'RW-1', masterName: 'wf-local', masterOid: 'wf-local', masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  await pumpUntilQuiet(db, deps);
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, wi.id));
  expect(rows.find((r: { stepOid: string }) => r.stepOid === 'hold').state).toBe('WAITING_USER');
  expect(rows.find((r: { stepOid: string }) => r.stepOid === 'wait').state).toBe('READY'); // blocked on Tool
  return { wc, id: wi.id as string };
}

test('workflow tier: release frees the local resource and the queued step runs on the next pump', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const { id } = await seedLocal(db, deps);
    const out = await runInstanceResourceVerb(db, deps, null, { verb: 'release', name: 'wf-local:Tool', resourceKey: 'wf-local:Tool', instanceId: id, actorUserId: ACTOR });
    expect(out.affectedInstanceIds).toEqual([id]);
    await pumpUntilQuiet(db, deps);
    const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, id));
    expect(rows.find((r: { stepOid: string }) => r.stepOid === 'wait')!.state).toBe('COMPLETED');
    expect((await traces(db, id)).some((t: { state: string; error: string | null }) => t.state === 'OPERATOR' && /release/.test(t.error ?? ''))).toBe(true);
  } finally { await close(); }
});

test('workflow tier: cancel-waiter fails the queued step in the same transaction; guards', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const { id } = await seedLocal(db, deps);
    await expect(runInstanceResourceVerb(db, deps, null, { verb: 'release-holder', name: 'wf-local:Tool', resourceKey: 'wf-local:Tool', instanceId: id, actorUserId: ACTOR, holderId: 1 }))
      .rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    await expect(runInstanceResourceVerb(db, deps, null, { verb: 'reset', name: 'x', resourceKey: 'wf-local:Nope', instanceId: id, actorUserId: ACTOR }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(runInstanceResourceVerb(db, deps, null, { verb: 'cancel-waiter', name: 'x', resourceKey: 'wf-local:Tool', instanceId: id, actorUserId: ACTOR, waiterStepOid: 'hold' }))
      .rejects.toMatchObject({ code: 'WAITER_NOT_FOUND' }); // 'hold' HOLDS it, it is not queued
    await runInstanceResourceVerb(db, deps, null, { verb: 'cancel-waiter', name: 'x', resourceKey: 'wf-local:Tool', instanceId: id, actorUserId: ACTOR, waiterStepOid: 'wait' });
    const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, id));
    const wait = rows.find((r: { stepOid: string }) => r.stepOid === 'wait')!;
    expect(wait.state).toBe('ERRORED');
    expect(wait.error).toBe('Resource "wf-local:Tool": wait cancelled by an operator');
    await expect(runInstanceResourceVerb(db, deps, null, { verb: 'reset', name: 'x', resourceKey: 'wf-local:Tool', instanceId: '00000000-0000-4000-8000-000000000001', actorUserId: ACTOR }))
      .rejects.toMatchObject({ code: 'RUNTIME_NOT_FOUND' });
  } finally { await close(); }
});

test('environment key on the instance route delegates to the work-center path with no instance lock', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, a, b } = await seed(db);
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use', inUse: 1, poolNames: [], availableNames: [] });
    const [h] = await db.insert(wcResourceHolder).values({ workCenterId: wc.id, name: 'Printer', instanceId: a.id, stepOid: 's-a', amount: 1, heldName: null }).returning();
    const out = await runInstanceResourceVerb(db, testDeps(), null, { verb: 'release-holder', name: 'Printer', resourceKey: 'Printer', instanceId: b.id, actorUserId: ACTOR, holderId: h.id });
    expect(out.affectedInstanceIds).toEqual([a.id]);
    expect(await db.select().from(wcResourceHolder)).toEqual([]);
    expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);
  } finally { await close(); }
});

test('workflow tier: cancel-waiter is scoped to its own resource — a step queued elsewhere survives', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const { id } = await seedLocal(db, deps);
    // 'wait' is queued on Tool; NOTHING is queued on Other. Naming Other must not reach it.
    await expect(runInstanceResourceVerb(db, deps, null, { verb: 'cancel-waiter', name: 'x', resourceKey: 'wf-local:Other', instanceId: id, actorUserId: ACTOR, waiterStepOid: 'wait' }))
      .rejects.toMatchObject({ code: 'WAITER_NOT_FOUND' });
    // ...and it is still queued on Tool, not silently dequeued: freeing Tool still hands it over.
    await runInstanceResourceVerb(db, deps, null, { verb: 'release', name: 'wf-local:Tool', resourceKey: 'wf-local:Tool', instanceId: id, actorUserId: ACTOR });
    await pumpUntilQuiet(db, deps);
    const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, id));
    expect(rows.find((r: { stepOid: string }) => r.stepOid === 'wait')!.state).toBe('COMPLETED');
  } finally { await close(); }
});

// ── Task 6: value-property verbs (spec §7.1 / U5, delta D17). A work-center value is a
// commander's edit of the SHARED tier (one UPDATE, no instance lock); an instance value stays
// LOCAL — a key the target store does not hold locally is refused (SHARED_KEY when the shared
// tier has it, VALUE_NOT_FOUND otherwise), never routed to the shared tier via `props.set()`. ──

const VALUE_SPEC = {
  local_id: 'wf', oid: 'wf-values', version: '1.0.0', last_modified_date: '2026-01-01',
  value_property_specifications: [{ name: 'Batch', entries: [{ name: 'Size', value: '5' }] }],
  steps: [step('s1', 'START'), step('ui', 'USER_INTERACTION'), step('e1', 'END')],
  connections: [{ from_step_id: 's1', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'e1' }],
};
async function seedParkedWithValues(db: AnyDb, deps: ReturnType<typeof testDeps>) {
  // Ruling P6: no `path` column on work_center.
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}` }).returning();
  await db.insert(wcValueProperty).values({ workCenterId: wc.id, propertyName: 'Env', entryName: 'Limit', value: '10' });
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: 'wf-values', name: 'wf-values', version: '1.0.0', state: 'Approved', specJsonb: VALUE_SPEC }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(), specJsonb: VALUE_SPEC,
    runtimeNumber: 1, runtimeLabel: 'RW-1', masterName: 'wf-values', masterOid: 'wf-values', masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  await pumpUntilQuiet(db, deps);
  return { wc, id: wi.id as string };
}

test('work-center value: stamps the actor; unknown pair → VALUE_NOT_FOUND', async () => {
  const { db, close } = await makeTestDb();
  try {
    // Ruling P6: `work_center` has no `path`; `app_user` seeds are `{ email, displayName }`.
    const [wc] = await db.insert(workCenter).values({ name: 'wc' }).returning();
    const [user] = await db.insert(appUser).values({ email: 'op@x.test', displayName: 'Op' }).returning();
    await db.insert(wcValueProperty).values({ workCenterId: wc.id, propertyName: 'Env', entryName: 'Limit', value: '10' });
    await setWorkCenterValueProperty(db, testDeps(), null, { workCenterId: wc.id, propertyName: 'Env', entryName: 'Limit', value: '12', actorUserId: user.id });
    const [row] = await db.select().from(wcValueProperty);
    expect([row.value, row.updatedBy]).toEqual(['12', user.id]);
    await expect(setWorkCenterValueProperty(db, testDeps(), null, { workCenterId: wc.id, propertyName: 'Env', entryName: 'Nope', value: '1', actorUserId: user.id }))
      .rejects.toMatchObject({ code: 'VALUE_NOT_FOUND' });
  } finally { await close(); }
});

test('instance value: local key updates property_store with a trace; shared key and unknown key refused (D17)', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  try {
    const { id } = await seedParkedWithValues(db, deps);
    await setInstanceValueProperty(db, deps, null, { instanceId: id, key: 'Batch.Size', value: '9', actorUserId: ACTOR });
    const [row] = await db.select({ store: workflowInstance.propertyStore }).from(workflowInstance).where(eq(workflowInstance.id, id));
    expect((row.store as Record<string, string>)['Batch.Size']).toBe('9');
    expect((await traces(db, id)).some((t: { state: string; error: string | null }) => t.state === 'OPERATOR' && /Batch\.Size/.test(t.error ?? ''))).toBe(true);
    await expect(setInstanceValueProperty(db, deps, null, { instanceId: id, key: 'Env.Limit', value: '1', actorUserId: ACTOR }))
      .rejects.toMatchObject({ code: 'SHARED_KEY' });
    const [shared] = await db.select().from(wcValueProperty);
    expect(shared.value).toBe('10'); // untouched
    await expect(setInstanceValueProperty(db, deps, null, { instanceId: id, key: 'Nope.X', value: '1', actorUserId: ACTOR }))
      .rejects.toMatchObject({ code: 'VALUE_NOT_FOUND' });
    await expect(setInstanceValueProperty(db, deps, null, { instanceId: id, specOid: 'not-active', key: 'Batch.Size', value: '1', actorUserId: ACTOR }))
      .rejects.toMatchObject({ code: 'CHILD_NOT_ACTIVE' });
  } finally { await close(); }
});
