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
import { workflow, workflowNode, workflowUiStep, workCenter } from 'mission-control-db/src/db/schema/index';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
  mockSessionAs(null);
});

const NIL = '00000000-0000-0000-0000-000000000000';

// M6: allowed roles hang off the WORKFLOW ENTRY, not off a work-center↔workflow link row.
// A workflow already belongs to exactly one work center, so the /work-centers/:id segment
// carried no information and is gone from these URLs.
async function seedEntry(wcName: string, oid: string) {
  const [wc] = await db.insert(workCenter).values({ name: wcName }).returning();
  const [wf] = await db.insert(workflow).values({
    oid, name: 'WF', workCenterId: wc.id, specJsonb: {},
  }).returning();
  const [root] = await db.insert(workflowNode).values({
    workflowId: wf.id, nodeOid: 'n0', name: 'Root', depth: 0,
  }).returning();
  await db.insert(workflowUiStep).values({
    workflowId: wf.id, owningNodeId: root.id, stepOid: 's1', name: 'Confirm', stepType: 'USER_INTERACTION',
  });
  return { wc, wf, root };
}

async function fixture() {
  const { wc, wf, root } = await seedEntry('WC', 'wf-1');
  const operator = await createRole(db, { name: 'Operator' });
  return { wf, wc, root, operator };
}

type View = { workflowId: string; nodes: Array<{ nodeId: string; nodeName: string; roleIds: string[] }> };

