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
import { mockSessionAs, seedUser, req } from '../test/harness';
import { migrateTestDb, resetDb } from '../test/fixture';
import { app } from '../app';
import { db } from '../lib/db';
import { createRole } from 'mission-control-db/src/dao/roles';
import {
  workflow, workflowNode, workCenter, workflowAllowedRole,
} from 'mission-control-db/src/db/schema/index';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
});

describe('role CRUD routes', () => {
  it('GET /api/roles lists name-sorted for a viewer; GET /:id returns roleView', async () => {
    const viewer = await seedUser(db, { email: 'v@x.io', displayName: 'V' });
    await createRole(db, { name: 'Zeta' });
    const alpha = await createRole(db, { name: 'Alpha' });
    mockSessionAs(viewer);
    const list = await req(app, 'GET', '/api/roles');
    expect(list.status).toBe(200);
    expect(((await list.json()) as { roles: Array<{ name: string }> }).roles.map((r) => r.name)).toEqual(['Alpha', 'Zeta']);
    const one = await req(app, 'GET', `/api/roles/${alpha.id}`);
    expect(one.status).toBe(200);
    const view = (await one.json()) as { role: { name: string }; members: unknown[]; workflows: unknown[] };
    expect(view.role.name).toBe('Alpha');
    expect((await req(app, 'GET', '/api/roles/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('steward creates (201 roleView), renames, deletes; viewer is 403 on all three', async () => {
    const steward = await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' });
    const viewer = await seedUser(db, { email: 'v@x.io', displayName: 'V' });
    mockSessionAs(steward);
    const created = await req(app, 'POST', '/api/roles', { json: { name: 'Operator', description: 'ops' } });
    expect(created.status).toBe(201);
    const roleId = ((await created.json()) as { role: { id: string } }).role.id;
    const patched = await req(app, 'PATCH', `/api/roles/${roleId}`, { json: { name: 'Operator II' } });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { role: { name: string } }).role.name).toBe('Operator II');
    expect((await req(app, 'DELETE', `/api/roles/${roleId}`)).status).toBe(204);
    mockSessionAs(viewer);
    expect((await req(app, 'POST', '/api/roles', { json: { name: 'X' } })).status).toBe(403);
    expect((await req(app, 'PATCH', `/api/roles/${roleId}`, { json: { name: 'X' } })).status).toBe(403);
    expect((await req(app, 'DELETE', `/api/roles/${roleId}`)).status).toBe(403);
  });

  it('validation + conflict envelopes: empty name 400; duplicate 409; system role 409; in-use 409', async () => {
    const steward = await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' });
    const sys = await createRole(db, { name: 'System', isSystem: true });
    const used = await createRole(db, { name: 'Used' });
    // M6: the work center owns the workflow directly, and the allowed-role row references
    // the workflow instead of a link row — that reference is what makes 'Used' in-use.
    const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'wf-1', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [node] = await db.insert(workflowNode).values({ workflowId: wf.id, nodeOid: 'n0', name: 'Root' }).returning();
    await db.insert(workflowAllowedRole).values({
      workflowId: wf.id, workflowNodeId: node.id, roleId: used.id,
    });
    mockSessionAs(steward);
    expect((await req(app, 'POST', '/api/roles', { json: {} })).status).toBe(400);
    const dupe = await req(app, 'POST', '/api/roles', { json: { name: 'Used' } });
    expect(dupe.status).toBe(409);
    expect(((await dupe.json()) as { error: { code: string } }).error.code).toBe('conflict');

    // Wire-code pinning: every DaoError→409 mapping lands on error.code 'conflict' (there is
    // no separate wire code per DaoError variant — see lib/errors.ts's daoWireCode), so the
    // DAO-error message is what actually distinguishes SYSTEM_ROLE from ROLE_IN_USE on the wire.
    const patchSys = await req(app, 'PATCH', `/api/roles/${sys.id}`, { json: { name: 'Renamed' } });
    expect(patchSys.status).toBe(409);
    expect(await patchSys.json()).toEqual({ error: { code: 'conflict', message: 'System roles cannot be edited' } });

    const deleteSys = await req(app, 'DELETE', `/api/roles/${sys.id}`);
    expect(deleteSys.status).toBe(409);
    expect(await deleteSys.json()).toEqual({ error: { code: 'conflict', message: 'System roles cannot be deleted' } });

    const deleteUsed = await req(app, 'DELETE', `/api/roles/${used.id}`);
    expect(deleteUsed.status).toBe(409);
    expect(await deleteUsed.json()).toEqual({ error: { code: 'conflict', message: 'Role is referenced by a loaded workflow (allowed-role assignment or e-signature)' } });
  });

  it('PATCH with description only (no name) → 200, name unchanged, description updated', async () => {
    const steward = await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' });
    const role = await createRole(db, { name: 'Operator', description: 'original' });
    mockSessionAs(steward);
    const res = await req(app, 'PATCH', `/api/roles/${role.id}`, { json: { description: 'x' } });
    expect(res.status).toBe(200);
    const view = (await res.json()) as { role: { name: string; description: string | null } };
    expect(view.role.name).toBe('Operator');
    expect(view.role.description).toBe('x');
  });
});

describe('a JSON null body', () => {
  it('POST /api/roles with body null is a 400 bad_request, not a 500', async () => {
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    const res = await req(app, 'POST', '/api/roles', { json: null });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_request');
  });
});
