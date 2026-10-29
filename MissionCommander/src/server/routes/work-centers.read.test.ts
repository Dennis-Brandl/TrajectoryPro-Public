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
import { app } from '../app';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
  mockSessionAs(null);
});

describe('work-center reads', () => {
  it('401 unauthenticated; 200 for a viewer', async () => {
    expect((await req(app, 'GET', '/api/work-centers')).status).toBe(401);
    const id = await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' });
    mockSessionAs(id);
    expect((await req(app, 'GET', '/api/work-centers')).status).toBe(200);
  });

  it('returns the flattened forest', async () => {
    const root = await createWorkCenter(db, { name: 'Root' });
    await createWorkCenter(db, { name: 'Child', parentWorkCenterId: root.id });
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V' }));
    const body = (await (await req(app, 'GET', '/api/work-centers')).json()) as {
      nodes: { id: string; name: string; parentWorkCenterId: string | null }[];
    };
    expect(body.nodes.map((n) => n.name).sort()).toEqual(['Child', 'Root']);
    expect(body.nodes.find((n) => n.name === 'Child')?.parentWorkCenterId).toBe(root.id);
  });

  it('GET :id returns the view; 404 for unknown', async () => {
    const root = await createWorkCenter(db, { name: 'Solo' });
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V' }));
    const ok = await req(app, 'GET', `/api/work-centers/${root.id}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { workCenter: { name: string } }).workCenter.name).toBe('Solo');
    const miss = await req(app, 'GET', '/api/work-centers/00000000-0000-0000-0000-000000000000');
    expect(miss.status).toBe(404);
  });

  it('GET :id 400s for a malformed uuid', async () => {
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V' }));
    const res = await req(app, 'GET', '/api/work-centers/not-a-uuid');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation');
  });
});
