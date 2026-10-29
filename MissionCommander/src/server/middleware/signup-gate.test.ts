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
import { appUser } from 'mission-control-db/src/db/schema/index';
import { migrateTestDb, resetDb } from '../test/fixture';
import { signupGate, isSignupPath } from './signup-gate';

// Mirrors production: the gate is mounted on the BROAD /api/auth/* prefix (not the narrow
// /api/auth/sign-up/*), so an encoded separator can't skip it (Hono won't enter a
// /sign-up/*-scoped middleware for `sign-up%2Femail`). The in-handler isSignupPath()
// canonicalizes and does the real matching.
function gateApp() {
  const app = new Hono();
  app.use('/api/auth/*', signupGate);
  app.post('/api/auth/sign-up/email', (c) => c.json({ ok: true }));
  return app;
}

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
});

describe('isSignupPath', () => {
  it('matches sign-up paths (incl. %2F-encoded) and nothing else', () => {
    expect(isSignupPath('/api/auth/sign-up/email')).toBe(true);
    expect(isSignupPath('/api/auth/sign-up%2Femail')).toBe(true); // canonicalize decodes %2F
    expect(isSignupPath('/api/auth/sign-in/email')).toBe(false);
    expect(isSignupPath('/api/auth/get-session')).toBe(false);
  });
});

describe('signup gate', () => {
  it('allows sign-up while no administrator exists', async () => {
    const res = await gateApp().request('/api/auth/sign-up/email', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('403s once an administrator exists', async () => {
    await db.insert(appUser).values({ email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    const res = await gateApp().request('/api/auth/sign-up/email', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden');
  });

  // The %2F narrow-mount skip: with the old /api/auth/sign-up/* mount this request slipped
  // past the gate entirely. The broad mount + canonicalize now closes it — after bootstrap,
  // the encoded spelling is gated too (403, not a fall-through to the no-such-route 404).
  it('403s a %2F-encoded sign-up path once an administrator exists', async () => {
    await db.insert(appUser).values({ email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    const res = await gateApp().request('/api/auth/sign-up%2Femail', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden');
  });

  it('does not touch non-signup auth paths', async () => {
    await db.insert(appUser).values({ email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    const app = gateApp();
    app.get('/api/auth/get-session', (c) => c.json({ ok: true }));
    const res = await app.request('/api/auth/get-session', { method: 'GET' });
    expect(res.status).toBe(200); // gate passed it through despite an admin existing
  });
}
);
