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

import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { workflowInstance, stepInstance, instanceAssignment, operatorPresence, LIVE_ASSIGNMENT_STATUSES } from '../db/schema/execution.js';
import { workflowNode } from '../db/schema/workflows.js';
import { workCenterUser, workCenterUserRole, workflowAllowedRole } from '../db/schema/work-centers.js';
import { computeSuggestion, effectiveAutoClaim, listOnlineCandidates } from './dispatch.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

/** Walk the frozen control-recipe tree for the spec object whose (remapped) oid matches and
 *  return its instantiateSpec-stamped master_oid. null = unknown (pre-stamp legacy recipe or
 *  unknown node) — callers treat that as unrestricted. */
export function masterNodeOidFor(specJsonb: unknown, recipeNodeOid: string): string | null {
  const visit = (spec: unknown): string | null => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
    const s = spec as Record<string, unknown>;
    if (s.oid === recipeNodeOid) return typeof s.master_oid === 'string' ? s.master_oid : null;
    if (Array.isArray(s.children)) {
      for (const c of s.children) { const hit = visit(c); if (hit !== null) return hit; }
    }
    return null;
  };
  return visit(specJsonb);
}

/** The recipe node's master oid followed by each ancestor's, nearest first, from the frozen
 *  control-recipe tree. [] = unknown recipe node, or the node itself unstamped (pre-stamp
 *  legacy recipe) — callers treat that as unrestricted. An unstamped ANCESTOR is skipped. */
export function masterNodeOidChainFor(specJsonb: unknown, recipeNodeOid: string): string[] {
  const visit = (spec: unknown, ancestors: Record<string, unknown>[]): Record<string, unknown>[] | null => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
    const s = spec as Record<string, unknown>;
    if (s.oid === recipeNodeOid) return [s, ...ancestors];
    if (Array.isArray(s.children)) {
      for (const c of s.children) { const hit = visit(c, [s, ...ancestors]); if (hit) return hit; }
    }
    return null;
  };
  const path = visit(specJsonb, []);
  if (!path || typeof path[0]!.master_oid !== 'string') return [];
  return path.flatMap((n) => (typeof n.master_oid === 'string' ? [n.master_oid] : []));
}

/** Live allowed-role set for a parked step, resolved through the RUNTIME'S SNAPSHOT ancestry
 *  (spec 2026-10-18 §2.1): for the recipe node and then each of its snapshot ancestors, the
 *  live workflow_node with that master oid; the grants of the first one that has any win.
 *  Walking the snapshot rather than the live parent_node_id chain matters because a Draft
 *  reload re-parents nodes in place — a running step must keep the roles it started under,
 *  not inherit from whatever its node now sits beneath. A master node missing from the live
 *  tree is skipped (a reload retains removed nodes while a runtime is unfinished, so this is
 *  rare). Empty array = unrestricted (any WC member). */
export async function resolveStepAllowedRoles(
  db: Db,
  args: { workflowId: string; specJsonb: unknown; recipeNodeOid: string },
): Promise<string[]> {
  for (const masterOid of masterNodeOidChainFor(args.specJsonb, args.recipeNodeOid)) {
    const rows = await db.select({ roleId: workflowAllowedRole.roleId })
      .from(workflowAllowedRole)
      .innerJoin(workflowNode, eq(workflowNode.id, workflowAllowedRole.workflowNodeId))
      .where(and(
        eq(workflowAllowedRole.workflowId, args.workflowId),
        eq(workflowNode.workflowId, args.workflowId),
        eq(workflowNode.nodeOid, masterOid),
      ));
    if (rows.length) return rows.map((r) => r.roleId);
  }
  return [];
}

/** Chain memory (spec 2026-08-14 D6): most recent claimant in the same (instance, nodeOid)
 *  scope. 'claimed' still counts (a held step seeds the chain); released/force-released rows
 *  have assignedUserId nulled and drop out; 'cancelled' is teardown noise and excluded.
 *
 *  Each assignment must also AGREE with its step's CURRENT state (review fix): a child
 *  workflow re-entered by a loop/GOTO resets its COMPLETED step rows to READY without
 *  touching their run-1 'completed' assignments, and counting those would hand the child's
 *  first run-2 step pre-claimed to the run-1 operator — exactly the role boundary the spec's
 *  child rule exists to protect. A completed assignment whose step is no longer COMPLETED
 *  (or a claimed one whose step left the parked states) belongs to a PRIOR execution of the
 *  scope and is dead memory. isNotNull(claimedAt) guards the DESC NULLS FIRST default from
 *  ever ranking a hypothetical claimedAt-less row above the genuine latest claimant. */
