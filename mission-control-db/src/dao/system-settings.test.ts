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
import { describe, it, expect, vi } from 'vitest';
import { getActionMatchingMode, setActionMatchingMode } from './system-settings';
import { systemSettings } from '../db/schema/index.js';
import { makeTestDb } from '../../test/helpers/db.js';

describe('action matching mode DAO', () => {
  it('defaults to loose when no row exists', async () => {
    const { db, close } = await makeTestDb();
    expect(await getActionMatchingMode(db)).toBe('loose');
    await close();
  });
  it('round-trips strict and back to loose', async () => {
    const { db, close } = await makeTestDb();
    await setActionMatchingMode(db, 'strict');
    expect(await getActionMatchingMode(db)).toBe('strict');
    await setActionMatchingMode(db, 'loose');
    expect(await getActionMatchingMode(db)).toBe('loose');
    await close();
  });
  it('reads an unrecognized stored value as loose (defensive)', async () => {
    const { db, close } = await makeTestDb();
    await db.insert(systemSettings).values({ key: 'action_matching', value: 'bogus' });
    expect(await getActionMatchingMode(db)).toBe('loose');
    await close();
  });
});

import {
  getActionServerPolicy, setActionServerTrust, setActionServerAllowlist,
  seedActionServerAllowlistIfAbsent, normalizeActionServerOrigin,
} from './system-settings';

describe('action-server policy DAO (spec 2026-09-05)', () => {
  it('defaults to strict with an empty allowlist when no rows exist', async () => {
    const { db, close } = await makeTestDb();
    expect(await getActionServerPolicy(db)).toEqual({ trust: 'strict', allowlist: [] });
    await close();
  });
  it('round-trips trust and the allowlist (normalised, deduped, order kept)', async () => {
    const { db, close } = await makeTestDb();
    await setActionServerTrust(db, 'loose');
    await setActionServerAllowlist(db, ['http://mission-autopilot-server:3002', 'http://b:1', 'http://mission-autopilot-server:3002']);
    expect(await getActionServerPolicy(db)).toEqual({ trust: 'loose', allowlist: ['http://mission-autopilot-server:3002', 'http://b:1'] });
    await setActionServerTrust(db, 'strict');
    expect((await getActionServerPolicy(db)).trust).toBe('strict');
    await close();
  });
  it('reads an unrecognized trust value as strict and an unparseable list as empty (fail closed)', async () => {
    const { db, close } = await makeTestDb();
    await db.insert(systemSettings).values([
      { key: 'action_server_trust', value: 'bogus' },
      { key: 'action_server_allowlist', value: 'not json' },
    ]);
    expect(await getActionServerPolicy(db)).toEqual({ trust: 'strict', allowlist: [] });
    await close();
  });
  it('seeds the allowlist only when the row is absent', async () => {
    const { db, close } = await makeTestDb();
    expect(await seedActionServerAllowlistIfAbsent(db, ['http://seed:3002'])).toBe(true);
    expect(await seedActionServerAllowlistIfAbsent(db, ['http://other:1'])).toBe(false);
    expect((await getActionServerPolicy(db)).allowlist).toEqual(['http://seed:3002']);
    await close();
  });
  it('an empty seed list writes nothing', async () => {
    const { db, close } = await makeTestDb();
    expect(await seedActionServerAllowlistIfAbsent(db, [])).toBe(false);
    expect(await seedActionServerAllowlistIfAbsent(db, ['http://seed:3002'])).toBe(true);
    await close();
  });
  it('seeds normalised origins and drops invalid entries with a warning', async () => {
    const { db, close } = await makeTestDb();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await seedActionServerAllowlistIfAbsent(db, ['http://Seed:3002/', 'ftp://nope', 'http://seed:3002'])).toBe(true);
      expect((await getActionServerPolicy(db)).allowlist).toEqual(['http://seed:3002']);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('ftp://nope');
    } finally {
      warn.mockRestore();
      await close();
    }
  });
  it("an admin-emptied list ('[]' row) is never re-seeded", async () => {
    const { db, close } = await makeTestDb();
    await setActionServerAllowlist(db, []);
    expect(await seedActionServerAllowlistIfAbsent(db, ['http://seed:3002'])).toBe(false);
    expect((await getActionServerPolicy(db)).allowlist).toEqual([]);
    await close();
  });
  it('normalizeActionServerOrigin accepts http(s) origins and rejects the rest', () => {
    expect(normalizeActionServerOrigin('http://mission-autopilot-server:3002/')).toEqual({ ok: true, origin: 'http://mission-autopilot-server:3002' });
    expect(normalizeActionServerOrigin('  HTTPS://Host.Example:8443 ')).toEqual({ ok: true, origin: 'https://host.example:8443' });
    expect(normalizeActionServerOrigin('ftp://x')).toMatchObject({ ok: false });
    expect(normalizeActionServerOrigin('not a url')).toMatchObject({ ok: false });
    expect(normalizeActionServerOrigin('http://host:3002/trajectory/v1/')).toMatchObject({ ok: false, reason: expect.stringContaining('path') });
    expect(normalizeActionServerOrigin('http://host:3002?x=1')).toMatchObject({ ok: false });
  });
});

import { eq } from 'drizzle-orm';
import { getRuntimeIdTimezone, setRuntimeIdTimezone, isValidTimeZone } from './system-settings';

describe('runtime ID timezone (spec 2026-10-07 §4.4)', () => {
  it('reads the server default when no row exists', async () => {
    const { db, close } = await makeTestDb();
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    expect(await getRuntimeIdTimezone(db)).toBe(expected);
    await close();
  });
  it('round-trips a stored zone', async () => {
    const { db, close } = await makeTestDb();
    await setRuntimeIdTimezone(db, 'America/Chicago');
    expect(await getRuntimeIdTimezone(db)).toBe('America/Chicago');
    await close();
  });
  it('reads an unparseable stored zone as the default rather than throwing', async () => {
    const { db, close } = await makeTestDb();
    await setRuntimeIdTimezone(db, 'America/Chicago');
    await db.update(systemSettings).set({ value: 'Not/AZone' }).where(eq(systemSettings.key, 'runtime_id_timezone'));
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    expect(await getRuntimeIdTimezone(db)).toBe(expected);
    await close();
  });
  it('rejects an invalid zone on write', async () => {
    const { db, close } = await makeTestDb();
    await expect(setRuntimeIdTimezone(db, 'Not/AZone')).rejects.toThrow();
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    await close();
  });
});
