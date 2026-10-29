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
import { sql } from 'drizzle-orm';
import { mockSessionAs, seedUser, req } from '../test/harness';
import { migrateTestDb, resetDb } from '../test/fixture';
import { app } from '../app';
import { db } from '../lib/db';
import { workCenter } from 'mission-control-db/src/db/schema/index';
import { readSiteTheme, writeSiteTheme } from 'mission-control-db/src/dao/pilot-theme-store';
import { writeWorkCenterTheme } from 'mission-control-db/src/dao/pilot-theme-chain';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
});

async function plant() {
  const [root] = await db.insert(workCenter).values({ name: 'Plant' }).returning();
  const [line] = await db.insert(workCenter).values({ name: 'Line 3', parentWorkCenterId: root!.id }).returning();
  const [cell] = await db.insert(workCenter).values({ name: 'Cell A', parentWorkCenterId: line!.id }).returning();
  return { root: root!, line: line!, cell: cell! };
}
async function asAdmin() {
  mockSessionAs(await seedUser(db, { email: 'wa@x.io', displayName: 'WA', accessLevel: 'administrator' }));
}
type View = { rev: number; site: unknown; chain: Array<{ id: string; name: string; theme: unknown }>; broken?: unknown };
const ownOf = (v: View) => v.chain.at(-1)!.theme;

