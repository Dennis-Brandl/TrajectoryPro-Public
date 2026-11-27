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
// Spec 2026-11-27 across workflows: separate workflows Synchronize on one ENVIRONMENT sync
// resource (the weigh-and-dispense pattern). Each waiter row keeps its partner count in
// wc_resource_waiter.amount, so the group survives every transaction boundary.
import { expect, test, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { runControlPass } from '../src/core/control.js';
import { runWorkCenterResourceVerb } from '../src/core/operator-verbs.js';
import { requestAbort } from 'mission-control-db/src/dao/runtime-control';
import { workCenter, workflow, workflowInstance, stepInstance, wcResource, wcResourceWaiter } from 'mission-control-db/src/db/schema/index';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const ACTOR = '99999999-9999-4999-8999-999999999999';
const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});
const ENV = {
  local_id: 'env-plant-lib', oid: 'env-plant', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [],
  resource_property_specifications: [{ name: 'Scale cycle', resource_type: 'sync' }],
};
/** One batch: START → SYNC on the environment's "Scale cycle" → END. */
const batch = (oid: string, partners: number) => ({
  local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV],
  steps: [
    step('s1', 'START'),
    step('sync', 'MATH', {
      resource_command_specifications: [
        { command_type: 'Synchronize', resource_name: 'Scale cycle', resource_source_oid: 'env-plant', partners },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [{ from_step_id: 's1', to_step_id: 'sync' }, { from_step_id: 'sync', to_step_id: 'e1' }],
});

async function makeWc(db: AnyDb) {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Scale cycle', resourceType: 'sync' });
  return wc as { id: string };
}
let n = 0;
async function start(db: AnyDb, wc: { id: string }, partners: number) {
  n += 1;
  const spec = batch(`wf-batch-${n}`, partners);
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: n, runtimeLabel: `RW-${n}`,
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  await pumpUntilQuiet(db, testDeps());
  return wi as { id: string };
}
const status = async (db: AnyDb, id: string) =>
  (await db.select().from(workflowInstance).where(eq(workflowInstance.id, id)))[0].status;
const syncStep = async (db: AnyDb, id: string) =>
  (await db.select().from(stepInstance).where(and(eq(stepInstance.workflowInstanceId, id), eq(stepInstance.stepOid, 'sync'))))[0];
const waiters = async (db: AnyDb, wc: { id: string }) =>
  (await db.select().from(wcResourceWaiter).where(eq(wcResourceWaiter.workCenterId, wc.id)))
    .map((w: { instanceId: string; kind: string; amount: number | null }) => ({ instanceId: w.instanceId, kind: w.kind, amount: w.amount }));

test('the waiter row carries the partner count', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await makeWc(db);
    const a = await start(db, wc, 3);
    expect(await waiters(db, wc)).toEqual([{ instanceId: a.id, kind: 'sync', amount: 3 }]);
  } finally { await close(); }
});

test('three workflows: the first two wait, the third releases all three', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await makeWc(db);
    const a = await start(db, wc, 3);
    const b = await start(db, wc, 3);
    expect([await status(db, a.id), await status(db, b.id)]).toEqual(['running', 'running']);
    const c = await start(db, wc, 3);
    await pumpUntilQuiet(db, testDeps());
    expect([await status(db, a.id), await status(db, b.id), await status(db, c.id)]).toEqual(['completed', 'completed', 'completed']);
    expect(await waiters(db, wc)).toEqual([]);
  } finally { await close(); }
});

test('a fourth workflow arriving after the release starts a new group', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await makeWc(db);
    for (let i = 0; i < 3; i++) await start(db, wc, 3);
    await pumpUntilQuiet(db, testDeps());
    const d = await start(db, wc, 4);
    expect(await status(db, d.id)).toBe('running');
    expect(await waiters(db, wc)).toEqual([{ instanceId: d.id, kind: 'sync', amount: 4 }]);
  } finally { await close(); }
});

