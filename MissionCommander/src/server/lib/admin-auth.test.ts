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
import { db } from './db';
import { appUser } from 'mission-control-db/src/db/schema/index';
import { migrateTestDb, resetDb } from '../test/fixture';
import { auth } from './auth';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
});

async function signUp(email: string, name: string): Promise<void> {
  await auth.api.signUpEmail({ body: { email, password: 'pw-123456', name } });
}

async function signInHeaders(email: string, password = 'pw-123456'): Promise<Headers> {
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return new Headers({ cookie: res.headers.get('set-cookie') ?? '' });
}

async function userId(email: string): Promise<string> {
  const [row] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, email));
  return row.id;
}

// impersonateUser emits SIX Set-Cookie headers (session_token/session_data/dont_remember
// deletions, then admin_session, then the REAL impersonation session_token) — a naive
// `headers.get('set-cookie')` comma-join puts the session_token deletion before the real
// token, and first-wins cookie parsing then yields no session. Replay them the way a
// browser would: in order, last-write-wins per cookie name, Max-Age=0 (or empty) deletes.
function cookieJar(...responses: Response[]): Headers {
  const jar = new Map<string, string>();
  for (const res of responses) {
    for (const entry of res.headers.getSetCookie()) {
      const [pair, ...attrs] = entry.split(';');
      const sep = pair.indexOf('=');
      const name = pair.slice(0, sep).trim();
      const value = pair.slice(sep + 1).trim();
      const deletes = value === '' || attrs.some((a) => a.trim().toLowerCase() === 'max-age=0');
      if (deletes) jar.delete(name);
      else jar.set(name, value);
    }
  }
  return new Headers({ cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') });
}

describe('admin plugin adoption (spec §6.2)', () => {
  it('role mirror: first user admin, later users user', async () => {
    await signUp('admin@x.io', 'Admin');
    await signUp('v@x.io', 'Vic');
    const [adminRow] = await db.select().from(appUser).where(eq(appUser.email, 'admin@x.io'));
    const [vicRow] = await db.select().from(appUser).where(eq(appUser.email, 'v@x.io'));
    expect(adminRow.role).toBe('admin'); // promote hook → setAccessLevel → mirror
    expect(vicRow.role).toBe('user');    // column default
  });

  it('setUserPassword: old credential dies, new one signs in; revokeUserSessions kills live sessions', async () => {
    await signUp('admin@x.io', 'Admin');
    await signUp('v@x.io', 'Vic');
    const adminHeaders = await signInHeaders('admin@x.io');
    const vicHeaders = await signInHeaders('v@x.io'); // Vic's live session, pre-reset
    const vicId = await userId('v@x.io');

    const result = await auth.api.setUserPassword({
      body: { userId: vicId, newPassword: 'brand-new-pw-9' },
      headers: adminHeaders,
    });
    expect(result.status).toBe(true);

    await expect(
      auth.api.signInEmail({ body: { email: 'v@x.io', password: 'pw-123456' } }),
    ).rejects.toThrow(); // old password rejected
    await auth.api.signInEmail({ body: { email: 'v@x.io', password: 'brand-new-pw-9' } }); // new one works

    // Session survives the password change alone (setUserPassword doesn't revoke) — assert
    // it's alive here so the post-revoke null below actually demonstrates revocation, rather
    // than the session having died for some unrelated reason.
    const preRevoke = await auth.api.getSession({ headers: vicHeaders });
    expect(preRevoke?.user.id).toBe(vicId);

    await auth.api.revokeUserSessions({ body: { userId: vicId }, headers: adminHeaders });
    expect(await auth.api.getSession({ headers: vicHeaders })).toBeNull(); // pre-reset session dead
  });

  it('non-admin cannot call plugin admin endpoints', async () => {
    await signUp('admin@x.io', 'Admin');
    await signUp('v@x.io', 'Vic');
    const vicHeaders = await signInHeaders('v@x.io');
    const adminId = await userId('admin@x.io');
    // role 'user' fails the plugin's admin check — pin the actual rejection shape (better-call
    // APIError: string `status` + numeric `statusCode`), not just "it threw something".
    await expect(
      auth.api.setUserPassword({ body: { userId: adminId, newPassword: 'hijack-pw-99' }, headers: vicHeaders }),
    ).rejects.toMatchObject({ name: 'APIError', status: 'FORBIDDEN', statusCode: 403 });
  });

  it('impersonation round-trip: session carries impersonatedBy; stop restores the admin', async () => {
    await signUp('admin@x.io', 'Admin');
    await signUp('v@x.io', 'Vic');
    const adminHeaders = await signInHeaders('admin@x.io');
    const vicId = await userId('v@x.io');
    const adminId = await userId('admin@x.io');

    const imp = await auth.api.impersonateUser({
      body: { userId: vicId }, headers: adminHeaders, asResponse: true,
    });
    const impHeaders = cookieJar(imp); // impersonation session_token + admin_session
    const impSession = await auth.api.getSession({ headers: impHeaders });
    expect(impSession?.user.id).toBe(vicId);
    expect((impSession?.session as { impersonatedBy?: string | null })?.impersonatedBy).toBe(adminId);
    const impersonationToken = (impSession?.session as { token: string }).token;

    const stop = await auth.api.stopImpersonating({ headers: impHeaders, asResponse: true });
    // Apply the stop response ON TOP of the impersonation jar: the restore rides the
    // admin_session cookie set during impersonation, and stop expires it (Max-Age=0).
    const backHeaders = cookieJar(imp, stop);
    const backSession = await auth.api.getSession({ headers: backHeaders });
    expect(backSession?.user.id).toBe(adminId);

    // stopImpersonating deletes the impersonation session row outright (not just cookie
    // expiry) — confirm it's actually gone server-side, not merely unreachable from this client.
    const remaining = await auth.api.listUserSessions({ body: { userId: vicId }, headers: adminHeaders });
    expect(remaining.sessions.map((s) => s.token)).not.toContain(impersonationToken);
  });
});