describe('work-center Pilot theme (spec 2026-10-09 §8)', () => {
  it('GET returns the site layer, the chain root first and this work center last', async () => {
    const { root, line, cell } = await plant();
    await writeWorkCenterTheme(db, line.id, { schema: 1, appTitle: 'Line 3 Pilot' });
    mockSessionAs(await seedUser(db, { email: 'wv@x.io', displayName: 'WV' }));
    const res = await req(app, 'GET', `/api/work-centers/${cell.id}/pilot-theme`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rev: 1, site: { schema: 1 },
      chain: [
        { id: root.id, name: 'Plant', theme: { schema: 1 } },
        { id: line.id, name: 'Line 3', theme: { schema: 1, appTitle: 'Line 3 Pilot' } },
        { id: cell.id, name: 'Cell A', theme: { schema: 1 } },
      ],
    });
  });

  it('GET of an unknown work center → 404', async () => {
    await asAdmin();
    expect((await req(app, 'GET', '/api/work-centers/00000000-0000-4000-8000-000000000000/pilot-theme')).status).toBe(404);
  });

  it('an administrator saves an override; the rev bumps; the response carries the new chain', async () => {
    const { cell } = await plant();
    await asAdmin();
    const put = await req(app, 'PUT', `/api/work-centers/${cell.id}/pilot-theme`, {
      json: { pilotTheme: { schema: 1, colors: { light: { brand: '#15803D' } } } },
    });
    expect(put.status).toBe(200);
    const v = (await put.json()) as View;
    expect(v.rev).toBe(1);
    expect(ownOf(v)).toEqual({ schema: 1, colors: { light: { brand: '#15803d' } } });
    expect(v.broken).toEqual([]);
  });

  it('null clears every override (stored as SQL NULL)', async () => {
    const { cell } = await plant();
    await writeWorkCenterTheme(db, cell.id, { schema: 1, font: 'lato' });
    await asAdmin();
    const put = await req(app, 'PUT', `/api/work-centers/${cell.id}/pilot-theme`, { json: { pilotTheme: null } });
    expect(put.status).toBe(200);
    expect(ownOf((await put.json()) as View)).toEqual({ schema: 1 });
    const rows = (await db.execute<{ n: boolean }>(sql`select pilot_theme is null as n from work_center where id = ${cell.id}`)).rows as Array<{ n: boolean }>;
    expect(rows[0]!.n).toBe(true);
  });

  it('a steward gets 403 and nothing is stored', async () => {
    const { cell } = await plant();
    mockSessionAs(await seedUser(db, { email: 'ws@x.io', displayName: 'WS', accessLevel: 'steward' }));
    const put = await req(app, 'PUT', `/api/work-centers/${cell.id}/pilot-theme`, { json: { pilotTheme: { schema: 1, font: 'lato' } } });
    expect(put.status).toBe(403);
    expect((await readSiteTheme(db)).rev).toBe(0);
  });

  it('a missing body field, a malformed theme and a logo with no stored asset → 422', async () => {
    const { cell } = await plant();
    await asAdmin();
    const missing = await req(app, 'PUT', `/api/work-centers/${cell.id}/pilot-theme`, { json: {} });
    expect(missing.status).toBe(422);
    const bad = await req(app, 'PUT', `/api/work-centers/${cell.id}/pilot-theme`, { json: { pilotTheme: { schema: 1, glow: 1 } } });
    expect(((await bad.json()) as { error: { message: string } }).error.message).toContain('glow: unknown field');
    const logo = { id: `sha256:${'a'.repeat(64)}`, mime: 'image/png', alt: '' };
    const noAsset = await req(app, 'PUT', `/api/work-centers/${cell.id}/pilot-theme`, { json: { pilotTheme: { schema: 1, logo } } });
    expect(noAsset.status).toBe(422);
    expect(((await noAsset.json()) as { error: { message: string } }).error.message).toBe(`pilotTheme: no such brand asset: ${logo.id}`);
  });

  it('the merged site + ancestors + this check blocks an override that is fine alone', async () => {
    const { line, cell } = await plant();
    await writeWorkCenterTheme(db, line.id, { schema: 1, colors: { light: { brand: '#d97706' } } });
    await asAdmin();
    const put = await req(app, 'PUT', `/api/work-centers/${cell.id}/pilot-theme`, {
      json: { pilotTheme: { schema: 1, colors: { light: { accentFg: '#ffffff' } } } },
    });
    expect(put.status).toBe(422);
    expect(((await put.json()) as { error: { message: string } }).error.message)
      .toBe('Work-center branding fails the contrast checks: Light mode: Text on accent on Accent is 3.18:1 — needs 4.5:1');
  });

  it('a parent save that breaks a descendant succeeds and names it', async () => {
    const { line, cell } = await plant();
    await writeWorkCenterTheme(db, cell.id, { schema: 1, colors: { light: { accentFg: '#ffffff' } } });
    await asAdmin();
    const put = await req(app, 'PUT', `/api/work-centers/${line.id}/pilot-theme`, {
      json: { pilotTheme: { schema: 1, colors: { light: { brand: '#d97706' } } } },
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as View).broken).toEqual([{
      id: cell.id, name: 'Plant / Line 3 / Cell A',
      failures: ['Light mode: Text on accent on Accent is 3.18:1 — needs 4.5:1'],
    }]);
  });

  it('moving a work center under another parent bumps the theme rev, so open Pilots refetch', async () => {
    const { root, cell } = await plant();
    await asAdmin();
    const patch = await req(app, 'PATCH', `/api/work-centers/${cell.id}`, { json: { parentWorkCenterId: root.id } });
    expect(patch.status).toBe(200);
    expect((await readSiteTheme(db)).rev).toBe(1);
    const rename = await req(app, 'PATCH', `/api/work-centers/${cell.id}`, { json: { name: 'Cell B' } });
    expect(rename.status).toBe(200);
    expect((await readSiteTheme(db)).rev).toBe(1);
  });

  it('a site save with an override holder it breaks still succeeds and is reported', async () => {
    const { cell } = await plant();
    await writeWorkCenterTheme(db, cell.id, { schema: 1, colors: { light: { accentFg: '#ffffff' } } });
    await writeSiteTheme(db, { schema: 1 });
    await asAdmin();
    const put = await req(app, 'PUT', '/api/system-settings', { json: { pilotTheme: { schema: 1, colors: { light: { brand: '#d97706' } } } } });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { pilotThemeBrokenWorkCenters: unknown }).pilotThemeBrokenWorkCenters).toEqual([{
      id: cell.id, name: 'Plant / Line 3 / Cell A',
      failures: ['Light mode: Text on accent on Accent is 3.18:1 — needs 4.5:1'],
    }]);
  });

  it('under an ancestor a later site change broke, the child can still save and clear (final review)', async () => {
    const { line, cell } = await plant();
    await writeWorkCenterTheme(db, line.id, { schema: 1, colors: { light: { accentFg: '#ffffff' } } });
    await writeWorkCenterTheme(db, cell.id, { schema: 1, font: 'lato' });
    await writeSiteTheme(db, { schema: 1, colors: { light: { brand: '#d97706' } } });
    await asAdmin();
    const title = await req(app, 'PUT', `/api/work-centers/${cell.id}/pilot-theme`, { json: { pilotTheme: { schema: 1, appTitle: 'Cell A Pilot' } } });
    expect(title.status).toBe(200);
    const clear = await req(app, 'PUT', `/api/work-centers/${cell.id}/pilot-theme`, { json: { pilotTheme: null } });
    expect(clear.status).toBe(200);
    // A failure this layer adds is still refused.
    const worse = await req(app, 'PUT', `/api/work-centers/${cell.id}/pilot-theme`, { json: { pilotTheme: { schema: 1, colors: { light: { text: '#9ca3af' } } } } });
    expect(worse.status).toBe(422);
    expect(((await worse.json()) as { error: { message: string } }).error.message).toContain('Light mode: Text on Page background');
  });
});