async function chainUserForScope(db: Db, instanceId: string, nodeOid: string): Promise<string | null> {
  const [row] = await db.select({ userId: instanceAssignment.assignedUserId })
    .from(instanceAssignment)
    .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
    .where(and(
      eq(stepInstance.workflowInstanceId, instanceId),
      eq(stepInstance.nodeOid, nodeOid),
      or(
        and(eq(instanceAssignment.status, 'completed'), eq(stepInstance.state, 'COMPLETED')),
        and(eq(instanceAssignment.status, 'claimed'), inArray(stepInstance.state, ['WAITING_USER', 'PAUSED'])),
      ),
      isNotNull(instanceAssignment.assignedUserId),
      isNotNull(instanceAssignment.claimedAt),
    ))
    .orderBy(desc(instanceAssignment.claimedAt))
    .limit(1);
  return row?.userId ?? null;
}

/** The per-user half of auto-claim eligibility (spec 2026-08-14 D7 a+c): work-center member
 *  AND online-present — one joined query, memoizable per user across a reconcile's loop
 *  because it does not depend on the step. The role half stays per-step (allowed sets differ
 *  between scopes) in resolveChainRole below; together they mirror the claim route's live
 *  re-check plus the presence guard. */
async function isPresentMember(db: Db, userId: string, workCenterId: string): Promise<boolean> {
  const [row] = await db.select({ userId: workCenterUser.userId })
    .from(workCenterUser)
    .innerJoin(operatorPresence, and(
      eq(operatorPresence.userId, workCenterUser.userId),
      eq(operatorPresence.attendingWorkCenterId, workCenterUser.workCenterId),
      eq(operatorPresence.status, 'online'),
    ))
    .where(and(eq(workCenterUser.workCenterId, workCenterId), eq(workCenterUser.userId, userId)));
  return row !== undefined;
}

/** The per-step half of D7 (b): role eligibility against this step's allowed set, held IN
 *  THIS work center (spec 2026-09-06). resolvedRoleId null = unrestricted scope (same as
 *  the claim route). */
async function resolveChainRole(
  db: Db, userId: string, workCenterId: string, allowedRoleIds: string[],
): Promise<{ ok: boolean; resolvedRoleId: string | null }> {
  if (allowedRoleIds.length === 0) return { ok: true, resolvedRoleId: null };
  const mine = await db.select({ roleId: workCenterUserRole.roleId }).from(workCenterUserRole)
    .where(and(
      eq(workCenterUserRole.workCenterId, workCenterId),
      eq(workCenterUserRole.userId, userId),
      inArray(workCenterUserRole.roleId, allowedRoleIds),
    ));
  if (mine.length === 0) return { ok: false, resolvedRoleId: null };
  // Non-null: the length guard above proves mine[0] exists (Pilot's tsc -b checks this
  // file under noUncheckedIndexedAccess, unlike this package's own tsconfig).
  return { ok: true, resolvedRoleId: mine[0]!.roleId };
}

/** D11: the sole eligible online candidate for a step's LIVE allowed set, or null when the
 *  pool is empty or contested. Lives beside resolveChainRole because it is the same
 *  eligibility question asked pool-wide instead of per-user. */
async function soleCandidateFor(
  db: Db, workCenterId: string, allowed: string[],
): Promise<{ userId: string; resolvedRoleId: string | null } | null> {
  const candidates = await listOnlineCandidates(db, { workCenterId, allowedRoleIds: allowed });
  if (candidates.length !== 1) return null;
  // Non-null: length === 1 is proven one line up (noUncheckedIndexedAccess consumers).
  return { userId: candidates[0]!.userId, resolvedRoleId: candidates[0]!.matchedRoleId };
}

/** Shared SET shape for claiming a row to the sole candidate (D16 audit + D13 marker clear). */
function soleClaimSet(sole: { userId: string; resolvedRoleId: string | null }, now: () => Date) {
  return {
    status: 'claimed' as const,
    assignedUserId: sole.userId,
    preferredUserId: sole.userId,
    resolvedRoleId: sole.resolvedRoleId,
    claimedAt: now(),
    dispatchPolicy: 'auto_claim',
    dispatchReason: 'auto_claim_sole_candidate',
    releasedFromUserId: null,
  };
}

export interface ReconcileResult { changed: boolean; workCenterId: string; }

/**
 * The one offer-lifecycle mechanism (spec §4.1/§4.3): idempotent, computed from ground truth,
 * intended to run INSIDE every engine transaction that claims an instance row.
 *  1. Close every live assignment whose step is no longer WAITING_USER or PAUSED
 *     (COMPLETED step -> 'completed', anything else -> 'cancelled').
 *  2. Offer every WAITING_USER step that has no live assignment (role snapshot + suggestion).
 *  3. Sole-candidate third pass (spec 2026-08-17 D14a): existing offers whose step still
 *     parks at WAITING_USER may auto-claim when exactly one eligible user is online.
 * PAUSED keeps assignments untouched: pause hides offers via the inbox's step-state join,
 * claims survive to resume.
 */
