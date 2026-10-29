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
import { createWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { wcResource, wcValueProperty } from 'mission-control-db/src/db/schema/index';
import { app } from '../app';

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); });

describe('work-center shared-state reads', () => {
  it('GET /work-centers/:id/resources and /value-properties → every registry row, orphans included', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    // No declaring spec at all: an orphan, which only this backstop view can show (spec §6.4).
    await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Orphan', resourceType: 'named pool', poolNames: ['A'], availableNames: ['A'], definedFromName: 'Gone' });
    await db.insert(wcValueProperty).values({ workCenterId: wc.id, propertyName: 'Env', entryName: 'Temp', value: '70' });
    expect((await req(app, 'GET', `/api/work-centers/${wc.id}/resources`)).status).toBe(401);
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));

    const r = await req(app, 'GET', `/api/work-centers/${wc.id}/resources`);
    expect(r.status).toBe(200);
    const rb = (await r.json()) as { resources: { name: string; orphaned: boolean; summary: { state: string } }[] };
    expect(rb.resources).toMatchObject([{ name: 'Orphan', orphaned: true, summary: { state: '1 available, 0 in use' } }]);

    const v = await req(app, 'GET', `/api/work-centers/${wc.id}/value-properties`);
    expect(v.status).toBe(200);
    expect((await v.json()) as unknown).toMatchObject({ values: [{ propertyName: 'Env', entryName: 'Temp', value: '70', orphaned: true }] });
  });

  it('404 for a missing work center; 400 for a malformed uuid', async () => {
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    for (const tail of ['resources', 'value-properties']) {
      expect((await req(app, 'GET', `/api/work-centers/00000000-0000-0000-0000-000000000000/${tail}`)).status).toBe(404);
      expect((await req(app, 'GET', `/api/work-centers/not-a-uuid/${tail}`)).status).toBe(400);
    }
  });
});
