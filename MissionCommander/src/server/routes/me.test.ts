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
import { db } from '../lib/db';
import { migrateTestDb, resetDb } from '../test/fixture';
import { mockSessionAs, seedUser, req } from '../test/harness';
import { createWorkCenter, assignUserToWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { app } from '../app';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
  mockSessionAs(null);
});

describe('GET /api/me', () => {
  it('401 without a session', async () => {
    expect((await req(app, 'GET', '/api/me')).status).toBe(401);
  });

  it('returns a viewer capability snapshot', async () => {
    const id = await seedUser(db, { email: 'v@x.io', displayName: 'Vic', accessLevel: 'viewer' });
    mockSessionAs(id);
    const res = await req(app, 'GET', '/api/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessLevel: string; isAdministrator: boolean; rights: string[] };
    expect(body.accessLevel).toBe('viewer');
    expect(body.isAdministrator).toBe(false);
    expect(body.rights).toContain('work_center:read');
    expect(body.rights).not.toContain('work_center:edit');
  });

  it('returns the login name', async () => {
    const id = await seedUser(db, { email: 'l@x.io', displayName: 'Lou', accessLevel: 'viewer', loginName: 'lou.l' });
    mockSessionAs(id);
    const body = (await (await req(app, 'GET', '/api/me')).json()) as { loginName: string };
    expect(body.loginName).toBe('lou.l');
  });

  it('marks an administrator', async () => {
    const id = await seedUser(db, { email: 'a@x.io', displayName: 'Ada', accessLevel: 'administrator' });
    mockSessionAs(id);
    const body = (await (await req(app, 'GET', '/api/me')).json()) as { isAdministrator: boolean; rights: string[] };
    expect(body.isAdministrator).toBe(true);
    expect(body.rights).toContain('access:edit');
  });

  it('lists every work center the caller commands, sorted', async () => {
    const wcA = await createWorkCenter(db, { name: 'A' });
    const wcB = await createWorkCenter(db, { name: 'B' });
    const id = await seedUser(db, { email: 'mc@x.io', displayName: 'MC', accessLevel: 'viewer' });
    // Assigned out of id order so a naive unsorted list would fail this assertion.
    const [first, second] = [wcA.id, wcB.id].sort().reverse();
    await assignUserToWorkCenter(db, first, id, { missionSystemCommander: true });
    await assignUserToWorkCenter(db, second, id, { missionSystemCommander: true });
    mockSessionAs(id);
    const body = (await (await req(app, 'GET', '/api/me')).json()) as { missionSystemCommanderOf: string[] };
    expect(body.missionSystemCommanderOf).toEqual([wcA.id, wcB.id].sort());
  });

  it('reports no commanded work centers for a plain user', async () => {
    const wc = await createWorkCenter(db, { name: 'A' });
    const id = await seedUser(db, { email: 'plain@x.io', displayName: 'Plain', accessLevel: 'viewer' });
    await assignUserToWorkCenter(db, wc.id, id); // assigned, but not a commander
    mockSessionAs(id);
    const body = (await (await req(app, 'GET', '/api/me')).json()) as { missionSystemCommanderOf: string[] };
    expect(body.missionSystemCommanderOf).toEqual([]);
  });
});
