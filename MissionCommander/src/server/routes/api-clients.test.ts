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
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { migrateTestDb, resetDb } from '../test/fixture';
import { mockSessionAs, seedUser, req } from '../test/harness';
import { createWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { apiClient } from 'mission-control-db/src/db/schema/index';
import { authenticateApiToken } from 'mission-control-db/src/dao/api-clients';
import { app } from '../app';

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); });
afterEach(() => { vi.restoreAllMocks(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as any;

async function world() {
  const wc = (await createWorkCenter(db, { name: 'Line 1' })).id;
  const admin = await seedUser(db, { email: 'ad@x.io', displayName: 'Ad', accessLevel: 'administrator' });
  const steward = await seedUser(db, { email: 's@x.io', displayName: 'St', accessLevel: 'steward' });
  return { wc, admin, steward };
}
const body = (wc: string, extra: Record<string, unknown> = {}) => ({
  name: 'ERP Scheduler', scopes: ['schedules:read', 'schedules:write'], workCenterIds: [wc], ...extra,
});

describe('api client routes', () => {
  it('require a session, and administrator: 401 signed out, 403 for a non-admin', async () => {
    const w = await world();
    for (const [method, path, json] of [
      ['GET', '/api/api-clients', undefined],
      ['POST', '/api/api-clients', body(w.wc)],
      ['POST', `/api/api-clients/${w.wc}/revoke`, undefined],
    ] as const) {
      mockSessionAs(null);
      expect((await req(app, method, path, { json })).status).toBe(401);
      mockSessionAs(w.steward);
      expect((await req(app, method, path, { json })).status).toBe(403);
    }
  });

  it('an administrator creates a client and sees the token once', async () => {
    const w = await world();
    mockSessionAs(w.admin);
    const created = await req(app, 'POST', '/api/api-clients', { json: body(w.wc) });
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const { client, token } = await json(created);
    expect(token).toMatch(/^mcx_/);
    expect(client).toMatchObject({ name: 'ERP Scheduler', scopes: ['schedules:read', 'schedules:write'], workCenterIds: [w.wc], status: 'active' });
    expect(client.createdBy).toBe(w.admin);

    const list = await req(app, 'GET', '/api/api-clients');
    expect(list.status).toBe(200);
    const text = await list.text();
    expect(text).not.toContain(token);
    expect(text).not.toMatch(/token_?hash/i);
    expect(JSON.parse(text)).toHaveLength(1);
    expect((await authenticateApiToken(db, token, new Date()))?.id).toBe(client.id);
  });

  it('rejects bad input with 422 and creates nothing', async () => {
    const w = await world();
    mockSessionAs(w.admin);
    const bad: [Record<string, unknown>, number][] = [
      [body(w.wc, { name: '' }), 422],
      [body(w.wc, { name: '   ' }), 422],
      [body(w.wc, { name: 'x'.repeat(201) }), 422],
      [body(w.wc, { scopes: [] }), 422],
      [body(w.wc, { scopes: ['schedules:root'] }), 422],
      [body(w.wc, { workCenterIds: [] }), 422],
      [body(w.wc, { workCenterIds: ['nope'] }), 422],
      // Well formed but absent: the DAO's WORK_CENTER_NOT_FOUND.
      [body(w.wc, { workCenterIds: ['00000000-0000-4000-8000-000000000000'] }), 404],
      [body(w.wc, { expiresAt: 'tomorrow' }), 422],
      [body(w.wc, { expiresAt: '2000-01-01T00:00:00Z' }), 422],
      [body(w.wc, { revokedAt: '2030-01-01T00:00:00Z' }), 422],
      [body(w.wc, { tokenHash: 'abc' }), 422],
    ];
    for (const [b, status] of bad) {
      const r = await req(app, 'POST', '/api/api-clients', { json: b });
      expect(r.status, JSON.stringify(b)).toBe(status);
    }
    expect((await req(app, 'POST', '/api/api-clients', { json: [] as never })).status).toBe(400);
    expect(await db.select().from(apiClient)).toHaveLength(0);
  });

  it('logs no hash when create fails in the database', async () => {
    const w = await world();
    mockSessionAs(w.admin);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(db, 'insert').mockImplementation(() => {
      throw Object.assign(new Error('Failed query: insert ... params: SECRETHASH'), { cause: new Error('connection refused') });
    });
    const r = await req(app, 'POST', '/api/api-clients', { json: body(w.wc) });
    expect(r.status).toBe(500);
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain('connection refused');
    expect(logged).not.toContain('SECRETHASH');
  });

  it('accepts a future expiry and allows duplicate names', async () => {
    const w = await world();
    mockSessionAs(w.admin);
    const r1 = await req(app, 'POST', '/api/api-clients', { json: body(w.wc, { expiresAt: '2999-01-01T00:00:00Z' }) });
    const r2 = await req(app, 'POST', '/api/api-clients', { json: body(w.wc) });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect((await json(r1)).client.expiresAt).toBe('2999-01-01T00:00:00.000Z');
  });

  it('revokes, permanently: the token stops working and the list says revoked', async () => {
    const w = await world();
    mockSessionAs(w.admin);
    const { client, token } = await json(await req(app, 'POST', '/api/api-clients', { json: body(w.wc) }));
    const r = await req(app, 'POST', `/api/api-clients/${client.id}/revoke`);
    expect(r.status).toBe(204);
    expect(await authenticateApiToken(db, token, new Date())).toBeNull();
    const [row] = await db.select().from(apiClient).where(eq(apiClient.id, client.id));
    expect(row!.revokedAt).not.toBeNull();
    const listed = await json(await req(app, 'GET', '/api/api-clients'));
    expect(listed[0].status).toBe('revoked');
    expect((await req(app, 'POST', `/api/api-clients/${client.id}/revoke`)).status).toBe(204);
  });

  it('revoke answers 404 for an unknown id and 400/422 for a malformed one', async () => {
    const w = await world();
    mockSessionAs(w.admin);
    expect((await req(app, 'POST', '/api/api-clients/00000000-0000-4000-8000-000000000000/revoke')).status).toBe(404);
    expect((await req(app, 'POST', '/api/api-clients/not-a-uuid/revoke')).status).toBe(400);
  });
});
