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

const NIL = '00000000-0000-0000-0000-000000000000';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
  mockSessionAs(null);
});

describe('environment-bindings routes', () => {
  it('GET returns [] then the seeded binding', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));

    const empty = await req(app, 'GET', `/api/work-centers/${wc.id}/environment-bindings`);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);

    mockSessionAs(await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' }));
    const put = await req(app, 'PUT', `/api/work-centers/${wc.id}/environment-bindings/env-1`,
      { json: { serverUri: 'http://action-server:3002' } });
    expect(put.status).toBe(204);

    const listRes = await req(app, 'GET', `/api/work-centers/${wc.id}/environment-bindings`);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { environmentOid: string; serverUri: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ environmentOid: 'env-1', serverUri: 'http://action-server:3002' });
  });

  it('PUT as admin upserts (204) and an empty string unbinds', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    mockSessionAs(await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' }));

    const first = await req(app, 'PUT', `/api/work-centers/${wc.id}/environment-bindings/env-1`,
      { json: { serverUri: 'http://server-1:3002' } });
    expect(first.status).toBe(204);
    let list = (await (await req(app, 'GET', `/api/work-centers/${wc.id}/environment-bindings`)).json()) as unknown[];
    expect(list).toHaveLength(1);

    // Overwrite
    const overwrite = await req(app, 'PUT', `/api/work-centers/${wc.id}/environment-bindings/env-1`,
      { json: { serverUri: 'http://server-2:3002' } });
    expect(overwrite.status).toBe(204);
    list = (await (await req(app, 'GET', `/api/work-centers/${wc.id}/environment-bindings`)).json()) as { serverUri: string }[];
    expect(list).toHaveLength(1);
    expect((list[0] as { serverUri: string }).serverUri).toBe('http://server-2:3002');

    // Empty string unbinds (deletes the row)
    const unbind = await req(app, 'PUT', `/api/work-centers/${wc.id}/environment-bindings/env-1`,
      { json: { serverUri: '' } });
    expect(unbind.status).toBe(204);
    list = (await (await req(app, 'GET', `/api/work-centers/${wc.id}/environment-bindings`)).json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  it('PUT as non-admin (steward) → 403', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    const res = await req(app, 'PUT', `/api/work-centers/${wc.id}/environment-bindings/env-1`,
      { json: { serverUri: 'http://server-1:3002' } });
    expect(res.status).toBe(403);
  });

  it('PUT for an unknown work center → 404', async () => {
    mockSessionAs(await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' }));
    const res = await req(app, 'PUT', `/api/work-centers/${NIL}/environment-bindings/env-1`,
      { json: { serverUri: 'http://server-1:3002' } });
    expect(res.status).toBe(404);
  });

  it('GET for an unknown work center → 404', async () => {
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    expect((await req(app, 'GET', `/api/work-centers/${NIL}/environment-bindings`)).status).toBe(404);
  });

  it('requires a session', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    mockSessionAs(null);
    expect((await req(app, 'GET', `/api/work-centers/${wc.id}/environment-bindings`)).status).toBe(401);
    expect((await req(app, 'PUT', `/api/work-centers/${wc.id}/environment-bindings/env-1`,
      { json: { serverUri: 'http://x:1' } })).status).toBe(401);
  });

  it('400s a malformed work-center uuid', async () => {
    mockSessionAs(await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' }));
    expect((await req(app, 'GET', '/api/work-centers/not-a-uuid/environment-bindings')).status).toBe(400);
    expect((await req(app, 'PUT', '/api/work-centers/not-a-uuid/environment-bindings/env-1',
      { json: { serverUri: 'http://x:1' } })).status).toBe(400);
  });

  it("PUT 400s a serverUri that is neither empty nor an http(s) URL", async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    mockSessionAs(await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' }));
    const res = await req(app, 'PUT', `/api/work-centers/${wc.id}/environment-bindings/env-1`,
      { json: { serverUri: 'ftp://nope' } });
    expect(res.status).toBe(400);
  });

  it('PUT 400s a body that is not JSON at all', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    mockSessionAs(await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' }));
    const res = await app.request(`/api/work-centers/${wc.id}/environment-bindings/env-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
  });

  it(':oid is not UUID-validated — a non-uuid oid is a valid key', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    mockSessionAs(await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' }));
    const res = await req(app, 'PUT', `/api/work-centers/${wc.id}/environment-bindings/not-a-uuid-oid`,
      { json: { serverUri: 'http://server-1:3002' } });
    expect(res.status).toBe(204);
  });
});
