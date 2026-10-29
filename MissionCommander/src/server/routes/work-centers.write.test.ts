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
import { db } from '../lib/db';
import { migrateTestDb, resetDb } from '../test/fixture';
import { mockSessionAs, seedUser, req } from '../test/harness';
import { createWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { workCenter, workflow, environmentSpec, workflowInstance } from 'mission-control-db/src/db/schema/index';
import { app } from '../app';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
  mockSessionAs(null);
});

async function as(level: 'viewer' | 'steward' | 'administrator') {
  mockSessionAs(await seedUser(db, { email: `${level}@x.io`, displayName: level, accessLevel: level }));
}

describe('work-center writes', () => {
  it('viewer create → 403', async () => {
    await as('viewer');
    expect((await req(app, 'POST', '/api/work-centers', { json: { name: 'X' } })).status).toBe(403);
  });

  it('steward creates a root → 201 with the view', async () => {
    await as('steward');
    const res = await req(app, 'POST', '/api/work-centers', { json: { name: 'Ops' } });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { workCenter: { name: string } }).workCenter.name).toBe('Ops');
  });

  it('duplicate sibling name → 409', async () => {
    await createWorkCenter(db, { name: 'Dup' });
    await as('steward');
    expect((await req(app, 'POST', '/api/work-centers', { json: { name: 'Dup' } })).status).toBe(409);
  });

  it('PATCH renames; delete-with-children → 409; delete leaf → 204', async () => {
    const root = await createWorkCenter(db, { name: 'Root' });
    const child = await createWorkCenter(db, { name: 'Child', parentWorkCenterId: root.id });
    await as('administrator');

    const patched = await req(app, 'PATCH', `/api/work-centers/${child.id}`, { json: { name: 'Renamed' } });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { workCenter: { name: string } }).workCenter.name).toBe('Renamed');

    expect((await req(app, 'DELETE', `/api/work-centers/${root.id}`)).status).toBe(409); // has a child
    expect((await req(app, 'DELETE', `/api/work-centers/${child.id}`)).status).toBe(204);
  });

  it('reparent cycle → 409', async () => {
    const root = await createWorkCenter(db, { name: 'A' });
    const child = await createWorkCenter(db, { name: 'B', parentWorkCenterId: root.id });
    await as('administrator');
    const res = await req(app, 'PATCH', `/api/work-centers/${root.id}`, { json: { parentWorkCenterId: child.id } });
    expect(res.status).toBe(409);
  });

  it('autoClaim: POST accepts a boolean, PATCH rejects a non-boolean with 400', async () => {
    await as('administrator');
    const created = await req(app, 'POST', '/api/work-centers', { json: { name: 'AC', autoClaim: true } });
    expect(created.status).toBe(201);
    const view = (await created.json()) as { workCenter: { id: string; autoClaim: boolean } };
    expect(view.workCenter.autoClaim).toBe(true);

    const bad = await req(app, 'PATCH', `/api/work-centers/${view.workCenter.id}`, { json: { autoClaim: 'yes' } });
    expect(bad.status).toBe(400);

    const off = await req(app, 'PATCH', `/api/work-centers/${view.workCenter.id}`, { json: { autoClaim: false } });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { workCenter: { autoClaim: boolean } }).workCenter.autoClaim).toBe(false);
  });

  it('DELETE :id 400s for a malformed uuid', async () => {
    await as('administrator');
    const res = await req(app, 'DELETE', '/api/work-centers/not-a-uuid');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation');
  });
});

