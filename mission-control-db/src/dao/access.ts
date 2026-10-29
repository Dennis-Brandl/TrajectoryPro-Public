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

import { and, eq, ne, sql } from 'drizzle-orm';
import { appUser } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { DaoError } from './errors.js';
import { setUserStatus } from './users.js';

type Db = PgDatabase<any, Schema>;

export const ACCESS_LEVELS = ['administrator', 'steward', 'viewer'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

// Curated category-to-verb catalog. work_center supports `link` — it governs user assignment
// and allowed-roles editing. Workflows and environments do NOT: since M6 an artifact is
// loaded directly into a work center, so there is no separate link step to gate.
// settings (spec 2026-08-20): system-wide settings such as action-matching mode. Only
// read/edit — there is nothing to create or delete, one row per key.
const CATEGORY_VERBS: Record<string, readonly string[]> = {
  work_center: ['read', 'create', 'edit', 'delete', 'link'],
  workflow: ['read', 'create', 'edit', 'delete'],
  environment: ['read', 'create', 'edit', 'delete'],
  user: ['read', 'create', 'edit', 'delete'],
  role: ['read', 'create', 'edit', 'delete'],
  access: ['read', 'create', 'edit', 'delete'],
  settings: ['read', 'edit'],
};

export const RIGHTS: string[] = Object.entries(CATEGORY_VERBS).flatMap(
  ([category, verbs]) => verbs.map((verb) => `${category}:${verb}`),
);

function rightsFor(level: AccessLevel): Set<string> {
  if (level === 'administrator') return new Set(RIGHTS);
  if (level === 'steward') return new Set(RIGHTS.filter((r) => !r.startsWith('access:')));
  // viewer: read-only on every non-access category
  return new Set(RIGHTS.filter((r) => r.endsWith(':read') && !r.startsWith('access:')));
}

export const TIER_RIGHTS: Record<AccessLevel, Set<string>> = {
  administrator: rightsFor('administrator'),
  steward: rightsFor('steward'),
  viewer: rightsFor('viewer'),
};

export type Principal = { userId: string; accessLevel: AccessLevel; rights: Set<string> };

export function hasRight(principal: Principal, right: string): boolean {
  return principal.rights.has(right);
}

export async function loadPrincipal(db: Db, userId: string): Promise<Principal | undefined> {
  const [u] = await db
    .select({ id: appUser.id, accessLevel: appUser.accessLevel })
    .from(appUser)
    .where(eq(appUser.id, userId));
  if (!u) return undefined;
  const level = u.accessLevel as AccessLevel;
  // Copy the tier's rights set — TIER_RIGHTS entries are shared singletons, and callers
  // must not be able to mutate a principal's rights and corrupt the process-wide tier set.
  return { userId: u.id, accessLevel: level, rights: new Set(TIER_RIGHTS[level]) };
}

export function roleForLevel(level: AccessLevel): 'admin' | 'user' {
  return level === 'administrator' ? 'admin' : 'user';
}

/**
 * access_level is the single source of truth; the better-auth `role` column is derived
 * from it HERE, in the same UPDATE (spec §5.2). The seed and the first-run promote hook
 * both call this, so the mirror invariant holds everywhere. Never write `role` elsewhere.
 */
export async function setAccessLevel(db: Db, userId: string, level: AccessLevel): Promise<void> {
  await db.update(appUser)
    .set({ accessLevel: level, role: roleForLevel(level), updatedAt: new Date() })
    .where(eq(appUser.id, userId));
}

async function assertNotLastActiveAdmin(tx: Db, userId: string): Promise<void> {
  const others = await tx.select({ id: appUser.id }).from(appUser).where(and(
    eq(appUser.accessLevel, 'administrator'),
    eq(appUser.status, 'active'),
    ne(appUser.id, userId),
  ));
  if (others.length === 0) throw new DaoError('LAST_ADMIN', 'This is the last active administrator');
}

/** Guarded access-level change (spec §5.3): no self-demote, never zero active admins. */
export async function setAccessLevelGuarded(db: Db, actorId: string, userId: string, level: AccessLevel): Promise<void> {
  if (actorId === userId && level !== 'administrator') {
    throw new DaoError('SELF_CHANGE_FORBIDDEN', 'You cannot change your own access level');
  }
  await db.transaction(async (tx) => {
    // Serialize admin-guard checks: two concurrent demotes of the two last admins would
    // each count the other and both pass. Same TOCTOU pattern (and lock idiom) as the
    // reparent cycle guard — 91001 is reparent's, 91002 is the admin guard's.
    await tx.execute(sql`select pg_advisory_xact_lock(91002)`);
    const [target] = await tx.select({ accessLevel: appUser.accessLevel, status: appUser.status })
      .from(appUser).where(eq(appUser.id, userId));
    if (!target) throw new DaoError('USER_NOT_FOUND');
    if (target.accessLevel === 'administrator' && target.status === 'active' && level !== 'administrator') {
      await assertNotLastActiveAdmin(tx, userId);
    }
    await setAccessLevel(tx, userId, level);
  });
}

/** Guarded enable/disable (spec §5.3): no self-disable, never zero active admins. */
export async function setUserStatusGuarded(
  db: Db, actorId: string, userId: string, status: 'active' | 'disabled',
): Promise<void> {
  if (actorId === userId && status === 'disabled') {
    throw new DaoError('SELF_CHANGE_FORBIDDEN', 'You cannot disable your own account');
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(91002)`);
    const [target] = await tx.select({ accessLevel: appUser.accessLevel, status: appUser.status })
      .from(appUser).where(eq(appUser.id, userId));
    if (!target) throw new DaoError('USER_NOT_FOUND');
    if (status === 'disabled' && target.accessLevel === 'administrator' && target.status === 'active') {
      await assertNotLastActiveAdmin(tx, userId);
    }
    await setUserStatus(tx, userId, status);
  });
}
