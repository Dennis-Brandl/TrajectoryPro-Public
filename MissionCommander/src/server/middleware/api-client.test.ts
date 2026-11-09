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
import { Hono } from 'hono';
import { db } from '../lib/db';
import { migrateTestDb, resetDb } from '../test/fixture';
import { mockSessionAs, seedUser } from '../test/harness';
import { createWorkCenter, deleteWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { createApiClient, revokeApiClient, type ApiClientScope } from 'mission-control-db/src/dao/api-clients';
import {
  requireApiClient, requireClientScope, resetApiClientLimiter, apiClientLimiterSize, MAX_TRACKED_IPS,
  safeErrorText, type ApiClientVars,
} from './api-client';

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); resetApiClientLimiter(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// A test-only app. Task 17 mounts the real routes. There is no IP middleware: requireApiClient
// resolves the caller itself, from the socket address the server puts in the Hono env. These
// tests supply that env, which is where a real Node server's peer address comes from.
function testApp() {
  const app = new Hono<{ Variables: ApiClientVars }>();
  app.use('/ext/*', requireApiClient);
  app.get('/ext/ping', (c) => c.json({ client: c.get('apiClient').name }));
  app.get('/ext/work-centers/:wc/things', requireClientScope('schedules:read'), (c) => c.json({ wc: c.req.param('wc') }));
  app.post('/ext/work-centers/:wc/control', requireClientScope('schedules:control'), (c) => c.json({ ok: true }));
  // The default is closed whatever the param is called.
  app.get('/ext/others/:id/things', requireClientScope('schedules:read'), (c) => c.json({ ok: true }));
  // The one kind of route with no work center says so explicitly.
  app.get('/ext/work-centers', requireClientScope('schedules:read', { workCenter: false }), (c) => c.json({ ok: true }));
  app.post('/ext/no-wc-control', requireClientScope('schedules:control', { workCenter: false }), (c) => c.json({ ok: true }));
  return app;
}

// A guard mounted with use('*') on a path where no `wc` param resolves.
function wildcardApp() {
  const app = new Hono<{ Variables: ApiClientVars }>();
  app.use('*', requireApiClient);
  app.use('*', requireClientScope('schedules:read'));
  app.get('/ext/work-centers/:wc/things', (c) => c.json({ ok: true }));
  return app;
}

const UNAUTHORIZED = { error: { code: 'unauthorized', message: 'Invalid or expired API token' } };
const NOT_FOUND = { error: { code: 'not_found', message: 'Not found' } };

function call(app: Hono<any>, path: string, opts: { token?: string; peer?: string; headers?: Record<string, string>; method?: string } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return app.request(
    path,
    { method: opts.method ?? 'GET', headers },
    { incoming: { socket: { remoteAddress: opts.peer ?? '10.1.1.1' } } },
  );
}
const BAD = 'mcx_' + 'B'.repeat(43);

async function world(scopes: ApiClientScope[] = ['schedules:read']) {
  const wc = (await createWorkCenter(db, { name: 'Line 1' })).id;
  const other = (await createWorkCenter(db, { name: 'Line 2' })).id;
  const admin = await seedUser(db, { email: 'ad@x.io', displayName: 'Ad', accessLevel: 'administrator' });
  const { client, token } = await createApiClient(db, { name: 'ERP', scopes, workCenterIds: [wc] }, admin);
  return { wc, other, admin, client, token };
}

describe('requireApiClient', () => {
  it('lets a valid bearer token through and exposes the principal', async () => {
    const w = await world();
    const r = await call(testApp(), '/ext/ping', { token: w.token });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ client: 'ERP' });
  });

  it('matches the Bearer scheme case-insensitively', async () => {
    const w = await world();
    for (const scheme of ['bearer', 'BEARER', 'BeArEr']) {
      const r = await call(testApp(), '/ext/ping', { headers: { authorization: `${scheme} ${w.token}` } });
      expect(r.status, scheme).toBe(200);
    }
  });

  it('answers revoked, expired, unknown and malformed tokens with one identical 401 and a Bearer challenge', async () => {
    const w = await world();
    const revoked = await createApiClient(db, { name: 'R', scopes: ['schedules:read'], workCenterIds: [w.wc] }, w.admin);
    await revokeApiClient(db, revoked.client.id, new Date());
    const expired = await createApiClient(db, { name: 'E', scopes: ['schedules:read'], workCenterIds: [w.wc], expiresAt: new Date(Date.now() + 1000) }, w.admin);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000);
    const app = testApp();
    const attempts: Record<string, string>[] = [
      { authorization: `Bearer ${revoked.token}` },
      { authorization: `Bearer ${expired.token}` },
      { authorization: `Bearer ${BAD}` },
      { authorization: 'Bearer garbage' },
      { authorization: 'Bearer' },
      { authorization: `Basic ${w.token}` },
      { authorization: `Bearer ${w.token} extra` },
      {},
    ];
    for (const headers of attempts) {
      const r = await call(app, '/ext/ping', { headers, peer: '10.9.9.9' });
      expect(r.status).toBe(401);
      expect(r.headers.get('www-authenticate')).toBe('Bearer');
      expect(await r.json()).toEqual(UNAUTHORIZED);
    }
  });

  it('never accepts a session cookie or a query-string token', async () => {
    const w = await world();
    mockSessionAs(w.admin);
    const app = testApp();
    const cookie = await call(app, '/ext/ping', { headers: { cookie: 'better-auth.session_token=abc' } });
    expect(cookie.status).toBe(401);
    expect(await cookie.json()).toEqual(UNAUTHORIZED);
    for (const q of ['token', 'access_token', 'api_key']) {
      expect((await call(app, `/ext/ping?${q}=${w.token}`)).status).toBe(401);
    }
  });

  it('never puts the token in a response', async () => {
    const w = await world();
    const bad = w.token.slice(0, -1) + (w.token.endsWith('A') ? 'B' : 'A');
    const r = await call(testApp(), '/ext/ping', { token: bad });
    expect(await r.text()).not.toContain(bad);
  });

  it('logs only a fixed text or the driver cause when the database fails, never the hash', async () => {
    const w = await world();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(db, 'select').mockImplementation(() => {
      throw Object.assign(new Error('Failed query: select ... params: SECRETHASH'), { cause: new Error('connection refused') });
    });
    const r = await call(testApp(), '/ext/ping', { token: w.token });
    expect(r.status).toBe(500);
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain('connection refused');
    expect(logged).not.toContain('SECRETHASH');
    expect(safeErrorText(new Error('has params: SECRETHASH'))).toBe('database error');
  });
});

