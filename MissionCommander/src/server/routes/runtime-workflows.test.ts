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
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { db } from '../lib/db';
import { migrateTestDb, resetDb } from '../test/fixture';
import { mockSessionAs, seedUser, req } from '../test/harness';
import { workCenter, workflow, stepInstance, instanceAssignment, operatorPresence } from 'mission-control-db/src/db/schema/index';
import { assignUserToWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { app } from '../app';
import { engineAssign, engineControl, engineForceRelease, engineForceComplete, EngineUnavailableError } from '../lib/engine-client';

// Engine calls are stubbed at the module boundary (phase 6 §5) — the route layer only
// authenticates/authorizes/maps; the real HTTP call to the engine is Task 6's concern,
// already covered by engine-client's own tests.
vi.mock('../lib/engine-client', () => ({
  EngineUnavailableError: class EngineUnavailableError extends Error {},
  engineControl: vi.fn(),
  engineForceRelease: vi.fn(),
  engineAssign: vi.fn(),
  engineWorkCenterResourceVerb: vi.fn(),
  engineInstanceResourceVerb: vi.fn(),
  engineSetWorkCenterValue: vi.fn(),
  engineSetInstanceValue: vi.fn(),
  engineForceComplete: vi.fn(),
}));

const mockEngineControl = vi.mocked(engineControl);
const mockEngineForceRelease = vi.mocked(engineForceRelease);
const mockEngineAssign = vi.mocked(engineAssign);
const mockEngineForceComplete = vi.mocked(engineForceComplete);

const NIL = '00000000-0000-0000-0000-000000000000';

const SPEC = {
  local_id: 'WF', oid: 'wf-1', version: '1.2.0', state: 'Effective',
  starting_parameter_specifications: [{ id: 'BatchSize', default_value: '10', value_type: 'literal' }],
  steps: [{ local_id: 'Start', oid: 's-1', step_type: 'START' }],
  connections: [],
};

async function seed() {
  const [wcA] = await db.insert(workCenter).values({ name: `A-${Math.random()}` }).returning();
  const [wcB] = await db.insert(workCenter).values({ name: `B-${Math.random()}` }).returning();
  const [wfA] = await db.insert(workflow).values({ oid: 'wf-1', name: 'WF-A', workCenterId: wcA.id, specJsonb: SPEC }).returning();
  const [wfB] = await db.insert(workflow).values({ oid: 'wf-1', name: 'WF-B', workCenterId: wcB.id, specJsonb: SPEC }).returning();
  const admin = await seedUser(db, { email: `a-${Math.random()}@t.test`, displayName: 'Admin', accessLevel: 'administrator' });
  const commanderA = await seedUser(db, { email: `c-${Math.random()}@t.test`, displayName: 'Cmdr' });
  const viewer = await seedUser(db, { email: `v-${Math.random()}@t.test`, displayName: 'Viewer' });
  await assignUserToWorkCenter(db, wcA.id, commanderA, { missionSystemCommander: true });
  await assignUserToWorkCenter(db, wcA.id, viewer, {});
  return { wcA, wcB, wfA, wfB, admin, commanderA, viewer };
}

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
  mockSessionAs(null);
  mockEngineControl.mockReset();
  mockEngineForceRelease.mockReset();
  mockEngineAssign.mockReset();
  mockEngineForceComplete.mockReset();
});

/** Create a pending instance for wfA as commanderA, returning its id. Leaves the session as commanderA. */
async function createInstance(wfA: { id: string }, commanderA: string): Promise<string> {
  mockSessionAs(commanderA);
  const created = await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, { json: {} });
  const { id } = (await created.json()) as { id: string };
  return id;
}

describe('GET /workflows/:workflowId/runtime-parameters', () => {
  it('returns normalized parameters for a viewer', async () => {
    const { wfA, viewer } = await seed();
    mockSessionAs(viewer);

    const res = await req(app, 'GET', `/api/workflows/${wfA.id}/runtime-parameters`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workflowId: string; parameters: unknown[] };
    expect(body.workflowId).toBe(wfA.id);
    expect(body.parameters).toEqual([
      { id: 'BatchSize', description: null, defaultValue: '10', valueType: 'literal' },
    ]);
  });

  it('404s an unknown workflow', async () => {
    const { viewer } = await seed();
    mockSessionAs(viewer);

    const res = await req(app, 'GET', `/api/workflows/${NIL}/runtime-parameters`);
    expect(res.status).toBe(404);
  });
});

