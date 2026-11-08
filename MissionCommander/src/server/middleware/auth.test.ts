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
import { Hono } from 'hono';
import { db } from '../lib/db';
import { migrateTestDb, resetDb } from '../test/fixture';
import { mockSessionAs, mockXoSessionAs, seedUser, req } from '../test/harness';
import { APP_HEADER, XO_APP } from '../../lib/app-header';
import { requireSession, requirePermission, requireAdministrator, type Vars } from './auth';

function guardedApp() {
  const app = new Hono<{ Variables: Vars }>();
  app.use('/api/*', requireSession);
  app.get('/api/open', (c) => c.json({ ok: true }));
  app.post('/api/edit', requirePermission('work_center:edit'), (c) => c.json({ ok: true }));
  app.post('/api/admin-only', requireAdministrator, (c) => c.json({ ok: true }));
  return app;
}

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
  mockSessionAs(null);
  mockXoSessionAs(null);
});

describe('requireSession', () => {
  it('401 when unauthenticated', async () => {
    expect((await req(guardedApp(), 'GET', '/api/open')).status).toBe(401);
  });

  it('401 when the user is disabled', async () => {
    const id = await seedUser(db, { email: 'd@x.io', displayName: 'D', status: 'disabled' });
    mockSessionAs(id);
    expect((await req(guardedApp(), 'GET', '/api/open')).status).toBe(401);
  });

  it('passes an active user through', async () => {
    const id = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'viewer' });
    mockSessionAs(id);
    expect((await req(guardedApp(), 'GET', '/api/open')).status).toBe(200);
  });
});

// 2026-11-08: Commander signed in as George, Mission XO as John Doe in the same browser.
// Commander's starts must act as George, XO's as John Doe.
describe('requireSession picks the sign-in of the app that sent the request', () => {
  function whoApp() {
    const app = new Hono<{ Variables: Vars }>();
    app.use('/api/*', requireSession);
    app.get('/api/who', (c) => c.json({ userId: c.get('principal').userId }));
    return app;
  }
  async function who(headers?: Record<string, string>) {
    const res = await whoApp().request('/api/who', { headers });
    return { status: res.status, userId: res.status === 200 ? ((await res.json()) as { userId: string }).userId : null };
  }

  it("uses Commander's session for an unmarked request and XO's for one XO marks", async () => {
    const george = await seedUser(db, { email: 'g@x.io', displayName: 'George', accessLevel: 'administrator' });
    const john = await seedUser(db, { email: 'j@x.io', displayName: 'John', accessLevel: 'steward' });
    mockSessionAs(george);
    mockXoSessionAs(john);
    expect(await who()).toEqual({ status: 200, userId: george });
    expect(await who({ [APP_HEADER]: XO_APP })).toEqual({ status: 200, userId: john });
  });

  it("an XO request with no XO sign-in is 401, even while Commander is signed in", async () => {
    const george = await seedUser(db, { email: 'g@x.io', displayName: 'George', accessLevel: 'administrator' });
    mockSessionAs(george);
    expect((await who({ [APP_HEADER]: XO_APP })).status).toBe(401);
  });

  it("a Commander request with only an XO sign-in is 401", async () => {
    const john = await seedUser(db, { email: 'j@x.io', displayName: 'John', accessLevel: 'steward' });
    mockXoSessionAs(john);
    expect((await who()).status).toBe(401);
  });
});

describe('requirePermission', () => {
  it('403 for a viewer lacking the right', async () => {
    const id = await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' });
    mockSessionAs(id);
    expect((await req(guardedApp(), 'POST', '/api/edit')).status).toBe(403);
  });

  it('allows a steward who holds the right', async () => {
    const id = await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' });
    mockSessionAs(id);
    expect((await req(guardedApp(), 'POST', '/api/edit')).status).toBe(200);
  });

  it('administrator short-circuits every right', async () => {
    const id = await seedUser(db, { email: 'ad@x.io', displayName: 'Ad', accessLevel: 'administrator' });
    mockSessionAs(id);
    expect((await req(guardedApp(), 'POST', '/api/edit')).status).toBe(200);
  });
});

describe('requireAdministrator', () => {
  it('403s a viewer', async () => {
    const id = await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' });
    mockSessionAs(id);
    expect((await req(guardedApp(), 'POST', '/api/admin-only')).status).toBe(403);
  });

  it('403s a steward — this gate is administrator-only, not rights-based', async () => {
    const id = await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' });
    mockSessionAs(id);
    expect((await req(guardedApp(), 'POST', '/api/admin-only')).status).toBe(403);
  });

  it('allows an administrator', async () => {
    const id = await seedUser(db, { email: 'ad@x.io', displayName: 'Ad', accessLevel: 'administrator' });
    mockSessionAs(id);
    expect((await req(guardedApp(), 'POST', '/api/admin-only')).status).toBe(200);
  });

  it('401s when unauthenticated', async () => {
    expect((await req(guardedApp(), 'POST', '/api/admin-only')).status).toBe(401);
  });
});
