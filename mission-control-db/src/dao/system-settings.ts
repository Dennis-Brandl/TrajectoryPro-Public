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
//
// Spec 2026-08-20: system-wide action-matching mode. Absent row and unrecognized
// values BOTH read as 'loose' — the default ships without a seed.
import { eq, inArray } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { systemSettings } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';

type Db = PgDatabase<any, Schema>;

export type ActionMatchingMode = 'loose' | 'strict';
const KEY = 'action_matching';

export async function getActionMatchingMode(db: Db): Promise<ActionMatchingMode> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, KEY));
  return row?.value === 'strict' ? 'strict' : 'loose';
}

export async function setActionMatchingMode(db: Db, mode: ActionMatchingMode): Promise<void> {
  await db.insert(systemSettings)
    .values({ key: KEY, value: mode, updatedAt: new Date() })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: mode, updatedAt: new Date() } });
}

// Spec 2026-09-05: action-server trust. Absent/unknown trust reads STRICT and an absent or
// unparseable allowlist reads EMPTY — both fail closed, matching the engine's pre-spec default
// (an empty ACTION_SERVER_ALLOWLIST refused every server).
export type ActionServerTrust = 'strict' | 'loose';
export interface ActionServerPolicy { trust: ActionServerTrust; allowlist: string[] }
const TRUST_KEY = 'action_server_trust';
const ALLOWLIST_KEY = 'action_server_allowlist';

/** Parses a user-entered action-server origin: http(s) only, no path/query/hash (a path is
 *  the classic "pasted /trajectory/v1/" mistake — clients add the protocol path themselves). */
export function normalizeActionServerOrigin(input: string): { ok: true; origin: string } | { ok: false; reason: string } {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return { ok: false, reason: 'not a valid URL' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'must start with http:// or https://' };
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    return { ok: false, reason: 'must be an origin only (scheme, host, port) — no path' };
  }
  return { ok: true, origin: url.origin };
}

function parseAllowlist(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

export async function getActionServerPolicy(db: Db): Promise<ActionServerPolicy> {
  const rows = await db.select().from(systemSettings)
    .where(inArray(systemSettings.key, [TRUST_KEY, ALLOWLIST_KEY]));
  const trustRow = rows.find(r => r.key === TRUST_KEY);
  const listRow = rows.find(r => r.key === ALLOWLIST_KEY);
  return { trust: trustRow?.value === 'loose' ? 'loose' : 'strict', allowlist: parseAllowlist(listRow?.value) };
}

async function upsert(db: Db, key: string, value: string): Promise<void> {
  await db.insert(systemSettings).values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date() } });
}

export async function setActionServerTrust(db: Db, trust: ActionServerTrust): Promise<void> {
  await upsert(db, TRUST_KEY, trust);
}

/** Stores the list deduped in first-seen order. Callers validate with normalizeActionServerOrigin. */
export async function setActionServerAllowlist(db: Db, origins: string[]): Promise<void> {
  await upsert(db, ALLOWLIST_KEY, JSON.stringify([...new Set(origins)]));
}

/** Decision B: the engine's ACTION_SERVER_ALLOWLIST env seeds the row on first boot only.
 *  Returns true when it wrote. An empty list never writes (leaves the row absent). Each raw
 *  entry is normalised through normalizeActionServerOrigin; rejects are dropped with a warning
 *  (a raw entry can never match the policy's `allowlist.includes(new URL(uri).origin)` check,
 *  and — unlike the pre-normalisation seed — a bad row would otherwise persist across reboots). */
export async function seedActionServerAllowlistIfAbsent(db: Db, origins: string[]): Promise<boolean> {
  const list: string[] = [];
  for (const raw of origins) {
    const parsed = normalizeActionServerOrigin(raw);
    if (!parsed.ok) {
      console.warn(`[mission-control-db] ignoring invalid ACTION_SERVER_ALLOWLIST entry "${raw}": ${parsed.reason}`);
      continue;
    }
    if (!list.includes(parsed.origin)) list.push(parsed.origin);
  }
  if (list.length === 0) return false;
  const inserted = await db.insert(systemSettings)
    .values({ key: ALLOWLIST_KEY, value: JSON.stringify(list), updatedAt: new Date() })
    .onConflictDoNothing({ target: systemSettings.key })
    .returning({ key: systemSettings.key });
  return inserted.length > 0;
}

// Spec 2026-10-07 §4.4: one deployment-wide timezone for the runtime ID's date and time
// tokens. Absent or unparseable reads as the server's resolved zone — same fail-safe shape
// as the settings above, and §7 forbids a timezone problem from stopping a run.
const RUNTIME_ID_TZ_KEY = 'runtime_id_timezone';

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export async function getRuntimeIdTimezone(db: Db): Promise<string> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, RUNTIME_ID_TZ_KEY));
  const stored = row?.value;
  return stored && isValidTimeZone(stored) ? stored : serverTimeZone();
}

// Validation failures here are a caller-input error, not a DAO domain error: DaoErrorCode
// (./errors.js) is a closed union shared with MissionCommander's exhaustive DAO_STATUS map,
// and this task does not add a case for every status that map would then require — widening
// that shared type is out of scope here. A plain Error satisfies the same "rejects.toThrow()"
// contract without touching it.
export async function setRuntimeIdTimezone(db: Db, tz: string): Promise<void> {
  if (!isValidTimeZone(tz)) throw new Error(`Invalid time zone: "${tz}"`);
  await upsert(db, RUNTIME_ID_TZ_KEY, tz);
}
