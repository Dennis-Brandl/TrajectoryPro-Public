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
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { migrateTestDb, resetDb } from '../test/fixture';
import { mockSessionAs, seedUser, req } from '../test/harness';
import { createWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { environmentSpec, workflow, workflowInstance } from 'mission-control-db/src/db/schema/index';
import { app } from '../app';

// M6: an environment spec is owned by exactly one work center, keyed
// (workCenterId, oid, version, state). No library, no link row.
async function seedEnvironmentInWorkCenter(oid: string, wcName = `WC-${oid}`) {
  const wc = await createWorkCenter(db, { name: wcName });
  const [e] = await db.insert(environmentSpec).values({
    oid, name: `Env-${oid}`, workCenterId: wc.id, specJsonb: {},
  }).returning();
  return { environmentSpecId: e.id, workCenterId: wc.id };
}

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); });

describe('environment detail + delete routes', () => {
  it('GET /environments/:id → 200 view for a reader; 404 for a missing id; 400 for a bad uuid', async () => {
    const { environmentSpecId } = await seedEnvironmentInWorkCenter('v-1');
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    const ok = await req(app, 'GET', `/api/environments/${environmentSpecId}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { environmentSpec: { id: string } }).environmentSpec.id).toBe(environmentSpecId);
    expect((await req(app, 'GET', `/api/environments/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
    expect((await req(app, 'GET', `/api/environments/not-a-uuid`)).status).toBe(400);
  });

  it('GET /api/environments/:id returns the singular owning work center', async () => {
    const { environmentSpecId, workCenterId } = await seedEnvironmentInWorkCenter('own-1');
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    const res = await req(app, 'GET', `/api/environments/${environmentSpecId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { workCenter: { id: string }; workCenters?: unknown };
    expect(body.workCenter.id).toBe(workCenterId);
    // The plural shape is gone — P1 changed hierarchies to singular ownership.
    expect(body.workCenters).toBeUndefined();
  });

  it('DELETE /environments/:id → 204 unreferenced; 403 for a viewer; 409 while a runtime is unfinished, 204 once it has finished', async () => {
    const { environmentSpecId, workCenterId } = await seedEnvironmentInWorkCenter('d-1');
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    expect((await req(app, 'DELETE', `/api/environments/${environmentSpecId}`)).status).toBe(403);

    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    // M6: linking is gone. Nothing RESTRICTs an environment_spec at the FK level
    // (workflow_environment CASCADEs; workflow_instance and schedule both SET NULL), so
    // deleteEnvironmentSpec pre-checks for instances explicitly — that is what 409s here.
    const [w] = await db.insert(workflow).values({
      oid: 'env-holder', name: 'Holder', workCenterId, specJsonb: {},
    }).returning();
    await db.insert(workflowInstance).values({
      workflowId: w.id, workCenterId, environmentSpecId, triggeredBy: 'manual',
      specJsonb: {}, runtimeNumber: 1, runtimeLabel: 'RW-1', masterName: 'Holder', masterOid: 'env-holder', masterVersion: '1.0.0', masterState: 'Draft',
    });
    const blocked = await req(app, 'DELETE', `/api/environments/${environmentSpecId}`);
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe('conflict');

    // A finished runtime is information only: the delete goes through and the runtime keeps
    // its row, with its environment link cleared.
    await db.update(workflowInstance).set({ status: 'completed' }).where(eq(workflowInstance.workflowId, w.id));
    expect((await req(app, 'DELETE', `/api/environments/${environmentSpecId}`)).status).toBe(204);
    const [run] = await db.select().from(workflowInstance).where(eq(workflowInstance.workflowId, w.id));
    expect(run.environmentSpecId).toBeNull();

    const { environmentSpecId: env2 } = await seedEnvironmentInWorkCenter('d-2');
    expect((await req(app, 'DELETE', `/api/environments/${env2}`)).status).toBe(204);
  });

  it('the retired import, link and move routes are gone', async () => {
    const { environmentSpecId, workCenterId } = await seedEnvironmentInWorkCenter('gone-1');
    mockSessionAs(await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' }));
    // PATCH re-filed a spec into another library; libraries are gone and spec content is
    // read-only (Designer's job), so nothing replaces it.
    expect((await req(app, 'PATCH', `/api/environments/${environmentSpecId}`)).status).toBe(404);
    // Linking is implicit in loading (spec §6).
    expect((await req(app, 'POST', `/api/environments/${environmentSpecId}/work-centers/${workCenterId}`)).status).toBe(404);
    expect((await req(app, 'DELETE', `/api/environments/${environmentSpecId}/work-centers/${workCenterId}`)).status).toBe(404);
    // The per-artifact import route is replaced by POST /api/work-centers/:id/load (Task 3).
    expect((await req(app, 'POST', '/api/environments/import')).status).toBe(404);
  });
});
