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
import { workCenter, runtimeHistory, type NewRuntimeHistory } from 'mission-control-db/src/db/schema/index';
import { assignUserToWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { insertStepSignature } from 'mission-control-db/src/dao/step-signatures';
import { app } from '../app';

const NIL = '00000000-0000-0000-0000-000000000000';

async function seed() {
  const [wcA] = await db.insert(workCenter).values({ name: `A-${Math.random()}` }).returning();
  const [wcB] = await db.insert(workCenter).values({ name: `B-${Math.random()}` }).returning();
  const admin = await seedUser(db, { email: `a-${Math.random()}@t.test`, displayName: 'Admin', accessLevel: 'administrator' });
  const commanderA = await seedUser(db, { email: `ca-${Math.random()}@t.test`, displayName: 'CmdrA' });
  const commanderB = await seedUser(db, { email: `cb-${Math.random()}@t.test`, displayName: 'CmdrB' });
  const viewer = await seedUser(db, { email: `v-${Math.random()}@t.test`, displayName: 'Viewer' });
  await assignUserToWorkCenter(db, wcA.id, commanderA, { missionSystemCommander: true });
  await assignUserToWorkCenter(db, wcB.id, commanderB, { missionSystemCommander: true });
  return { wcA, wcB, admin, commanderA, commanderB, viewer };
}

async function seedHistory(overrides: Partial<NewRuntimeHistory> = {}) {
  const merged = {
    workCenterName: 'WC', runtimeNumber: 1,
    masterName: 'WF', masterOid: 'wf-1', masterVersion: '1.0.0', masterState: 'Effective',
    finalState: 'completed', finishedAt: new Date(), trace: [],
    ...overrides,
  };
  const [row] = await db.insert(runtimeHistory).values({
    ...merged,
    runtimeLabel: overrides.runtimeLabel ?? `RW-${merged.runtimeNumber}`,
  }).returning();
  return row;
}

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
  mockSessionAs(null);
});

