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
import { mockSessionAs, seedUser, req } from '../test/harness';
import { migrateTestDb, resetDb } from '../test/fixture';
import { app } from '../app';
import { db } from '../lib/db';
import { auth } from '../lib/auth';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
  vi.mocked(auth.api.signUpEmail).mockClear();
});

describe('GET /api/users/:id', () => {
  it('returns the userView for any signed-in tier; 404 on missing; 400 on bad uuid', async () => {
    const viewer = await seedUser(db, { email: 'v@x.io', displayName: 'Viewer' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'Target' });
    mockSessionAs(viewer);
    const res = await req(app, 'GET', `/api/users/${target}`);
    expect(res.status).toBe(200);
    const view = (await res.json()) as { user: { id: string; email: string }; workCenters: unknown[] };
    expect(view.user.id).toBe(target);
    expect(view).not.toHaveProperty('roles');
    expect(view.workCenters).toEqual([]);
    expect((await req(app, 'GET', '/api/users/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await req(app, 'GET', '/api/users/not-a-uuid')).status).toBe(400);
  });

  it('401 without a session', async () => {
    mockSessionAs(null);
    expect((await req(app, 'GET', '/api/users/00000000-0000-0000-0000-000000000000')).status).toBe(401);
  });
});

describe('POST /api/users (access:create — administrator only)', () => {
  it('creates via signUpEmail, applies accessLevel, returns 201 userView', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'Admin', accessLevel: 'administrator' });
    mockSessionAs(admin);
    const res = await req(app, 'POST', '/api/users', {
      json: { email: 'new@x.io', displayName: 'New User', password: 'first-pw-123', accessLevel: 'steward', loginName: 'new.user' },
    });
    expect(res.status).toBe(201);
    const view = (await res.json()) as { user: { email: string; accessLevel: string; role: string; loginName: string } };
    expect(view.user.email).toBe('new@x.io');
    expect(view.user.accessLevel).toBe('steward');
    expect(view.user.role).toBe('user'); // mirror applied by setAccessLevel
    expect(view.user.loginName).toBe('new.user');
    expect(vi.mocked(auth.api.signUpEmail)).toHaveBeenCalledWith({
      body: { email: 'new@x.io', password: 'first-pw-123', name: 'New User' },
    });
  });

  it('validates body: missing fields → 400; short password → 400; duplicate email → 409', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'Admin', accessLevel: 'administrator' });
    await seedUser(db, { email: 'dupe@x.io', displayName: 'Dupe' });
    mockSessionAs(admin);
    expect((await req(app, 'POST', '/api/users', { json: { email: 'x@x.io' } })).status).toBe(400);
    expect((await req(app, 'POST', '/api/users', {
      json: { email: 'x@x.io', displayName: 'X', password: 'short', loginName: 'x.user' },
    })).status).toBe(400);
    expect((await req(app, 'POST', '/api/users', {
      json: { email: 'x@x.io', displayName: 'X', password: 'long-enough-pw', accessLevel: 'super', loginName: 'x.user' },
    })).status).toBe(400);
    const dupe = await req(app, 'POST', '/api/users', {
      json: { email: 'dupe@x.io', displayName: 'D', password: 'long-enough-pw', loginName: 'x.user' },
    });
    expect(dupe.status).toBe(409);
    expect((await req(app, 'POST', '/api/users', {
      json: { email: 'y@x.io', displayName: 'Y', password: 'long-enough-pw' },
    })).status).toBe(400);                                              // loginName missing
    expect((await req(app, 'POST', '/api/users', {
      json: { email: 'y@x.io', displayName: 'Y', password: 'long-enough-pw', loginName: 'Bad Name!' },
    })).status).toBe(400);                                              // pattern
    await seedUser(db, { email: 'taken@x.io', displayName: 'Taken', loginName: 'taken' });
    expect((await req(app, 'POST', '/api/users', {
      json: { email: 'z@x.io', displayName: 'Z', password: 'long-enough-pw', loginName: 'TAKEN' },
    })).status).toBe(409);                                              // normalised duplicate
  });

  it('normalizes a mixed-case email before signup, persist-check, and duplicate-check', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'Admin', accessLevel: 'administrator' });
    mockSessionAs(admin);
    const res = await req(app, 'POST', '/api/users', {
      json: { email: 'John.Smith@Co.io', displayName: 'John Smith', password: 'first-pw-123', loginName: 'john.smith' },
    });
    expect(res.status).toBe(201);
    const view = (await res.json()) as { user: { email: string } };
    expect(view.user.email).toBe('john.smith@co.io');
    expect(vi.mocked(auth.api.signUpEmail)).toHaveBeenCalledWith({
      body: { email: 'john.smith@co.io', password: 'first-pw-123', name: 'John Smith' },
    });

    await seedUser(db, { email: 'dupe@x.io', displayName: 'Dupe' });
    const dupe = await req(app, 'POST', '/api/users', {
      json: { email: 'DUPE@X.IO', displayName: 'D', password: 'long-enough-pw', loginName: 'john.smith' },
    });
    expect(dupe.status).toBe(409);
  });

  it('403 for steward and viewer (access:create is admin-only)', async () => {
    for (const accessLevel of ['steward', 'viewer'] as const) {
      const uid = await seedUser(db, { email: `${accessLevel}@x.io`, displayName: accessLevel, accessLevel });
      mockSessionAs(uid);
      const res = await req(app, 'POST', '/api/users', {
        json: { email: 'n@x.io', displayName: 'N', password: 'long-enough-pw', loginName: 'n.user' },
      });
      expect(res.status, accessLevel).toBe(403);
    }
  });
});

