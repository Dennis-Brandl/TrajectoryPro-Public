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
import { createRole } from 'mission-control-db/src/dao/roles';
import { app } from '../app';

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); });

type View = { users: Array<{ id: string; roles: Array<{ name: string }> }> };

async function fixture() {
  const steward = await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' });
  const viewer = await seedUser(db, { email: 'v@x.io', displayName: 'V' });
  const member = await seedUser(db, { email: 'm@x.io', displayName: 'M' });
  const outsider = await seedUser(db, { email: 'o@x.io', displayName: 'O' });
  const wc = await createWorkCenter(db, { name: 'Line 1' });
  await assignUserToWorkCenter(db, wc.id, member);
  const op = await createRole(db, { name: 'Operator' });
  const sup = await createRole(db, { name: 'Supervisor' });
  return { steward, viewer, member, outsider, wc, op, sup };
}

describe('PUT /api/work-centers/:id/users/:userId/roles (work_center:link)', () => {
  it('steward sets, replaces, de-duplicates and clears the set; the refreshed view lists roles per member', async () => {
    const f = await fixture();
    mockSessionAs(f.steward);
    const url = `/api/work-centers/${f.wc.id}/users/${f.member}/roles`;

    let res = await req(app, 'PUT', url, { json: { roleIds: [f.sup.id, f.op.id, f.op.id] } });
    expect(res.status).toBe(200);
    let view = (await res.json()) as View;
    expect(view.users.find((u) => u.id === f.member)?.roles.map((r) => r.name)).toEqual(['Operator', 'Supervisor']);

    res = await req(app, 'PUT', url, { json: { roleIds: [f.sup.id] } });
    view = (await res.json()) as View;
    expect(view.users.find((u) => u.id === f.member)?.roles.map((r) => r.name)).toEqual(['Supervisor']);

    res = await req(app, 'PUT', url, { json: { roleIds: [] } });
    view = (await res.json()) as View;
    expect(view.users.find((u) => u.id === f.member)?.roles).toEqual([]);
  });

  it('viewer → 403 with the work_center:link envelope', async () => {
    const f = await fixture();
    mockSessionAs(f.viewer);
    const res = await req(app, 'PUT', `/api/work-centers/${f.wc.id}/users/${f.member}/roles`, { json: { roleIds: [f.op.id] } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'forbidden', message: 'Missing permission: work_center:link' } });
  });

  it('non-member → 404; unknown role → 404; bad uuids → 400; malformed body → 400', async () => {
    const f = await fixture();
    mockSessionAs(f.steward);
    expect((await req(app, 'PUT', `/api/work-centers/${f.wc.id}/users/${f.outsider}/roles`, { json: { roleIds: [] } })).status).toBe(404);
    expect((await req(app, 'PUT', `/api/work-centers/${f.wc.id}/users/${f.member}/roles`, { json: { roleIds: ['00000000-0000-0000-0000-000000000000'] } })).status).toBe(404);
    expect((await req(app, 'PUT', `/api/work-centers/${f.wc.id}/users/not-a-uuid/roles`, { json: { roleIds: [] } })).status).toBe(400);
    expect((await req(app, 'PUT', `/api/work-centers/${f.wc.id}/users/${f.member}/roles`, { json: { roleIds: ['nope'] } })).status).toBe(400);
    expect((await req(app, 'PUT', `/api/work-centers/${f.wc.id}/users/${f.member}/roles`, { json: {} })).status).toBe(400);
  });
});
