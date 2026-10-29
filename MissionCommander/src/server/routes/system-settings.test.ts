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
import { mockSessionAs, seedUser, req } from '../test/harness';
import { migrateTestDb, resetDb } from '../test/fixture';
import { app } from '../app';
import { db } from '../lib/db';

const NO_THEME = { rev: 0, site: { schema: 1 } };

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
});

describe('system-settings routes', () => {
  it('GET /api/system-settings defaults to loose (viewer holds settings:read)', async () => {
    const viewer = await seedUser(db, { email: 'v@x.io', displayName: 'V' });
    mockSessionAs(viewer);
    const res = await req(app, 'GET', '/api/system-settings');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actionMatching: 'loose', actionServerTrust: 'strict', actionServerAllowlist: [], pilotTheme: NO_THEME });
  });

  it('steward PUT strict → 200, then GET reflects strict', async () => {
    const steward = await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' });
    mockSessionAs(steward);
    const put = await req(app, 'PUT', '/api/system-settings', { json: { actionMatching: 'strict' } });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ actionMatching: 'strict', actionServerTrust: 'strict', actionServerAllowlist: [], pilotTheme: NO_THEME });
    const get = await req(app, 'GET', '/api/system-settings');
    expect(await get.json()).toEqual({ actionMatching: 'strict', actionServerTrust: 'strict', actionServerAllowlist: [], pilotTheme: NO_THEME });
  });

  it('PUT with an invalid actionMatching value → 422', async () => {
    const steward = await seedUser(db, { email: 's2@x.io', displayName: 'S2', accessLevel: 'steward' });
    mockSessionAs(steward);
    const res = await req(app, 'PUT', '/api/system-settings', { json: { actionMatching: 'bogus' } });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation');
  });

  it('viewer is 403 on PUT (lacks settings:edit); GET still succeeds', async () => {
    const viewer = await seedUser(db, { email: 'v2@x.io', displayName: 'V2' });
    mockSessionAs(viewer);
    const put = await req(app, 'PUT', '/api/system-settings', { json: { actionMatching: 'strict' } });
    expect(put.status).toBe(403);
    expect(await put.json()).toEqual({ error: { code: 'forbidden', message: 'Missing permission: settings:edit' } });
    expect((await req(app, 'GET', '/api/system-settings')).status).toBe(200);
  });

  it('GET returns the action-server policy defaults alongside actionMatching', async () => {
    const viewer = await seedUser(db, { email: 'v2@x.io', displayName: 'V2' });
    mockSessionAs(viewer);
    const res = await req(app, 'GET', '/api/system-settings');
    expect(await res.json()).toEqual({ actionMatching: 'loose', actionServerTrust: 'strict', actionServerAllowlist: [], pilotTheme: NO_THEME });
  });
  it('PUT stores a normalised, deduped allowlist and the trust mode; a partial PUT leaves the rest alone', async () => {
    // Administrator, not steward: finding #6 makes actionServerTrust/actionServerAllowlist
    // administrator-only, and this test's first PUT carries both.
    const admin = await seedUser(db, { email: 'a3@x.io', displayName: 'A3', accessLevel: 'administrator' });
    mockSessionAs(admin);
    const put = await req(app, 'PUT', '/api/system-settings', { json: { actionServerAllowlist: ['http://mission-autopilot-server:3002/', 'http://mission-autopilot-server:3002'], actionServerTrust: 'loose' } });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ actionMatching: 'loose', actionServerTrust: 'loose', actionServerAllowlist: ['http://mission-autopilot-server:3002'], pilotTheme: NO_THEME });
    const again = await req(app, 'PUT', '/api/system-settings', { json: { actionMatching: 'strict' } });
    expect(await again.json()).toEqual({ actionMatching: 'strict', actionServerTrust: 'loose', actionServerAllowlist: ['http://mission-autopilot-server:3002'], pilotTheme: NO_THEME });
  });
  it('PUT rejects a bad trust value, a pathful origin, an empty body, and > 50 entries with 422', async () => {
    const steward = await seedUser(db, { email: 's4@x.io', displayName: 'S4', accessLevel: 'steward' });
    mockSessionAs(steward);
    for (const json of [
      { actionServerTrust: 'open' },
      { actionServerAllowlist: ['http://h:1/trajectory/v1/'] },
      {},
      { actionServerAllowlist: Array.from({ length: 51 }, (_, i) => `http://h${i}:1`) },
    ]) {
      const res = await req(app, 'PUT', '/api/system-settings', { json });
      expect(res.status).toBe(422);
    }
    const pathful = await req(app, 'PUT', '/api/system-settings', { json: { actionServerAllowlist: ['http://h:1/trajectory/v1/'] } });
    expect(((await pathful.json()) as { error: { message: string } }).error.message).toMatch(/actionServerAllowlist\[0\]/);
  });

  // Finding #6 (Important): a steward holds settings:edit — enough for actionMatching — but
  // the trust mode and the allowlist are administrator-only.
  it('steward PUT with actionServerTrust → 403 (trust and the allowlist require an administrator)', async () => {
    const steward = await seedUser(db, { email: 's5@x.io', displayName: 'S5', accessLevel: 'steward' });
    mockSessionAs(steward);
    const res = await req(app, 'PUT', '/api/system-settings', { json: { actionServerTrust: 'loose' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'forbidden', message: 'Action server trust and the allowlist require an administrator' } });
  });

  it('steward PUT with only actionMatching → 200 (unchanged)', async () => {
    const steward = await seedUser(db, { email: 's6@x.io', displayName: 'S6', accessLevel: 'steward' });
    mockSessionAs(steward);
    const res = await req(app, 'PUT', '/api/system-settings', { json: { actionMatching: 'strict' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actionMatching: 'strict', actionServerTrust: 'strict', actionServerAllowlist: [], pilotTheme: NO_THEME });
  });

  it('administrator PUT with actionServerTrust and actionServerAllowlist → 200', async () => {
    const admin = await seedUser(db, { email: 'a4@x.io', displayName: 'A4', accessLevel: 'administrator' });
    mockSessionAs(admin);
    const res = await req(app, 'PUT', '/api/system-settings', { json: { actionServerTrust: 'loose', actionServerAllowlist: ['http://x:1'] } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actionMatching: 'loose', actionServerTrust: 'loose', actionServerAllowlist: ['http://x:1'], pilotTheme: NO_THEME });
  });
});