describe('allowed-roles routes', () => {
  it("lists a workflow's UI nodes with their assigned roles", async () => {
    const f = await fixture();
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V' }));

    const res = await req(app, 'GET', `/api/workflows/${f.wf.id}/allowed-roles`);
    expect(res.status).toBe(200);
    const view = (await res.json()) as View;
    expect(view).toMatchObject({ workflowId: f.wf.id });
    expect(view.nodes).toHaveLength(1);
    expect(view.nodes[0].nodeName).toBe('Root');
  });

  it('404s for an unknown workflow', async () => {
    await fixture();
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V' }));
    expect((await req(app, 'GET', `/api/workflows/${NIL}/allowed-roles`)).status).toBe(404);
  });

  it('requires a session', async () => {
    const f = await fixture();
    mockSessionAs(null);
    expect((await req(app, 'GET', `/api/workflows/${f.wf.id}/allowed-roles`)).status).toBe(401);
  });

  it('400s a malformed workflow uuid', async () => {
    await fixture();
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    expect((await req(app, 'GET', '/api/workflows/nope/allowed-roles')).status).toBe(400);
  });

  it('the old work-center-scoped path is gone', async () => {
    const f = await fixture();
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    const old = `/api/work-centers/${f.wc.id}/workflows/${f.wf.id}`;
    expect((await req(app, 'GET', `${old}/allowed-roles`)).status).toBe(404);
  });

  it('PUT replaces the grant set and returns the refreshed view', async () => {
    const f = await fixture();
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));

    const res = await req(app, 'PUT', `/api/workflows/${f.wf.id}/allowed-roles`, {
      json: { nodes: [{ nodeId: f.root.id, roleIds: [f.operator.id] }] },
    });
    expect(res.status).toBe(200);
    const view = (await res.json()) as View;
    expect(view.nodes[0].roleIds).toEqual([f.operator.id]);

    const cleared = await req(app, 'PUT', `/api/workflows/${f.wf.id}/allowed-roles`, {
      json: { nodes: [{ nodeId: f.root.id, roleIds: [] }] },
    });
    expect(((await cleared.json()) as View).nodes[0].roleIds).toEqual([]);
  });

  it('PUT 400s on a body that is not JSON at all', async () => {
    // Exercises the .catch(() => null) on c.req.json() — the well-formed-but-invalid case
    // below never reaches it, so before this split that branch had no cover.
    const f = await fixture();
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    const res = await app.request(`/api/workflows/${f.wf.id}/allowed-roles`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
  });

  it('PUT 400s on well-formed JSON that fails validation', async () => {
    const f = await fixture();
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    const res = await req(app, 'PUT', `/api/workflows/${f.wf.id}/allowed-roles`, {
      json: { nodes: [{ nodeId: 'not-a-uuid', roleIds: [] }] },
    });
    expect(res.status).toBe(400);
  });

  it('PUT 403s without work_center:link', async () => {
    const f = await fixture();
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V' })); // viewer
    const res = await req(app, 'PUT', `/api/workflows/${f.wf.id}/allowed-roles`, {
      json: { nodes: [] },
    });
    expect(res.status).toBe(403);
  });

  it('PUT 404s for an unknown workflow', async () => {
    await fixture();
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    const res = await req(app, 'PUT', `/api/workflows/${NIL}/allowed-roles`, { json: { nodes: [] } });
    expect(res.status).toBe(404);
  });

  it('PUT 400s a payload with too many nodes', async () => {
    const f = await fixture();
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    const nodes = Array.from({ length: 501 }, () => ({ nodeId: f.root.id, roleIds: [] }));
    expect((await req(app, 'PUT', `/api/workflows/${f.wf.id}/allowed-roles`, { json: { nodes } })).status).toBe(400);
  });

  it('PUT 400s a payload with too many roles on one node', async () => {
    const f = await fixture();
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    const roleIds = Array.from({ length: 101 }, () => f.operator.id);
    expect((await req(app, 'PUT', `/api/workflows/${f.wf.id}/allowed-roles`, {
      json: { nodes: [{ nodeId: f.root.id, roleIds }] },
    })).status).toBe(400);
  });

  it('PUT 400s a payload under both per-array caps but over the total pair cap', async () => {
    // 200 nodes x 60 roles = 12,000 pairs. Neither .max() fires; the total must.
    // Without the superRefine this is the case that reaches the insert and 500s.
    const f = await fixture();
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    const roleIds = Array.from({ length: 60 }, () => f.operator.id);
    const nodes = Array.from({ length: 200 }, () => ({ nodeId: f.root.id, roleIds }));
    expect((await req(app, 'PUT', `/api/workflows/${f.wf.id}/allowed-roles`, { json: { nodes } })).status).toBe(400);
  });

  it('PUT 404s when a node does not belong to this workflow', async () => {
    // The DaoError -> HTTP mapping is proven in errors.test.ts, but this route's own catch
    // had no cover in its own file. A node from ANOTHER workflow is the realistic trigger:
    // without it a steward could grant roles on another work center's entry.
    const f = await fixture();
    const other = await seedEntry('WC-Other', 'wf-2');
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    const res = await req(app, 'PUT', `/api/workflows/${f.wf.id}/allowed-roles`, {
      json: { nodes: [{ nodeId: other.root.id, roleIds: [] }] },
    });
    expect(res.status).toBe(404);
  });

  it('two work centers holding the same oid keep independent assignments under PUT', async () => {
    // The DAO proves this; the route must not reintroduce a work-center-scoped lookup on
    // top of it. Asserts BOTH directions so it cannot pass by returning empty for
    // everything — the failure mode that made three tests in the last milestone unable
    // to fail.
    const a = await seedEntry('WC-A', 'shared-oid');
    const b = await seedEntry('WC-B', 'shared-oid');
    const operator = await createRole(db, { name: 'Operator' });
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));

    await req(app, 'PUT', `/api/workflows/${a.wf.id}/allowed-roles`, {
      json: { nodes: [{ nodeId: a.root.id, roleIds: [operator.id] }] },
    });

    const viewB = await req(app, 'GET', `/api/workflows/${b.wf.id}/allowed-roles`);
    expect(((await viewB.json()) as View).nodes[0].roleIds).toEqual([]);
    const viewA = await req(app, 'GET', `/api/workflows/${a.wf.id}/allowed-roles`);
    expect(((await viewA.json()) as View).nodes[0].roleIds).toEqual([operator.id]);
  });
});
