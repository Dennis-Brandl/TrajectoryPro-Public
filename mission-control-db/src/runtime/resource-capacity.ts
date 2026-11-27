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
// Spec 2026-11-26: a work-center resource's shares, count or names are the work center's own.
// The rules shared by the engine's set-capacity verb and the work-center package import.
import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Schema } from '../db/client.js';
import { wcResourceHolder, wcResourceWaiter } from '../db/schema/index.js';
import { MAX_NAME_LENGTH } from '../dao/names.js';
import { nextAvailableNames } from '../dao/work-center-runtime.js';

type Db = PgDatabase<any, Schema>;

export const MAX_POOL_NAMES = 500;
export const MAX_USE_LIMIT = 2147483647;
/** The types whose capacity is a number (shares / count). */
export const COUNTED_TYPES = ['binary shared use with pool limits', 'countable use with pool limits'] as const;
export const NAMED_TYPE = 'named pool';

export function isCountedType(t: string): boolean {
  return (COUNTED_TYPES as readonly string[]).includes(t);
}

/** True for a whole number the use_limit column can hold, at least 1. */
export function validUseLimit(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_USE_LIMIT;
}

/** The trimmed roster, or the reason it is refused. */
export function checkPoolNames(names: unknown): string[] | string {
  if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) return 'names must be a list of text';
  const list = names.map((n) => n.trim());
  if (list.length === 0) return 'a named resource needs at least one name';
  if (list.length > MAX_POOL_NAMES) return `a named resource can have at most ${MAX_POOL_NAMES} names`;
  if (list.some((n) => n === '')) return 'a name cannot be blank';
  const long = list.find((n) => n.length > MAX_NAME_LENGTH);
  if (long) return `"${long.slice(0, 20)}…" is longer than ${MAX_NAME_LENGTH} characters`;
  const seen = new Set<string>();
  for (const n of list) {
    if (seen.has(n)) return `"${n}" is listed twice`;
    seen.add(n);
  }
  return list;
}

/** Names a run holds right now: holder rows, plus grants a waiter has not yet consumed. */
export async function readHeldNames(tx: Db, workCenterId: string, name: string): Promise<Set<string>> {
  const holders = await tx.select({ n: wcResourceHolder.heldName }).from(wcResourceHolder)
    .where(and(eq(wcResourceHolder.workCenterId, workCenterId), eq(wcResourceHolder.name, name)));
  const grants = await tx.select({ n: wcResourceWaiter.grantedName }).from(wcResourceWaiter)
    .where(and(eq(wcResourceWaiter.workCenterId, workCenterId), eq(wcResourceWaiter.name, name), eq(wcResourceWaiter.granted, true)));
  return new Set([...holders, ...grants].map((r) => r.n).filter((n): n is string => n !== null));
}

/**
 * The free names after the roster becomes `next`. A name a run still holds is never free, even
 * when it left the roster earlier (retired) and is now added back — nextAvailableNames alone
 * would call it brand-new and hand it out twice.
 */
export function freeNamesAfter(
  available: readonly string[], oldRoster: readonly string[], next: readonly string[], held: Set<string>,
): string[] {
  return nextAvailableNames(available, oldRoster, next).filter((n) => !held.has(n));
}
