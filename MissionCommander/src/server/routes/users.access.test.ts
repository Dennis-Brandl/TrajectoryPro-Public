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
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { mockSessionAs, seedUser, req } from '../test/harness';
import { migrateTestDb, resetDb } from '../test/fixture';
import { app } from '../app';
import { db } from '../lib/db';
import { auth } from '../lib/auth';
import { appUser } from 'mission-control-db/src/db/schema/index';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
  vi.mocked(auth.api.setUserPassword).mockClear();
  vi.mocked(auth.api.revokeUserSessions).mockClear();
});

describe('POST /api/users/:id/password (access:edit)', () => {
  it('admin sets a password: plugin call + session revocation, → {ok:true}', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'T' });
    mockSessionAs(admin);
    const res = await req(app, 'POST', `/api/users/${target}/password`, { json: { newPassword: 'fresh-pw-123' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(vi.mocked(auth.api.setUserPassword)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(auth.api.setUserPassword).mock.calls[0][0] as { body: { userId: string; newPassword: string } };
    expect(call.body).toEqual({ userId: target, newPassword: 'fresh-pw-123' });
    const revoke = vi.mocked(auth.api.revokeUserSessions).mock.calls[0][0] as { body: { userId: string } };
    expect(revoke.body).toEqual({ userId: target });
  });

  it('short password → 400 (no plugin call); steward/viewer → 403; missing user → 404', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    const steward = await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' });
    const viewer = await seedUser(db, { email: 'v@x.io', displayName: 'V' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'T' });
    mockSessionAs(admin);
    expect((await req(app, 'POST', `/api/users/${target}/password`, { json: { newPassword: 'short' } })).status).toBe(400);
    expect(vi.mocked(auth.api.setUserPassword)).not.toHaveBeenCalled();
    expect((await req(app, 'POST', '/api/users/00000000-0000-0000-0000-000000000000/password', { json: { newPassword: 'fresh-pw-123' } })).status).toBe(404);
    mockSessionAs(steward);
    expect((await req(app, 'POST', `/api/users/${target}/password`, { json: { newPassword: 'fresh-pw-123' } })).status).toBe(403);
    mockSessionAs(viewer);
    const viewerRes = await req(app, 'POST', `/api/users/${target}/password`, { json: { newPassword: 'fresh-pw-123' } });
    expect(viewerRes.status).toBe(403);
    expect(await viewerRes.json()).toEqual({ error: { code: 'forbidden', message: 'Missing permission: access:edit' } });
  });

  it('session revocation fails → 500 partial, but the password WAS already set', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'T' });
    mockSessionAs(admin);
    vi.mocked(auth.api.revokeUserSessions).mockRejectedValueOnce(new Error('boom'));
    const res = await req(app, 'POST', `/api/users/${target}/password`, { json: { newPassword: 'fresh-pw-123' } });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('partial');
    expect(body.error.message).toMatch(/password was set/i);
    expect(body.error.message).toMatch(/sessions/i);
    expect(vi.mocked(auth.api.setUserPassword)).toHaveBeenCalledTimes(1);
  });
});

// LAST_ADMIN over HTTP is deliberately NOT tested here: it is sequentially unreachable
// through these routes. The actor must be an ACTIVE administrator (requireSession +
// access:edit); if actor ≠ target, the actor themselves is a second active admin, so the
// target is never the last; if actor === target, SELF_CHANGE_FORBIDDEN fires first.
// LAST_ADMIN only fires in the concurrent race the advisory lock serializes — its 409
// behavior is covered at the DAO layer (access.guarded.test.ts) and its wire mapping at
// the errors layer (lib/errors.test.ts).
describe('POST /api/users/:id/access (access:edit, guarded)', () => {
  it('admin promotes a viewer to steward → refreshed userView', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'T' });
    mockSessionAs(admin);
    const res = await req(app, 'POST', `/api/users/${target}/access`, { json: { accessLevel: 'steward' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { accessLevel: string } }).user.accessLevel).toBe('steward');
  });

  it('self-demote → 403 with the forbidden wire code', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    mockSessionAs(admin);
    const res = await req(app, 'POST', `/api/users/${admin}/access`, { json: { accessLevel: 'viewer' } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden');
  });

  it('with two active admins one demotes the other; the demoted actor immediately loses access:edit', async () => {
    const a1 = await seedUser(db, { email: 'a1@x.io', displayName: 'A1', accessLevel: 'administrator' });
    const a2 = await seedUser(db, { email: 'a2@x.io', displayName: 'A2', accessLevel: 'administrator' });
    mockSessionAs(a2);
    const res = await req(app, 'POST', `/api/users/${a1}/access`, { json: { accessLevel: 'viewer' } });
    expect(res.status).toBe(200);
    mockSessionAs(a1); // still sessioned, but requireSession re-loads the principal fresh
    expect((await req(app, 'POST', `/api/users/${a2}/access`, { json: { accessLevel: 'viewer' } })).status).toBe(403);
  });

  it('invalid accessLevel → 400; steward/viewer → 403', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    const steward = await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' });
    const viewer = await seedUser(db, { email: 'v@x.io', displayName: 'V' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'T' });
    mockSessionAs(admin);
    expect((await req(app, 'POST', `/api/users/${target}/access`, { json: { accessLevel: 'root' } })).status).toBe(400);
    mockSessionAs(steward);
    expect((await req(app, 'POST', `/api/users/${target}/access`, { json: { accessLevel: 'steward' } })).status).toBe(403);
    mockSessionAs(viewer);
    const viewerRes = await req(app, 'POST', `/api/users/${target}/access`, { json: { accessLevel: 'steward' } });
    expect(viewerRes.status).toBe(403);
    expect(await viewerRes.json()).toEqual({ error: { code: 'forbidden', message: 'Missing permission: access:edit' } });
  });
});