test('mismatch fails the late step and leaves the others waiting', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await makeWc(db);
    const a = await start(db, wc, 3);
    const b = await start(db, wc, 3);
    const c = await start(db, wc, 2);
    expect(await syncStep(db, c.id)).toMatchObject({
      state: 'ERRORED', error: 'Sync "Scale cycle" is waiting for 3 partners; this step expects 2',
    });
    expect(await status(db, c.id)).toBe('errored');
    expect([await status(db, a.id), await status(db, b.id)]).toEqual(['running', 'running']);
    const rows = await waiters(db, wc);
    expect(rows.map((r: { instanceId: string }) => r.instanceId).sort()).toEqual([a.id, b.id].sort());
    expect(rows.every((r: { amount: number | null }) => r.amount === 3)).toBe(true);
  } finally { await close(); }
});

test('an aborted partner leaves the group; Clear sync releases the rest as today', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await makeWc(db);
    const a = await start(db, wc, 3);
    const b = await start(db, wc, 3);
    await requestAbort(db, a.id, { kind: 'system', label: 'test' });
    await runControlPass(db, testDeps());
    expect(await status(db, a.id)).toBe('aborted');
    expect(await waiters(db, wc)).toEqual([{ instanceId: b.id, kind: 'sync', amount: 3 }]);
    await runWorkCenterResourceVerb(db, testDeps(), null, { verb: 'clear-sync', name: 'Scale cycle', workCenterId: wc.id, actorUserId: ACTOR });
    await pumpUntilQuiet(db, testDeps());
    expect(await waiters(db, wc)).toEqual([]);
    expect(await status(db, b.id)).not.toBe('running');
  } finally { await close(); }
});

// ── Review minors (2026-11-27) ──

test('releasing a group logs no dropped-grant warning', async () => {
  const { db, close } = await makeTestDb();
  const warn = vi.spyOn(console, 'warn');
  try {
    const wc = await makeWc(db);
    for (let i = 0; i < 3; i++) await start(db, wc, 3);
    await pumpUntilQuiet(db, testDeps());
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('dropped an environment grant'))).toEqual([]);
  } finally { warn.mockRestore(); await close(); }
});

test('a waiter from before the deploy (amount NULL) still pairs at 2, and a 3-partner arrival is refused', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await makeWc(db);
    const a = await start(db, wc, 2);
    await db.update(wcResourceWaiter).set({ amount: null }); // as written by the engine before 2026-11-27
    const c = await start(db, wc, 3);
    expect(await syncStep(db, c.id)).toMatchObject({ state: 'ERRORED', error: 'Sync "Scale cycle" is waiting for 2 partners; this step expects 3' });
    const b = await start(db, wc, 2);
    await pumpUntilQuiet(db, testDeps());
    expect([await status(db, a.id), await status(db, b.id)]).toEqual(['completed', 'completed']);
  } finally { await close(); }
});

test('a TRY catches the mismatch', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await makeWc(db);
    await start(db, wc, 3);
    const spec = batch('wf-batch-try', 2);
    // TRY is not allowed on MATH: the synchronizing step is a SCRIPT here.
    spec.steps[1] = {
      ...spec.steps[1], step_type: 'SCRIPT', script_config: { source: "output.g = 'ran';" },
      output_parameter_specifications: [{ id: 'g', target: 'Result.G' }],
      try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }],
    } as typeof spec.steps[1];
    spec.steps.push(
      step('c1', 'CATCH', { catch_id: 'C1', output_parameter_specifications: [{ id: 'Message', target: 'Caught.Message' }] }) as typeof spec.steps[1],
      step('r1', 'RETURN', { return_config: { command: 'COMPLETE' } }) as typeof spec.steps[1],
    );
    spec.connections.push({ from_step_id: 'c1', to_step_id: 'r1' });
    const [wf] = await db.insert(workflow).values({
      workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
    }).returning();
    const [wi] = await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
      specJsonb: spec, startingParams: null, runtimeNumber: 99, runtimeLabel: 'RW-99',
      masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
    }).returning();
    await pumpUntilQuiet(db, testDeps());
    const row = (await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id)))[0];
    expect(row.status).toBe('completed');
    expect(row.propertyStore).toMatchObject({ 'Caught.Message': 'Sync "Scale cycle" is waiting for 3 partners; this step expects 2' });
  } finally { await close(); }
});
