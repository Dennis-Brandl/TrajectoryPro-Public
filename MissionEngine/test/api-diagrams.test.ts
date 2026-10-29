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
// Pilot Workflows tab (spec 2026-08-19): the three read routes behind the live
// diagram — WC running list (+mine), instance diagram (frozen-spec projection),
// instance live states. Auth pattern mirrors api-images.test.ts exactly.
import { expect, test } from 'vitest';
import {
  workCenter, workflow, workflowInstance, stepInstance, instanceAssignment,
} from 'mission-control-db/src/db/schema/index';
import { makeApi } from './helpers/api.js';

const SPEC = {
  oid: 'rt_0', local_id: 'DG', display_style: 'flowchart',
  steps: [
    { oid: 'rt_1', local_id: 'Begin', step_type: 'START', position: { x: 0, y: 0 } },
    { oid: 'rt_2', local_id: 'Fill', step_type: 'USER_INTERACTION', position: { x: 0, y: 100 } },
  ],
  connections: [{ from_step_id: 'rt_1', to_step_id: 'rt_2' }],
  children: [],
};

async function seedRunning(db: Awaited<ReturnType<typeof makeApi>>['db'], wcId: string) {
  const oid = `wf-dg-${Math.random()}`;
  const [wf] = await db.insert(workflow).values({
    workCenterId: wcId, oid, name: oid, version: '1.0.0', state: 'Effective', specJsonb: SPEC,
  }).returning();
  const runtimeNumber = Math.floor(Math.random() * 1_000_000) + 1;
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wcId, triggeredBy: 'manual', status: 'running',
    specJsonb: SPEC, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Effective',
  }).returning();
  const [si] = await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: 'rt_0', stepOid: 'rt_2', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  return { wi, si };
}

test('all three routes 401 without a session', async () => {
  const { db, app, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const { wi } = await seedRunning(db, wc.id);
  for (const path of [
    `/api/work-centers/${wc.id}/runtime-workflows`,
    `/api/runtime-workflows/${wi.id}/diagram`,
    `/api/runtime-workflows/${wi.id}/live-states`,
  ]) {
    expect((await app.request(path)).status).toBe(401);
  }
  await close();
});

test('member gets list (+mine on their offer), diagram (rt oids, no-store), live states', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-dg@example.com', wc.id);
  const { wi, si } = await seedRunning(db, wc.id);
  await db.insert(instanceAssignment).values({ stepInstanceId: si.id, workCenterId: wc.id, status: 'offered' });
  const cookie = await cookieFor('op-dg@example.com');

  const list = await app.request(`/api/work-centers/${wc.id}/runtime-workflows`, { headers: { cookie } });
  expect(list.status).toBe(200);
  expect(list.headers.get('cache-control')).toBe('no-store');
  const items = await list.json() as Array<{ id: string; mine: boolean; status: string }>;
  expect(items.map((i) => i.id)).toContain(wi.id);
  expect(items.find((i) => i.id === wi.id)!.mine).toBe(true); // open offer, no role gate

  const dg = await app.request(`/api/runtime-workflows/${wi.id}/diagram`, { headers: { cookie } });
  expect(dg.status).toBe(200);
  expect(dg.headers.get('cache-control')).toBe('no-store');
  const diagram = await dg.json() as { instanceId: string; root: { steps: Array<{ oid: string }> } };
  expect(diagram.instanceId).toBe(wi.id);
  expect(diagram.root.steps.map((s) => s.oid)).toEqual(['rt_1', 'rt_2']);

  const ls = await app.request(`/api/runtime-workflows/${wi.id}/live-states`, { headers: { cookie } });
  expect(ls.status).toBe(200);
  const live = await ls.json() as { steps: Record<string, { state: string; assignment: { mine: boolean } | null }> };
  expect(live.steps['rt_2']).toMatchObject({ state: 'WAITING_USER', assignment: { mine: true } });
  expect(live.steps['rt_1']).toBeUndefined();
  await close();
});

test('non-member 403; unknown + malformed ids 404 (list: 400 malformed wcId)', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-out@example.com'); // no membership
  const { wi } = await seedRunning(db, wc.id);
  const cookie = await cookieFor('op-out@example.com');

  expect((await app.request(`/api/work-centers/${wc.id}/runtime-workflows`, { headers: { cookie } })).status).toBe(403);
  expect((await app.request(`/api/runtime-workflows/${wi.id}/diagram`, { headers: { cookie } })).status).toBe(403);
  expect((await app.request(`/api/runtime-workflows/${wi.id}/live-states`, { headers: { cookie } })).status).toBe(403);
  expect((await app.request('/api/work-centers/not-a-uuid/runtime-workflows', { headers: { cookie } })).status).toBe(400);
  expect((await app.request('/api/runtime-workflows/not-a-uuid/diagram', { headers: { cookie } })).status).toBe(404);
  expect((await app.request('/api/runtime-workflows/00000000-0000-4000-8000-000000000000/live-states', { headers: { cookie } })).status).toBe(404);
  await close();
});