describe('POST /workflows/:workflowId/runtime-workflows', () => {
  it('creates as commanderA → 201, runtimeNumber 1, status pending', async () => {
    const { wfA, commanderA } = await seed();
    mockSessionAs(commanderA);

    const res = await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, { json: {} });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { runtimeNumber: number; status: string };
    expect(body.runtimeNumber).toBe(1);
    expect(body.status).toBe('pending');
  });

  it('403s a viewer', async () => {
    const { wfA, viewer } = await seed();
    mockSessionAs(viewer);

    const res = await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, { json: {} });
    expect(res.status).toBe(403);
  });

  it('201s an administrator', async () => {
    const { wfA, admin } = await seed();
    mockSessionAs(admin);

    const res = await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, { json: {} });
    expect(res.status).toBe(201);
  });

  it('403s commanderA on WC B\'s workflow (cross-WC isolation)', async () => {
    const { wfB, commanderA } = await seed();
    mockSessionAs(commanderA);

    const res = await req(app, 'POST', `/api/workflows/${wfB.id}/runtime-workflows`, { json: {} });
    expect(res.status).toBe(403);
  });

  it('404s an unknown workflow id', async () => {
    const { commanderA } = await seed();
    mockSessionAs(commanderA);

    const res = await req(app, 'POST', `/api/workflows/${NIL}/runtime-workflows`, { json: {} });
    expect(res.status).toBe(404);
  });

  it('400s an unknown parameter name', async () => {
    const { wfA, commanderA } = await seed();
    mockSessionAs(commanderA);

    const res = await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, {
      json: { params: { Unknown: 'x' } },
    });
    expect(res.status).toBe(400);
  });

  it('400s a non-string parameter value (zod)', async () => {
    const { wfA, commanderA } = await seed();
    mockSessionAs(commanderA);

    const res = await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, {
      json: { params: { BatchSize: 7 } },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /work-centers/:id/runtime-workflows', () => {
  it('lists both instances for a viewer, no specJsonb key', async () => {
    const { wcA, wfA, commanderA, admin, viewer } = await seed();

    mockSessionAs(commanderA);
    await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, { json: {} });
    mockSessionAs(admin);
    await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, { json: {} });

    mockSessionAs(viewer);
    const res = await req(app, 'GET', `/api/work-centers/${wcA.id}/runtime-workflows`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runtimeWorkflows: Record<string, unknown>[] };
    expect(body.runtimeWorkflows).toHaveLength(2);
    for (const row of body.runtimeWorkflows) {
      expect(row).not.toHaveProperty('specJsonb');
    }
  });

  it('filter + pagination params flow through; bad filter/page -> 400', async () => {
    const { wcA, wfA, commanderA, viewer } = await seed();
    mockSessionAs(commanderA);

    const created = await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, { json: {} });
    const { id } = (await created.json()) as { id: string };
    await req(app, 'POST', `/api/runtime-workflows/${id}/start`);
    await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, { json: {} }); // stays pending

    mockSessionAs(viewer);

    const active = await req(app, 'GET', `/api/work-centers/${wcA.id}/runtime-workflows?filter=active`);
    expect(active.status).toBe(200);
    const activeBody = (await active.json()) as { runtimeWorkflows: { status: string }[]; total: number; page: number; pageSize: number; statusCounts: Record<string, number> };
    expect(activeBody.runtimeWorkflows.every((r) => r.status === 'queued')).toBe(true);
    expect(activeBody.total).toBe(1);
    expect(activeBody.page).toBe(1);
    expect(activeBody.pageSize).toBe(24);
    // Chip counts ride every list response and cover the whole work center (one queued
    // instance = active bucket, one still pending), regardless of the filter applied.
    expect(activeBody.statusCounts).toEqual({ active: 1, pending: 1, finished: 0 });

    const noParams = await req(app, 'GET', `/api/work-centers/${wcA.id}/runtime-workflows`);
    expect(noParams.status).toBe(200);
    const noParamsBody = (await noParams.json()) as { runtimeWorkflows: unknown[]; total: number; page: number; pageSize: number };
    expect(noParamsBody).toMatchObject({ total: 2, page: 1, pageSize: 24 });
    expect(noParamsBody.runtimeWorkflows).toHaveLength(2);

    const badFilter = await req(app, 'GET', `/api/work-centers/${wcA.id}/runtime-workflows?filter=bogus`);
    expect(badFilter.status).toBe(400);
    expect(((await badFilter.json()) as { error: { code: string } }).error.code).toBe('validation');

    const badPage = await req(app, 'GET', `/api/work-centers/${wcA.id}/runtime-workflows?page=0`);
    expect(badPage.status).toBe(400);
    expect(((await badPage.json()) as { error: { code: string } }).error.code).toBe('validation');
  });
});

