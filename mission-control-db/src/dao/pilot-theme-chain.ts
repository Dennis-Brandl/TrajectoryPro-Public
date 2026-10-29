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

// Spec 2026-10-09 §8.1–§8.2, §11: work-center Pilot theme overrides. A work center's layer
// lives in work_center.pilot_theme (NULL = inherit); its ancestors come from ONE recursive
// CTE, root first; every write bumps the shared pilot_theme_rev (and NOTIFYs the engine) in
// the same transaction, exactly like a site write.
import { eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { workCenter, brandAsset } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';
import { DaoError } from './errors.js';
import { subtree } from './work-centers.js';
import { readSiteTheme, bumpThemeRev } from './pilot-theme-store.js';
import { deleteOrphanBrandAssets, themeLogoIds } from './brand-assets.js';
import {
  parseTheme, resolveTheme, checkContrast, describeFailure, type PilotTheme,
} from './pilot-theme.js';

type Db = PgDatabase<any, Schema>;

export interface ThemeChainLayer { id: string; name: string; theme: PilotTheme }
export interface BrokenWorkCenter { id: string; name: string; failures: string[] }

// db.execute() erases the row type (see subtree in dao/work-centers.ts), so assert it here.
type ChainRow = { id: string; name: string; pilot_theme: unknown; depth: number };

/** A stored override (jsonb arrives parsed) → a layer; unreadable fields read as inherit. */
function layerFrom(raw: unknown): PilotTheme {
  const r = parseTheme(raw ?? null, { strict: false });
  return r.ok ? r.theme : { schema: 1 };
}

/** Root first, this work center last. null when the work center does not exist. */
export async function readThemeChain(db: Db, workCenterId: string): Promise<ThemeChainLayer[] | null> {
  const res = await db.execute<ChainRow>(sql`
    with recursive chain as (
      select id, name, parent_work_center_id, pilot_theme, 0 as depth from work_center where id = ${workCenterId}
      union all
      select w.id, w.name, w.parent_work_center_id, w.pilot_theme, chain.depth + 1
      from work_center w join chain on w.id = chain.parent_work_center_id
      where chain.depth < 64
    )
    select id, name, pilot_theme, depth from chain order by depth desc
  `);
  const rows = res.rows as ChainRow[];
  if (rows.length === 0) return null;
  return rows.map((r) => ({ id: r.id, name: r.name, theme: layerFrom(r.pilot_theme) }));
}

/** Stores a work center's override (NULL when it sets nothing) and bumps the rev, atomically;
 *  logos the old override used that nothing references any more are deleted in the same
 *  transaction (spec §8.1). The caller validates first (parseTheme strict, missingBrandAssets,
 *  merged checkContrast). */
export async function writeWorkCenterTheme(db: Db, workCenterId: string, theme: PilotTheme | null): Promise<number> {
  const value = theme && Object.keys(theme).some((k) => k !== 'schema') ? theme : null;
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ pilotTheme: workCenter.pilotTheme }).from(workCenter).where(eq(workCenter.id, workCenterId));
    if (!before) throw new DaoError('WORK_CENTER_NOT_FOUND');
    await tx.update(workCenter).set({ pilotTheme: value, updatedAt: new Date() }).where(eq(workCenter.id, workCenterId));
    const { site } = await readSiteTheme(tx);
    await deleteOrphanBrandAssets(tx, site, themeLogoIds(layerFrom(before.pilotTheme)));
    return bumpThemeRev(tx);
  });
}

/** Override holders whose merged theme fails §11 now (with `under`: strict descendants only). */
export async function brokenWorkCenterThemes(db: Db, opts: { under?: string } = {}): Promise<BrokenWorkCenter[]> {
  const { site } = await readSiteTheme(db);
  let ids = (await db.select({ id: workCenter.id }).from(workCenter).where(isNotNull(workCenter.pilotTheme))).map((r) => r.id);
  if (opts.under !== undefined) {
    const below = new Set((await subtree(db, opts.under)).map((n) => n.id).filter((id) => id !== opts.under));
    ids = ids.filter((id) => below.has(id));
  }
  const out: BrokenWorkCenter[] = [];
  for (const id of ids) {
    const chain = await readThemeChain(db, id);
    if (!chain) continue;
    const { failures } = checkContrast(resolveTheme([site, ...chain.map((l) => l.theme)]));
    if (failures.length > 0) {
      out.push({ id, name: chain.map((l) => l.name).join(' / '), failures: failures.map(describeFailure) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Spec §11: "logo id not in brand_asset" is a format error. */
export async function missingBrandAssets(db: Db, theme: PilotTheme): Promise<string[]> {
  const ids = themeLogoIds(theme);
  if (ids.length === 0) return [];
  const found = new Set((await db.select({ id: brandAsset.id }).from(brandAsset).where(inArray(brandAsset.id, ids))).map((r) => r.id));
  return ids.filter((id) => !found.has(id));
}
