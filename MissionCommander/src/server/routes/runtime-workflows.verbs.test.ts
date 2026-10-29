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
import { createWorkCenter, assignUserToWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { workflow, workflowInstance } from 'mission-control-db/src/db/schema/index';
import { engineInstanceResourceVerb, engineSetInstanceValue, EngineUnavailableError } from '../lib/engine-client';
import { app } from '../app';

vi.mock('../lib/engine-client', () => ({
  EngineUnavailableError: class EngineUnavailableError extends Error {},
  engineControl: vi.fn(), engineForceRelease: vi.fn(), engineAssign: vi.fn(),
  engineWorkCenterResourceVerb: vi.fn(), engineInstanceResourceVerb: vi.fn(),
  engineSetWorkCenterValue: vi.fn(), engineSetInstanceValue: vi.fn(),
}));
const mockVerb = vi.mocked(engineInstanceResourceVerb);
const mockSetValue = vi.mocked(engineSetInstanceValue);
const NIL = '00000000-0000-0000-0000-000000000000';
const SPEC = { oid: 'wf-1', steps: [{ oid: 's-mix', local_id: 'Mix Step' }], connections: [], children: [] };

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); vi.clearAllMocks(); });

async function seedInstance() {
  const wc = await createWorkCenter(db, { name: 'Line 1' });
  const [wf] = await db.insert(workflow).values({ oid: 'wf-1', name: 'Fill', workCenterId: wc.id, specJsonb: SPEC }).returning();
  const [inst] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', specJsonb: SPEC,
    runtimeNumber: 3, runtimeLabel: 'RW-3', masterName: 'Fill', masterOid: 'wf-1', masterVersion: '1.0.0', masterState: 'Effective',
  }).returning();
  const commander = await seedUser(db, { email: 'c@x.io', displayName: 'C', accessLevel: 'steward' });
  await assignUserToWorkCenter(db, wc.id, commander, { missionSystemCommander: true });
  const viewer = await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' });
  await assignUserToWorkCenter(db, wc.id, viewer);
  return { wc, inst, commander, viewer };
}

describe('instance resource verbs', () => {
  it('cancel-waiter with a step-oid waiterId (D16): viewer 403 before the engine; commander 200; a number waiterId also passes', async () => {
    const { inst, commander, viewer } = await seedInstance();
    const path = `/api/runtime-workflows/${inst.id}/resources/cancel-waiter`;
    mockSessionAs(viewer);
    expect((await req(app, 'POST', path, { json: { resourceKey: 'rt_1:Lock', waiterId: 's-pack' } })).status).toBe(403);
    expect(mockVerb).not.toHaveBeenCalled();

    mockSessionAs(commander);
    mockVerb.mockResolvedValue({ ok: true, summary: 'cancel-waiter' });
    expect((await req(app, 'POST', path, { json: { resourceKey: 'rt_1:Lock', waiterId: 's-pack' } })).status).toBe(200);
    expect(mockVerb).toHaveBeenLastCalledWith(inst.id, 'cancel-waiter', { resourceKey: 'rt_1:Lock', waiterId: 's-pack', actorUserId: commander });
    expect((await req(app, 'POST', path, { json: { resourceKey: 'Printer', waiterId: 12 } })).status).toBe(200);
    expect(mockVerb).toHaveBeenLastCalledWith(inst.id, 'cancel-waiter', { resourceKey: 'Printer', waiterId: 12, actorUserId: commander });
  });

  it('body validation and the status mapping', async () => {
    const { inst, commander } = await seedInstance();
    mockSessionAs(commander);
    const path = `/api/runtime-workflows/${inst.id}/resources/release`;
    for (const json of [{}, { resourceKey: '' }, { resourceKey: 'k', amount: -1 }, { resourceKey: 'k', waiterId: true }, { resourceKey: 'k', name: 'k' }]) {
      expect((await req(app, 'POST', path, { json })).status).toBe(400);
    }
    expect(mockVerb).not.toHaveBeenCalled();

    mockVerb.mockResolvedValueOnce({ ok: false, status: 409, message: 'a workflow-scoped resource has no holder ledger — use release' });
    const conflict = await req(app, 'POST', `/api/runtime-workflows/${inst.id}/resources/release-holder`, { json: { resourceKey: 'rt_1:Lock', holderId: 1 } });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: { code: 'conflict', message: 'a workflow-scoped resource has no holder ledger — use release' } });

    mockVerb.mockRejectedValueOnce(new EngineUnavailableError('down'));
    expect((await req(app, 'POST', path, { json: { resourceKey: 'rt_1:Lock', amount: 1 } })).status).toBe(502);

    expect((await req(app, 'POST', `/api/runtime-workflows/${NIL}/resources/release`, { json: { resourceKey: 'k' } })).status).toBe(404);
    expect((await req(app, 'POST', '/api/runtime-workflows/nope/resources/release', { json: { resourceKey: 'k' } })).status).toBe(400);
  });
});

describe('instance value write', () => {
  it('viewer 403 before the engine; unknown-id 404; root and child (specOid) edits forward; a shared key answers the engine 409 as conflict', async () => {
    const { inst, commander, viewer } = await seedInstance();
    const path = `/api/runtime-workflows/${inst.id}/value-properties`;
    mockSessionAs(viewer);
    expect((await req(app, 'POST', path, { json: { key: 'Batch.Size', value: '7' } })).status).toBe(403);
    expect(mockSetValue).not.toHaveBeenCalled();

    mockSessionAs(commander);
    expect((await req(app, 'POST', `/api/runtime-workflows/${NIL}/value-properties`, { json: { key: 'k', value: '1' } })).status).toBe(404);
    expect(mockSetValue).not.toHaveBeenCalled();

    mockSetValue.mockResolvedValue({ ok: true, summary: 'set' });
    expect((await req(app, 'POST', path, { json: { key: 'Batch.Size', value: '7' } })).status).toBe(200);
    expect(mockSetValue).toHaveBeenLastCalledWith(inst.id, { key: 'Batch.Size', value: '7', actorUserId: commander });
    expect((await req(app, 'POST', path, { json: { specOid: 'wf-1-c1', key: 'Sub.X', value: '2' } })).status).toBe(200);
    expect(mockSetValue).toHaveBeenLastCalledWith(inst.id, { specOid: 'wf-1-c1', key: 'Sub.X', value: '2', actorUserId: commander });

    expect((await req(app, 'POST', path, { json: { key: 'Batch.Size' } })).status).toBe(400);

    mockSetValue.mockResolvedValueOnce({ ok: false, status: 409, message: '"Env.Temp" is shared — edit it on the work center' });
    const shared = await req(app, 'POST', path, { json: { key: 'Env.Temp', value: '1' } });
    expect(shared.status).toBe(409);
    expect(await shared.json()).toEqual({ error: { code: 'conflict', message: '"Env.Temp" is shared — edit it on the work center' } });
  });
});