describe('failure limiter', () => {
  it('limits per caller IP from the socket: 10 failures, then 429 with Retry-After', async () => {
    const w = await world();
    const app = testApp();
    for (let i = 0; i < 10; i++) expect((await call(app, '/ext/ping', { token: BAD, peer: '7.7.7.7' })).status).toBe(401);
    const blocked = await call(app, '/ext/ping', { token: BAD, peer: '7.7.7.7' });
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe('rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // A valid token in the blocked window stays 429, so a guesser cannot confirm a hit.
    expect((await call(app, '/ext/ping', { token: w.token, peer: '7.7.7.7' })).status).toBe(429);
    // Another IP is untouched.
    expect((await call(app, '/ext/ping', { token: w.token, peer: '8.8.8.8' })).status).toBe(200);
  });

  it('ignores a client-sent x-mission-client-ip and x-forwarded-for when picking the bucket', async () => {
    const w = await world();
    const app = testApp();
    // The attacker (one socket) varies the header on every try, and names the victim's IP.
    for (let i = 0; i < 10; i++) {
      const r = await call(app, '/ext/ping', {
        token: BAD, peer: '6.6.6.6',
        headers: { 'x-mission-client-ip': i < 5 ? `3.3.3.${i}` : '2.2.2.2', 'x-forwarded-for': `4.4.4.${i}` },
      });
      expect(r.status).toBe(401);
    }
    // One bucket for the attacker, whatever it claimed: now blocked even with a fresh claimed IP.
    const blocked = await call(app, '/ext/ping', { token: BAD, peer: '6.6.6.6', headers: { 'x-mission-client-ip': '9.9.9.9' } });
    expect(blocked.status).toBe(429);
    // The victim named in the header is not locked out.
    expect((await call(app, '/ext/ping', { token: w.token, peer: '2.2.2.2' })).status).toBe(200);
  });

  it('does not count a request with no Authorization header', async () => {
    const w = await world();
    const app = testApp();
    for (let i = 0; i < 25; i++) expect((await call(app, '/ext/ping', { peer: '5.5.5.5' })).status).toBe(401);
    expect((await call(app, '/ext/ping', { token: w.token, peer: '5.5.5.5' })).status).toBe(200);
  });

  it('counts only failures, and the block lifts when the window passes', async () => {
    const w = await world();
    const app = testApp();
    vi.useFakeTimers({ toFake: ['Date'] });
    for (let i = 0; i < 30; i++) expect((await call(app, '/ext/ping', { token: w.token, peer: '6.6.6.7' })).status).toBe(200);
    for (let i = 0; i < 10; i++) await call(app, '/ext/ping', { token: BAD, peer: '6.6.6.7' });
    expect((await call(app, '/ext/ping', { token: BAD, peer: '6.6.6.7' })).status).toBe(429);
    vi.setSystemTime(Date.now() + 59_000);
    expect((await call(app, '/ext/ping', { token: BAD, peer: '6.6.6.7' })).status).toBe(429);
    vi.setSystemTime(Date.now() + 2_000);
    expect((await call(app, '/ext/ping', { token: w.token, peer: '6.6.6.7' })).status).toBe(200);
  });

  it('failures roll off one by one rather than all at once', async () => {
    const w = await world();
    const app = testApp();
    vi.useFakeTimers({ toFake: ['Date'] });
    for (let i = 0; i < 5; i++) await call(app, '/ext/ping', { token: BAD, peer: '5.5.5.6' });
    vi.setSystemTime(Date.now() + 40_000);
    for (let i = 0; i < 5; i++) await call(app, '/ext/ping', { token: BAD, peer: '5.5.5.6' });
    expect((await call(app, '/ext/ping', { token: BAD, peer: '5.5.5.6' })).status).toBe(429);
    vi.setSystemTime(Date.now() + 21_000); // the first five are 61 s old, the last five 21 s
    expect((await call(app, '/ext/ping', { token: w.token, peer: '5.5.5.6' })).status).toBe(200);
  });

  it('keeps the map bounded at 10,000 IPs', async () => {
    const app = testApp();
    const ip = (i: number) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
    for (let i = 0; i <= MAX_TRACKED_IPS; i++) await call(app, '/ext/ping', { token: BAD, peer: ip(i) });
    expect(apiClientLimiterSize()).toBe(MAX_TRACKED_IPS);
  }, 60_000);
});

describe('requireClientScope', () => {
  it('403 when the scope is missing', async () => {
    const w = await world(['schedules:read']);
    const r = await call(testApp(), `/ext/work-centers/${w.wc}/control`, { token: w.token, method: 'POST' });
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe('forbidden');
  });

  it('404 with the standard not-found body for a work center outside the list, existing or not', async () => {
    const w = await world();
    const app = testApp();
    expect((await call(app, `/ext/work-centers/${w.wc}/things`, { token: w.token })).status).toBe(200);
    for (const wc of [w.other, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const r = await call(app, `/ext/work-centers/${wc}/things`, { token: w.token });
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual(NOT_FOUND);
    }
  });

  it('a work center that was deleted drops out of reach', async () => {
    const w = await world();
    await deleteWorkCenter(db, w.wc, { confirmed: true });
    const r = await call(testApp(), `/ext/work-centers/${w.wc}/things`, { token: w.token });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual(NOT_FOUND);
  });

  it('fails closed: a route with no `wc` param is 404 by default, whatever the param is called', async () => {
    const w = await world();
    const r = await call(testApp(), `/ext/others/${w.wc}/things`, { token: w.token });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual(NOT_FOUND);
  });

  it('fails closed when the guard is mounted with use("*")', async () => {
    const w = await world();
    const r = await call(wildcardApp(), `/ext/work-centers/${w.wc}/things`, { token: w.token });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual(NOT_FOUND);
  });

  it('opting out with { workCenter: false } checks the scope only', async () => {
    const w = await world(['schedules:read']);
    const app = testApp();
    expect((await call(app, '/ext/work-centers', { token: w.token })).status).toBe(200);
    // The opt-out does not skip the scope check.
    expect((await call(app, '/ext/no-wc-control', { token: w.token, method: 'POST' })).status).toBe(403);
  });
});
