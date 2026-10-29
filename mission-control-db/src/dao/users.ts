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

import { eq } from 'drizzle-orm';
import { appUser, type AppUser, type NewAppUser } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { DaoError, pgErrorCode, pgViolates } from './errors.js';
import { roleForLevel, type AccessLevel } from './access.js';

type Db = PgDatabase<any, Schema>;

/** Spec 2026-09-06 D6: 2–64 chars of [a-z0-9._-], starting with a letter or digit. Mirrored
 *  by the app_user_login_name_ck CHECK (migration 0031) — the DAO check yields a typed
 *  LOGIN_NAME_INVALID instead of a raw 23514. */
export const LOGIN_NAME_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
export function normalizeLoginName(raw: string): string { return raw.trim().toLowerCase(); }
export function isValidLoginName(s: string): boolean { return LOGIN_NAME_RE.test(s); }
const LOGIN_NAME_INVALID_MESSAGE = 'Login name must be 2–64 characters of lowercase letters, digits, dot, underscore or hyphen, starting with a letter or digit';
function assertLoginName(raw: string): string {
  const s = normalizeLoginName(raw);
  if (!isValidLoginName(s)) {
    throw new DaoError('LOGIN_NAME_INVALID', LOGIN_NAME_INVALID_MESSAGE);
  }
  return s;
}
/**
 * Maps both login-name constraint violations the DB can still raise beneath the DAO-level
 * assertLoginName check: 23505 on app_user_login_name_unique (a race, or a caller that bypassed
 * assertLoginName) and 23514 on app_user_login_name_ck (belt-and-suspenders — the DAO regex
 * mirrors the CHECK, but the CHECK is the ground truth). Also 23505 on app_user_email_unique →
 * EMAIL_CONFLICT for an email change that lost a race. Everything else rethrows unchanged.
 */
export function mapLoginNameError(err: unknown): never {
  if (pgErrorCode(err) === '23505' && pgViolates(err, 'app_user_email_unique')) {
    throw new DaoError('EMAIL_CONFLICT', 'Email already in use');
  }
  if (pgErrorCode(err) === '23505' && pgViolates(err, 'app_user_login_name_unique')) {
    throw new DaoError('LOGIN_NAME_CONFLICT', 'Login name already in use');
  }
  if (pgErrorCode(err) === '23514' && pgViolates(err, 'app_user_login_name_ck')) {
    throw new DaoError('LOGIN_NAME_INVALID', LOGIN_NAME_INVALID_MESSAGE);
  }
  throw err;
}

/**
 * The better-auth `role` mirror is derived from accessLevel HERE so every insert path upholds
 * the invariant (see access.ts setAccessLevel, which does the same on update) — callers can no
 * longer create a mirror-broken row by passing (or omitting) `role` directly.
 * loginName: validated when given; when omitted the 0031 trigger derives one from the email.
 */
export async function createUser(db: Db, input: NewAppUser): Promise<AppUser> {
  const withRole: NewAppUser = { ...input, role: roleForLevel((input.accessLevel ?? 'viewer') as AccessLevel) };
  if (input.loginName !== undefined && input.loginName !== '') withRole.loginName = assertLoginName(input.loginName);
  else delete withRole.loginName;
  try {
    const [u] = await db.insert(appUser).values(withRole).returning();
    return u!;
  } catch (err) {
    return mapLoginNameError(err);
  }
}
export function listUsers(db: Db): Promise<AppUser[]> {
  return db.select().from(appUser);
}
export async function setUserStatus(db: Db, id: string, status: 'active' | 'disabled'): Promise<void> {
  await db.update(appUser).set({ status, updatedAt: new Date() }).where(eq(appUser.id, id));
}
/** better-auth stores emails lowercased and signs in by exact match, so a changed email is
 *  normalised the same way or the user could no longer sign in with it. */
export function normalizeEmail(raw: string): string { return raw.trim().toLowerCase(); }
export function isValidEmail(s: string): boolean { return /^\S+@\S+\.\S+$/.test(s); }
function assertEmail(raw: string): string {
  const s = normalizeEmail(raw);
  if (!isValidEmail(s)) throw new DaoError('EMAIL_INVALID', 'A valid email is required');
  return s;
}

export async function updateUser(
  db: Db, id: string, patch: { displayName?: string; loginName?: string; email?: string },
): Promise<AppUser> {
  const set: { displayName?: string; loginName?: string; email?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (patch.displayName !== undefined) set.displayName = patch.displayName;
  if (patch.loginName !== undefined) set.loginName = assertLoginName(patch.loginName);
  if (patch.email !== undefined) set.email = assertEmail(patch.email);
  try {
    const [u] = await db.update(appUser).set(set).where(eq(appUser.id, id)).returning();
    if (!u) throw new DaoError('USER_NOT_FOUND');
    return u;
  } catch (err) {
    return mapLoginNameError(err);
  }
}
/** Case-insensitive lookup (login names are stored normalised). */
export async function findUserByLoginName(db: Db, loginName: string): Promise<AppUser | null> {
  const [u] = await db.select().from(appUser).where(eq(appUser.loginName, normalizeLoginName(loginName)));
  return u ?? null;
}
