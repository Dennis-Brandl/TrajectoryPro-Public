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

import { and, eq, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { workCenter, workCenterControlGrant, CONTROL_GRANT_SCOPES, type ControlGrantScope } from '../db/schema/index.js';
import { DaoError } from './errors.js';
import type { Schema } from '../db/client.js';

type Db = PgDatabase<any, Schema>;

export type ControlGrantView = {
  sourceWorkCenterId: string; sourceWorkCenterName: string;
  targetWorkCenterId: string; targetWorkCenterName: string;
  scope: ControlGrantScope; createdAt: Date;
};

const src = alias(workCenter, 'src_wc');
const tgt = alias(workCenter, 'tgt_wc');

/** Spec 2026-10-15 §2.2 (R7): grants FROM this work center (it may control others) and TO it. */
export async function listControlGrants(db: Db, workCenterId: string): Promise<{ outgoing: ControlGrantView[]; incoming: ControlGrantView[] }> {
  const rows = await db.select({
    sourceWorkCenterId: workCenterControlGrant.sourceWorkCenterId, sourceWorkCenterName: src.name,
    targetWorkCenterId: workCenterControlGrant.targetWorkCenterId, targetWorkCenterName: tgt.name,
    scope: workCenterControlGrant.scope, createdAt: workCenterControlGrant.createdAt,
  }).from(workCenterControlGrant)
    .innerJoin(src, eq(src.id, workCenterControlGrant.sourceWorkCenterId))
    .innerJoin(tgt, eq(tgt.id, workCenterControlGrant.targetWorkCenterId))
    .where(or(eq(workCenterControlGrant.sourceWorkCenterId, workCenterId), eq(workCenterControlGrant.targetWorkCenterId, workCenterId)))
    .orderBy(src.name, tgt.name);
  const views = rows as ControlGrantView[];
  return {
    outgoing: views.filter((v) => v.sourceWorkCenterId === workCenterId),
    incoming: views.filter((v) => v.targetWorkCenterId === workCenterId),
  };
}

export async function setControlGrant(db: Db, input: {
  sourceWorkCenterId: string; targetWorkCenterId: string; scope: ControlGrantScope; userId: string | null;
}): Promise<void> {
  if (!(CONTROL_GRANT_SCOPES as readonly string[]).includes(input.scope)) {
    throw new DaoError('CONTROL_GRANT_INVALID', `Unknown grant scope: ${String(input.scope)}`);
  }
  if (input.sourceWorkCenterId === input.targetWorkCenterId) {
    throw new DaoError('CONTROL_GRANT_INVALID', 'A work center always controls its own runtimes; no grant is needed');
  }
  const found = await db.select({ id: workCenter.id }).from(workCenter)
    .where(or(eq(workCenter.id, input.sourceWorkCenterId), eq(workCenter.id, input.targetWorkCenterId)));
  if (found.length < 2) throw new DaoError('WORK_CENTER_NOT_FOUND');
  await db.insert(workCenterControlGrant).values({
    sourceWorkCenterId: input.sourceWorkCenterId, targetWorkCenterId: input.targetWorkCenterId,
    scope: input.scope, createdBy: input.userId,
  }).onConflictDoUpdate({
    target: [workCenterControlGrant.sourceWorkCenterId, workCenterControlGrant.targetWorkCenterId],
    set: { scope: input.scope, createdBy: input.userId, createdAt: new Date() },
  });
}

export async function deleteControlGrant(db: Db, sourceWorkCenterId: string, targetWorkCenterId: string): Promise<void> {
  await db.delete(workCenterControlGrant).where(and(
    eq(workCenterControlGrant.sourceWorkCenterId, sourceWorkCenterId),
    eq(workCenterControlGrant.targetWorkCenterId, targetWorkCenterId)));
}

export async function getControlGrantScope(db: Db, sourceWorkCenterId: string, targetWorkCenterId: string): Promise<ControlGrantScope | null> {
  const [row] = await db.select({ scope: workCenterControlGrant.scope }).from(workCenterControlGrant).where(and(
    eq(workCenterControlGrant.sourceWorkCenterId, sourceWorkCenterId),
    eq(workCenterControlGrant.targetWorkCenterId, targetWorkCenterId)));
  return (row?.scope as ControlGrantScope | undefined) ?? null;
}
