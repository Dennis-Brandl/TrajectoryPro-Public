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
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { apiClient, appUser } from '../db/schema/index.js';
import { createWorkCenter, deleteWorkCenter } from './work-centers.js';
import {
  createApiClient, authenticateApiToken, revokeApiClient, listApiClients, hashApiToken,
} from './api-clients.js';
import { DaoError } from './errors.js';

const NOW = new Date('2026-11-08T12:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

async function setup() {
  const { db, close } = await makeTestDb();
  const wc1 = (await createWorkCenter(db, { name: 'Line 1' })).id;
  const wc2 = (await createWorkCenter(db, { name: 'Line 2' })).id;
  const [admin] = await db.insert(appUser).values({ email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' }).returning();
  return { db, close, wc1, wc2, admin: admin!.id };
}
const input = (wcs: string[], extra: Record<string, unknown> = {}) => ({
  name: 'ERP', scopes: ['schedules:read'] as string[], workCenterIds: wcs, ...extra,
});

describe('api client DAO', () => {
  it('issues an mcx_ token of 256 random bits and stores only its SHA-256', async () => {
    const t = await setup();
    const a = await createApiClient(t.db, input([t.wc1]) as never, t.admin);
    const b = await createApiClient(t.db, input([t.wc1]) as never, t.admin);
    expect(a.token).toMatch(/^mcx_[A-Za-z0-9_-]{43}$/); // 43 base64url chars = 256 bits
    expect(a.token).not.toBe(b.token);
    const [row] = await t.db.select().from(apiClient).where(eq(apiClient.id, a.client.id));
    expect(row!.tokenHash).toBe(createHash('sha256').update(a.token).digest('hex'));
    expect(row!.tokenHash).toBe(hashApiToken(a.token));
    expect(JSON.stringify(row)).not.toContain(a.token);
    expect(row!.tokenPrefix).toBe(a.token.slice(0, 8));
    expect(row!.createdBy).toBe(t.admin);
    await t.close();
  });

  it('never returns the token or a hash from list or create views', async () => {
    const t = await setup();
    const { client, token } = await createApiClient(t.db, input([t.wc1]) as never, t.admin);
    const text = JSON.stringify([client, await listApiClients(t.db, NOW)]);
    expect(text).not.toContain(token);
    expect(text).not.toContain(hashApiToken(token));
    expect(text).not.toMatch(/tokenHash|token_hash/);
    await t.close();
  });

  it('rejects empty or unknown scopes and unknown work centers', async () => {
    const t = await setup();
    await expect(createApiClient(t.db, input([t.wc1], { scopes: [] }) as never, t.admin)).rejects.toMatchObject({ code: 'INVALID_SCOPE' });
    await expect(createApiClient(t.db, input([t.wc1], { scopes: ['schedules:root'] }) as never, t.admin)).rejects.toMatchObject({ code: 'INVALID_SCOPE' });
    await expect(createApiClient(t.db, input([]) as never, t.admin)).rejects.toMatchObject({ code: 'WORK_CENTER_NOT_FOUND' });
    await expect(createApiClient(t.db, input(['00000000-0000-4000-8000-000000000000']) as never, t.admin)).rejects.toMatchObject({ code: 'WORK_CENTER_NOT_FOUND' });
    await t.close();
  });

  it('authenticates a valid token and returns its principal', async () => {
    const t = await setup();
    const { client, token } = await createApiClient(t.db, input([t.wc1, t.wc2], { scopes: ['schedules:read', 'schedules:write'] }) as never, t.admin);
    const p = await authenticateApiToken(t.db, token, NOW);
    expect(p).toMatchObject({ id: client.id, name: 'ERP', scopes: ['schedules:read', 'schedules:write'] });
    expect([...p!.workCenterIds].sort()).toEqual([t.wc1, t.wc2].sort());
    await t.close();
  });

  it('returns null for unknown, malformed, revoked and expired tokens', async () => {
    const t = await setup();
    const live = await createApiClient(t.db, input([t.wc1]) as never, t.admin);
    const revoked = await createApiClient(t.db, input([t.wc1]) as never, t.admin);
    const expiring = await createApiClient(t.db, input([t.wc1], { expiresAt: minutes(10) }) as never, t.admin);
    await revokeApiClient(t.db, revoked.client.id, NOW);
    expect(await authenticateApiToken(t.db, live.token, NOW)).not.toBeNull();
    expect(await authenticateApiToken(t.db, revoked.token, minutes(1))).toBeNull();
    expect(await authenticateApiToken(t.db, expiring.token, minutes(9))).not.toBeNull();
    expect(await authenticateApiToken(t.db, expiring.token, minutes(10))).toBeNull();
    expect(await authenticateApiToken(t.db, 'mcx_' + 'A'.repeat(43), NOW)).toBeNull();
    for (const bad of ['', 'mcx_', live.token.slice(1), live.token + 'x', live.token.toUpperCase(), 'x'.repeat(5000), live.token.slice(4)]) {
      expect(await authenticateApiToken(t.db, bad, NOW)).toBeNull();
    }
    // the stored hash itself is not a credential
    expect(await authenticateApiToken(t.db, hashApiToken(live.token), NOW)).toBeNull();
    await t.close();
  });

  it('revoke is permanent, idempotent, and unknown ids throw API_CLIENT_NOT_FOUND', async () => {
    const t = await setup();
    const { client } = await createApiClient(t.db, input([t.wc1]) as never, t.admin);
    await revokeApiClient(t.db, client.id, NOW);
    await revokeApiClient(t.db, client.id, minutes(5));
    const [row] = await t.db.select().from(apiClient).where(eq(apiClient.id, client.id));
    expect(row!.revokedAt).toEqual(NOW); // the first revocation stands
    const err = await revokeApiClient(t.db, '00000000-0000-4000-8000-000000000000', NOW).catch((e) => e);
    expect(err).toBeInstanceOf(DaoError);
    expect(err.code).toBe('API_CLIENT_NOT_FOUND');
    await t.close();
  });

  it('updates last_used_at at most once a minute', async () => {
    const t = await setup();
    const { client, token } = await createApiClient(t.db, input([t.wc1]) as never, t.admin);
    const lastUsed = async () => (await t.db.select().from(apiClient).where(eq(apiClient.id, client.id)))[0]!.lastUsedAt;
    expect(await lastUsed()).toBeNull();
    await authenticateApiToken(t.db, token, NOW);
    expect(await lastUsed()).toEqual(NOW);
    await authenticateApiToken(t.db, token, new Date(NOW.getTime() + 59_000));
    expect(await lastUsed()).toEqual(NOW);
    const later = new Date(NOW.getTime() + 60_000);
    await authenticateApiToken(t.db, token, later);
    expect(await lastUsed()).toEqual(later);
    await t.close();
  });

  it('a failure while recording last use does not fail authentication', async () => {
    const t = await setup();
    const { client, token } = await createApiClient(t.db, input([t.wc1]) as never, t.admin);
    const broken = new Proxy(t.db, {
      get(target, prop, receiver) {
        if (prop === 'update') return () => { throw new Error('boom'); };
        return Reflect.get(target, prop, receiver);
      },
    });
    const p = await authenticateApiToken(broken, token, NOW);
    expect(p?.id).toBe(client.id);
    await t.close();
  });

  it('a deleted work center drops off the client list, in auth and in list views', async () => {
    const t = await setup();
    const { client, token } = await createApiClient(t.db, input([t.wc1, t.wc2]) as never, t.admin);
    await deleteWorkCenter(t.db, t.wc2, { confirmed: true });
    expect((await authenticateApiToken(t.db, token, NOW))!.workCenterIds).toEqual([t.wc1]);
    const listed = (await listApiClients(t.db, NOW)).find((c) => c.id === client.id)!;
    expect(listed.workCenterIds).toEqual([t.wc1]);
    await t.close();
  });

  it('reports status active, revoked or expired in list views', async () => {
    const t = await setup();
    const a = await createApiClient(t.db, input([t.wc1]) as never, t.admin);
    const r = await createApiClient(t.db, input([t.wc1]) as never, t.admin);
    const e = await createApiClient(t.db, input([t.wc1], { expiresAt: minutes(1) }) as never, t.admin);
    await revokeApiClient(t.db, r.client.id, NOW);
    const byId = new Map((await listApiClients(t.db, minutes(2))).map((c) => [c.id, c.status]));
    expect(byId.get(a.client.id)).toBe('active');
    expect(byId.get(r.client.id)).toBe('revoked');
    expect(byId.get(e.client.id)).toBe('expired');
    await t.close();
  });
});
