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
import { db } from './db';
import { appUser } from 'mission-control-db/src/db/schema/index';
import { migrateTestDb, resetDb } from '../test/fixture';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
});

describe('server db handle', () => {
  it('runs migrations and starts empty', async () => {
    expect(await db.select().from(appUser)).toHaveLength(0);
  });

  it('round-trips an app_user with the new auth columns', async () => {
    const [u] = await db.insert(appUser).values({ email: 'd@x.io', displayName: 'D' }).returning();
    expect(u.emailVerified).toBe(false);
    const [again] = await db.select().from(appUser).where(eq(appUser.id, u.id));
    expect(again.email).toBe('d@x.io');
  });
});
