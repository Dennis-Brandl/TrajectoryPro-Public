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

import { describe, it, expect } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { workCenter, brandAsset } from '../db/schema/index.js';
import { makeTestDb } from '../../test/helpers/db.js';
import { readSiteTheme, writeSiteTheme } from './pilot-theme-store';
import {
  readThemeChain, writeWorkCenterTheme, brokenWorkCenterThemes, missingBrandAssets,
} from './pilot-theme-chain';
import { DaoError } from './errors';

const ASSET_ID = `sha256:${'a'.repeat(64)}`;

describe('migration 0037 (spec 2026-10-09 §8.1)', () => {
  it('work_center.pilot_theme is a nullable jsonb that defaults to NULL (inherit)', async () => {
    const { db, close } = await makeTestDb();
    const [wc] = await db.insert(workCenter).values({ name: 'Plant' }).returning();
    expect(wc!.pilotTheme).toBeNull();
    await db.update(workCenter).set({ pilotTheme: { schema: 1, font: 'lato' } }).where(eq(workCenter.id, wc!.id));
    const [row] = await db.select({ t: workCenter.pilotTheme }).from(workCenter).where(eq(workCenter.id, wc!.id));
    expect(row!.t).toEqual({ schema: 1, font: 'lato' });
    await close();
  });

  it('brand_asset accepts a content-hash id with png or svg, and rejects anything else', async () => {
    const { db, close } = await makeTestDb();
    await db.insert(brandAsset).values({ id: ASSET_ID, mime: 'image/png', dataBase64: 'iVBORw0KGgo=', width: 10, height: 10 });
    const [row] = await db.select().from(brandAsset);
    expect(row!.createdAt).toBeInstanceOf(Date);
    await expect(db.insert(brandAsset).values({ id: `sha256:${'b'.repeat(64)}`, mime: 'image/gif', dataBase64: 'x', width: 1, height: 1 }))
      .rejects.toThrow();
    await expect(db.insert(brandAsset).values({ id: 'logo.png', mime: 'image/png', dataBase64: 'x', width: 1, height: 1 }))
      .rejects.toThrow();
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from brand_asset`)).rows as Array<{ n: number }>;
    expect(n).toBe(1);
    await close();
  });
});

async function plant(db: Awaited<ReturnType<typeof makeTestDb>>['db']) {
  const [root] = await db.insert(workCenter).values({ name: 'Plant' }).returning();
  const [line] = await db.insert(workCenter).values({ name: 'Line 3', parentWorkCenterId: root!.id }).returning();
  const [cell] = await db.insert(workCenter).values({ name: 'Cell A', parentWorkCenterId: line!.id }).returning();
  return { root: root!, line: line!, cell: cell! };
}

describe('readThemeChain (spec §8.2)', () => {
  it('lists root first, this work center last; no override reads as the empty layer', async () => {
    const { db, close } = await makeTestDb();
    const { root, line, cell } = await plant(db);
    await writeWorkCenterTheme(db, line.id, { schema: 1, colors: { light: { brand: '#15803d' } } });
    expect(await readThemeChain(db, cell.id)).toEqual([
      { id: root.id, name: 'Plant', theme: { schema: 1 } },
      { id: line.id, name: 'Line 3', theme: { schema: 1, colors: { light: { brand: '#15803d' } } } },
      { id: cell.id, name: 'Cell A', theme: { schema: 1 } },
    ]);
    await close();
  });

  it('an unknown work center is null; a hand-edited override keeps only its valid fields', async () => {
    const { db, close } = await makeTestDb();
    const { cell } = await plant(db);
    expect(await readThemeChain(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
    await db.update(workCenter).set({ pilotTheme: { schema: 1, font: 'comic-sans', density: 'touch' } }).where(eq(workCenter.id, cell.id));
    expect((await readThemeChain(db, cell.id))!.at(-1)!.theme).toEqual({ schema: 1, density: 'touch' });
    await close();
  });
});

describe('writeWorkCenterTheme (spec §8.1)', () => {
  it('stores the override and bumps the shared theme rev', async () => {
    const { db, close } = await makeTestDb();
    const { line } = await plant(db);
    expect(await writeWorkCenterTheme(db, line.id, { schema: 1, appTitle: 'Line 3 Pilot' })).toBe(1);
    expect(await writeSiteTheme(db, { schema: 1 })).toBe(2);
    expect((await readSiteTheme(db)).rev).toBe(2);
    await close();
  });

  it('null and an override with no fields both store SQL NULL (inherit everything)', async () => {
    const { db, close } = await makeTestDb();
    const { line } = await plant(db);
    const isNull = async () => ((await db.execute<{ n: boolean }>(sql`select pilot_theme is null as n from work_center where id = ${line.id}`)).rows as Array<{ n: boolean }>)[0]!.n;
    await writeWorkCenterTheme(db, line.id, { schema: 1, font: 'lato' });
    expect(await isNull()).toBe(false);
    await writeWorkCenterTheme(db, line.id, { schema: 1 });
    expect(await isNull()).toBe(true);
    await writeWorkCenterTheme(db, line.id, { schema: 1, font: 'lato' });
    await writeWorkCenterTheme(db, line.id, null);
    expect(await isNull()).toBe(true);
    await close();
  });

  it('an unknown work center throws WORK_CENTER_NOT_FOUND and bumps nothing', async () => {
    const { db, close } = await makeTestDb();
    const attempt = writeWorkCenterTheme(db, '00000000-0000-4000-8000-000000000000', { schema: 1, font: 'lato' });
    await expect(attempt).rejects.toBeInstanceOf(DaoError);
    await expect(attempt).rejects.toMatchObject({ code: 'WORK_CENTER_NOT_FOUND' });
    expect((await readSiteTheme(db)).rev).toBe(0);
    await close();
  });
});

describe('brokenWorkCenterThemes (spec §11)', () => {
  it('names each override holder whose merged theme a later site change broke', async () => {
    const { db, close } = await makeTestDb();
    const { line, cell } = await plant(db);
    await writeWorkCenterTheme(db, cell.id, { schema: 1, colors: { light: { accentFg: '#ffffff' } } });
    await writeWorkCenterTheme(db, line.id, { schema: 1, appTitle: 'Line 3 Pilot' });
    expect(await brokenWorkCenterThemes(db)).toEqual([]);
    await writeSiteTheme(db, { schema: 1, colors: { light: { brand: '#d97706' } } });
    expect(await brokenWorkCenterThemes(db)).toEqual([{
      id: cell.id, name: 'Plant / Line 3 / Cell A',
      failures: ['Light mode: Text on accent on Accent is 3.18:1 — needs 4.5:1'],
    }]);
    await close();
  });

  it('with `under`, only strict descendants are listed', async () => {
    const { db, close } = await makeTestDb();
    const { root, line, cell } = await plant(db);
    await writeWorkCenterTheme(db, cell.id, { schema: 1, colors: { light: { accentFg: '#ffffff' } } });
    await writeWorkCenterTheme(db, root.id, { schema: 1, colors: { light: { brand: '#d97706' } } });
    expect((await brokenWorkCenterThemes(db, { under: line.id })).map((b) => b.id)).toEqual([cell.id]);
    expect(await brokenWorkCenterThemes(db, { under: cell.id })).toEqual([]);
    await close();
  });
});

describe('missingBrandAssets (spec §11 format errors)', () => {
  it('lists logo ids with no stored asset; none for false, null or absent logos', async () => {
    const { db, close } = await makeTestDb();
    await db.insert(brandAsset).values({ id: ASSET_ID, mime: 'image/png', dataBase64: 'iVBORw0KGgo=', width: 10, height: 10 });
    const other = `sha256:${'c'.repeat(64)}`;
    expect(await missingBrandAssets(db, { schema: 1 })).toEqual([]);
    expect(await missingBrandAssets(db, { schema: 1, logo: false, logoDark: null })).toEqual([]);
    expect(await missingBrandAssets(db, {
      schema: 1, logo: { id: ASSET_ID, mime: 'image/png', alt: '' }, logoDark: { id: other, mime: 'image/png', alt: '' },
    })).toEqual([other]);
    await close();
  });
});