// Spec 2026-10-07 §5: the runtime workflow ID template, set through the DAO field whitelisted
// and validated on the route (two sites, two statuses — 422 here, 400 from the DAO as
// defence in depth for non-route callers; see dao/work-centers.ts's normaliseTemplate).
describe('work-center runtimeIdTemplate', () => {
  it('rejects an invalid runtimeIdTemplate with 422 and names the rule', async () => {
    await as('steward');
    const res = await req(app, 'POST', '/api/work-centers', { json: { name: 'WC-1', runtimeIdTemplate: 'NO-SEQ' } });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('{SEQ}');
  });

  it('rejects a non-string runtimeIdTemplate rather than casting it through', async () => {
    await as('steward');
    const res = await req(app, 'POST', '/api/work-centers',
      { json: { name: 'WC-2', runtimeIdTemplate: { evil: true } } });
    expect(res.status).toBe(400);
  });

  it('accepts and round-trips a valid template', async () => {
    await as('steward');
    const res = await req(app, 'POST', '/api/work-centers',
      { json: { name: 'WC-3', runtimeIdTemplate: 'MIX-{YYYY}{MM}{DD}-{SEQ:3}' } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { workCenter: { runtimeIdTemplate: string | null } };
    expect(body.workCenter.runtimeIdTemplate).toBe('MIX-{YYYY}{MM}{DD}-{SEQ:3}');
  });

  it('PATCH 422s an invalid template against the CURRENT name when the body omits one, and blank normalises to null', async () => {
    await as('steward');
    const created = await req(app, 'POST', '/api/work-centers', { json: { name: 'WC-4', runtimeIdTemplate: 'RW-{SEQ}' } });
    const view = (await created.json()) as { workCenter: { id: string } };

    const bad = await req(app, 'PATCH', `/api/work-centers/${view.workCenter.id}`, { json: { runtimeIdTemplate: 'NO-SEQ' } });
    expect(bad.status).toBe(422);

    const blanked = await req(app, 'PATCH', `/api/work-centers/${view.workCenter.id}`, { json: { runtimeIdTemplate: '   ' } });
    expect(blanked.status).toBe(200);
    const blankedBody = (await blanked.json()) as { workCenter: { runtimeIdTemplate: string | null } };
    expect(blankedBody.workCenter.runtimeIdTemplate).toBeNull();
  });
});

// M6 spec §8.1: destroying a work center destroys every artifact loaded into it AND all of
// its execution history, so the first DELETE never destroys anything — it reports what the
// second one would.
describe('two-call work-center delete', () => {
  async function populated() {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    const [wf] = await db.insert(workflow).values({
      oid: 'wf-1', name: 'Bottle Fill', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await db.insert(environmentSpec).values({
      oid: 'env-1', name: 'Line Env', workCenterId: wc.id, specJsonb: {},
    });
    await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual',
      specJsonb: {}, runtimeNumber: 1, runtimeLabel: 'RW-1', masterName: 'Bottle Fill', masterOid: 'wf-1', masterVersion: '1.0.0', masterState: 'Draft',
    });
    return wc;
  }

  it('deletes an empty work center without confirmation', async () => {
    const wc = await createWorkCenter(db, { name: 'Empty' });
    await as('administrator');
    expect((await req(app, 'DELETE', `/api/work-centers/${wc.id}`)).status).toBe(204);
    expect(await db.select().from(workCenter)).toHaveLength(0);
  });

  it('refuses a populated work center with 409 and an impact summary, destroying nothing', async () => {
    const wc = await populated();
    await as('administrator');

    const res = await req(app, 'DELETE', `/api/work-centers/${wc.id}`);
    expect(res.status).toBe(409);
    const body = await res.json() as {
      error: { code: string; impact: { workflows: number; environments: number; instances: number; hasChildren: boolean } };
    };
    expect(body.error.code).toBe('conflict');
    expect(body.error.impact).toMatchObject({ workflows: 1, environments: 1, instances: 1, hasChildren: false });

    // Nothing destroyed — the preflight is a report, not a partial teardown.
    expect(await db.select().from(workCenter)).toHaveLength(1);
    expect(await db.select().from(workflow)).toHaveLength(1);
    expect(await db.select().from(workflowInstance)).toHaveLength(1);
  });

  it('deletes it with ?confirm=true, removing artifacts and history', async () => {
    const wc = await populated();
    await as('administrator');
    expect((await req(app, 'DELETE', `/api/work-centers/${wc.id}?confirm=true`)).status).toBe(204);
    expect(await db.select().from(workCenter)).toHaveLength(0);
    expect(await db.select().from(workflow)).toHaveLength(0);
    expect(await db.select().from(environmentSpec)).toHaveLength(0);
    expect(await db.select().from(workflowInstance)).toHaveLength(0);
  });

  it('still refuses a work center with children even when confirmed', async () => {
    const parent = await createWorkCenter(db, { name: 'Parent' });
    await createWorkCenter(db, { name: 'Child', parentWorkCenterId: parent.id });
    await as('administrator');

    // Children block regardless (spec §8.3) — subtrees come apart bottom-up, so no
    // confirmation can override this one.
    const res = await req(app, 'DELETE', `/api/work-centers/${parent.id}?confirm=true`);
    expect(res.status).toBe(409);
    expect(await db.select().from(workCenter)).toHaveLength(2);
  });

  it('treats any confirm value other than "true" as unconfirmed', async () => {
    const wc = await populated();
    await as('administrator');
    // Guards against a truthiness bug making `?confirm=false` destroy the work center.
    expect((await req(app, 'DELETE', `/api/work-centers/${wc.id}?confirm=false`)).status).toBe(409);
    expect((await req(app, 'DELETE', `/api/work-centers/${wc.id}?confirm=1`)).status).toBe(409);
    expect(await db.select().from(workCenter)).toHaveLength(1);
  });

  it('requires work_center:delete — a viewer is refused before any preflight runs', async () => {
    const wc = await populated();
    await as('viewer');
    expect((await req(app, 'DELETE', `/api/work-centers/${wc.id}?confirm=true`)).status).toBe(403);
    expect(await db.select().from(workCenter)).toHaveLength(1);
  });

  // Mission Engine (phase 3): an active runtime workflow blocks the delete unconditionally —
  // even ?confirm=true, and even though the DAO throws this DaoError BEFORE computing the
  // impact summary, so the response carries no `impact` field. Before errors.ts mapped this
  // code, the unmapped-code default silently answered 400 (bad_request) instead of 409
  // (conflict) for a request that was never malformed.
  it('refuses to delete a work center with an active runtime workflow, confirmed or not', async () => {
    const wc = await populated();
    const [wf] = await db.select().from(workflow).where(eq(workflow.workCenterId, wc.id));
    await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running',
      specJsonb: {}, runtimeNumber: 2, runtimeLabel: 'RW-2', masterName: 'Bottle Fill', masterOid: 'wf-1', masterVersion: '1.0.0', masterState: 'Draft',
    });
    await as('administrator');

    const unconfirmed = await req(app, 'DELETE', `/api/work-centers/${wc.id}`);
    expect(unconfirmed.status).toBe(409);
    expect(((await unconfirmed.json()) as { error: { code: string } }).error.code).toBe('conflict');

    const confirmed = await req(app, 'DELETE', `/api/work-centers/${wc.id}?confirm=true`);
    expect(confirmed.status).toBe(409);
    expect(((await confirmed.json()) as { error: { code: string } }).error.code).toBe('conflict');

    // Nothing destroyed by either attempt.
    expect(await db.select().from(workCenter)).toHaveLength(1);
  });
});

