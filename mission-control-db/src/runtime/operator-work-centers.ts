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

import { and, eq, inArray } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { instanceAssignment, stepInstance, LIVE_ASSIGNMENT_STATUSES } from '../db/schema/execution.js';
import { workCenter, workCenterUser, workCenterUserRole } from '../db/schema/work-centers.js';
import type { Schema } from '../db/client.js';
import { isAssignmentVisibleTo } from './inbox.js';

type Db = PgDatabase<any, Schema>;

/** One card on the Pilot's work-center picker (spec 2026-10-09 §5.5). */
export interface OperatorWorkCenter {
  id: string;
  name: string;
  /** Ancestor names from the root down to the parent; [] for a root work center. */
  path: string[];
  /** What this operator's inbox there would list: visible offers plus their own live claims. */
  openTasks: number;
}

/** The step states buildInbox lists a claim for (its myClaims narrowing). */
const CLAIM_LISTED_STATES = new Set(['WAITING_USER', 'PAUSED']);

export async function listOperatorWorkCenters(db: Db, userId: string): Promise<OperatorWorkCenter[]> {
  const memberIds = (await db.select({ id: workCenterUser.workCenterId }).from(workCenterUser)
    .where(eq(workCenterUser.userId, userId))).map((r) => r.id);
  if (memberIds.length === 0) return [];

  // The whole tree is small (tens of rows): one read beats a recursive query per card.
  const all = await db.select({ id: workCenter.id, name: workCenter.name, parentId: workCenter.parentWorkCenterId })
    .from(workCenter);
  const byId = new Map(all.map((w) => [w.id, w]));
  const pathOf = (id: string): string[] => {
    const names: string[] = [];
    const seen = new Set([id]);
    let parentId = byId.get(id)?.parentId ?? null;
    // `seen` ends a corrupt parent cycle instead of looping forever.
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      names.unshift(parent.name);
      parentId = parent.parentId;
    }
    return names;
  };

  // Roles count only in the work center that grants them (spec 2026-09-06).
  const roleRows = await db.select({ wcId: workCenterUserRole.workCenterId, roleId: workCenterUserRole.roleId })
    .from(workCenterUserRole).where(eq(workCenterUserRole.userId, userId));
  const rolesByWc = new Map<string, Set<string>>();
  for (const r of roleRows) {
    const set = rolesByWc.get(r.wcId) ?? new Set<string>();
    set.add(r.roleId);
    rolesByWc.set(r.wcId, set);
  }

  const live = await db.select({
    wcId: instanceAssignment.workCenterId,
    status: instanceAssignment.status,
    assignedUserId: instanceAssignment.assignedUserId,
    allowedRoleIds: instanceAssignment.allowedRoleIds,
    stepState: stepInstance.state,
  }).from(instanceAssignment)
    .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
    .where(and(
      inArray(instanceAssignment.workCenterId, memberIds),
      inArray(instanceAssignment.status, [...LIVE_ASSIGNMENT_STATUSES]),
    ));
  const counts = new Map<string, number>();
  for (const a of live) {
    if (!isAssignmentVisibleTo(a, a.stepState, userId, rolesByWc.get(a.wcId) ?? new Set<string>())) continue;
    if (a.status === 'claimed' && !CLAIM_LISTED_STATES.has(a.stepState)) continue;
    counts.set(a.wcId, (counts.get(a.wcId) ?? 0) + 1);
  }

  const sortKey = (w: OperatorWorkCenter) => [...w.path, w.name].join('\u0000');
  return memberIds
    .filter((id) => byId.has(id))
    .map((id) => ({ id, name: byId.get(id)!.name, path: pathOf(id), openTasks: counts.get(id) ?? 0 }))
    .sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
}