describe('system-settings — Pilot branding (spec 2026-10-09 §8.3, §11)', () => {
  it('GET carries the site theme and its rev; nothing stored = rev 0 and the empty theme', async () => {
    const viewer = await seedUser(db, { email: 'pv@x.io', displayName: 'PV' });
    mockSessionAs(viewer);
    const res = await req(app, 'GET', '/api/system-settings');
    expect(((await res.json()) as { pilotTheme: unknown }).pilotTheme).toEqual(NO_THEME);
  });

  it('an administrator stores a theme; each save bumps the rev; colours come back lower-cased', async () => {
    const admin = await seedUser(db, { email: 'pa@x.io', displayName: 'PA', accessLevel: 'administrator' });
    mockSessionAs(admin);
    const put = await req(app, 'PUT', '/api/system-settings', {
      json: { pilotTheme: { schema: 1, appTitle: 'Acme Pilot', colors: { light: { brand: '#7C3AED' } } } },
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { pilotTheme: unknown }).pilotTheme).toEqual({
      rev: 1, site: { schema: 1, appTitle: 'Acme Pilot', colors: { light: { brand: '#7c3aed' } } },
    });
    const again = await req(app, 'PUT', '/api/system-settings', { json: { pilotTheme: { schema: 1 } } });
    expect(((await again.json()) as { pilotTheme: unknown }).pilotTheme).toEqual({ rev: 2, site: { schema: 1 } });
  });

  it('a steward holding settings:edit gets 403 and nothing is stored', async () => {
    const steward = await seedUser(db, { email: 'ps@x.io', displayName: 'PS', accessLevel: 'steward' });
    mockSessionAs(steward);
    const put = await req(app, 'PUT', '/api/system-settings', { json: { pilotTheme: { schema: 1, font: 'lato' } } });
    expect(put.status).toBe(403);
    expect(await put.json()).toEqual({ error: { code: 'forbidden', message: 'Pilot branding requires an administrator' } });
    const get = await req(app, 'GET', '/api/system-settings');
    expect(((await get.json()) as { pilotTheme: unknown }).pilotTheme).toEqual(NO_THEME);
  });

  it('a malformed theme → 422 naming every problem; nothing is stored', async () => {
    const admin = await seedUser(db, { email: 'pa2@x.io', displayName: 'PA2', accessLevel: 'administrator' });
    mockSessionAs(admin);
    const put = await req(app, 'PUT', '/api/system-settings', {
      json: { pilotTheme: { schema: 1, glow: 1, colors: { light: { brand: '#fff' } } } },
    });
    expect(put.status).toBe(422);
    const { error } = (await put.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe('validation');
    expect(error.message).toContain('glow: unknown field');
    expect(error.message).toContain('colors.light.brand: must be a #rrggbb colour');
    const get = await req(app, 'GET', '/api/system-settings');
    expect(((await get.json()) as { pilotTheme: unknown }).pilotTheme).toEqual(NO_THEME);
  });

  it('a theme that fails a §11 check → 422 naming the pair; nothing is stored', async () => {
    const admin = await seedUser(db, { email: 'pa3@x.io', displayName: 'PA3', accessLevel: 'administrator' });
    mockSessionAs(admin);
    const put = await req(app, 'PUT', '/api/system-settings', {
      json: { pilotTheme: { schema: 1, colors: { dark: { text: '#1f2937' } } } },
    });
    expect(put.status).toBe(422);
    const { error } = (await put.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe('validation');
    expect(error.message).toMatch(/^Pilot branding fails the contrast checks: /);
    expect(error.message).toContain('Dark mode: Text on Page background is ');
    const get = await req(app, 'GET', '/api/system-settings');
    expect(((await get.json()) as { pilotTheme: unknown }).pilotTheme).toEqual(NO_THEME);
  });

  it('pilotTheme saves together with another setting', async () => {
    const admin = await seedUser(db, { email: 'pa4@x.io', displayName: 'PA4', accessLevel: 'administrator' });
    mockSessionAs(admin);
    const put = await req(app, 'PUT', '/api/system-settings', {
      json: { actionMatching: 'strict', pilotTheme: { schema: 1, font: 'lato' } },
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as { actionMatching: string; pilotTheme: unknown };
    expect(body.actionMatching).toBe('strict');
    expect(body.pilotTheme).toEqual({ rev: 1, site: { schema: 1, font: 'lato' } });
  });

  it('a site logo with no stored asset → 422 (spec §11; P3b uploads them)', async () => {
    const admin = await seedUser(db, { email: 'pa5@x.io', displayName: 'PA5', accessLevel: 'administrator' });
    mockSessionAs(admin);
    const id = `sha256:${'d'.repeat(64)}`;
    const put = await req(app, 'PUT', '/api/system-settings', { json: { pilotTheme: { schema: 1, logo: { id, mime: 'image/svg+xml', alt: 'Acme' } } } });
    expect(put.status).toBe(422);
    expect(await put.json()).toEqual({ error: { code: 'validation', message: `pilotTheme: no such brand asset: ${id}` } });
  });
});