describe('GET /runtime-workflows/:id/live', () => {
  it('200 with summary+steps+trace; 404 unknown; open to work_center:read', async () => {
    const { wfA, commanderA, viewer } = await seed();
    const id = await createInstance(wfA, commanderA);
    const [step] = await db.insert(stepInstance).values({
      workflowInstanceId: id, nodeOid: 'n', stepOid: 's-1', stepType: 'START', state: 'READY',
    }).returning();

    mockSessionAs(viewer);
    const res = await req(app, 'GET', `/api/runtime-workflows/${id}/live`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { id: string }; steps: { id: string; stepOid: string }[]; trace: unknown[];
    };
    expect(body.summary.id).toBe(id);
    expect(body.steps.map((s) => s.id)).toEqual([step.id]);
    expect(Array.isArray(body.trace)).toBe(true);

    const unknown = await req(app, 'GET', `/api/runtime-workflows/${NIL}/live`);
    expect(unknown.status).toBe(404);
    const unknownBody = (await unknown.json()) as { error: { code: string } };
    expect(unknownBody.error.code).toBe('not_found');
  });
});

describe('GET /work-centers/:id/presence', () => {
  it('returns { presence } for the WC, open to work_center:read', async () => {
    const { wcA, viewer } = await seed();
    const online = await seedUser(db, { email: `p-${Math.random()}@t.test`, displayName: 'Present One' });
    await db.insert(operatorPresence).values({
      userId: online, attendingWorkCenterId: wcA.id, sessionId: `sess-${Math.random()}`, status: 'online',
    });

    mockSessionAs(viewer);
    const res = await req(app, 'GET', `/api/work-centers/${wcA.id}/presence`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { presence: { userId: string; name: string | null; status: string }[] };
    expect(body.presence).toEqual([
      { userId: online, name: 'Present One', status: 'online', since: expect.any(String) },
    ]);
  });
});

describe('POST /runtime-workflows/:id/start', () => {
  it('starts as commanderA → 200 queued; a second start → 409; a viewer → 403', async () => {
    const { wfA, commanderA, viewer } = await seed();
    mockSessionAs(commanderA);

    const created = await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, { json: {} });
    const { id } = (await created.json()) as { id: string };

    const started = await req(app, 'POST', `/api/runtime-workflows/${id}/start`);
    expect(started.status).toBe(200);
    expect(((await started.json()) as { status: string }).status).toBe('queued');

    const second = await req(app, 'POST', `/api/runtime-workflows/${id}/start`);
    expect(second.status).toBe(409);

    const created2 = await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, { json: {} });
    const { id: id2 } = (await created2.json()) as { id: string };
    mockSessionAs(viewer);
    const asViewer = await req(app, 'POST', `/api/runtime-workflows/${id2}/start`);
    expect(asViewer.status).toBe(403);
  });
});

describe('DELETE /runtime-workflows/:id', () => {
  it('deletes a pending instance → 204; a queued one → 409; an unknown one → 404', async () => {
    const { wfA, commanderA } = await seed();
    mockSessionAs(commanderA);

    const created = await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, { json: {} });
    const { id } = (await created.json()) as { id: string };
    const del = await req(app, 'DELETE', `/api/runtime-workflows/${id}`);
    expect(del.status).toBe(204);

    const created2 = await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, { json: {} });
    const { id: id2 } = (await created2.json()) as { id: string };
    await req(app, 'POST', `/api/runtime-workflows/${id2}/start`);
    const delQueued = await req(app, 'DELETE', `/api/runtime-workflows/${id2}`);
    expect(delQueued.status).toBe(409);

    const delUnknown = await req(app, 'DELETE', `/api/runtime-workflows/${NIL}`);
    expect(delUnknown.status).toBe(404);
  });
});

