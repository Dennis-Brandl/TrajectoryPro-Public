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

import { asc, eq } from 'drizzle-orm';
import { role, type Role, type NewRole } from '../db/schema/index.js';
import { DaoError, pgErrorCode } from './errors.js';
import { assertNameLength } from './names.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

export async function createRole(db: Db, input: NewRole): Promise<Role> {
  assertNameLength(input.name);
  try {
    const [r] = await db.insert(role).values(input).returning();
    return r!;
  } catch (err) {
    if (pgErrorCode(err) === '23505') throw new DaoError('ROLE_NAME_CONFLICT', `Role name already exists: ${input.name}`);
    throw err;
  }
}

export function listRoles(db: Db): Promise<Role[]> {
  return db.select().from(role).orderBy(asc(role.name));
}

/** Exact-name lookup after trimming (spec 2026-09-06 D8: role.name is UNIQUE and case-sensitive). */
export async function findRoleByName(db: Db, name: string): Promise<Role | null> {
  const [r] = await db.select().from(role).where(eq(role.name, name.trim()));
  return r ?? null;
}

export async function updateRole(
  db: Db,
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<Role> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(role).where(eq(role.id, id));
    if (!current) throw new DaoError('ROLE_NOT_FOUND');
    if (current.isSystem) throw new DaoError('SYSTEM_ROLE', 'System roles cannot be edited');
    if (patch.name !== undefined) assertNameLength(patch.name);
    try {
      const [r] = await tx.update(role).set({ ...patch, updatedAt: new Date() }).where(eq(role.id, id)).returning();
      return r!;
    } catch (err) {
      if (pgErrorCode(err) === '23505') throw new DaoError('ROLE_NAME_CONFLICT', `Role name already exists: ${patch.name}`);
      throw err;
    }
  });
}

export async function deleteRole(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(role).where(eq(role.id, id));
    if (!current) throw new DaoError('ROLE_NOT_FOUND');
    if (current.isSystem) throw new DaoError('SYSTEM_ROLE', 'System roles cannot be deleted');
    try {
      await tx.delete(role).where(eq(role.id, id));
    } catch (err) {
      // allowed-role rows and e-signature links (workflow_signature_role) RESTRICT role
      // deletion (spec decision 4); work_center_user_role membership cascades.
      if (pgErrorCode(err) === '23503') throw new DaoError('ROLE_IN_USE', 'Role is referenced by a loaded workflow (allowed-role assignment or e-signature)');
      throw err;
    }
  });
}
