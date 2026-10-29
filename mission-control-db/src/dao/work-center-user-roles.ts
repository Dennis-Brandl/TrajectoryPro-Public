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

import { and, asc, eq, getTableColumns } from 'drizzle-orm';
import {
  workCenter, workCenterUser, workCenterUserRole, role, appUser,
  type WorkCenter, type Role, type AppUser,
} from '../db/schema/index.js';
import { DaoError, pgErrorCode } from './errors.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

/** One work center a user belongs to, with the roles held THERE (spec 2026-09-06 §4.3). */
export type UserWorkCenterMembership = { workCenter: WorkCenter; missionSystemCommander: boolean; roles: Role[] };
/** One work center in which somebody holds a role, with those users. */
export type RoleWorkCenterMembers = { workCenter: WorkCenter; users: AppUser[] };

async function isMember(db: Db, workCenterId: string, userId: string): Promise<boolean> {
  const [row] = await db.select({ userId: workCenterUser.userId }).from(workCenterUser)
    .where(and(eq(workCenterUser.workCenterId, workCenterId), eq(workCenterUser.userId, userId)));
  return row !== undefined;
}

/**
 * Atomic whole-set replace of U's roles in W — the same shape as the allowed-roles editor:
 * the caller sends the complete desired set, an omitted role reads as "removed". Non-member
 * (checked up front so an empty set on a non-member is not a silent success) and unknown
 * role id (FK 23503 on insert) both surface as LINK_TARGET_NOT_FOUND. Every row in the new
 * set gets a fresh assigned_at; preserving it for roles already held is not worth the code.
 */
export async function setWorkCenterUserRoles(
  db: Db, workCenterId: string, userId: string, roleIds: string[],
): Promise<void> {
  const wanted = [...new Set(roleIds)];
  await db.transaction(async (tx) => {
    if (!(await isMember(tx, workCenterId, userId))) throw new DaoError('LINK_TARGET_NOT_FOUND', 'User is not a member of this work center');
    await tx.delete(workCenterUserRole)
      .where(and(eq(workCenterUserRole.workCenterId, workCenterId), eq(workCenterUserRole.userId, userId)));
    if (wanted.length === 0) return;
    try {
      await tx.insert(workCenterUserRole).values(wanted.map((roleId) => ({ workCenterId, userId, roleId })));
    } catch (err) {
      if (pgErrorCode(err) === '23503') throw new DaoError('LINK_TARGET_NOT_FOUND', 'Unknown role');
      throw err;
    }
  });
}

export function rolesForUserInWorkCenter(db: Db, workCenterId: string, userId: string): Promise<Role[]> {
  return db.select(getTableColumns(role)).from(workCenterUserRole)
    .innerJoin(role, eq(role.id, workCenterUserRole.roleId))
    .where(and(eq(workCenterUserRole.workCenterId, workCenterId), eq(workCenterUserRole.userId, userId)))
    .orderBy(asc(role.name));
}

/** userId → name-sorted roles, for the work-center view's member rows (one grouped query). */
export async function rolesForWorkCenterMembers(db: Db, workCenterId: string): Promise<Map<string, Role[]>> {
  const rows = await db.select({ userId: workCenterUserRole.userId, role: getTableColumns(role) })
    .from(workCenterUserRole)
    .innerJoin(role, eq(role.id, workCenterUserRole.roleId))
    .where(eq(workCenterUserRole.workCenterId, workCenterId))
    .orderBy(asc(role.name));
  const out = new Map<string, Role[]>();
  for (const r of rows) {
    const list = out.get(r.userId) ?? [];
    list.push(r.role);
    out.set(r.userId, list);
  }
  return out;
}

export async function workCenterMembershipsForUser(db: Db, userId: string): Promise<UserWorkCenterMembership[]> {
  const memberships = await db.select({ workCenter: getTableColumns(workCenter), missionSystemCommander: workCenterUser.missionSystemCommander })
    .from(workCenterUser)
    .innerJoin(workCenter, eq(workCenter.id, workCenterUser.workCenterId))
    .where(eq(workCenterUser.userId, userId))
    .orderBy(asc(workCenter.name));
  const roleRows = await db.select({ workCenterId: workCenterUserRole.workCenterId, role: getTableColumns(role) })
    .from(workCenterUserRole)
    .innerJoin(role, eq(role.id, workCenterUserRole.roleId))
    .where(eq(workCenterUserRole.userId, userId))
    .orderBy(asc(role.name));
  const rolesByWc = new Map<string, Role[]>();
  for (const r of roleRows) {
    const list = rolesByWc.get(r.workCenterId) ?? [];
    list.push(r.role);
    rolesByWc.set(r.workCenterId, list);
  }
  return memberships.map((m) => ({ ...m, roles: rolesByWc.get(m.workCenter.id) ?? [] }));
}

/**
 * Work-center names are unique only among siblings (schema/work-centers.ts): two work
 * centers named alike under different parents are legal, so rows for distinct work centers
 * can interleave under an ORDER BY name. Group through a Map keyed by work-center id (as
 * workCenterMembershipsForUser does above), not by consecutive row runs.
 */
export async function membersForRole(db: Db, roleId: string): Promise<RoleWorkCenterMembers[]> {
  const rows = await db.select({ workCenter: getTableColumns(workCenter), user: getTableColumns(appUser) })
    .from(workCenterUserRole)
    .innerJoin(workCenter, eq(workCenter.id, workCenterUserRole.workCenterId))
    .innerJoin(appUser, eq(appUser.id, workCenterUserRole.userId))
    .where(eq(workCenterUserRole.roleId, roleId))
    .orderBy(asc(workCenter.name), asc(workCenter.id), asc(appUser.displayName));
  const byWcId = new Map<string, RoleWorkCenterMembers>();
  for (const r of rows) {
    const existing = byWcId.get(r.workCenter.id);
    if (existing) existing.users.push(r.user);
    else byWcId.set(r.workCenter.id, { workCenter: r.workCenter, users: [r.user] });
  }
  return [...byWcId.values()];
}

/** The e-signature predicate (sub-project 2) and anything else that asks "R in W?" */
export async function userHoldsRoleInWorkCenter(db: Db, workCenterId: string, userId: string, roleId: string): Promise<boolean> {
  const [row] = await db.select({ roleId: workCenterUserRole.roleId }).from(workCenterUserRole)
    .where(and(
      eq(workCenterUserRole.workCenterId, workCenterId),
      eq(workCenterUserRole.userId, userId),
      eq(workCenterUserRole.roleId, roleId),
    ));
  return row !== undefined;
}
