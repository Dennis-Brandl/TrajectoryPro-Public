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
import { workflow, workflowInstance, workCenter } from 'mission-control-db/src/db/schema/index';
import { app } from '../app';

const NIL = '00000000-0000-0000-0000-000000000000';

// M6: a workflow is owned by exactly one work center, keyed (workCenterId, oid, version,
// state). There is no library and no link row, so every fixture starts from a work center.
async function seedWorkflowInWorkCenter(oid: string, wcName = `WC-${oid}`) {
  const wc = await createWorkCenter(db, { name: wcName });
  const [w] = await db.insert(workflow).values({
    oid, name: `WF-${oid}`, workCenterId: wc.id, version: '1.0.0', state: 'Effective', specJsonb: {},
  }).returning();
  return { workflowId: w.id, workCenterId: wc.id };
}

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); });

describe('workflow detail + delete routes', () => {
  it('GET /workflows/:id → 200 view for a reader; 404 for a missing id; 400 for a bad uuid', async () => {
    const { workflowId } = await seedWorkflowInWorkCenter('v-1');
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    const ok = await req(app, 'GET', `/api/workflows/${workflowId}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { workflow: { id: string } }).workflow.id).toBe(workflowId);
    expect((await req(app, 'GET', `/api/workflows/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
    expect((await req(app, 'GET', `/api/workflows/not-a-uuid`)).status).toBe(400);
  });

  it('GET /api/workflows/:id returns the singular owning work center', async () => {
    const { workflowId, workCenterId } = await seedWorkflowInWorkCenter('own-1');
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    const res = await req(app, 'GET', `/api/workflows/${workflowId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { workCenter: { id: string }; workCenters?: unknown };
    expect(body.workCenter.id).toBe(workCenterId);
    // The plural shape is gone — P1 changed hierarchies to singular ownership.
    expect(body.workCenters).toBeUndefined();
  });

  it('DELETE /workflows/:id → 204 unreferenced; 403 for a viewer; 409 while a runtime is unfinished, 204 once it has finished', async () => {
    const { workflowId, workCenterId } = await seedWorkflowInWorkCenter('d-1');
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    expect((await req(app, 'DELETE', `/api/workflows/${workflowId}`)).status).toBe(403);

    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    // M6: linking no longer exists, so the 409 comes from execution history instead —
    // deleteWorkflow refuses a workflow that still has runtime instances.
    await db.insert(workflowInstance).values({
      workflowId, workCenterId, triggeredBy: 'manual',
      specJsonb: {}, runtimeNumber: 1, runtimeLabel: 'RW-1', masterName: 'WF-d-1', masterOid: 'd-1', masterVersion: '1.0.0', masterState: 'Effective',
    });
    const blocked = await req(app, 'DELETE', `/api/workflows/${workflowId}`);
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe('conflict');

    // A finished runtime is information only (its record is in runtime_history): once the
    // pending one has finished, the delete goes through and takes the finished row with it.
    await db.update(workflowInstance).set({ status: 'completed' }).where(eq(workflowInstance.workflowId, workflowId));
    expect((await req(app, 'DELETE', `/api/workflows/${workflowId}`)).status).toBe(204);
    expect(await db.select().from(workflowInstance).where(eq(workflowInstance.workflowId, workflowId))).toHaveLength(0);

    const { workflowId: wf2 } = await seedWorkflowInWorkCenter('d-2');
    expect((await req(app, 'DELETE', `/api/workflows/${wf2}`)).status).toBe(204);
  });

  it('the retired import, link and move routes are gone', async () => {
    const { workflowId, workCenterId } = await seedWorkflowInWorkCenter('gone-1');
    mockSessionAs(await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' }));
    // PATCH re-filed a workflow into another library. Libraries are gone, and spec content
    // stays read-only (Designer's job), so nothing replaces it.
    expect((await req(app, 'PATCH', `/api/workflows/${workflowId}`)).status).toBe(404);
    // Linking is now implicit in loading (spec §6), so the explicit link/unlink verbs go.
    expect((await req(app, 'POST', `/api/workflows/${workflowId}/work-centers/${workCenterId}`)).status).toBe(404);
    expect((await req(app, 'DELETE', `/api/workflows/${workflowId}/work-centers/${workCenterId}`)).status).toBe(404);
    // The per-artifact import route is replaced by POST /api/work-centers/:id/load (Task 3).
    expect((await req(app, 'POST', '/api/workflows/import')).status).toBe(404);
  });

  it('GET /workflows/:id returns the view without the retired nodes/uiSteps arrays', async () => {
    // nodes/uiSteps lost their last consumer when the Nodes outline became the Diagram tab
    // (dao/hierarchies.ts). The type system alone can't guard this — WorkflowDetail.test.tsx's
    // fixture reached the mock through `as never`, which defeated excess-property checking —
    // so this has to be a runtime shape assertion against the live route.
    const { workflowId } = await seedWorkflowInWorkCenter('shape-1');
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    const res = await req(app, 'GET', `/api/workflows/${workflowId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('workflow');
    expect(body).toHaveProperty('workCenter');
    expect(body).toHaveProperty('environments');
    expect(body).not.toHaveProperty('nodes');
    expect(body).not.toHaveProperty('uiSteps');
  });

  it('GET /diagram returns the projected graph', async () => {
    const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'wf-d', name: 'Diagrammed', workCenterId: wc.id,
      specJsonb: {
        oid: 'root', local_id: 'Root', display_style: 'bpmn',
        steps: [{ oid: 's0', local_id: 'START', step_type: 'START', position: { x: 1, y: 2 } }],
        connections: [], children: [],
      },
    }).returning();
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V' }));

    const res = await req(app, 'GET', `/api/workflows/${wf.id}/diagram`);
    expect(res.status).toBe(200);
    const body = await res.json() as { workflowId: string; root: { notation: string; steps: unknown[] } };
    expect(body.workflowId).toBe(wf.id);
    expect(body.root.notation).toBe('bpmn');
    expect(body.root.steps).toHaveLength(1);
  });

  it('GET /diagram 404s for an unknown workflow', async () => {
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V' }));
    expect((await req(app, 'GET', `/api/workflows/${NIL}/diagram`)).status).toBe(404);
  });

  it('GET /diagram 400s on a non-uuid id', async () => {
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V' }));
    expect((await req(app, 'GET', '/api/workflows/nope/diagram')).status).toBe(400);
  });

  it('the workflow view does not ship the spec blob', async () => {
    const [wc] = await db.insert(workCenter).values({ name: 'WC2' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'wf-p', name: 'Plain', workCenterId: wc.id, specJsonb: { huge: 'blob' },
    }).returning();
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V' }));
    const body = await (await req(app, 'GET', `/api/workflows/${wf.id}`)).json() as { workflow: object };
    expect(body.workflow).not.toHaveProperty('specJsonb');
  });
});

// Phase 4a (spec 2026-08-03 §6): the dispatch policy's long-promised surfacing. Suggest-
// only — the engine records a preferred user on offers, but any eligible operator can claim.
// Gated on 'workflow:edit', not 'workflow:delete' — Step 1 found no 'workflow:update'/
// 'workflow:write' literal, but CATEGORY_VERBS (dao/access.ts) already generates
// 'workflow:edit' from the curated workflow verb set ['read','create','edit','delete'], and
// that IS "a workflow-write permission" per the brief's own first branch. It wins over the
// brief's DELETE-route fallback: editing a policy is an edit, not a delete.
describe('PATCH /workflows/:id/dispatch-policy', () => {
  it('204s and persists for manual, least_queued_steps, and null (inherit)', async () => {
    const { workflowId } = await seedWorkflowInWorkCenter('dp-1');
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));

    for (const policy of ['manual', 'least_queued_steps', null]) {
      const res = await req(app, 'PATCH', `/api/workflows/${workflowId}/dispatch-policy`, { json: { policy } });
      expect(res.status).toBe(204);
      const view = await (await req(app, 'GET', `/api/workflows/${workflowId}`)).json() as { workflow: { dispatchPolicy: string | null } };
      expect(view.workflow.dispatchPolicy).toBe(policy);
    }
  });

  it('400s for an unknown policy string (DaoError from assertDispatchPolicy)', async () => {
    const { workflowId } = await seedWorkflowInWorkCenter('dp-2');
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    const res = await req(app, 'PATCH', `/api/workflows/${workflowId}/dispatch-policy`, { json: { policy: 'sparkly' } });
    expect(res.status).toBe(400);
  });

  it('404s for a stale-but-well-formed uuid', async () => {
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    const res = await req(app, 'PATCH', `/api/workflows/${NIL}/dispatch-policy`, { json: { policy: 'manual' } });
    expect(res.status).toBe(404);
  });

  it('401s without a session; 403s for a viewer (missing workflow:edit)', async () => {
    const { workflowId } = await seedWorkflowInWorkCenter('dp-3');
    // beforeEach already left the session null.
    expect((await req(app, 'PATCH', `/api/workflows/${workflowId}/dispatch-policy`, { json: { policy: 'manual' } })).status).toBe(401);

    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    expect((await req(app, 'PATCH', `/api/workflows/${workflowId}/dispatch-policy`, { json: { policy: 'manual' } })).status).toBe(403);
  });

  it('400s when the body lacks `policy` entirely', async () => {
    const { workflowId } = await seedWorkflowInWorkCenter('dp-4');
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    const res = await req(app, 'PATCH', `/api/workflows/${workflowId}/dispatch-policy`, { json: {} });
    expect(res.status).toBe(400);
  });
});