describe('POST /runtime-workflows/:id/pause', () => {
  it('pause route: commander-gated, forwards to the engine, passes 200/409/404 through', async () => {
    const { wfA, commanderA, viewer } = await seed();
    const id = await createInstance(wfA, commanderA);

    mockEngineControl.mockResolvedValueOnce({ ok: true });
    const ok = await req(app, 'POST', `/api/runtime-workflows/${id}/pause`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(mockEngineControl).toHaveBeenCalledWith('pause', id);

    mockEngineControl.mockResolvedValueOnce({ ok: false, status: 409, message: 'cannot pause from completed' });
    const conflict = await req(app, 'POST', `/api/runtime-workflows/${id}/pause`);
    expect(conflict.status).toBe(409);
    const conflictBody = (await conflict.json()) as { error: { code: string; message: string } };
    expect(conflictBody.error.code).toBe('conflict');
    expect(conflictBody.error.message).toBe('cannot pause from completed');

    mockEngineControl.mockResolvedValueOnce({ ok: false, status: 404, message: 'instance not found' });
    const notFound = await req(app, 'POST', `/api/runtime-workflows/${id}/pause`);
    expect(notFound.status).toBe(404);
    expect(((await notFound.json()) as { error: { code: string } }).error.code).toBe('not_found');

    mockEngineControl.mockClear();
    mockSessionAs(viewer);
    const forbidden = await req(app, 'POST', `/api/runtime-workflows/${id}/pause`);
    expect(forbidden.status).toBe(403);
    expect(mockEngineControl).not.toHaveBeenCalled();

    mockSessionAs(commanderA);
    const unknownInstance = await req(app, 'POST', `/api/runtime-workflows/${NIL}/pause`);
    expect(unknownInstance.status).toBe(404);
    expect(mockEngineControl).not.toHaveBeenCalled();
  });

  it('pause route: engine unreachable -> 502 internal', async () => {
    const { wfA, commanderA } = await seed();
    const id = await createInstance(wfA, commanderA);

    mockEngineControl.mockRejectedValueOnce(new EngineUnavailableError('connect ECONNREFUSED'));
    const res = await req(app, 'POST', `/api/runtime-workflows/${id}/pause`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal');
    expect(body.error.message).toBe('Engine unreachable — try again');
  });

  it('resume/stop/abort route to the matching engine verb', async () => {
    const { wfA, commanderA } = await seed();
    const id = await createInstance(wfA, commanderA);

    for (const verb of ['resume', 'stop', 'abort'] as const) {
      mockEngineControl.mockResolvedValueOnce({ ok: true });
      const res = await req(app, 'POST', `/api/runtime-workflows/${id}/${verb}`);
      expect(res.status).toBe(200);
      expect(mockEngineControl).toHaveBeenCalledWith(verb, id);
    }
  });
});

describe('POST /assignments/:id/force-release', () => {
  it('force-release route: commander-gated via the assignment WC, same mapping', async () => {
    const { wcA, wfA, commanderA } = await seed();
    const instanceId = await createInstance(wfA, commanderA);

    const [step] = await db.insert(stepInstance).values({
      workflowInstanceId: instanceId, nodeOid: 'n', stepOid: 's1', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
    }).returning();
    const [assignment] = await db.insert(instanceAssignment).values({
      stepInstanceId: step.id, workCenterId: wcA.id, status: 'offered',
    }).returning();

    mockEngineForceRelease.mockResolvedValueOnce({ ok: true });
    const ok = await req(app, 'POST', `/api/assignments/${assignment.id}/force-release`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(mockEngineForceRelease).toHaveBeenCalledWith(assignment.id);

    mockEngineForceRelease.mockResolvedValueOnce({ ok: false, status: 409, message: 'assignment already claimed elsewhere' });
    const conflict = await req(app, 'POST', `/api/assignments/${assignment.id}/force-release`);
    expect(conflict.status).toBe(409);
    const conflictBody = (await conflict.json()) as { error: { code: string; message: string } };
    expect(conflictBody.error.code).toBe('conflict');
    expect(conflictBody.error.message).toBe('assignment already claimed elsewhere');

    const unknown = await req(app, 'POST', `/api/assignments/${NIL}/force-release`);
    expect(unknown.status).toBe(404);
    expect(mockEngineForceRelease).toHaveBeenCalledTimes(2); // unknown assignment never reaches the engine
  });
});

describe('GET /runtime-workflows/active', () => {
  it('returns the WC forest + active leaves for a viewer; excludes terminal', async () => {
    const { wcA, wfA, commanderA, viewer } = await seed();
    const id = await createInstance(wfA, commanderA);
    mockSessionAs(commanderA);
    await req(app, 'POST', `/api/runtime-workflows/${id}/start`);
    mockSessionAs(viewer);
    const res = await req(app, 'GET', '/api/runtime-workflows/active');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: Array<{ id: string }>; runtimeWorkflows: Array<{ id: string; workCenterId: string; status: string }> };
    expect(body.nodes.some((n) => n.id === wcA.id)).toBe(true);
    expect(body.runtimeWorkflows).toEqual([
      expect.objectContaining({ id, workCenterId: wcA.id, runtimeNumber: 1, status: 'queued' }),
    ]);
  });
  it('401s without a session', async () => {
    await seed();
    expect((await req(app, 'GET', '/api/runtime-workflows/active')).status).toBe(401);
  });
});

describe('GET /runtime-workflows/:id/{diagram,live-states}', () => {
  it('serves the frozen diagram and the live-states map to a viewer', async () => {
    const { wfA, commanderA, viewer } = await seed();
    const id = await createInstance(wfA, commanderA);
    mockSessionAs(viewer);
    const diagram = await req(app, 'GET', `/api/runtime-workflows/${id}/diagram`);
    expect(diagram.status).toBe(200);
    const dBody = (await diagram.json()) as { instanceId: string; root: { steps: unknown[] } };
    expect(dBody.instanceId).toBe(id);
    expect(dBody.root.steps).toHaveLength(1); // SPEC has one START step
    const live = await req(app, 'GET', `/api/runtime-workflows/${id}/live-states`);
    expect(live.status).toBe(200);
    const lBody = (await live.json()) as { instanceId: string; status: string; steps: object; childActive: object };
    expect(lBody.instanceId).toBe(id);
    expect(lBody.status).toBe('pending');
  });
  it('404s an unknown instance', async () => {
    const { viewer } = await seed();
    mockSessionAs(viewer);
    expect((await req(app, 'GET', `/api/runtime-workflows/${NIL}/diagram`)).status).toBe(404);
    expect((await req(app, 'GET', `/api/runtime-workflows/${NIL}/live-states`)).status).toBe(404);
  });
});

describe('assign', () => {
  async function seedOffer(wcId: string, instanceId: string): Promise<string> {
    const [step] = await db.insert(stepInstance).values({
      workflowInstanceId: instanceId, nodeOid: 'wf-1', stepOid: 's-1', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
    }).returning();
    const [a] = await db.insert(instanceAssignment).values({
      stepInstanceId: step!.id, workCenterId: wcId, status: 'offered',
    }).returning();
    return a!.id;
  }

  it('candidates: lists WC members for a viewer; 404 unknown', async () => {
    const { wcA, wfA, commanderA, viewer } = await seed();
    const id = await createInstance(wfA, commanderA);
    const aId = await seedOffer(wcA.id, id);
    mockSessionAs(viewer);
    const res = await req(app, 'GET', `/api/assignments/${aId}/candidates`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assignmentId: string; status: string; candidates: Array<{ userId: string }> };
    expect(body.assignmentId).toBe(aId);
    expect(body.status).toBe('offered');
    // commanderA and viewer are both members of wcA (seed()).
    expect(body.candidates.length).toBeGreaterThanOrEqual(2);
    expect((await req(app, 'GET', `/api/assignments/${NIL}/candidates`)).status).toBe(404);
  });

  it('assign: commander 200 → engineAssign called; viewer 403 BEFORE any engine call; 400 bad body; engine 409/unreachable mapped', async () => {
    const { wcA, wfA, commanderA, viewer } = await seed();
    const id = await createInstance(wfA, commanderA);
    const aId = await seedOffer(wcA.id, id);

    mockSessionAs(viewer);
    expect((await req(app, 'POST', `/api/assignments/${aId}/assign`, { json: { userId: NIL } })).status).toBe(403);
    expect(mockEngineAssign).not.toHaveBeenCalled();

    mockSessionAs(commanderA);
    expect((await req(app, 'POST', `/api/assignments/${aId}/assign`, { json: { userId: 'nope' } })).status).toBe(400);

    mockEngineAssign.mockResolvedValue({ ok: true });
    const ok = await req(app, 'POST', `/api/assignments/${aId}/assign`, { json: { userId: NIL } });
    expect(ok.status).toBe(200);
    expect(mockEngineAssign).toHaveBeenCalledWith(aId, NIL);

    mockEngineAssign.mockResolvedValue({ ok: false, status: 409, message: 'assignment is not an open offer' });
    expect((await req(app, 'POST', `/api/assignments/${aId}/assign`, { json: { userId: NIL } })).status).toBe(409);

    mockEngineAssign.mockRejectedValue(new EngineUnavailableError('down'));
    expect((await req(app, 'POST', `/api/assignments/${aId}/assign`, { json: { userId: NIL } })).status).toBe(502);
  });
});

describe('create with start', () => {
  it('start:true → 201 queued (single transaction, no engine call)', async () => {
    const { wfA, commanderA } = await seed();
    mockSessionAs(commanderA);
    const res = await req(app, 'POST', `/api/workflows/${wfA.id}/runtime-workflows`, { json: { start: true } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; queuedAt: string | null };
    expect(body.status).toBe('queued');
    expect(body.queuedAt).not.toBeNull();
    expect(mockEngineControl).not.toHaveBeenCalled();
  });
});

describe('POST /runtime-workflows/:id/steps/:stepInstanceId/force-complete', () => {
  it('commander-gated, reason required, forwards the actor and the trimmed reason', async () => {
    const { wfA, commanderA, viewer } = await seed();
    const id = await createInstance(wfA, commanderA);
    const [st] = await db.insert(stepInstance).values({
      workflowInstanceId: id, nodeOid: 'n', stepOid: 'g', stepType: 'GATE', state: 'WAITING_GATE',
    }).returning();
    const path = `/api/runtime-workflows/${id}/steps/${st.id}/force-complete`;

    mockSessionAs(viewer);
    expect((await req(app, 'POST', path, { json: { reason: 'x' } })).status).toBe(403);

    mockSessionAs(commanderA);
    expect((await req(app, 'POST', path, { json: {} })).status).toBe(400);
    expect((await req(app, 'POST', path, { json: { reason: '   ' } })).status).toBe(400);

    mockEngineForceComplete.mockResolvedValueOnce({ ok: true, summary: 'Forced complete: sensor stuck' });
    const ok = await req(app, 'POST', path, { json: { reason: '  sensor stuck ' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, summary: 'Forced complete: sensor stuck' });
    expect(mockEngineForceComplete).toHaveBeenCalledWith(id, st.id, { actorUserId: commanderA, reason: 'sensor stuck' });

    mockEngineForceComplete.mockResolvedValueOnce({ ok: false, status: 409, message: 'Resume the workflow first' });
    const paused = await req(app, 'POST', path, { json: { reason: 'again' } });
    expect(paused.status).toBe(409);
    expect(((await paused.json()) as { error: { message: string } }).error.message).toBe('Resume the workflow first');

    const tooLong = await req(app, 'POST', path, { json: { reason: 'x'.repeat(501) } });
    expect(tooLong.status).toBe(400);
    expect(((await tooLong.json()) as { error: { message: string } }).error.message).toBe('A reason (1–500 characters) is required');
    expect(mockEngineForceComplete).toHaveBeenCalledTimes(2);

    expect((await req(app, 'POST', `/api/runtime-workflows/${id}/steps/not-a-uuid/force-complete`, { json: { reason: 'x' } })).status).toBe(400);
  });
});
