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
import { Hono, type Context } from 'hono';
import { db } from '../lib/db';
import { migrateTestDb, resetDb } from '../test/fixture';
import { mockSessionAs, seedUser, req } from '../test/harness';
import { requireSession, requireMissionSystemCommander, type Vars } from '../middleware/auth';
import { createWorkCenter, assignUserToWorkCenter } from 'mission-control-db/src/dao/work-centers';

function guardedApp(resolveWorkCenterId: (c: Context<{ Variables: Vars }>) => Promise<string | null>) {
  const app = new Hono<{ Variables: Vars }>();
  app.use('/api/*', requireSession);
  app.get('/api/commander-only', requireMissionSystemCommander(resolveWorkCenterId), (c) => c.json({ ok: true }));
  return app;
}

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
  mockSessionAs(null);
});

describe('requireMissionSystemCommander', () => {
  it('401 without a session', async () => {
    const wc = await createWorkCenter(db, { name: 'WC' });
    const app = guardedApp(async () => wc.id);
    expect((await req(app, 'GET', '/api/commander-only')).status).toBe(401);
  });

  it('403 for a viewer assigned to the work center but not flagged commander', async () => {
    const wc = await createWorkCenter(db, { name: 'WC' });
    const viewer = await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' });
    await assignUserToWorkCenter(db, wc.id, viewer);
    mockSessionAs(viewer);
    const app = guardedApp(async () => wc.id);
    expect((await req(app, 'GET', '/api/commander-only')).status).toBe(403);
  });

  it('200 for a viewer flagged Mission System Commander on the work center', async () => {
    const wc = await createWorkCenter(db, { name: 'WC' });
    const commander = await seedUser(db, { email: 'c@x.io', displayName: 'C', accessLevel: 'viewer' });
    await assignUserToWorkCenter(db, wc.id, commander, { missionSystemCommander: true });
    mockSessionAs(commander);
    const app = guardedApp(async () => wc.id);
    expect((await req(app, 'GET', '/api/commander-only')).status).toBe(200);
  });

  it('200 for an administrator, even when not assigned to the work center at all', async () => {
    const wc = await createWorkCenter(db, { name: 'WC' });
    const admin = await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    mockSessionAs(admin);
    const app = guardedApp(async () => wc.id);
    expect((await req(app, 'GET', '/api/commander-only')).status).toBe(200);
  });

  it('404 when the resolver finds no subject', async () => {
    const viewer = await seedUser(db, { email: 'v2@x.io', displayName: 'V2', accessLevel: 'viewer' });
    mockSessionAs(viewer);
    const app = guardedApp(async () => null);
    expect((await req(app, 'GET', '/api/commander-only')).status).toBe(404);
  });
});