describe('POST /api/users/:id/status (access:edit, guarded)', () => {
  it('admin disables and re-enables a user → refreshed userView both times', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'T' });
    mockSessionAs(admin);
    const off = await req(app, 'POST', `/api/users/${target}/status`, { json: { status: 'disabled' } });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { user: { status: string } }).user.status).toBe('disabled');
    const on = await req(app, 'POST', `/api/users/${target}/status`, { json: { status: 'active' } });
    expect(on.status).toBe(200);
    expect(((await on.json()) as { user: { status: string } }).user.status).toBe('active');
  });

  it('self-disable → 403; a disabled user is rejected by requireSession (401)', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'T' });
    mockSessionAs(admin);
    expect((await req(app, 'POST', `/api/users/${admin}/status`, { json: { status: 'disabled' } })).status).toBe(403);
    await req(app, 'POST', `/api/users/${target}/status`, { json: { status: 'disabled' } });
    mockSessionAs(target); // holds a "session", but the fresh status read rejects it
    expect((await req(app, 'GET', `/api/users/${admin}`)).status).toBe(401);
  });

  it('invalid status → 400; steward/viewer → 403', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    const steward = await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' });
    const viewer = await seedUser(db, { email: 'v@x.io', displayName: 'V' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'T' });
    mockSessionAs(admin);
    expect((await req(app, 'POST', `/api/users/${target}/status`, { json: { status: 'nonsense' } })).status).toBe(400);
    mockSessionAs(steward);
    expect((await req(app, 'POST', `/api/users/${target}/status`, { json: { status: 'disabled' } })).status).toBe(403);
    mockSessionAs(viewer);
    const viewerRes = await req(app, 'POST', `/api/users/${target}/status`, { json: { status: 'disabled' } });
    expect(viewerRes.status).toBe(403);
    expect(await viewerRes.json()).toEqual({ error: { code: 'forbidden', message: 'Missing permission: access:edit' } });
  });

  it('disable revokes the target sessions; enable does not', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'T' });
    mockSessionAs(admin);
    const off = await req(app, 'POST', `/api/users/${target}/status`, { json: { status: 'disabled' } });
    expect(off.status).toBe(200);
    expect(vi.mocked(auth.api.revokeUserSessions)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(auth.api.revokeUserSessions).mock.calls[0][0] as { body: { userId: string } };
    expect(call.body).toEqual(expect.objectContaining({ userId: target }));

    vi.mocked(auth.api.revokeUserSessions).mockClear();
    mockSessionAs(admin);
    const on = await req(app, 'POST', `/api/users/${target}/status`, { json: { status: 'active' } });
    expect(on.status).toBe(200);
    expect(vi.mocked(auth.api.revokeUserSessions)).not.toHaveBeenCalled();
  });

  it('session revocation fails on disable → 500 partial, but the user IS already disabled', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'T' });
    mockSessionAs(admin);
    vi.mocked(auth.api.revokeUserSessions).mockRejectedValueOnce(new Error('boom'));
    const res = await req(app, 'POST', `/api/users/${target}/status`, { json: { status: 'disabled' } });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('partial');
    expect(body.error.message).toMatch(/disabled/i);
    expect(body.error.message).toMatch(/sessions/i);
    const [row] = await db.select({ status: appUser.status }).from(appUser).where(eq(appUser.id, target));
    expect(row.status).toBe('disabled');
  });
});
