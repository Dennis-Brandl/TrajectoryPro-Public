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

import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { workCenter, workCenterEnvironmentBinding } from '../db/schema/index.js';
import { DaoError } from './errors.js';
import type { Schema } from '../db/client.js';

type Db = PgDatabase<any, Schema>;

async function assertWorkCenter(db: Db, workCenterId: string): Promise<void> {
  const row = await db.select({ id: workCenter.id }).from(workCenter).where(eq(workCenter.id, workCenterId));
  if (row.length === 0) throw new DaoError('WORK_CENTER_NOT_FOUND');
}

export async function listEnvironmentBindings(db: Db, workCenterId: string) {
  await assertWorkCenter(db, workCenterId);
  return db.select({
    environmentOid: workCenterEnvironmentBinding.environmentOid,
    serverUri: workCenterEnvironmentBinding.serverUri,
    updatedAt: workCenterEnvironmentBinding.updatedAt,
  }).from(workCenterEnvironmentBinding)
    .where(eq(workCenterEnvironmentBinding.workCenterId, workCenterId))
    .orderBy(workCenterEnvironmentBinding.environmentOid);
}

export async function setEnvironmentBinding(db: Db, input: { workCenterId: string; environmentOid: string; serverUri: string; userId: string | null }): Promise<void> {
  await assertWorkCenter(db, input.workCenterId);
  if (input.serverUri === '') {
    await db.delete(workCenterEnvironmentBinding).where(and(
      eq(workCenterEnvironmentBinding.workCenterId, input.workCenterId),
      eq(workCenterEnvironmentBinding.environmentOid, input.environmentOid)));
    return;
  }
  await db.insert(workCenterEnvironmentBinding)
    .values({ workCenterId: input.workCenterId, environmentOid: input.environmentOid, serverUri: input.serverUri, updatedBy: input.userId })
    .onConflictDoUpdate({
      target: [workCenterEnvironmentBinding.workCenterId, workCenterEnvironmentBinding.environmentOid],
      set: { serverUri: input.serverUri, updatedAt: new Date(), updatedBy: input.userId },
    });
}

export async function getEnvironmentBinding(db: Db, workCenterId: string, environmentOid: string): Promise<string | null> {
  const rows = await db.select({ serverUri: workCenterEnvironmentBinding.serverUri })
    .from(workCenterEnvironmentBinding)
    .where(and(eq(workCenterEnvironmentBinding.workCenterId, workCenterId), eq(workCenterEnvironmentBinding.environmentOid, environmentOid)));
  return rows[0]?.serverUri ?? null;
}
