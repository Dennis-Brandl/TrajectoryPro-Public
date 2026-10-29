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

import { and, eq, inArray, sql } from 'drizzle-orm';
import { appUser } from '../db/schema/identity.js';
import { workCenter, workCenterUser, workCenterUserRole } from '../db/schema/work-centers.js';
import { workflow } from '../db/schema/workflows.js';
import { operatorPresence, instanceAssignment } from '../db/schema/execution.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

// The dispatch override used to live on the retired work_center_workflow link row; it is
// now a plain column on the workflow entry itself (spec: dispatchPolicy absorbed onto
// workflow), so the override lookup is a direct read with no link hop. Falls back to the
// work center's own default when the workflow entry has none set.
export async function effectiveDispatchPolicy(db: Db, workCenterId: string, workflowId: string): Promise<string> {
  const [wf] = await db.select({ p: workflow.dispatchPolicy }).from(workflow).where(eq(workflow.id, workflowId));
  if (wf?.p) return wf.p;
  const [wc] = await db.select({ p: workCenter.dispatchPolicy }).from(workCenter).where(eq(workCenter.id, workCenterId));
  return wc?.p ?? 'least_queued_steps';
}

// Auto-claim chains (spec 2026-08-14 D4): same override shape as effectiveDispatchPolicy —
// the workflow entry's tri-state (true/false/null) beats the work center's default; absent
// everything = false (feature off).
export async function effectiveAutoClaim(db: Db, workCenterId: string, workflowId: string): Promise<boolean> {
  const [wf] = await db.select({ a: workflow.autoClaim }).from(workflow).where(eq(workflow.id, workflowId));
  if (wf?.a != null) return wf.a;
  const [wc] = await db.select({ a: workCenter.autoClaim }).from(workCenter).where(eq(workCenter.id, workCenterId));
  return wc?.a ?? false;
}

export interface OnlineCandidate { userId: string; priority: number; matchedRoleId: string | null; }

/** Distinct online eligible users for a step's allowed-role set (spec 2026-08-17 D11):
 *  work-center members with an 'online' presence row attending this work center; a
 *  role-restricted set joins work_center_user_role for THIS work center, unrestricted ([]) admits every online member.
 *  One row per USER — the role join returns one row per (user, matched role) and the
 *  sole-candidate rule counts users, so duplicates are collapsed (first matched role kept). */
export async function listOnlineCandidates(
  db: Db,
  args: { workCenterId: string; allowedRoleIds: string[] },
): Promise<OnlineCandidate[]> {
  const present = and(
    eq(operatorPresence.attendingWorkCenterId, args.workCenterId),
    eq(operatorPresence.status, 'online'),
  );
  if (args.allowedRoleIds.length === 0) {
    const rows = await db
      .select({ userId: appUser.id, priority: workCenterUser.priority })
      .from(operatorPresence)
      .innerJoin(appUser, eq(appUser.id, operatorPresence.userId))
      .innerJoin(workCenterUser, and(eq(workCenterUser.userId, appUser.id), eq(workCenterUser.workCenterId, args.workCenterId)))
      .where(present);
    return rows.map((r) => ({ ...r, matchedRoleId: null }));
  }
  // Spec 2026-09-06: the role join is per work center. work_center_user stays joined for
  // `priority` (the composite FK already guarantees membership).
  const rows = await db
    .select({ userId: appUser.id, priority: workCenterUser.priority, matchedRoleId: workCenterUserRole.roleId })
    .from(operatorPresence)
    .innerJoin(appUser, eq(appUser.id, operatorPresence.userId))
    .innerJoin(workCenterUser, and(eq(workCenterUser.userId, appUser.id), eq(workCenterUser.workCenterId, args.workCenterId)))
    .innerJoin(workCenterUserRole, and(
      eq(workCenterUserRole.userId, appUser.id),
      eq(workCenterUserRole.workCenterId, args.workCenterId),
    ))
    .where(and(present, inArray(workCenterUserRole.roleId, args.allowedRoleIds)));
  const byUser = new Map<string, OnlineCandidate>();
  for (const r of rows) if (!byUser.has(r.userId)) byUser.set(r.userId, r);
  return [...byUser.values()];
}

export interface DispatchSuggestion { preferredUserId: string | null; policy: string; reason: string; }

/**
 * Suggest-only dispatch (spec 2026-08-03 F6): pick a preferred user for an offer. Presence is
 * a sensible input for SUGGESTING (an absent user is a useless suggestion) even though it never
 * gates VISIBILITY (F5). `manual` and empty candidate pools yield no preference — pure pull.
 * round_robin / fewest_active_instances keep their documented fallback to least-queued.
 */
export async function computeSuggestion(
  db: Db,
  args: { workCenterId: string; workflowId: string; allowedRoleIds: string[] },
): Promise<DispatchSuggestion> {
  const policy = await effectiveDispatchPolicy(db, args.workCenterId, args.workflowId);
  if (args.allowedRoleIds.length === 0) {
    return { preferredUserId: null, policy, reason: 'unrestricted: pull-based claim' };
  }

  const candidates = await listOnlineCandidates(db, args);

  if (candidates.length === 0) return { preferredUserId: null, policy, reason: 'no candidate' };
  if (policy === 'manual') return { preferredUserId: null, policy, reason: 'manual: pull-based claim' };

  if (policy === 'highest_priority') {
    // Non-null [0]: candidates.length === 0 already returned above (this file is checked
    // under noUncheckedIndexedAccess by the Pilot's tsc -b, unlike its own tsconfig).
    const chosen = [...candidates].sort((a, b) => b.priority - a.priority)[0]!;
    return { preferredUserId: chosen.userId, policy, reason: `highest_priority: ${chosen.priority}` };
  }

  // least_queued_steps (default); round_robin / fewest_active_instances fall back for now.
  const counts = await Promise.all(candidates.map(async (c) => {
    // count(*) always yields exactly one row — rows[0] cannot be absent.
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(instanceAssignment)
      .where(and(eq(instanceAssignment.assignedUserId, c.userId), eq(instanceAssignment.status, 'claimed')));
    return { c, n: rows[0]!.n };
  }));
  // Non-null [0]: counts mirrors candidates, proven non-empty above.
  const best = counts.sort((a, b) => a.n - b.n)[0]!;
  return { preferredUserId: best.c.userId, policy, reason: `least_queued_steps: ${best.n}` };
}
