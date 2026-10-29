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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestDb } from './helpers/db.js';
import { eq } from 'drizzle-orm';
import { appUser } from 'mission-control-db/src/db/schema/index';
import { ACCOUNT_DISABLED_MESSAGE } from 'mission-control-db/src/dao/account-status';
import { createAuth } from '../src/api/auth.js';
import { makeApi } from './helpers/api.js';

// better-auth against PGlite works under vitest (CM's route tests prove the pattern; it also
// disables its origin check under vitest — same caveat as CM's auth.ts documents).
describe('engine better-auth mount', () => {
  let db: Awaited<ReturnType<typeof makeTestDb>>['db'];
  let close: () => Promise<void>;
  beforeEach(async () => ({ db, close } = await makeTestDb()));
  afterEach(async () => close());

  function testAuth(allowSignUp = false) {
    return createAuth(db as never, { baseURL: 'http://127.0.0.1:3006', secret: 'test-secret', allowSignUp });
  }

  it('signs in against a shared-DB account and lands the session in the shared session table', async () => {
    const bootstrap = testAuth(true);
    await bootstrap.api.signUpEmail({ body: { email: 'op@example.com', password: 'password-123', name: 'Op One' } });
    const auth = testAuth(); // production shape: sign-up disabled
    const res = await auth.api.signInEmail({ body: { email: 'op@example.com', password: 'password-123' }, asResponse: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/mission-engine\.session_token/); // app-distinct prefix (2026-08-20)
    const session = await auth.api.getSession({ headers: new Headers({ cookie: res.headers.get('set-cookie')! }) });
    expect(session?.user.email).toBe('op@example.com');
  });

  it('refuses sign-up in production shape', async () => {
    const auth = testAuth();
    const res = await auth.api.signUpEmail({
      body: { email: 'new@example.com', password: 'password-123', name: 'New' }, asResponse: true,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('a disabled account cannot sign in: 403 with the disabled message', async () => {
    const bootstrap = testAuth(true);
    await bootstrap.api.signUpEmail({ body: { email: 'off@example.com', password: 'password-123', name: 'Off' } });
    await db.update(appUser).set({ status: 'disabled' }).where(eq(appUser.email, 'off@example.com'));
    const res = await testAuth().api.signInEmail({ body: { email: 'off@example.com', password: 'password-123' }, asResponse: true });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ message: ACCOUNT_DISABLED_MESSAGE, code: 'ACCOUNT_DISABLED' });
  });
});

// Review focus 5: a user disabled while signed in — the session row predates the change.
describe('engine session gate and disabled accounts', () => {
  it('a signed-in user who is then disabled gets 401 on the next /api call', async () => {
    const { app, db, seedOperator, cookieFor, close } = await makeApi();
    await seedOperator('live@example.com');
    const cookie = await cookieFor('live@example.com');
    expect((await app.request('/api/me', { headers: { cookie } })).status).toBe(200);
    await db.update(appUser).set({ status: 'disabled' }).where(eq(appUser.email, 'live@example.com'));
    expect((await app.request('/api/me', { headers: { cookie } })).status).toBe(401);
    await close();
  });
});
