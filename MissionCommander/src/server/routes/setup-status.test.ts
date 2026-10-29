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
import { appUser } from 'mission-control-db/src/db/schema/index';
import { migrateTestDb, resetDb } from '../test/fixture';
import { app } from '../app';

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); });

describe('GET /api/setup-status', () => {
  it('setupComplete=false when no administrator exists', async () => {
    const res = await app.request('/api/setup-status');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ setupComplete: false });
  });
  it('setupComplete=true once an administrator exists', async () => {
    await db.insert(appUser).values({ email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
    expect(await (await app.request('/api/setup-status')).json()).toEqual({ setupComplete: true });
  });
});