// Auto-claim override (spec 2026-08-14 D4): same gating and shape as dispatch-policy above.
describe('PATCH /workflows/:id/auto-claim', () => {
  it('204s and persists for true, false, and null (inherit)', async () => {
    const { workflowId } = await seedWorkflowInWorkCenter('ac-1');
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));

    for (const value of [true, false, null]) {
      const res = await req(app, 'PATCH', `/api/workflows/${workflowId}/auto-claim`, { json: { value } });
      expect(res.status).toBe(204);
      const view = await (await req(app, 'GET', `/api/workflows/${workflowId}`)).json() as { workflow: { autoClaim: boolean | null } };
      expect(view.workflow.autoClaim).toBe(value);
    }
  });

  it('400s for a non-boolean value, a body without `value`, and a primitive JSON body', async () => {
    const { workflowId } = await seedWorkflowInWorkCenter('ac-2');
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    expect((await req(app, 'PATCH', `/api/workflows/${workflowId}/auto-claim`, { json: { value: 'yes' } })).status).toBe(400);
    expect((await req(app, 'PATCH', `/api/workflows/${workflowId}/auto-claim`, { json: {} })).status).toBe(400);
    // `true` is valid JSON: `'value' in true` would throw and 500 without the typeof guard.
    expect((await req(app, 'PATCH', `/api/workflows/${workflowId}/auto-claim`, { json: true })).status).toBe(400);
    expect((await req(app, 'PATCH', `/api/workflows/${workflowId}/dispatch-policy`, { json: true })).status).toBe(400);
  });

  it('404s for a stale uuid; 401 without session; 403 for a viewer', async () => {
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    expect((await req(app, 'PATCH', `/api/workflows/${NIL}/auto-claim`, { json: { value: true } })).status).toBe(404);

    const { workflowId } = await seedWorkflowInWorkCenter('ac-3');
    mockSessionAs(null);
    expect((await req(app, 'PATCH', `/api/workflows/${workflowId}/auto-claim`, { json: { value: true } })).status).toBe(401);
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    expect((await req(app, 'PATCH', `/api/workflows/${workflowId}/auto-claim`, { json: { value: true } })).status).toBe(403);
  });
});
