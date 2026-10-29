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
import { eq } from 'drizzle-orm';
import { brandAsset, workCenter } from '../db/schema/index.js';
import { makeTestDb } from '../../test/helpers/db.js';
import { writeSiteTheme } from './pilot-theme-store';
import { writeWorkCenterTheme } from './pilot-theme-chain';
import {
  storeBrandAsset, readBrandAsset, brandAssetHeaders, themeLogoIds, deleteOrphanBrandAssets,
  UNSAVED_UPLOAD_GRACE_MS,
} from './brand-assets';

const A = `sha256:${'a'.repeat(64)}`;
const B = `sha256:${'b'.repeat(64)}`;
const logo = (id: string) => ({ id, mime: 'image/png' as const, alt: '' });
const asset = (id: string) => ({ id, mime: 'image/png' as const, data: Buffer.from(`png ${id}`), width: 1, height: 1 });
type TestDb = Awaited<ReturnType<typeof makeTestDb>>['db'];
const stored = async (db: TestDb) => (await db.select({ id: brandAsset.id }).from(brandAsset)).map((r) => r.id).sort();
const age = (db: TestDb, id: string, ms: number) =>
  db.update(brandAsset).set({ createdAt: new Date(Date.now() - ms) }).where(eq(brandAsset.id, id));

describe('brand assets (spec 2026-10-09 §8.1, §12)', () => {
  it('stores an asset once and reads its bytes back; an unknown or malformed id reads null', async () => {
    const { db, close } = await makeTestDb();
    await storeBrandAsset(db, asset(A));
    await storeBrandAsset(db, asset(A));
    expect(await stored(db)).toEqual([A]);
    expect(await readBrandAsset(db, A)).toEqual({ mime: 'image/png', data: Buffer.from(`png ${A}`) });
    expect(await readBrandAsset(db, B)).toBeNull();
    expect(await readBrandAsset(db, 'logo.png')).toBeNull();
    await close();
  });

  it('is served immutable and nosniff; an SVG also gets the sandbox CSP', () => {
    expect(brandAssetHeaders('image/png')).toEqual({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    expect(brandAssetHeaders('image/svg+xml')['Content-Security-Policy'])
      .toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
  });

  it('themeLogoIds: the logo and the dark logo, once each; nothing for false, null or absent', () => {
    expect(themeLogoIds({ schema: 1, logo: logo(A), logoDark: logo(B) })).toEqual([A, B]);
    expect(themeLogoIds({ schema: 1, logo: logo(A), logoDark: logo(A) })).toEqual([A]);
    expect(themeLogoIds({ schema: 1, logo: false, logoDark: null })).toEqual([]);
    expect(themeLogoIds({ schema: 1 })).toEqual([]);
  });

  it('a site write that replaces its logo deletes the old asset in the same write', async () => {
    const { db, close } = await makeTestDb();
    await storeBrandAsset(db, asset(A));
    await storeBrandAsset(db, asset(B));
    await writeSiteTheme(db, { schema: 1, logo: logo(A) });
    await writeSiteTheme(db, { schema: 1, logo: logo(B) });
    expect(await stored(db)).toEqual([B]);
    await close();
  });

  it('an asset a work center still uses survives the site dropping it; clearing the work center deletes it', async () => {
    const { db, close } = await makeTestDb();
    const [wc] = await db.insert(workCenter).values({ name: 'Plant' }).returning();
    await storeBrandAsset(db, asset(A));
    await writeSiteTheme(db, { schema: 1, logo: logo(A) });
    await writeWorkCenterTheme(db, wc!.id, { schema: 1, logoDark: logo(A) });
    await writeSiteTheme(db, { schema: 1 });
    expect(await stored(db)).toEqual([A]);
    await writeWorkCenterTheme(db, wc!.id, null);
    expect(await stored(db)).toEqual([]);
    await close();
  });

  it('a fresh upload no theme uses yet survives other writes; one older than a day is swept', async () => {
    const { db, close } = await makeTestDb();
    await storeBrandAsset(db, asset(A));
    await storeBrandAsset(db, asset(B));
    await age(db, B, UNSAVED_UPLOAD_GRACE_MS + 60_000);
    await writeSiteTheme(db, { schema: 1, appTitle: 'Acme Pilot' });
    expect(await stored(db)).toEqual([A]);
    await close();
  });

  it('uploading the same file again restarts its grace period', async () => {
    const { db, close } = await makeTestDb();
    await storeBrandAsset(db, asset(B));
    await age(db, B, UNSAVED_UPLOAD_GRACE_MS + 60_000);
    await storeBrandAsset(db, asset(B));
    await writeSiteTheme(db, { schema: 1 });
    expect(await stored(db)).toEqual([B]);
    await close();
  });

  it('deleteOrphanBrandAssets returns what it deleted and keeps every referenced id', async () => {
    const { db, close } = await makeTestDb();
    await storeBrandAsset(db, asset(A));
    await storeBrandAsset(db, asset(B));
    expect(await deleteOrphanBrandAssets(db, { schema: 1, logo: logo(B) }, [A, B])).toEqual([A]);
    expect(await stored(db)).toEqual([B]);
    expect(await deleteOrphanBrandAssets(db, { schema: 1 }, [])).toEqual([]);
    await close();
  });
});
