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
import { eq } from 'drizzle-orm';
import { app } from '../app';
import { db } from '../lib/db';
import { appUser } from 'mission-control-db/src/db/schema/index';
import { migrateTestDb, resetDb } from '../test/fixture';
import { auth } from '../lib/auth';
import { isBlockedAdminPath } from './admin-gate';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
});

// Endpoints the app does NOT use — must stay blocked (spec §6.3), plus a made-up path
// proving the allowlist is default-closed (a future/unknown admin endpoint is denied),
// plus bypass-variant spellings that canonicalize back under the admin prefix.
const BLOCKED = [
  '/api/auth/admin/remove-user',
  '/api/auth/admin/set-role',
  '/api/auth/admin/update-user',
  '/api/auth/admin/create-user',
  '/api/auth/admin/ban-user',
  '/api/auth/admin/unban-user',
  '/api/auth/admin/set-user-password',
  '/api/auth/admin/some-future-endpoint', // default-closed: unknown admin path is denied
  '/api/auth/admin/remove-user/', // trailing slash
  '/api/auth/admin//remove-user', // duplicate interior slash
  '/api/auth/admin%2Fremove-user', // encoded separator (canonicalize decodes %2F)
  '/api/auth/admin/%72emove-user', // encoded letter (canonicalize decodes → remove-user)
];

// Endpoints the app DOES use (must reach the handler), and non-admin auth paths (never
// subject to the allowlist at all).
const ALLOWED = [
  '/api/auth/admin/list-user-sessions',
  '/api/auth/admin/revoke-user-session',
  '/api/auth/admin/revoke-user-sessions',
  '/api/auth/admin/impersonate-user',
  '/api/auth/admin/stop-impersonating',
  '/api/auth/sign-in/email',
  '/api/auth/get-session',
  '/api/auth/sign-up/email',
];

async function adminCookie(): Promise<string> {
  await auth.api.signUpEmail({ body: { email: 'admin@x.io', password: 'pw-123456', name: 'Admin' } });
  const res = await auth.api.signInEmail({
    body: { email: 'admin@x.io', password: 'pw-123456' }, asResponse: true,
  });
  return res.headers.get('set-cookie') ?? '';
}

describe('isBlockedAdminPath (default-closed allowlist policy, spec §6.3)', () => {
  for (const p of BLOCKED) it(`blocks ${p}`, () => expect(isBlockedAdminPath(p)).toBe(true));
  for (const p of ALLOWED) it(`allows ${p}`, () => expect(isBlockedAdminPath(p)).toBe(false));
});

describe('admin-plugin endpoint lockdown over HTTP (spec §6.3)', () => {
  it('404s every blocked / unknown admin path — even for an administrator', async () => {
    const cookie = await adminCookie();
    for (const path of BLOCKED) {
      const res = await app.request(path, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status, path).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code, path).toBe('not_found');
    }
  });

  // HTTP-pin the live endpoints through the broad /api/auth/* mount: the gate must NOT
  // block them (they reach better-auth, which answers with some non-404 status). Three
  // are driven to a real non-404 here; revoke-user-session / stop-impersonating share the
  // identical single mount + allowlist decision and are pinned by isBlockedAdminPath above
  // (no per-endpoint mount exists to regress independently).
  it('lets the live admin capabilities through the mount (gate does not 404 them)', async () => {
    const cookie = await adminCookie();
    await auth.api.signUpEmail({ body: { email: 'vic@x.io', password: 'pw-123456', name: 'Vic' } });
    const [vic] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, 'vic@x.io'));

    const live: [string, unknown][] = [
      ['/api/auth/admin/list-user-sessions', { userId: vic.id }],
      ['/api/auth/admin/revoke-user-sessions', { userId: vic.id }],
      ['/api/auth/admin/impersonate-user', { userId: vic.id }],
    ];
    for (const [path, body] of live) {
      const res = await app.request(path, {
        method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(res.status, path).not.toBe(404); // reached the handler — gate allowed it
    }
  });
});