// M6 retired ARTIFACT linking (loading is the linking step now), but user assignment
// survived — spec §9 keeps WorkCenterDetail's Users tab. P2 deleted routes/links.ts
// wholesale, which took these two routes with it; they are restored on the work center,
// which is what they were always scoped to.
describe('work-center user assignment', () => {
  it('assigns a user and returns the refreshed view', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    const target = await seedUser(db, { email: 'op@x.io', displayName: 'Op' });
    await as('administrator');

    const res = await req(app, 'POST', `/api/work-centers/${wc.id}/users/${target}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { users: { id: string }[] };
    expect(body.users.map((u) => u.id)).toContain(target);
  });

  it('unassigns and is idempotent', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    const target = await seedUser(db, { email: 'op@x.io', displayName: 'Op' });
    await as('administrator');
    await req(app, 'POST', `/api/work-centers/${wc.id}/users/${target}`);

    expect((await req(app, 'DELETE', `/api/work-centers/${wc.id}/users/${target}`)).status).toBe(204);
    // A second delete must not 404 — the dialog fires it optimistically.
    expect((await req(app, 'DELETE', `/api/work-centers/${wc.id}/users/${target}`)).status).toBe(204);
  });

  it('404s an unknown user, 400s a malformed one, 403s a viewer', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    const target = await seedUser(db, { email: 'op@x.io', displayName: 'Op' });
    const NIL = '00000000-0000-0000-0000-000000000000';

    await as('administrator');
    // LINK_TARGET_NOT_FOUND (23503 on the FK) maps to 404, not a raw 500.
    expect((await req(app, 'POST', `/api/work-centers/${wc.id}/users/${NIL}`)).status).toBe(404);
    // The '/work-centers/*' mount only guards :id's shape; :userId needs its own guard.
    expect((await req(app, 'POST', `/api/work-centers/${wc.id}/users/not-a-uuid`)).status).toBe(400);

    await as('viewer');
    expect((await req(app, 'POST', `/api/work-centers/${wc.id}/users/${target}`)).status).toBe(403);
  });

  it('rejects a non-numeric priority with 400', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    const target = await seedUser(db, { email: 'op@x.io', displayName: 'Op' });
    await as('administrator');
    const res = await req(app, 'POST', `/api/work-centers/${wc.id}/users/${target}`,
      { json: { priority: 'high' } });
    expect(res.status).toBe(400);
  });

  it('assigns with missionSystemCommander: true and the view reflects the flag', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    const target = await seedUser(db, { email: 'op@x.io', displayName: 'Op' });
    await as('administrator');
    const res = await req(app, 'POST', `/api/work-centers/${wc.id}/users/${target}`,
      { json: { missionSystemCommander: true } });
    expect(res.status).toBe(200);
    const body = await res.json() as { users: { id: string; missionSystemCommander: boolean }[] };
    expect(body.users.find((u) => u.id === target)?.missionSystemCommander).toBe(true);
  });

  it('rejects a non-boolean missionSystemCommander with 400', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    const target = await seedUser(db, { email: 'op@x.io', displayName: 'Op' });
    await as('administrator');
    const res = await req(app, 'POST', `/api/work-centers/${wc.id}/users/${target}`,
      { json: { missionSystemCommander: 'yes' } });
    expect(res.status).toBe(400);
  });
});

describe('work-center typeName', () => {
  const message = async (res: Response) => ((await res.json()) as { error: { message: string } }).error.message;

  it('POST trims and stores typeName; GET nodes carry it', async () => {
    await as('steward');
    const res = await req(app, 'POST', '/api/work-centers', { json: { name: 'L1', typeName: ' Production Line ' } });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { workCenter: { typeName: string | null } }).workCenter.typeName).toBe('Production Line');
    const list = await req(app, 'GET', '/api/work-centers');
    const nodes = ((await list.json()) as { nodes: { name: string; typeName: string | null }[] }).nodes;
    expect(nodes.find((n) => n.name === 'L1')?.typeName).toBe('Production Line');
  });

  it('PATCH rejects a non-string typeName with 400', async () => {
    const wc = await createWorkCenter(db, { name: 'L1' });
    await as('steward');
    const res = await req(app, 'PATCH', `/api/work-centers/${wc.id}`, { json: { typeName: 42 } });
    expect(res.status).toBe(400);
    expect(await message(res)).toBe('typeName must be a string or null');
  });

  it('PATCH rejects a 51-char typeName and leaves the row unchanged', async () => {
    const wc = await createWorkCenter(db, { name: 'L1', typeName: 'Site' });
    await as('steward');
    const res = await req(app, 'PATCH', `/api/work-centers/${wc.id}`, { json: { typeName: 'x'.repeat(51) } });
    expect(res.status).toBe(400);
    expect(await message(res)).toBe('Type must be 50 characters or fewer.');
    const [row] = await db.select().from(workCenter).where(eq(workCenter.id, wc.id));
    expect(row.typeName).toBe('Site');
  });

  it('PATCH blank clears; unrelated PATCH keeps the type', async () => {
    const wc = await createWorkCenter(db, { name: 'L1', typeName: 'Site' });
    await as('steward');
    const keep = await req(app, 'PATCH', `/api/work-centers/${wc.id}`, { json: { description: 'x' } });
    expect(((await keep.json()) as { workCenter: { typeName: string | null } }).workCenter.typeName).toBe('Site');
    const clear = await req(app, 'PATCH', `/api/work-centers/${wc.id}`, { json: { typeName: '   ' } });
    expect(clear.status).toBe(200);
    expect(((await clear.json()) as { workCenter: { typeName: string | null } }).workCenter.typeName).toBeNull();
  });
});

describe('a JSON null body', () => {
  it('POST /api/work-centers with body null is a 400 bad_request, not a 500', async () => {
    await as('steward');
    const res = await req(app, 'POST', '/api/work-centers', { json: null });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_request');
  });
});
