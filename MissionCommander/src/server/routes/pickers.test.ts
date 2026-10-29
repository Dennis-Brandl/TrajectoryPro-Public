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
import { workflow, environmentSpec } from 'mission-control-db/src/db/schema/index';
import { createWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { app } from '../app';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
  mockSessionAs(null);
});

describe('picker lists', () => {
  it('401 unauthenticated', async () => {
    expect((await req(app, 'GET', '/api/workflows')).status).toBe(401);
  });

  it('workflows and environments come back as work-center-ordered summaries for a viewer', async () => {
    // M6: the grouping container is the WORK CENTER, not a library. The ordering intent is
    // unchanged — container first, then name — so the fixture still proves that container
    // order beats name order, which a same-container fixture could never show.
    const wcA = await createWorkCenter(db, { name: 'WcA' });
    const wcB = await createWorkCenter(db, { name: 'WcB' });
    await db.insert(workflow).values([
      // name-only order would be Alpha, Zeta — work-center order (WcA < WcB) puts Zeta first.
      { oid: 'o-b', name: 'Zeta', workCenterId: wcA.id, version: '1', state: 'effective', specJsonb: {} },
      { oid: 'o-a', name: 'Alpha', workCenterId: wcB.id, version: '1', state: 'effective', specJsonb: {} },
    ]);
    await db.insert(environmentSpec).values([
      // name-only order would be Mike, Zulu — work-center order (WcA < WcB) puts Zulu first.
      { oid: 'e-z', name: 'Zulu', workCenterId: wcA.id, version: '1', state: 'effective', specJsonb: {} },
      { oid: 'e-m', name: 'Mike', workCenterId: wcB.id, version: '1', state: 'effective', specJsonb: {} },
    ]);
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));

    const wf = (await (await req(app, 'GET', '/api/workflows')).json()) as {
      workflows: { name: string; workCenterName: string }[];
    };
    expect(wf.workflows.map((w) => w.name)).toEqual(['Zeta', 'Alpha']);
    expect(wf.workflows.map((w) => w.workCenterName)).toEqual(['WcA', 'WcB']);
    expect(wf.workflows[0]).not.toHaveProperty('specJsonb');

    const env = (await (await req(app, 'GET', '/api/environments')).json()) as {
      environments: { name: string; workCenterName: string }[];
    };
    expect(env.environments.map((e) => e.name)).toEqual(['Zulu', 'Mike']);
    expect(env.environments.map((e) => e.workCenterName)).toEqual(['WcA', 'WcB']);
    expect(env.environments[0]).not.toHaveProperty('specJsonb');
  });

  it('GET /api/users lists users name-sorted', async () => {
    await seedUser(db, { email: 'z@x.io', displayName: 'Zed' });
    const meId = await seedUser(db, { email: 'a@x.io', displayName: 'Abe', accessLevel: 'viewer' });
    mockSessionAs(meId);
    const body = (await (await req(app, 'GET', '/api/users')).json()) as { users: { displayName: string }[] };
    expect(body.users.map((u) => u.displayName)).toEqual(['Abe', 'Zed']);
  });
});
