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
// Spec 2026-10-09 §8.1/§12: uploaded Pilot logos in brand_asset, keyed by the content hash of
// the stored bytes. Commander cleans and stores them; the engine and Commander serve them
// publicly (R5: the login screen shows the site logo) with the same headers. An asset no theme
// references is deleted in the transaction of the theme write that dropped its last reference;
// an upload no theme has referenced yet is kept for a day, so an editor can still save it.
import { eq, inArray, isNotNull, lt } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { brandAsset, workCenter } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';
import { parseTheme, type LogoMime, type PilotTheme, type ThemeLogo } from './pilot-theme.js';

type Db = PgDatabase<any, Schema>;

const ID_RE = /^sha256:[0-9a-f]{64}$/;
export const UNSAVED_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;

export interface NewBrandAsset { id: string; mime: LogoMime; data: Buffer; width: number; height: number }

/** Idempotent (the id is the content hash). A re-upload restarts the unsaved-upload grace. */
export async function storeBrandAsset(db: Db, a: NewBrandAsset): Promise<void> {
  await db.insert(brandAsset)
    .values({ id: a.id, mime: a.mime, dataBase64: a.data.toString('base64'), width: a.width, height: a.height })
    .onConflictDoUpdate({ target: brandAsset.id, set: { createdAt: new Date() } });
}

export async function readBrandAsset(db: Db, id: string): Promise<{ mime: string; data: Buffer } | null> {
  if (!ID_RE.test(id)) return null;
  const [row] = await db.select({ mime: brandAsset.mime, dataBase64: brandAsset.dataBase64 })
    .from(brandAsset).where(eq(brandAsset.id, id));
  return row ? { mime: row.mime, data: Buffer.from(row.dataBase64, 'base64') } : null;
}

/** Spec §12: ids are content hashes, so the bytes behind a URL never change. */
export function brandAssetHeaders(mime: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  };
  if (mime === 'image/svg+xml') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return headers;
}

export function themeLogoIds(theme: PilotTheme): string[] {
  const ids = [theme.logo, theme.logoDark]
    .filter((l): l is ThemeLogo => typeof l === 'object' && l !== null)
    .map((l) => l.id);
  return [...new Set(ids)];
}

/** Deletes `candidates` (and unsaved uploads older than the grace) that neither `site` nor any
 *  work center's override references. Call inside the transaction of the theme write, with
 *  the logos that layer referenced BEFORE the write and the site theme as it is AFTER it. */
export async function deleteOrphanBrandAssets(
  db: Db, site: PilotTheme, candidates: readonly string[], now: Date = new Date(),
): Promise<string[]> {
  const stale = await db.select({ id: brandAsset.id }).from(brandAsset)
    .where(lt(brandAsset.createdAt, new Date(now.getTime() - UNSAVED_UPLOAD_GRACE_MS)));
  const maybe = new Set([...candidates, ...stale.map((r) => r.id)]);
  if (maybe.size === 0) return [];
  const referenced = new Set(themeLogoIds(site));
  const layers = await db.select({ theme: workCenter.pilotTheme }).from(workCenter).where(isNotNull(workCenter.pilotTheme));
  for (const { theme } of layers) {
    const parsed = parseTheme(theme, { strict: false });
    if (parsed.ok) for (const id of themeLogoIds(parsed.theme)) referenced.add(id);
  }
  const doomed = [...maybe].filter((id) => !referenced.has(id));
  if (doomed.length === 0) return [];
  const gone = await db.delete(brandAsset).where(inArray(brandAsset.id, doomed)).returning({ id: brandAsset.id });
  return gone.map((r) => r.id).sort();
}
