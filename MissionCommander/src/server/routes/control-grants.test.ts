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
import { app } from '../app';

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); });

describe('control-grants routes', () => {
  it('admin grants, lists both directions, changes scope, removes', async () => {
    const a = await createWorkCenter(db, { name: 'Line A' });
    const b = await createWorkCenter(db, { name: 'Line B' });
    mockSessionAs(await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' }));
    expect((await req(app, 'PUT', `/api/work-centers/${a.id}/control-grants/${b.id}`, { json: { scope: 'own' } })).status).toBe(204);
    expect((await req(app, 'PUT', `/api/work-centers/${a.id}/control-grants/${b.id}`, { json: { scope: 'any' } })).status).toBe(204);
    const fromA = await (await req(app, 'GET', `/api/work-centers/${a.id}/control-grants`)).json() as { outgoing: Array<{ targetWorkCenterName: string; scope: string }> };
    expect(fromA.outgoing).toEqual([expect.objectContaining({ targetWorkCenterName: 'Line B', scope: 'any' })]);
    const toB = await (await req(app, 'GET', `/api/work-centers/${b.id}/control-grants`)).json() as { incoming: unknown[] };
    expect(toB.incoming).toHaveLength(1);
    expect((await req(app, 'DELETE', `/api/work-centers/${a.id}/control-grants/${b.id}`)).status).toBe(204);
    const after = await (await req(app, 'GET', `/api/work-centers/${a.id}/control-grants`)).json() as { outgoing: unknown[] };
    expect(after.outgoing).toEqual([]);
  });

  it('a viewer can read; a steward cannot write; bad scope and self-grant are 400', async () => {
    const a = await createWorkCenter(db, { name: 'Line A' });
    const b = await createWorkCenter(db, { name: 'Line B' });
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    expect((await req(app, 'GET', `/api/work-centers/${a.id}/control-grants`)).status).toBe(200);
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    expect((await req(app, 'PUT', `/api/work-centers/${a.id}/control-grants/${b.id}`, { json: { scope: 'own' } })).status).toBe(403);
    mockSessionAs(await seedUser(db, { email: 'ad@x.io', displayName: 'Ad', accessLevel: 'administrator' }));
    expect((await req(app, 'PUT', `/api/work-centers/${a.id}/control-grants/${b.id}`, { json: { scope: 'all' } })).status).toBe(400);
    expect((await req(app, 'PUT', `/api/work-centers/${a.id}/control-grants/${a.id}`, { json: { scope: 'own' } })).status).toBe(400);
  });

  it('a steward cannot remove a grant (403); without a session PUT and DELETE are 401', async () => {
    const a = await createWorkCenter(db, { name: 'Line A' });
    const b = await createWorkCenter(db, { name: 'Line B' });
    mockSessionAs(await seedUser(db, { email: 'ad@x.io', displayName: 'Ad', accessLevel: 'administrator' }));
    expect((await req(app, 'PUT', `/api/work-centers/${a.id}/control-grants/${b.id}`, { json: { scope: 'own' } })).status).toBe(204);
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    expect((await req(app, 'DELETE', `/api/work-centers/${a.id}/control-grants/${b.id}`)).status).toBe(403);
    mockSessionAs(null);
    expect((await req(app, 'PUT', `/api/work-centers/${a.id}/control-grants/${b.id}`, { json: { scope: 'any' } })).status).toBe(401);
    expect((await req(app, 'DELETE', `/api/work-centers/${a.id}/control-grants/${b.id}`)).status).toBe(401);
    // Nothing above changed the grant.
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    const list = await (await req(app, 'GET', `/api/work-centers/${a.id}/control-grants`)).json() as { outgoing: Array<{ scope: string }> };
    expect(list.outgoing).toEqual([expect.objectContaining({ scope: 'own' })]);
  });
});
