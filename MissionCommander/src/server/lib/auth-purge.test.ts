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
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { db } from './db';
import { appUser, session, verification } from 'mission-control-db/src/db/schema/index';
import { migrateTestDb, resetDb } from '../test/fixture';
import { purgeExpiredAuthRows, startAuthPurge } from './auth-purge';

const HOUR = 3_600_000;

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
  const now = Date.now();
  const [u] = await db
    .insert(appUser)
    .values({ email: 'purge@x.io', displayName: 'Purge' })
    .returning({ id: appUser.id });
  await db.insert(session).values([
    { userId: u.id, token: 'old', expiresAt: new Date(now - HOUR) },
    { userId: u.id, token: 'new', expiresAt: new Date(now + HOUR) },
  ]);
  await db.insert(verification).values([
    { identifier: 'a', value: 'old', expiresAt: new Date(now - HOUR) },
    { identifier: 'b', value: 'new', expiresAt: new Date(now + HOUR) },
  ]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('purgeExpiredAuthRows', () => {
  it('deletes only expired sessions and verifications', async () => {
    expect(await purgeExpiredAuthRows(db, new Date())).toEqual({ sessions: 1, verifications: 1 });
    const s = await db.select().from(session);
    const v = await db.select().from(verification);
    expect(s.map((r) => r.token)).toEqual(['new']);
    expect(v.map((r) => r.value)).toEqual(['new']);
  });

  it('second run deletes nothing', async () => {
    await purgeExpiredAuthRows(db, new Date());
    expect(await purgeExpiredAuthRows(db, new Date())).toEqual({ sessions: 0, verifications: 0 });
  });
});

describe('startAuthPurge', () => {
  it('logs and survives a failing run', async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = {
      delete: () => {
        throw new Error('db down');
      },
    } as unknown as Parameters<typeof startAuthPurge>[0];
    startAuthPurge(failing);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(err).toHaveBeenCalledWith('[auth-purge] failed:', expect.any(Error));
    expect(err).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(err).toHaveBeenCalledTimes(2);
  });
});