describe('PATCH /api/users/:id (user:edit — steward+)', () => {
  it('steward renames or changes the login name; response is the refreshed userView', async () => {
    const steward = await seedUser(db, { email: 's@x.io', displayName: 'Steward', accessLevel: 'steward' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'Old Name' });
    mockSessionAs(steward);
    const res = await req(app, 'PATCH', `/api/users/${target}`, { json: { displayName: 'New Name' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { displayName: string } }).user.displayName).toBe('New Name');

    const login = await req(app, 'PATCH', `/api/users/${target}`, { json: { loginName: ' New.Login ' } });
    expect(login.status).toBe(200);
    expect(((await login.json()) as { user: { loginName: string } }).user.loginName).toBe('new.login');
  });

  it('viewer → 403; empty displayName → 400; missing user → 404', async () => {
    const viewer = await seedUser(db, { email: 'v@x.io', displayName: 'Viewer' });
    const steward = await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'T' });
    mockSessionAs(viewer);
    expect((await req(app, 'PATCH', `/api/users/${target}`, { json: { displayName: 'X' } })).status).toBe(403);
    mockSessionAs(steward);
    expect((await req(app, 'PATCH', `/api/users/${target}`, { json: { displayName: '' } })).status).toBe(400);
    expect((await req(app, 'PATCH', '/api/users/00000000-0000-0000-0000-000000000000', { json: { displayName: 'X' } })).status).toBe(404);
    expect((await req(app, 'PATCH', `/api/users/${target}`, { json: {} })).status).toBe(400);
    expect((await req(app, 'PATCH', `/api/users/${target}`, { json: { loginName: '!' } })).status).toBe(400);
    await seedUser(db, { email: 'w@x.io', displayName: 'W', loginName: 'wanted' });
    expect((await req(app, 'PATCH', `/api/users/${target}`, { json: { loginName: 'wanted' } })).status).toBe(409);
  });
});

describe('PATCH /api/users/:id email (access:edit — administrator)', () => {
  it('administrator changes the email (normalised); invalid → 400; taken → 409', async () => {
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'T' });
    await seedUser(db, { email: 'taken@x.io', displayName: 'Taken' });
    mockSessionAs(admin);
    const res = await req(app, 'PATCH', `/api/users/${target}`, { json: { email: ' New@X.io ' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { email: string } }).user.email).toBe('new@x.io');
    expect((await req(app, 'PATCH', `/api/users/${target}`, { json: { email: 'nope' } })).status).toBe(400);
    expect((await req(app, 'PATCH', `/api/users/${target}`, { json: { email: 42 } })).status).toBe(400);
    expect((await req(app, 'PATCH', `/api/users/${target}`, { json: { email: 'Taken@x.io' } })).status).toBe(409);
  });

  it('steward → 403 for an email change, and nothing else in the patch is applied', async () => {
    const steward = await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' });
    const target = await seedUser(db, { email: 't@x.io', displayName: 'T' });
    mockSessionAs(steward);
    const res = await req(app, 'PATCH', `/api/users/${target}`, { json: { displayName: 'Renamed', email: 'n@x.io' } });
    expect(res.status).toBe(403);
    const after = (await (await req(app, 'GET', `/api/users/${target}`)).json()) as { user: { displayName: string; email: string } };
    expect(after.user).toMatchObject({ displayName: 'T', email: 't@x.io' });
  });
});

describe('a JSON null body', () => {
  it('POST /api/users with body null is a 400 bad_request, not a 500', async () => {
    mockSessionAs(await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' }));
    const res = await req(app, 'POST', '/api/users', { json: null });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_request');
  });
});
