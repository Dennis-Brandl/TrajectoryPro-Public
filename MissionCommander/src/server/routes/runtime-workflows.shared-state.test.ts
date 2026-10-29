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
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db } from '../lib/db';
import { migrateTestDb, resetDb } from '../test/fixture';
import { mockSessionAs, seedUser, req } from '../test/harness';
import { createWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { workflow, workflowInstance, wcResource, wcResourceHolder } from 'mission-control-db/src/db/schema/index';
import { app } from '../app';

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); });

const SPEC = { oid: 'wf-1', steps: [{ oid: 's-mix', local_id: 'Mix Step' }], connections: [], children: [{ oid: 'wf-1-c1', local_id: 'Sub', steps: [], connections: [] }] };

async function seedInstance() {
  const wc = await createWorkCenter(db, { name: 'Line 1' });
  const [wf] = await db.insert(workflow).values({ oid: 'wf-1', name: 'Fill', workCenterId: wc.id, specJsonb: SPEC }).returning();
  const [inst] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', specJsonb: SPEC,
    runtimeNumber: 3, runtimeLabel: 'RW-3', masterName: 'Fill', masterOid: 'wf-1', masterVersion: '1.0.0', masterState: 'Effective',
    propertyStore: { 'Batch.Size': '5' },
    engineState: {
      resources: { resources: [['wf-1:Lock', { type: 'binary exclusive use', inUse: 1, queue: [], ownerId: 'wf-1', scope: 'workflow', resourceKey: 'wf-1:Lock' }]], pendingGrants: [], syncMatchedData: [], pendingNamedAssignments: [] },
      childProperties: { 'wf-1-c1': { 'Sub.X': '1' } },
    },
  }).returning();
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use', inUse: 1 });
  await db.insert(wcResourceHolder).values({ workCenterId: wc.id, name: 'Printer', instanceId: inst.id, stepOid: 's-mix', amount: 1 });
  return { wc, inst };
}

describe('runtime-workflow shared-state reads', () => {
  it('GET /runtime-workflows/:id/resources → 401 unauthenticated; 200 with workflow + environment rows', async () => {
    const { inst } = await seedInstance();
    expect((await req(app, 'GET', `/api/runtime-workflows/${inst.id}/resources`)).status).toBe(401);
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    const res = await req(app, 'GET', `/api/runtime-workflows/${inst.id}/resources`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runtimeNumber: number; workflow: { name: string; summary: { state: string } }[]; environment: { name: string; holders: { runtimeNumber: number; stepName: string }[] }[] };
    expect(body.runtimeNumber).toBe(3);
    expect(body.workflow).toMatchObject([{ name: 'Lock', summary: { state: 'In use' } }]);
    expect(body.environment).toMatchObject([{ name: 'Printer', holders: [{ runtimeNumber: 3, stepName: 'Mix Step' }] }]);
  });

  it('GET /runtime-workflows/:id/value-properties → root, named child stores, and the shared registry', async () => {
    const { inst } = await seedInstance();
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    const res = await req(app, 'GET', `/api/runtime-workflows/${inst.id}/value-properties`);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({
      root: { 'Batch.Size': '5' },
      children: [{ childOid: 'wf-1-c1', childName: 'Sub', values: { 'Sub.X': '1' } }],
      shared: [],
    });
  });

  it('404 for a missing instance; 400 for a malformed uuid', async () => {
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    for (const tail of ['resources', 'value-properties']) {
      expect((await req(app, 'GET', `/api/runtime-workflows/00000000-0000-0000-0000-000000000000/${tail}`)).status).toBe(404);
      expect((await req(app, 'GET', `/api/runtime-workflows/not-a-uuid/${tail}`)).status).toBe(400);
    }
  });
});
