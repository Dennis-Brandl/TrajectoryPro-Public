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
import { auth, trustedOrigins } from './auth';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
});

describe('better-auth ↔ app_user mapping', () => {
  it('sign-up lands a uuid-id app_user row with mapped columns; first user → administrator', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@x.io', password: 'pw-123456', name: 'Admin One' } });

    const [row] = await db.select().from(appUser).where(eq(appUser.email, 'admin@x.io'));
    expect(row).toBeTruthy();
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/); // DB-generated uuid, not a better-auth text id
    expect(row.displayName).toBe('Admin One'); // better-auth `name` → display_name
    expect(row.emailVerified).toBe(false);
    expect(row.accessLevel).toBe('administrator'); // promoted by the first-run hook
  });

  it('second user defaults to viewer (not promoted)', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@x.io', password: 'pw-123456', name: 'Admin' } });
    await auth.api.signUpEmail({ body: { email: 'v@x.io', password: 'pw-123456', name: 'Vic' } });
    const [row] = await db.select().from(appUser).where(eq(appUser.email, 'v@x.io'));
    expect(row.accessLevel).toBe('viewer');
  });

  it('sign-in issues a session that getSession resolves', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@x.io', password: 'pw-123456', name: 'Admin' } });
    const signIn = await auth.api.signInEmail({
      body: { email: 'admin@x.io', password: 'pw-123456' },
      asResponse: true,
    });
    const cookie = signIn.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('mission-commander.session_token'); // app-distinct prefix (2026-08-20)
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user?.email).toBe('admin@x.io');
  });
});

// better-auth's origin check must agree with the CORS policy in app.ts, which trusts any
// origin whose hostname is localhost or 127.0.0.1 regardless of port. They diverged: the
// old list hardcoded :5173 and :3002, so a deployment on any other port (the container
// publishes :3005) rejected 127.0.0.1 with INVALID_ORIGIN while localhost worked — the
// latter only by accident, because better-auth implicitly trusts its own baseURL.
// NOTE ON COVERAGE: these assert the POLICY (the pattern list), not better-auth's
// matching of it. better-auth sets `skipOriginCheck: isTest() ? true : false`
// (context/create-context.mjs), so its origin-check middleware is DISABLED under vitest —
// no unit test in this suite can exercise a rejection, which is exactly how the
// localhost-only list shipped. The wildcard semantics were verified against better-auth's
// own matchesOriginPattern: 'http://localhost:*' matches http://localhost:3005 and does
// NOT match http://127.0.0.1.evil.com or http://localhost.evil.com.
describe('trustedOrigins mirrors the CORS loopback policy', () => {
  it('trusts either loopback hostname on ANY port, so a deployment port change cannot break sign-in', () => {
    const patterns = trustedOrigins();
    expect(patterns).toContain('http://localhost:*');
    expect(patterns).toContain('http://127.0.0.1:*');
    // app.ts's CORS check keys on hostname alone, so it admits https loopback too;
    // the two layers must not disagree again.
    expect(patterns).toContain('https://localhost:*');
    expect(patterns).toContain('https://127.0.0.1:*');
  });

  it('appends explicit ALLOWED_ORIGINS entries, trimmed, ignoring blanks', () => {
    const prev = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = 'https://command.example.com,  https://ops.example.com , ';
    try {
      const patterns = trustedOrigins();
      expect(patterns).toContain('https://command.example.com');
      expect(patterns).toContain('https://ops.example.com');
      expect(patterns).not.toContain('');
    } finally {
      if (prev === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = prev;
    }
  });

  it('adds no non-loopback origin of its own', () => {
    const prev = process.env.ALLOWED_ORIGINS;
    delete process.env.ALLOWED_ORIGINS;
    try {
      for (const p of trustedOrigins()) {
        expect(p, p).toMatch(/^https?:\/\/(localhost|127\.0\.0\.1):\*$/);
      }
    } finally {
      if (prev !== undefined) process.env.ALLOWED_ORIGINS = prev;
    }
  });
});
