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

// Spec 2026-10-09 §8.1: the site theme is a system_settings row (JSON text) and
// pilot_theme_rev is bumped in the SAME transaction as any site or work-center theme write.
// The bump NOTIFYs PILOT_THEME_CHANNEL with the new rev; the engine relays it to every open
// Pilot as an SSE `theme` event (spec §13). NOTIFY inside a transaction is delivered on commit.
import { inArray, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { systemSettings } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';
import { readTheme, type PilotTheme } from './pilot-theme.js';
import { deleteOrphanBrandAssets, themeLogoIds } from './brand-assets.js';

type Db = PgDatabase<any, Schema>;

export const PILOT_THEME_KEY = 'pilot_theme';
export const PILOT_THEME_REV_KEY = 'pilot_theme_rev';
export const PILOT_THEME_CHANNEL = 'pilot_theme';

/** Unreadable values read as defaults (spec §7): an unparseable theme → nothing set, a
 *  non-numeric rev → 0. Never throws on stored content. */
export async function readSiteTheme(db: Db): Promise<{ rev: number; site: PilotTheme }> {
  const rows = await db.select().from(systemSettings)
    .where(inArray(systemSettings.key, [PILOT_THEME_KEY, PILOT_THEME_REV_KEY]));
  const themeRow = rows.find((r) => r.key === PILOT_THEME_KEY);
  const revRow = rows.find((r) => r.key === PILOT_THEME_REV_KEY);
  const rev = revRow && /^[0-9]+$/.test(revRow.value) ? Number(revRow.value) : 0;
  return { rev, site: readTheme(themeRow?.value) };
}

/** Increments pilot_theme_rev (a non-numeric value restarts at 1) and NOTIFYs the new rev.
 *  Call inside the transaction that writes the theme. */
export async function bumpThemeRev(db: Db): Promise<number> {
  const [row] = await db.insert(systemSettings)
    .values({ key: PILOT_THEME_REV_KEY, value: '1', updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: sql`(CASE WHEN ${systemSettings.value} ~ '^[0-9]+$' THEN ${systemSettings.value}::bigint + 1 ELSE 1 END)::text`,
        updatedAt: new Date(),
      },
    })
    .returning({ value: systemSettings.value });
  const rev = Number(row?.value ?? '0');
  await db.execute(sql`SELECT pg_notify(${PILOT_THEME_CHANNEL}, ${String(rev)})`);
  return rev;
}

/** Stores the site theme and bumps the rev, atomically; logos the old site theme used that
 *  nothing references any more are deleted in the same transaction (spec §8.1). The caller
 *  validates first (parseTheme strict + checkContrast on the merged result). Returns the new rev. */
export async function writeSiteTheme(db: Db, theme: PilotTheme): Promise<number> {
  const value = JSON.stringify(theme);
  return db.transaction(async (tx) => {
    const { site: before } = await readSiteTheme(tx);
    await tx.insert(systemSettings)
      .values({ key: PILOT_THEME_KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date() } });
    await deleteOrphanBrandAssets(tx, theme, themeLogoIds(before));
    return bumpThemeRev(tx);
  });
}