export async function reconcileAssignments(
  db: Db, instanceId: string, now: () => Date,
): Promise<ReconcileResult | null> {
  const [inst] = await db.select({
    workCenterId: workflowInstance.workCenterId,
    workflowId: workflowInstance.workflowId,
    specJsonb: workflowInstance.specJsonb,
  }).from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  if (!inst) return null;

  const steps = await db.select({ id: stepInstance.id, state: stepInstance.state, nodeOid: stepInstance.nodeOid })
    .from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  if (steps.length === 0) return { changed: false, workCenterId: inst.workCenterId };

  const live = await db.select({
    id: instanceAssignment.id,
    stepInstanceId: instanceAssignment.stepInstanceId,
    status: instanceAssignment.status,
    releasedFromUserId: instanceAssignment.releasedFromUserId,
  })
    .from(instanceAssignment)
    .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
    .where(and(
      eq(stepInstance.workflowInstanceId, instanceId),
      inArray(instanceAssignment.status, [...LIVE_ASSIGNMENT_STATUSES]),
    ));

  const stateByStep = new Map(steps.map((s) => [s.id, s.state]));
  const liveByStep = new Set<string>();
  let changed = false;

  for (const a of live) {
    const state = stateByStep.get(a.stepInstanceId);
    if (state === 'WAITING_USER' || state === 'PAUSED') { liveByStep.add(a.stepInstanceId); continue; }
    await db.update(instanceAssignment).set({
      status: state === 'COMPLETED' ? 'completed' : 'cancelled',
      completedAt: now(),
    }).where(eq(instanceAssignment.id, a.id));
    changed = true;
  }

  // Auto-claim chains (spec 2026-08-14): resolved lazily once per reconcile (the flag is per
  // workflow+work-center, not per step); chain memory memoized per scope so a parallel
  // fan-out in one scope claims every branch for the same user (D3). Decisions apply to
  // NEWLY INSERTED offers only (D5) — existing offers (e.g. a released claim) are live rows
  // and never reach this loop.
  let autoClaimOn: boolean | null = null;
  const chainBy = new Map<string, string | null>();
  const presentMemberBy = new Map<string, boolean>();
  const soleBy = new Map<string, { userId: string; resolvedRoleId: string | null } | null>();
  const soleFor = async (allowed: string[]) => {
    const key = [...allowed].sort().join(',');
    if (!soleBy.has(key)) soleBy.set(key, await soleCandidateFor(db, inst.workCenterId, allowed));
    return soleBy.get(key) ?? null;
  };

  for (const s of steps) {
    if (s.state !== 'WAITING_USER' || liveByStep.has(s.id)) continue;
    const allowed = await resolveStepAllowedRoles(db, {
      workflowId: inst.workflowId, specJsonb: inst.specJsonb, recipeNodeOid: s.nodeOid,
    });

    autoClaimOn ??= await effectiveAutoClaim(db, inst.workCenterId, inst.workflowId);
    if (autoClaimOn) {
      if (!chainBy.has(s.nodeOid)) chainBy.set(s.nodeOid, await chainUserForScope(db, instanceId, s.nodeOid));
      const chainUser = chainBy.get(s.nodeOid) ?? null;
      if (chainUser) {
        if (!presentMemberBy.has(chainUser)) {
          presentMemberBy.set(chainUser, await isPresentMember(db, chainUser, inst.workCenterId));
        }
        const elig = presentMemberBy.get(chainUser)
          ? await resolveChainRole(db, chainUser, inst.workCenterId, allowed)
          : { ok: false, resolvedRoleId: null };
        if (elig.ok) {
          await db.insert(instanceAssignment).values({
            stepInstanceId: s.id,
            workCenterId: inst.workCenterId,
            allowedRoleIds: allowed,
            preferredUserId: chainUser,
            assignedUserId: chainUser,
            resolvedRoleId: elig.resolvedRoleId,
            status: 'claimed',
            dispatchPolicy: 'auto_claim',
            dispatchReason: 'auto_claim_chain',
            assignedAt: now(),
            claimedAt: now(),
          });
          changed = true;
          continue;
        }
      }
    }

    // Sole-candidate rule (spec 2026-08-17 D11/D12): where the chain abstains — no memory in
    // this scope (run start, child boundary) or an ineligible chain user — a pool of exactly
    // one eligible online user claims the new offer at birth.
    if (autoClaimOn) {
      const sole = await soleFor(allowed);
      if (sole) {
        await db.insert(instanceAssignment).values({
          stepInstanceId: s.id,
          workCenterId: inst.workCenterId,
          allowedRoleIds: allowed,
          assignedAt: now(),
          ...soleClaimSet(sole, now),
        });
        changed = true;
        continue;
      }
    }

    const suggestion = await computeSuggestion(db, {
      workCenterId: inst.workCenterId, workflowId: inst.workflowId, allowedRoleIds: allowed,
    });
    await db.insert(instanceAssignment).values({
      stepInstanceId: s.id,
      workCenterId: inst.workCenterId,
      allowedRoleIds: allowed,
      preferredUserId: suggestion.preferredUserId,
      status: 'offered',
      dispatchPolicy: suggestion.policy,
      dispatchReason: suggestion.reason,
      assignedAt: now(),
    });
    changed = true;
  }

  // Third pass (spec 2026-08-17 D14a): existing offers whose step still parks at WAITING_USER
  // may claim when exactly one eligible user is online — presence or eligibility changed after
  // the offer was born. Never back to a releaser (D13); never a PAUSED step (D15). The
  // status='offered' guard in the UPDATE keeps a concurrent manual claim authoritative (D17).
  const stepById = new Map(steps.map((st) => [st.id, st]));
  for (const a of live) {
    if (a.status !== 'offered') continue;
    const st = stepById.get(a.stepInstanceId);
    if (!st || st.state !== 'WAITING_USER') continue;
    autoClaimOn ??= await effectiveAutoClaim(db, inst.workCenterId, inst.workflowId);
    if (!autoClaimOn) break;
    const allowed = await resolveStepAllowedRoles(db, {
      workflowId: inst.workflowId, specJsonb: inst.specJsonb, recipeNodeOid: st.nodeOid,
    });
    const sole = await soleFor(allowed);
    if (!sole || a.releasedFromUserId === sole.userId) continue;
    const updated = await db.update(instanceAssignment)
      .set(soleClaimSet(sole, now))
      .where(and(eq(instanceAssignment.id, a.id), eq(instanceAssignment.status, 'offered')))
      .returning({ id: instanceAssignment.id });
    if (updated.length > 0) changed = true;
  }

  return { changed, workCenterId: inst.workCenterId };
}

