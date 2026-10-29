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
import { engineWorkCenterResourceVerb, engineSetWorkCenterValue, EngineUnavailableError } from '../lib/engine-client';
import { app } from '../app';

// Phase 4b (spec §7.2): the routes are thin commander-gated proxies. The engine's own behaviour
// is proven in its suite; engine-client's wire shape in its own tests. Here: gate order, body
// validation, and the Phase 6 status mapping — with the engine mocked.
vi.mock('../lib/engine-client', () => ({
  EngineUnavailableError: class EngineUnavailableError extends Error {},
  engineControl: vi.fn(), engineForceRelease: vi.fn(), engineAssign: vi.fn(),
  engineWorkCenterResourceVerb: vi.fn(), engineInstanceResourceVerb: vi.fn(),
  engineSetWorkCenterValue: vi.fn(), engineSetInstanceValue: vi.fn(),
}));
const mockVerb = vi.mocked(engineWorkCenterResourceVerb);
const mockSetValue = vi.mocked(engineSetWorkCenterValue);
const NIL = '00000000-0000-0000-0000-000000000000';

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); vi.clearAllMocks(); });

async function seedCommanderAndViewer() {
  const wc = await createWorkCenter(db, { name: 'Line 1' });
  const commander = await seedUser(db, { email: 'c@x.io', displayName: 'C', accessLevel: 'steward' });
  await assignUserToWorkCenter(db, wc.id, commander, { missionSystemCommander: true });
  const viewer = await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' });
  await assignUserToWorkCenter(db, wc.id, viewer);
  return { wc, commander, viewer };
}

describe('work-center resource verbs', () => {
  it('release-holder: 401 → 403 (viewer, engine never called) → 200 with the summary, actorUserId = the commander', async () => {
    const { wc, commander, viewer } = await seedCommanderAndViewer();
    const path = `/api/work-centers/${wc.id}/resources/release-holder`;
    expect((await req(app, 'POST', path, { json: { name: 'Printer', holderId: 4 } })).status).toBe(401);

    mockSessionAs(viewer);
    expect((await req(app, 'POST', path, { json: { name: 'Printer', holderId: 4 } })).status).toBe(403);
    expect(mockVerb).not.toHaveBeenCalled();

    mockSessionAs(commander);
    mockVerb.mockResolvedValueOnce({ ok: true, summary: 'release-holder "Printer" (row 4)' });
    const res = await req(app, 'POST', path, { json: { name: 'Printer', holderId: 4 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, summary: 'release-holder "Printer" (row 4)' });
    expect(mockVerb).toHaveBeenCalledWith(wc.id, 'release-holder', { name: 'Printer', holderId: 4, actorUserId: commander });
  });

  it('every verb is a route; an unknown verb is not; the body is validated before the engine is called', async () => {
    const { wc, commander } = await seedCommanderAndViewer();
    mockSessionAs(commander);
    mockVerb.mockResolvedValue({ ok: true, summary: 'ok' });
    for (const verb of ['release', 'reset', 'cancel-waiter', 'clear-sync']) {
      expect((await req(app, 'POST', `/api/work-centers/${wc.id}/resources/${verb}`, { json: { name: 'Printer', amount: 1 } })).status).toBe(200);
    }
    expect(mockVerb).toHaveBeenCalledTimes(4);
    expect(mockVerb.mock.calls.map((c) => c[1])).toEqual(['release', 'reset', 'cancel-waiter', 'clear-sync']);
    expect((await req(app, 'POST', `/api/work-centers/${wc.id}/resources/explode`, { json: { name: 'Printer' } })).status).toBe(404);

    vi.clearAllMocks();
    const bad = [
      {},                                   // name missing
      { name: '' },                         // empty name
      { name: 'Printer', amount: 0 },       // amount must be a positive integer
      { name: 'Printer', holderId: 1.5 },   // non-integer
      { name: 'Printer', waiterId: 's-1' }, // the WORK-CENTER route takes row ids only
      { name: 'Printer', extra: true },     // strict
    ];
    for (const json of bad) expect((await req(app, 'POST', `/api/work-centers/${wc.id}/resources/release`, { json })).status).toBe(400);
    expect(mockVerb).not.toHaveBeenCalled();
  });

  it('maps engine 404 → not_found, 409 → conflict with the engine message, unreachable → 502', async () => {
    const { wc, commander } = await seedCommanderAndViewer();
    mockSessionAs(commander);
    const path = `/api/work-centers/${wc.id}/resources/reset`;
    mockVerb.mockResolvedValueOnce({ ok: false, status: 404, message: 'resource "Nope" not found' });
    const missing = await req(app, 'POST', path, { json: { name: 'Nope' } });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: 'not_found', message: 'resource "Nope" not found' } });

    mockVerb.mockResolvedValueOnce({ ok: false, status: 409, message: 'nothing to release: 0 unaccounted unit(s)' });
    const conflict = await req(app, 'POST', path, { json: { name: 'Printer' } });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: { code: 'conflict', message: 'nothing to release: 0 unaccounted unit(s)' } });

    mockVerb.mockRejectedValueOnce(new EngineUnavailableError('connect ECONNREFUSED'));
    const down = await req(app, 'POST', path, { json: { name: 'Printer' } });
    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({ error: { code: 'internal', message: 'Engine unreachable — try again' } });
  });

  it('404 for an unknown work center, 400 for a malformed uuid — both before the engine', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    mockSessionAs(admin);
    expect((await req(app, 'POST', `/api/work-centers/${NIL}/resources/reset`, { json: { name: 'Printer' } })).status).toBe(404);
    expect((await req(app, 'POST', '/api/work-centers/not-a-uuid/resources/reset', { json: { name: 'Printer' } })).status).toBe(400);
    expect(mockVerb).not.toHaveBeenCalled();
  });
});

describe('work-center value write', () => {
  it('commander 200 with the body forwarded; viewer 403; non-string value 400; engine 409 mapped', async () => {
    const { wc, commander, viewer } = await seedCommanderAndViewer();
    const path = `/api/work-centers/${wc.id}/value-properties`;
    mockSessionAs(viewer);
    expect((await req(app, 'POST', path, { json: { propertyName: 'Batch', entryName: 'Size', value: '7' } })).status).toBe(403);
    expect(mockSetValue).not.toHaveBeenCalled();

    mockSessionAs(commander);
    expect((await req(app, 'POST', path, { json: { propertyName: 'Batch', entryName: 'Size', value: 7 } })).status).toBe(400);
    expect((await req(app, 'POST', path, { json: { propertyName: 'Batch', value: '7' } })).status).toBe(400);
    expect(mockSetValue).not.toHaveBeenCalled();

    mockSetValue.mockResolvedValueOnce({ ok: true, summary: 'set Batch.Size' });
    const ok = await req(app, 'POST', path, { json: { propertyName: 'Batch', entryName: 'Size', value: '' } }); // empty string is a legal value
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, summary: 'set Batch.Size' });
    expect(mockSetValue).toHaveBeenCalledWith(wc.id, { propertyName: 'Batch', entryName: 'Size', value: '', actorUserId: commander });

    mockSetValue.mockResolvedValueOnce({ ok: false, status: 404, message: 'value "Batch.Nope" not found' });
    expect((await req(app, 'POST', path, { json: { propertyName: 'Batch', entryName: 'Nope', value: '1' } })).status).toBe(404);
  });
});