describe('GET /work-centers/:id/runtime-history', () => {
  it('lists rows scoped to the WC; filters + pagination flow through; bad state/page -> 400', async () => {
    const { wcA, wcB, viewer } = await seed();
    await seedHistory({ workCenterId: wcA.id, workCenterName: wcA.name, finalState: 'completed', finishedAt: new Date('2026-01-01') });
    await seedHistory({ workCenterId: wcA.id, workCenterName: wcA.name, finalState: 'errored', finishedAt: new Date('2026-01-02') });
    await seedHistory({ workCenterId: wcB.id, workCenterName: wcB.name, finalState: 'completed', finishedAt: new Date('2026-01-03') });

    mockSessionAs(viewer);
    const res = await req(app, 'GET', `/api/work-centers/${wcA.id}/runtime-history`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { history: unknown[]; total: number; page: number; pageSize: number };
    expect(body.total).toBe(2);
    expect(body.history).toHaveLength(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);

    const filtered = await req(app, 'GET', `/api/work-centers/${wcA.id}/runtime-history?state=errored`);
    expect(filtered.status).toBe(200);
    const filteredBody = (await filtered.json()) as { history: { finalState: string }[]; total: number };
    expect(filteredBody.total).toBe(1);
    expect(filteredBody.history[0].finalState).toBe('errored');

    const badState = await req(app, 'GET', `/api/work-centers/${wcA.id}/runtime-history?state=bogus`);
    expect(badState.status).toBe(400);
    expect(((await badState.json()) as { error: { code: string } }).error.code).toBe('validation');

    const badPage = await req(app, 'GET', `/api/work-centers/${wcA.id}/runtime-history?page=0`);
    expect(badPage.status).toBe(400);
  });

  it('search/from/to filters pass through the route layer to the DAO', async () => {
    const { wcA, viewer } = await seed();
    await seedHistory({ workCenterId: wcA.id, workCenterName: wcA.name, masterName: 'Alpha Flow', finishedAt: new Date('2026-01-01') });
    await seedHistory({ workCenterId: wcA.id, workCenterName: wcA.name, masterName: 'Beta Flow', finishedAt: new Date('2026-02-01') });
    await seedHistory({ workCenterId: wcA.id, workCenterName: wcA.name, masterName: 'Gamma Flow', finishedAt: new Date('2026-03-01') });

    mockSessionAs(viewer);

    const bySearch = await req(app, 'GET', `/api/work-centers/${wcA.id}/runtime-history?search=Beta`);
    expect(bySearch.status).toBe(200);
    const bySearchBody = (await bySearch.json()) as { total: number; history: { masterName: string }[] };
    expect(bySearchBody.total).toBe(1);
    expect(bySearchBody.history[0].masterName).toBe('Beta Flow');

    const byFrom = await req(app, 'GET', `/api/work-centers/${wcA.id}/runtime-history?from=2026-02-01`);
    expect(byFrom.status).toBe(200);
    const byFromBody = (await byFrom.json()) as { total: number; history: { masterName: string }[] };
    expect(byFromBody.total).toBe(2);
    expect(byFromBody.history.map((h) => h.masterName).sort()).toEqual(['Beta Flow', 'Gamma Flow']);

    const byTo = await req(app, 'GET', `/api/work-centers/${wcA.id}/runtime-history?to=2026-02-01`);
    expect(byTo.status).toBe(200);
    const byToBody = (await byTo.json()) as { total: number; history: { masterName: string }[] };
    expect(byToBody.total).toBe(2);
    expect(byToBody.history.map((h) => h.masterName).sort()).toEqual(['Alpha Flow', 'Beta Flow']);
  });

  it('?workCenterId=<other WC> is rejected 400 by the strict per-WC schema (scope-leak regression)', async () => {
    const { wcA, wcB, viewer } = await seed();
    await seedHistory({ workCenterId: wcA.id, workCenterName: wcA.name });
    await seedHistory({ workCenterId: wcB.id, workCenterName: wcB.name });

    mockSessionAs(viewer);
    const res = await req(app, 'GET', `/api/work-centers/${wcA.id}/runtime-history?workCenterId=${wcB.id}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation');
  });
});

describe('GET /runtime-history', () => {
  it('lists across WCs; workCenterId scopes; orphans scopes; both together -> 400', async () => {
    const { wcA, wcB, viewer } = await seed();
    await seedHistory({ workCenterId: wcA.id, workCenterName: wcA.name });
    await seedHistory({ workCenterId: wcB.id, workCenterName: wcB.name });
    await seedHistory({ workCenterId: null, workCenterName: '(deleted)' });

    mockSessionAs(viewer);
    const all = await req(app, 'GET', '/api/runtime-history');
    expect(all.status).toBe(200);
    expect(((await all.json()) as { total: number }).total).toBe(3);

    const scoped = await req(app, 'GET', `/api/runtime-history?workCenterId=${wcA.id}`);
    expect(scoped.status).toBe(200);
    expect(((await scoped.json()) as { total: number }).total).toBe(1);

    const orphans = await req(app, 'GET', '/api/runtime-history?orphans=true');
    expect(orphans.status).toBe(200);
    const orphansBody = (await orphans.json()) as { total: number; history: { workCenterId: string | null }[] };
    expect(orphansBody.total).toBe(1);
    expect(orphansBody.history[0].workCenterId).toBeNull();

    const both = await req(app, 'GET', `/api/runtime-history?workCenterId=${wcA.id}&orphans=true`);
    expect(both.status).toBe(400);
  });
});

describe('GET /runtime-history/:id', () => {
  it('200s the full detail payload; 404s unknown', async () => {
    const { wcA, viewer } = await seed();
    const workflowInstanceId = '33333333-3333-4333-8333-333333333333';
    const seeded = await seedHistory({
      workCenterId: wcA.id, workCenterName: wcA.name,
      workflowInstanceId,
      trace: [{ step_oid: 's-1', state: 'completed', order: 0, timestamp: 1 }],
      startingParams: { BatchSize: '10' },
    });
    await insertStepSignature(db, {
      workflowInstanceId, runtimeNumber: seeded.runtimeNumber, runtimeLabel: seeded.runtimeLabel,
      workCenterId: wcA.id, workCenterName: wcA.name,
      stepOid: 's-1', stepName: 'Approve batch',
      signerLoginName: 'jane', signerDisplayName: 'Jane Lee',
      roleName: 'QA Lead', operatorLoginName: 'jane', decision: 'yes',
      outcome: 'signed', failureCode: null,
    });

    mockSessionAs(viewer);
    const res = await req(app, 'GET', `/api/runtime-history/${seeded.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string; trace: unknown[]; startingParams: Record<string, string>;
      signatures: { signerLoginName: string; outcome: string }[];
      stepRuns: unknown[]; startedByLoginName: string | null; startedByUserId: string | null;
      userNames: Record<string, string>;
    };
    expect(Array.isArray(body.stepRuns)).toBe(true);
    expect(body).toHaveProperty('startedByLoginName');
    expect(body).toHaveProperty('startedByUserId');
    expect(typeof body.userNames).toBe('object');
    expect(body.id).toBe(seeded.id);
    expect(body.trace).toEqual([{ step_oid: 's-1', state: 'completed', order: 0, timestamp: 1 }]);
    expect(body.startingParams).toEqual({ BatchSize: '10' });
    expect(body.signatures).toHaveLength(1);
    expect(body.signatures[0]).toMatchObject({ signerLoginName: 'jane', outcome: 'signed' });

    const notFound = await req(app, 'GET', `/api/runtime-history/${NIL}`);
    expect(notFound.status).toBe(404);
  });
});

describe('DELETE /runtime-history/:id', () => {
  it('admin deletes any row -> 204', async () => {
    const { wcA, admin } = await seed();
    const row = await seedHistory({ workCenterId: wcA.id, workCenterName: wcA.name });
    mockSessionAs(admin);
    const res = await req(app, 'DELETE', `/api/runtime-history/${row.id}`);
    expect(res.status).toBe(204);
  });

  it("commander of the row's WC deletes -> 204", async () => {
    const { wcA, commanderA } = await seed();
    const row = await seedHistory({ workCenterId: wcA.id, workCenterName: wcA.name });
    mockSessionAs(commanderA);
    const res = await req(app, 'DELETE', `/api/runtime-history/${row.id}`);
    expect(res.status).toBe(204);
  });

  it('commander of a DIFFERENT WC -> 403', async () => {
    const { wcA, commanderB } = await seed();
    const row = await seedHistory({ workCenterId: wcA.id, workCenterName: wcA.name });
    mockSessionAs(commanderB);
    const res = await req(app, 'DELETE', `/api/runtime-history/${row.id}`);
    expect(res.status).toBe(403);
  });

  it('non-commander (viewer) -> 403', async () => {
    const { wcA, viewer } = await seed();
    const row = await seedHistory({ workCenterId: wcA.id, workCenterName: wcA.name });
    mockSessionAs(viewer);
    const res = await req(app, 'DELETE', `/api/runtime-history/${row.id}`);
    expect(res.status).toBe(403);
  });

  it('orphan row + commander -> 403 (admin-only by construction)', async () => {
    const { commanderA } = await seed();
    const row = await seedHistory({ workCenterId: null, workCenterName: '(deleted)' });
    mockSessionAs(commanderA);
    const res = await req(app, 'DELETE', `/api/runtime-history/${row.id}`);
    expect(res.status).toBe(403);
  });

  it('orphan row + admin -> 204', async () => {
    const { admin } = await seed();
    const row = await seedHistory({ workCenterId: null, workCenterName: '(deleted)' });
    mockSessionAs(admin);
    const res = await req(app, 'DELETE', `/api/runtime-history/${row.id}`);
    expect(res.status).toBe(204);
  });

  it('unknown id -> 404', async () => {
    const { admin } = await seed();
    mockSessionAs(admin);
    const res = await req(app, 'DELETE', `/api/runtime-history/${NIL}`);
    expect(res.status).toBe(404);
  });

  it('non-admin (plain viewer) unknown id -> 404, not 403 (existence check precedes the authorization gate)', async () => {
    const { viewer } = await seed();
    mockSessionAs(viewer);
    const res = await req(app, 'DELETE', `/api/runtime-history/${NIL}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /runtime-history/purge-count and POST /runtime-history/purge', () => {
  it('admin-only (403 for commander); shapes {count}/{deleted}', async () => {
    const { wcA, admin, commanderA } = await seed();
    await seedHistory({ workCenterId: wcA.id, workCenterName: wcA.name, finishedAt: new Date('2026-01-01') });
    await seedHistory({ workCenterId: wcA.id, workCenterName: wcA.name, finishedAt: new Date('2026-06-01') });

    mockSessionAs(commanderA);
    const forbiddenCount = await req(app, 'GET', '/api/runtime-history/purge-count?olderThan=2026-03-01');
    expect(forbiddenCount.status).toBe(403);
    const forbiddenPurge = await req(app, 'POST', '/api/runtime-history/purge', { json: { olderThan: '2026-03-01' } });
    expect(forbiddenPurge.status).toBe(403);

    mockSessionAs(admin);
    const count = await req(app, 'GET', '/api/runtime-history/purge-count?olderThan=2026-03-01');
    expect(count.status).toBe(200);
    expect(await count.json()).toEqual({ count: 1 });

    const purge = await req(app, 'POST', '/api/runtime-history/purge', { json: { olderThan: '2026-03-01' } });
    expect(purge.status).toBe(200);
    expect(await purge.json()).toEqual({ deleted: 1 });
  });
});