/**
 * Work-center-wide sole-candidate sweep (spec 2026-08-17 D14b): the same decision the
 * reconcile third pass applies per instance, run across every open offer in the work center.
 * Called by the engine after presence transitions and releases — events that change the
 * candidate or offer pool without any instance transaction running. Returns true when at
 * least one offer was claimed (caller NOTIFYs). Deliberately outside the engine's instance
 * locks: it mirrors the manual claim route, and the status='offered' UPDATE guard plus the
 * live-per-step unique index arbitrate races (D17).
 */
export async function sweepSoleCandidateClaims(
  db: Db, workCenterId: string, now: () => Date,
): Promise<boolean> {
  const offers = await db.select({
    id: instanceAssignment.id,
    releasedFromUserId: instanceAssignment.releasedFromUserId,
    nodeOid: stepInstance.nodeOid,
    instanceId: stepInstance.workflowInstanceId,
  })
    .from(instanceAssignment)
    .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
    .where(and(
      eq(instanceAssignment.workCenterId, workCenterId),
      eq(instanceAssignment.status, 'offered'),
      eq(stepInstance.state, 'WAITING_USER'),
    ));
  if (offers.length === 0) return false;

  const instBy = new Map<string, { workflowId: string; specJsonb: unknown; autoClaim: boolean } | null>();
  const soleBy = new Map<string, { userId: string; resolvedRoleId: string | null } | null>();
  let changed = false;

  for (const o of offers) {
    if (!instBy.has(o.instanceId)) {
      const [row] = await db.select({ workflowId: workflowInstance.workflowId, specJsonb: workflowInstance.specJsonb })
        .from(workflowInstance).where(eq(workflowInstance.id, o.instanceId));
      instBy.set(o.instanceId, row
        ? { ...row, autoClaim: await effectiveAutoClaim(db, workCenterId, row.workflowId) }
        : null);
    }
    const inst = instBy.get(o.instanceId);
    if (!inst?.autoClaim) continue;
    const allowed = await resolveStepAllowedRoles(db, {
      workflowId: inst.workflowId, specJsonb: inst.specJsonb, recipeNodeOid: o.nodeOid,
    });
    const key = [...allowed].sort().join(',');
    if (!soleBy.has(key)) soleBy.set(key, await soleCandidateFor(db, workCenterId, allowed));
    const sole = soleBy.get(key) ?? null;
    if (!sole || o.releasedFromUserId === sole.userId) continue;
    const updated = await db.update(instanceAssignment)
      .set(soleClaimSet(sole, now))
      .where(and(eq(instanceAssignment.id, o.id), eq(instanceAssignment.status, 'offered')))
      .returning({ id: instanceAssignment.id });
    if (updated.length > 0) changed = true;
  }
  return changed;
}
