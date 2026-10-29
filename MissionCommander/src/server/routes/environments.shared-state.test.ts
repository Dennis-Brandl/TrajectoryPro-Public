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
import { environmentSpec, wcResource, wcValueProperty } from 'mission-control-db/src/db/schema/index';
import { app } from '../app';

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); });

// Phase 3 (spec §6.2): integration tests against PGlite through the real DAO — the registry
// rows are seeded directly, the way a load would have materialized them.
async function seedEnvironment() {
  const wc = await createWorkCenter(db, { name: 'Line 1' });
  const [env] = await db.insert(environmentSpec).values({
    oid: 'env-1', name: 'Kitchen', workCenterId: wc.id, version: '1.0.0', state: 'Effective',
    specJsonb: {
      resource_property_specifications: [
        { name: 'Printer', resource_type: 'binary exclusive use' },
        { name: 'Ghost', resource_type: 'sync' },
      ],
      value_property_specifications: [{ name: 'Batch', entries: [{ name: 'Size', value: '5' }, { name: 'Missing', value: '' }] }],
    },
  }).returning();
  await db.insert(wcResource).values([
    { workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use', inUse: 1, definedByEnvSpecId: env.id, definedFromName: 'Kitchen', definedFromVersion: '1.0.0', definedFromState: 'Effective' },
    { workCenterId: wc.id, name: 'Extra', resourceType: 'sync', definedByEnvSpecId: env.id },
  ]);
  await db.insert(wcValueProperty).values({ workCenterId: wc.id, propertyName: 'Batch', entryName: 'Size', value: '5', definedByEnvSpecId: env.id });
  return { wc, env };
}

describe('environment shared-state reads', () => {
  it('GET /environments/:id/resources → 401 unauthenticated; 200 for a viewer, filtered to the declared names', async () => {
    const { env } = await seedEnvironment();
    expect((await req(app, 'GET', `/api/environments/${env.id}/resources`)).status).toBe(401);
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    const res = await req(app, 'GET', `/api/environments/${env.id}/resources`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resources: { name: string; summary: { state: string }; definedBy: { name: string }; updatedAt: string }[]; unregistered: string[] };
    expect(body.resources.map((r) => r.name)).toEqual(['Printer']); // 'Extra' is in the registry but not declared here
    expect(body.resources[0].summary.state).toBe('In use');
    expect(body.resources[0].definedBy.name).toBe('Kitchen');
    expect(typeof body.resources[0].updatedAt).toBe('string'); // Dates serialize to ISO strings on the wire
    expect(body.unregistered).toEqual(['Ghost']);
  });

  it('GET /environments/:id/value-properties → 200 with the declared property and the unregistered pairs', async () => {
    const { env } = await seedEnvironment();
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    const res = await req(app, 'GET', `/api/environments/${env.id}/value-properties`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { values: { entryName: string; value: string }[]; unregistered: { propertyName: string; entryName: string }[] };
    expect(body.values).toMatchObject([{ entryName: 'Size', value: '5' }]);
    expect(body.unregistered).toEqual([{ propertyName: 'Batch', entryName: 'Missing' }]);
  });

  it('404 for a missing id; 400 for a malformed uuid', async () => {
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    for (const tail of ['resources', 'value-properties']) {
      expect((await req(app, 'GET', `/api/environments/00000000-0000-0000-0000-000000000000/${tail}`)).status).toBe(404);
      expect((await req(app, 'GET', `/api/environments/not-a-uuid/${tail}`)).status).toBe(400);
    }
  });
});
