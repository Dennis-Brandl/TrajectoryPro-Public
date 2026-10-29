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
import { workCenter, workflow, workflowInstance } from 'mission-control-db/src/db/schema/index';
import { assignUserToWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { app } from '../app';

const NIL = '00000000-0000-0000-0000-000000000000';

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); });

describe('GET /runtime-workflows/:id/children', () => {
  it('lists the direct children to a viewer', async () => {
    const [wc] = await db.insert(workCenter).values({ name: `WC-${Math.random()}` }).returning();
    const [wf] = await db.insert(workflow).values({ oid: 'wf-1', name: 'WF', workCenterId: wc.id, specJsonb: {} }).returning();
    const base = { workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual' as const, status: 'running' as const,
      specJsonb: { oid: 's', steps: [], connections: [] }, masterName: 'Mix', masterOid: 'm-1', masterVersion: '1.2.0', masterState: 'Effective' };
    const [parent] = await db.insert(workflowInstance).values({ ...base, runtimeNumber: 1, runtimeLabel: 'RW-1' }).returning();
    const [child] = await db.insert(workflowInstance).values({
      ...base, runtimeNumber: 2, runtimeLabel: 'RW-2', createdByInstanceId: parent.id, createdAt: new Date('2026-10-01T10:00:00Z'),
    }).returning();
    const viewer = await seedUser(db, { email: `v-${Math.random()}@t.test`, displayName: 'Viewer' });
    await assignUserToWorkCenter(db, wc.id, viewer, {});
    mockSessionAs(viewer);

    const res = await req(app, 'GET', `/api/runtime-workflows/${parent.id}/children`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 1, items: [{
      runtimeLabel: 'RW-2', workCenterPath: wc.name, workflowName: 'Mix', workflowVersion: '1.2.0', workflowState: 'Effective',
      createdAt: '2026-10-01T10:00:00.000Z', state: 'running', open: { kind: 'live', id: child.id },
    }] });
  });

  it('401 without a session; 400 for a non-UUID id', async () => {
    expect((await req(app, 'GET', `/api/runtime-workflows/${NIL}/children`)).status).toBe(401);
    const viewer = await seedUser(db, { email: `v-${Math.random()}@t.test`, displayName: 'Viewer' });
    mockSessionAs(viewer);
    expect((await req(app, 'GET', '/api/runtime-workflows/not-a-uuid/children')).status).toBe(400);
  });
});
