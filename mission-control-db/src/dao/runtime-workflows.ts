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

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  appUser, workflow, workflowInstance, stepInstance, instanceAssignment, operatorPresence, traceEntry,
  RUNTIME_DELETABLE_STATUSES, RUNTIME_ACTIVE_STATUSES, RUNTIME_FINAL_STATES,
  workCenterUserRole, LIVE_ASSIGNMENT_STATUSES, workCenterUser, type RuntimeWorkflowStatus, type AssignmentStatus,
} from '../db/schema/index.js';
import { DaoError } from './errors.js';
import { allocateRuntimeIdentity } from './work-centers.js';
import { getRuntimeIdTimezone } from './system-settings.js';
import {
  instantiateSpec, startingParameterSpecs, validateStartingParams, type StartingParameterSpec,
} from '../runtime/instantiate.js';
import { waitTimerOf, type GateTimer } from '../runtime/gate-timer.js';
import { findStepDef, isAssignmentVisibleTo } from '../runtime/inbox.js';
import { resolveStepAllowedRoles } from '../runtime/assignments.js';
import { listStepSignatures, type StepSignatureView } from './step-signatures.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

export type RuntimeWorkflowSummary = {
  id: string; workCenterId: string; runtimeNumber: number; runtimeLabel: string;
  masterName: string; masterOid: string; masterVersion: string; masterState: string;
  // The DB CHECK (generated from RUNTIME_WORKFLOW_STATUSES) guarantees the narrowing.
  status: RuntimeWorkflowStatus; createdByName: string | null; createdByLabel: string | null; createdAt: Date;
  queuedAt: Date | null; startedAt: Date | null; completedAt: Date | null;
};

// Summary projection NEVER ships spec_jsonb/starting_params/property_store (M6 over-fetch lesson).
const SUMMARY_COLS = {
  id: workflowInstance.id, workCenterId: workflowInstance.workCenterId,
  runtimeNumber: workflowInstance.runtimeNumber, runtimeLabel: workflowInstance.runtimeLabel,
  masterName: workflowInstance.masterName, masterOid: workflowInstance.masterOid,
  masterVersion: workflowInstance.masterVersion, masterState: workflowInstance.masterState,
  status: workflowInstance.status, createdAt: workflowInstance.createdAt,
  queuedAt: workflowInstance.queuedAt, startedAt: workflowInstance.startedAt,
  completedAt: workflowInstance.completedAt, createdByName: appUser.displayName, createdByLabel: workflowInstance.createdByLabel,
};

async function summaryById(db: Db, id: string): Promise<RuntimeWorkflowSummary | undefined> {
  const [row] = await db.select(SUMMARY_COLS).from(workflowInstance)
    .leftJoin(appUser, eq(appUser.id, workflowInstance.createdBy))
    .where(eq(workflowInstance.id, id));
  return row as RuntimeWorkflowSummary | undefined;
}

export async function createRuntimeWorkflow(
  db: Db,
  input: {
    workflowId: string; params: Record<string, unknown>; userId: string | null; start?: boolean;
    // Drop starting parameters the master does not declare instead of rejecting them.
    ignoreUnknownParams?: boolean;
    // Spec 2026-10-15 §2: a runtime created by another runtime's action.
    triggeredBy?: 'manual' | 'workflow';
    // stepStartedAt: the creating step's activation (Caller.stepStartedAt) — with the step id, the
    // exactly-once key (workflow_instance_created_by_step_uq).
    createdBy?: { instanceId: string; stepInstanceId: string; stepStartedAt: Date; label: string };
  },
): Promise<RuntimeWorkflowSummary> {
  return await db.transaction(async (tx) => {
    // FOR SHARE: a Draft reload takes FOR UPDATE on this row (replaceWorkflowEntry), so the two
    // serialise — the snapshot below can never name a node a reload is deleting with its grants.
    const [master] = await tx.select().from(workflow).where(eq(workflow.id, input.workflowId)).for('share');
    if (!master) throw new DaoError('RUNTIME_MASTER_NOT_FOUND');
    const starting = validateStartingParams(startingParameterSpecs(master.specJsonb), input.params, {
      ignoreUnknown: input.ignoreUnknownParams,
    });
    const recipe = instantiateSpec(master.specJsonb);
    const timeZone = await getRuntimeIdTimezone(tx as unknown as Db);
    const { runtimeNumber, runtimeLabel } = await allocateRuntimeIdentity(
      tx as unknown as Db, master.workCenterId, new Date(), timeZone,
    );
    const [row] = await tx.insert(workflowInstance).values({
      workflowId: master.id, workCenterId: master.workCenterId,
      triggeredBy: input.triggeredBy ?? 'manual',
      createdByInstanceId: input.createdBy?.instanceId ?? null,
      createdByStepInstanceId: input.createdBy?.stepInstanceId ?? null,
      createdByStepStartedAt: input.createdBy?.stepStartedAt ?? null,
      createdByLabel: input.createdBy?.label ?? null,
      specJsonb: recipe, startingParams: starting, runtimeNumber, runtimeLabel,
      masterName: master.name, masterOid: master.oid,
      masterVersion: master.version, masterState: master.state,
      createdBy: input.userId,
      // Create-and-Start (spec 2026-08-27 U6): lands directly in 'queued' inside the SAME
      // transaction — no created-but-failed-to-start half state. The worker loop discovers
      // queued rows on its normal cycle, exactly as after requestStart.
      ...(input.start
        ? { status: 'queued' as const, queuedAt: sql`now()`, startRequestedBy: input.userId }
        : { status: 'pending' as const }),
    }).returning({ id: workflowInstance.id });
    return (await summaryById(tx as unknown as Db, row!.id))!;
  });
}

export type RuntimeListFilter = 'all' | 'active' | 'pending' | 'finished';

export const RUNTIME_LIST_MAX_PAGE_SIZE = 100;
const RUNTIME_LIST_DEFAULT_PAGE_SIZE = 24;

const FILTER_STATUSES: Record<Exclude<RuntimeListFilter, 'all'>, readonly string[]> = {
  active: RUNTIME_ACTIVE_STATUSES,
  pending: ['pending'],
  finished: RUNTIME_FINAL_STATES,
};

/** Per-filter-bucket totals for the whole work center (never page- or filter-scoped) — the
 *  monitoring tab renders them on the filter chips ("Active (2)") so operators see where the
 *  work is without clicking through every chip. */
export type RuntimeStatusCounts = Record<Exclude<RuntimeListFilter, 'all'>, number>;

export type RuntimeStepClaimant = { userId: string; name: string | null; presence: 'online' | 'away' | 'offline' };
export type RuntimeActiveStep = { stepOid: string; stepName: string | null; stepType: string; state: string; claimant: RuntimeStepClaimant | null };
export type RuntimeWorkflowMonitorSummary = RuntimeWorkflowSummary & { activeSteps: RuntimeActiveStep[]; errorText: string | null };

/** Mirrors the engine's NON_TERMINAL_STEP_STATES (MissionEngine/src/core/transition.ts) —
 *  the queue states that make a step "currently active" from a monitoring point of view. */
const NON_TERMINAL_STEP_STATES = ['READY', 'EXECUTING', 'WAITING_ACTION', 'WAITING_USER', 'WAITING_GATE', 'WAITING_PROPERTIES', 'WAITING_SCRIPT', 'PAUSED'] as const;

/** Page-scoped live enrichment (spec §4): active step rows (named via a server-side walk of the
 *  frozen spec — the projection guard stands, spec_jsonb never leaves this function), the
 *  claimant of each claimed step with their presence at the instance's work center, and the
 *  errored step's message for errored instances. */
async function attachLiveInfo(db: Db, summaries: RuntimeWorkflowSummary[]): Promise<RuntimeWorkflowMonitorSummary[]> {
  if (summaries.length === 0) return [];
  const ids = summaries.map((s) => s.id);

  const stepRows = await db.select({
    id: stepInstance.id, workflowInstanceId: stepInstance.workflowInstanceId,
    nodeOid: stepInstance.nodeOid, stepOid: stepInstance.stepOid,
    stepType: stepInstance.stepType, state: stepInstance.state,
    orderIndex: stepInstance.orderIndex, createdAt: stepInstance.createdAt,
  }).from(stepInstance).where(and(
    inArray(stepInstance.workflowInstanceId, ids),
    inArray(stepInstance.state, [...NON_TERMINAL_STEP_STATES]),
  ));
  stepRows.sort((a, b) => (a.orderIndex ?? 1e9) - (b.orderIndex ?? 1e9) || a.createdAt.getTime() - b.createdAt.getTime());

  const claimants = stepRows.length === 0 ? [] : await db.select({
    stepInstanceId: instanceAssignment.stepInstanceId,
    userId: instanceAssignment.assignedUserId,
    name: appUser.displayName,
    presence: operatorPresence.status,
  }).from(instanceAssignment)
    .innerJoin(appUser, eq(appUser.id, instanceAssignment.assignedUserId))
    .leftJoin(operatorPresence, and(
      eq(operatorPresence.userId, instanceAssignment.assignedUserId),
      eq(operatorPresence.attendingWorkCenterId, instanceAssignment.workCenterId),
    ))
    .where(and(
      inArray(instanceAssignment.stepInstanceId, stepRows.map((r) => r.id)),
      eq(instanceAssignment.status, 'claimed'),
    ));
  const claimantByStep = new Map(claimants.map((r) => [r.stepInstanceId, {
    userId: r.userId!, name: r.name, presence: (r.presence ?? 'offline') as RuntimeStepClaimant['presence'],
  }]));

  const erroredIds = summaries.filter((s) => s.status === 'errored').map((s) => s.id);
  const errRows = erroredIds.length === 0 ? [] : await db.select({
    workflowInstanceId: stepInstance.workflowInstanceId, error: stepInstance.error,
    completedAt: stepInstance.completedAt,
  }).from(stepInstance).where(and(
    inArray(stepInstance.workflowInstanceId, erroredIds), eq(stepInstance.state, 'ERRORED'),
  ));
  const errorByInstance = new Map<string, string>();
  for (const r of errRows.sort((a, b) => (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0))) {
    if (r.error) errorByInstance.set(r.workflowInstanceId, r.error); // latest wins
  }

  // Spec walk for names — only instances that actually have active steps.
  const nameIds = [...new Set(stepRows.map((r) => r.workflowInstanceId))];
  const specRows = nameIds.length === 0 ? [] : await db.select({
    id: workflowInstance.id, specJsonb: workflowInstance.specJsonb,
  }).from(workflowInstance).where(inArray(workflowInstance.id, nameIds));
  const specById = new Map(specRows.map((r) => [r.id, r.specJsonb]));

  const stepsByInstance = new Map<string, RuntimeActiveStep[]>();
  for (const r of stepRows) {
    const def = findStepDef(specById.get(r.workflowInstanceId), r.nodeOid, r.stepOid);
    const list = stepsByInstance.get(r.workflowInstanceId) ?? [];
    list.push({
      stepOid: r.stepOid,
      stepName: typeof def?.local_id === 'string' ? def.local_id : null,
      stepType: r.stepType, state: r.state,
      claimant: claimantByStep.get(r.id) ?? null,
    });
    stepsByInstance.set(r.workflowInstanceId, list);
  }

  return summaries.map((s) => ({
    ...s,
    activeSteps: stepsByInstance.get(s.id) ?? [],
    errorText: errorByInstance.get(s.id) ?? null,
  }));
}

/** Phase-6 monitoring list: SUMMARY_COLS projection with status filtering and LIMIT/OFFSET
 *  pagination (retired the legacy unpaginated listRuntimeWorkflows — this is the sole list
 *  read now). `total` counts the FILTERED set so the client can render "page X of Y" per
 *  filter chip; `statusCounts` is the unfiltered per-bucket breakdown for chip labels. */
export async function listRuntimeWorkflowsPage(
  db: Db, workCenterId: string,
  opts: { filter?: RuntimeListFilter; page?: number; pageSize?: number } = {},
): Promise<{ items: RuntimeWorkflowMonitorSummary[]; total: number; page: number; pageSize: number; statusCounts: RuntimeStatusCounts }> {
  const filter = opts.filter ?? 'all';
  const rawPageSize = Number.isFinite(opts.pageSize) ? opts.pageSize! : RUNTIME_LIST_DEFAULT_PAGE_SIZE;
  const rawPage = Number.isFinite(opts.page) ? opts.page! : 1;
  const pageSize = Math.min(Math.max(1, rawPageSize), RUNTIME_LIST_MAX_PAGE_SIZE);
  const page = Math.max(1, rawPage);
  const where = filter === 'all'
    ? eq(workflowInstance.workCenterId, workCenterId)
    : and(eq(workflowInstance.workCenterId, workCenterId),
        inArray(workflowInstance.status, [...FILTER_STATUSES[filter]]));
  const n = (await db.select({ n: sql<number>`count(*)::int` }).from(workflowInstance).where(where))[0]!.n;
  // One grouped scan of the whole work center, folded into the three chip buckets in JS —
  // the buckets are disjoint status sets (FILTER_STATUSES above), so each row lands in at
  // most one bucket.
  const perStatus = await db.select({ status: workflowInstance.status, n: sql<number>`count(*)::int` })
    .from(workflowInstance)
    .where(eq(workflowInstance.workCenterId, workCenterId))
    .groupBy(workflowInstance.status);
  const statusCounts: RuntimeStatusCounts = { active: 0, pending: 0, finished: 0 };
  for (const row of perStatus) {
    for (const bucket of ['active', 'pending', 'finished'] as const) {
      if (FILTER_STATUSES[bucket].includes(row.status)) { statusCounts[bucket] += row.n; break; }
    }
  }
  const rows = await db.select(SUMMARY_COLS).from(workflowInstance)
    .leftJoin(appUser, eq(appUser.id, workflowInstance.createdBy))
    .where(where)
    .orderBy(desc(workflowInstance.runtimeNumber))
    .limit(pageSize).offset((page - 1) * pageSize);
  return { items: await attachLiveInfo(db, rows as RuntimeWorkflowSummary[]), total: n, page, pageSize, statusCounts };
}

export async function requestStart(db: Db, instanceId: string, userId: string | null): Promise<RuntimeWorkflowSummary> {
  const res = await db.update(workflowInstance)
    .set({ status: 'queued', queuedAt: sql`now()`, startRequestedBy: userId, updatedAt: sql`now()` })
    .where(and(eq(workflowInstance.id, instanceId), eq(workflowInstance.status, 'pending')))
    .returning({ id: workflowInstance.id });
  if (!res.length) {
    const [row] = await db.select({ id: workflowInstance.id }).from(workflowInstance)
      .where(eq(workflowInstance.id, instanceId));
    throw new DaoError(row ? 'RUNTIME_INVALID_STATE' : 'RUNTIME_NOT_FOUND');
  }
  return (await summaryById(db, instanceId))!;
}

/** Deletable = not executing (spec §5.1): pending/completed/aborted/stopped/errored.
 *  queued counts as start-commanded and is NOT deletable. step_instance/trace_entry cascade;
 *  runtime_history (Task 4) deliberately survives. */
export async function deleteRuntimeWorkflow(db: Db, instanceId: string): Promise<void> {
  const res = await db.delete(workflowInstance)
    .where(and(
      eq(workflowInstance.id, instanceId),
      inArray(workflowInstance.status, [...RUNTIME_DELETABLE_STATUSES]),
    )).returning({ id: workflowInstance.id });
  if (!res.length) {
    const [row] = await db.select({ id: workflowInstance.id }).from(workflowInstance)
      .where(eq(workflowInstance.id, instanceId));
    throw new DaoError(row ? 'RUNTIME_INVALID_STATE' : 'RUNTIME_NOT_FOUND');
  }
}

export async function getStartingParameterSpecs(
  db: Db, workflowId: string,
): Promise<{ workflowId: string; parameters: StartingParameterSpec[] } | undefined> {
  const [master] = await db.select({ id: workflow.id, specJsonb: workflow.specJsonb })
    .from(workflow).where(eq(workflow.id, workflowId));
  if (!master) return undefined;
  return { workflowId: master.id, parameters: startingParameterSpecs(master.specJsonb) };
}

export async function workCenterIdForWorkflow(db: Db, workflowId: string): Promise<string | null> {
  const [row] = await db.select({ wc: workflow.workCenterId }).from(workflow).where(eq(workflow.id, workflowId));
  return row?.wc ?? null;
}

export async function workCenterIdForInstance(db: Db, instanceId: string): Promise<string | null> {
  const [row] = await db.select({ wc: workflowInstance.workCenterId }).from(workflowInstance)
    .where(eq(workflowInstance.id, instanceId));
  return row?.wc ?? null;
}

export type RuntimeLiveStep = {
  id: string; stepOid: string; stepName: string | null; stepType: string; state: string;
  error: string | null; startedAt: Date | null; completedAt: Date | null;
  assignment: { id: string; status: 'offered' | 'claimed'; claimant: RuntimeStepClaimant | null } | null;
  /** A waiting timed GATE's or repeating SCRIPT's countdown (spec 2026-10-13 §5.4, §6.7); null otherwise. */
  gateTimer: GateTimer | null;
};
export type RuntimeTraceEntryView = { stepOid: string | null; stepName: string | null; state: string; error: string | null; at: Date };
export type RuntimeWorkflowLiveDetail = {
  summary: RuntimeWorkflowSummary; steps: RuntimeLiveStep[]; trace: RuntimeTraceEntryView[];
  signatures: StepSignatureView[];
};

const TRACE_TAIL_LIMIT = 50;

/** Dialog payload (spec §4): the whole live picture for ONE instance. The spec walk for step
 *  names loads spec_jsonb once, server-side only — it never reaches the return value. */
export async function getRuntimeWorkflowLive(db: Db, id: string): Promise<RuntimeWorkflowLiveDetail | undefined> {
  const summary = await summaryById(db, id);
  if (!summary) return undefined;
  // Only engine_state's armedGates — its step snapshots stay off this 2 s poll path.
  const head = (await db.select({
    specJsonb: workflowInstance.specJsonb,
    armedGates: sql<Record<string, PilotLiveArmedGate> | null>`${workflowInstance.engineState}->'armedGates'`,
  }).from(workflowInstance).where(eq(workflowInstance.id, id)))[0]!;
  const specJsonb = head.specJsonb;
  const armedGates = head.armedGates ?? {};
  const nameOf = (nodeOid: string | null, stepOid: string | null): string | null => {
    if (!stepOid) return null;
    if (nodeOid) {
      const def = findStepDef(specJsonb, nodeOid, stepOid);
      return typeof def?.local_id === 'string' ? def.local_id : null;
    }
    // trace entries carry no node oid — walk every node for the step oid.
    const visit = (spec: unknown): string | null => {
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
      const s = spec as Record<string, unknown>;
      if (Array.isArray(s.steps)) {
        const hit = (s.steps as Array<Record<string, unknown>>).find((st) => st?.oid === stepOid);
        if (hit && typeof hit.local_id === 'string') return hit.local_id;
      }
      if (Array.isArray(s.children)) for (const c of s.children) { const n = visit(c); if (n) return n; }
      return null;
    };
    return visit(specJsonb);
  };

  // Dialog projection: NEVER ships input_params/output_params jsonb on this 2s poll path
  // (the specJsonb over-fetch lesson shape — see SUMMARY_COLS above).
  const stepRows = await db.select({
    id: stepInstance.id, stepOid: stepInstance.stepOid, nodeOid: stepInstance.nodeOid,
    stepType: stepInstance.stepType, state: stepInstance.state, error: stepInstance.error,
    startedAt: stepInstance.startedAt, completedAt: stepInstance.completedAt,
    orderIndex: stepInstance.orderIndex, createdAt: stepInstance.createdAt,
  }).from(stepInstance)
    .where(eq(stepInstance.workflowInstanceId, id));
  stepRows.sort((a, b) => (a.orderIndex ?? 1e9) - (b.orderIndex ?? 1e9) || a.createdAt.getTime() - b.createdAt.getTime());

  const liveAssignments = stepRows.length === 0 ? [] : await db.select({
    id: instanceAssignment.id, stepInstanceId: instanceAssignment.stepInstanceId,
    status: instanceAssignment.status, userId: instanceAssignment.assignedUserId,
    name: appUser.displayName, presence: operatorPresence.status,
  }).from(instanceAssignment)
    .leftJoin(appUser, eq(appUser.id, instanceAssignment.assignedUserId))
    .leftJoin(operatorPresence, and(
      eq(operatorPresence.userId, instanceAssignment.assignedUserId),
      eq(operatorPresence.attendingWorkCenterId, instanceAssignment.workCenterId),
    ))
    .where(and(
      inArray(instanceAssignment.stepInstanceId, stepRows.map((r) => r.id)),
      inArray(instanceAssignment.status, ['offered', 'claimed']),
    ));
  const assignmentByStep = new Map(liveAssignments.map((a) => [a.stepInstanceId, a]));

  const traceRows = await db.select().from(traceEntry)
    .where(eq(traceEntry.workflowInstanceId, id))
    // (order_index, id): an OPERATOR row (Phase 4a) is written from outside the instance's
    // transaction at max(order_index)+1 and can tie the instance's own next entry — the id is
    // the only deterministic tiebreak, and without it a tie at the 50-row boundary could drop
    // the older row (spec §12.5 item 19). Matches trace-assembly's (order_index, id) sort.
    .orderBy(desc(traceEntry.orderIndex), desc(traceEntry.id)).limit(TRACE_TAIL_LIMIT);
  traceRows.reverse(); // oldest of the tail first

  const signatures = await listStepSignatures(db, id);

  return {
    summary,
    signatures,
    steps: stepRows.map((r) => {
      const a = assignmentByStep.get(r.id);
      return {
        id: r.id, stepOid: r.stepOid, stepName: nameOf(r.nodeOid, r.stepOid),
        stepType: r.stepType, state: r.state, error: r.error,
        startedAt: r.startedAt, completedAt: r.completedAt,
        gateTimer: waitTimerOf(r.state, findStepDef(specJsonb, r.nodeOid, r.stepOid), r.startedAt, armedGates[r.stepOid]),
        assignment: a ? {
          id: a.id, status: a.status as 'offered' | 'claimed',
          claimant: a.status === 'claimed' && a.userId
            ? { userId: a.userId, name: a.name, presence: (a.presence ?? 'offline') as RuntimeStepClaimant['presence'] }
            : null,
        } : null,
      };
    }),
    trace: traceRows.map((t) => ({
      stepOid: t.stepOid, stepName: nameOf(null, t.stepOid), state: t.state, error: t.error, at: t.at,
    })),
  };
}

export async function workCenterIdForAssignment(db: Db, assignmentId: string): Promise<string | null> {
  const [row] = await db.select({ wc: instanceAssignment.workCenterId })
    .from(instanceAssignment).where(eq(instanceAssignment.id, assignmentId));
  return row?.wc ?? null;
}

// ── Pilot Workflows tab (spec 2026-08-19) ───────────────────────────────────

export type PilotRuntimeWorkflow = RuntimeWorkflowMonitorSummary & {
  /** The caller holds a claim on, or can see an offer for, ≥1 step of this instance. */
  mine: boolean;
};

async function myRoleIds(db: Db, userId: string, workCenterId: string): Promise<Set<string>> {
  return new Set((await db.select({ roleId: workCenterUserRole.roleId }).from(workCenterUserRole)
    .where(and(eq(workCenterUserRole.workCenterId, workCenterId), eq(workCenterUserRole.userId, userId)))).map((r) => r.roleId));
}

/** The Workflows tab's chip list: the CM Runtime tab's 'active' bucket, unpaged up to the
 *  shared clamp (100 — spec said 200; the clamp wins, warn if ever hit), plus `mine` via
 *  the SAME predicate the inbox uses (isAssignmentVisibleTo — never re-derive it). */
export async function listActiveRuntimeWorkflowsForOperator(
  db: Db, workCenterId: string, userId: string,
): Promise<PilotRuntimeWorkflow[]> {
  const { items, total } = await listRuntimeWorkflowsPage(db, workCenterId, {
    filter: 'active', pageSize: RUNTIME_LIST_MAX_PAGE_SIZE,
  });
  if (total > items.length) console.warn(`listActiveRuntimeWorkflowsForOperator: ${total} active at ${workCenterId}, capped at ${items.length}`);
  if (items.length === 0) return [];

  const roles = await myRoleIds(db, userId, workCenterId);
  const rows = await db.select({
    instanceId: stepInstance.workflowInstanceId,
    status: instanceAssignment.status,
    assignedUserId: instanceAssignment.assignedUserId,
    allowedRoleIds: instanceAssignment.allowedRoleIds,
    stepState: stepInstance.state,
  }).from(instanceAssignment)
    .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
    .where(and(
      inArray(stepInstance.workflowInstanceId, items.map((i) => i.id)),
      inArray(instanceAssignment.status, [...LIVE_ASSIGNMENT_STATUSES]),
    ));
  const mineIds = new Set(rows
    .filter((r) => isAssignmentVisibleTo(
      { status: r.status, assignedUserId: r.assignedUserId, allowedRoleIds: r.allowedRoleIds },
      r.stepState, userId, roles))
    .map((r) => r.instanceId));
  return items.map((i) => ({ ...i, mine: mineIds.has(i.id) }));
}

export type PilotLiveAssignment = {
  id: string; status: 'offered' | 'claimed';
  claimant: { displayName: string } | null;
  mine: boolean;
};
/** GATE follow-up 8c: engine_state.armedGates[gateOid] projected onto the gate's own live step
 *  (the engine keys it by the GATE's oid; spec 2026-08-29 §6.4). */
export type PilotLiveArmedGate = { predecessorOid: string; open: boolean; stopSent: boolean };
export type PilotLiveStep = {
  state: string; nodeOid: string; error: string | null;
  assignment: PilotLiveAssignment | null;
  /** Set on a GATE that is ARMED against its ACTION PROXY predecessor (control_previous_action);
   *  null for every other step. Optional on the wire so older fixtures stay valid. */
  armedGate?: PilotLiveArmedGate | null;
  /** The step_instance row id — what force complete / Continue now address (spec 2026-10-13 §5). */
  stepInstanceId?: string;
  /** A waiting timed GATE's or repeating SCRIPT's countdown (spec 2026-10-13 §5.4, §6.7); null otherwise. */
  gateTimer?: GateTimer | null;
};
export type RuntimeWorkflowLiveStates = {
  instanceId: string; status: string;
  steps: Record<string, PilotLiveStep>;
  childActive: Record<string, string>;
};

/** The Workflows tab's 2s-poll payload: one entry per REACHED step — latest row per
 *  stepOid (loops re-enter with fresh rows; max orderIndex, ties by createdAt) — plus
 *  engine_state.childActive. Absent steps are IDLE, inferred client-side. Served for
 *  terminal instances too (a viewed diagram keeps working after completion). Never
 *  ships input/output params or spec_jsonb (the projection-guard shape). */
export async function getRuntimeWorkflowLiveStates(
  db: Db, instanceId: string, userId: string,
): Promise<RuntimeWorkflowLiveStates | undefined> {
  const [inst] = await db.select({
    id: workflowInstance.id, status: workflowInstance.status, engineState: workflowInstance.engineState,
    workCenterId: workflowInstance.workCenterId,
  }).from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  if (!inst) return undefined;

  const stepRows = await db.select({
    id: stepInstance.id, stepOid: stepInstance.stepOid, nodeOid: stepInstance.nodeOid,
    state: stepInstance.state, error: stepInstance.error, startedAt: stepInstance.startedAt,
    orderIndex: stepInstance.orderIndex, createdAt: stepInstance.createdAt,
  }).from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));

  const winners = new Map<string, (typeof stepRows)[number]>();
  for (const r of stepRows) {
    const prev = winners.get(r.stepOid);
    const beats = !prev
      || (r.orderIndex ?? -1) > (prev.orderIndex ?? -1)
      || ((r.orderIndex ?? -1) === (prev.orderIndex ?? -1) && r.createdAt.getTime() > prev.createdAt.getTime());
    if (beats) winners.set(r.stepOid, r);
  }

  // Timed gates and repeating scripts need the recipe (delay / cycle / limit) — fetched only when
  // one is waiting, so the 2 s poll keeps its no-spec_jsonb shape the rest of the time.
  const needsSpec = [...winners.values()].some((r) => r.state === 'WAITING_GATE' || r.state === 'WAITING_SCRIPT');
  const specJsonb = needsSpec
    ? (await db.select({ s: workflowInstance.specJsonb }).from(workflowInstance).where(eq(workflowInstance.id, instanceId)))[0]?.s ?? null
    : null;

  const winnerIds = [...winners.values()].map((r) => r.id);
  const assignments = winnerIds.length === 0 ? [] : await db.select({
    id: instanceAssignment.id, stepInstanceId: instanceAssignment.stepInstanceId,
    status: instanceAssignment.status, assignedUserId: instanceAssignment.assignedUserId,
    allowedRoleIds: instanceAssignment.allowedRoleIds, claimantName: appUser.displayName,
  }).from(instanceAssignment)
    .leftJoin(appUser, eq(appUser.id, instanceAssignment.assignedUserId))
    .where(and(
      inArray(instanceAssignment.stepInstanceId, winnerIds),
      inArray(instanceAssignment.status, [...LIVE_ASSIGNMENT_STATUSES]),
    ));
  const byStep = new Map(assignments.map((a) => [a.stepInstanceId, a]));
  const roles = await myRoleIds(db, userId, inst.workCenterId);

  const engineState = inst.engineState as { childActive?: Record<string, string>; armedGates?: Record<string, PilotLiveArmedGate> } | null;
  const armedGates = engineState?.armedGates ?? {};

  const steps: Record<string, PilotLiveStep> = {};
  for (const [stepOid, r] of winners) {
    const a = byStep.get(r.id);
    steps[stepOid] = {
      state: r.state, nodeOid: r.nodeOid, error: r.error,
      assignment: a ? {
        id: a.id, status: a.status as 'offered' | 'claimed',
        claimant: a.status === 'claimed' && a.claimantName ? { displayName: a.claimantName } : null,
        mine: isAssignmentVisibleTo(
          { status: a.status, assignedUserId: a.assignedUserId, allowedRoleIds: a.allowedRoleIds },
          r.state, userId, roles),
      } : null,
      armedGate: armedGates[stepOid] ?? null,
      stepInstanceId: r.id,
      gateTimer: waitTimerOf(r.state, findStepDef(specJsonb, r.nodeOid, stepOid), r.startedAt, armedGates[stepOid]),
    };
  }

  const childActive = engineState?.childActive ?? {};
  return { instanceId: inst.id, status: inst.status, steps, childActive };
}

// ── CM Runtime pane (spec 2026-08-27 §4.2) ──────────────────────────────────

/** Lean cross-WC projection for the Runtime pane's 5 s tree poll: every ACTIVE instance in
 *  every work center, ordered (workCenterId, runtimeNumber) for stable grouping. Deliberately
 *  narrower than RuntimeWorkflowSummary — the tree renders id/number/label/name/version/status
 *  only, and widening would drag the createdBy join onto a hot cross-WC poll. */
export type ActiveRuntimeLeaf = {
  id: string; workCenterId: string; runtimeNumber: number; runtimeLabel: string;
  masterName: string; masterVersion: string; status: RuntimeWorkflowStatus;
};

export async function listActiveRuntimeLeaves(db: Db): Promise<ActiveRuntimeLeaf[]> {
  const rows = await db.select({
    id: workflowInstance.id, workCenterId: workflowInstance.workCenterId,
    runtimeNumber: workflowInstance.runtimeNumber, runtimeLabel: workflowInstance.runtimeLabel,
    masterName: workflowInstance.masterName, masterVersion: workflowInstance.masterVersion,
    status: workflowInstance.status,
  }).from(workflowInstance)
    .where(inArray(workflowInstance.status, [...RUNTIME_ACTIVE_STATUSES]))
    .orderBy(workflowInstance.workCenterId, workflowInstance.runtimeNumber);
  return rows as ActiveRuntimeLeaf[];
}

export type AssignmentCandidate = { userId: string; name: string | null; presence: 'online' | 'away' | 'offline' };
export type AssignmentCandidatesView = {
  assignmentId: string; status: AssignmentStatus; stepName: string | null;
  candidates: AssignmentCandidate[];
};

/** Advisory picker feed for commander assign (spec 2026-08-27 §4.6): work-center members
 *  whose roles intersect the step's allowed roles (ALL members when unrestricted), deduped
 *  by user keeping the best presence AT THIS work center (a user can hold several presence
 *  sessions). Presence is shown, never required — the engine re-validates at assign time;
 *  this list gates nothing. */
export async function listAssignmentCandidates(db: Db, assignmentId: string): Promise<AssignmentCandidatesView | undefined> {
  const [row] = await db.select({
    a: instanceAssignment,
    nodeOid: stepInstance.nodeOid, stepOid: stepInstance.stepOid,
    workflowId: workflowInstance.workflowId, specJsonb: workflowInstance.specJsonb,
  }).from(instanceAssignment)
    .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
    .innerJoin(workflowInstance, eq(stepInstance.workflowInstanceId, workflowInstance.id))
    .where(eq(instanceAssignment.id, assignmentId));
  if (!row) return undefined;

  const allowed = await resolveStepAllowedRoles(db, {
    workflowId: row.workflowId, specJsonb: row.specJsonb, recipeNodeOid: row.nodeOid,
  });

  const members = await db.select({
    userId: workCenterUser.userId, name: appUser.displayName, presence: operatorPresence.status,
  }).from(workCenterUser)
    .innerJoin(appUser, eq(appUser.id, workCenterUser.userId))
    .leftJoin(operatorPresence, and(
      eq(operatorPresence.userId, workCenterUser.userId),
      eq(operatorPresence.attendingWorkCenterId, row.a.workCenterId),
    ))
    .where(eq(workCenterUser.workCenterId, row.a.workCenterId));

  let eligible = members;
  if (allowed.length > 0) {
    const holders = await db.select({ userId: workCenterUserRole.userId }).from(workCenterUserRole)
      .where(and(eq(workCenterUserRole.workCenterId, row.a.workCenterId), inArray(workCenterUserRole.roleId, allowed)));
    const ok = new Set(holders.map((h) => h.userId));
    eligible = members.filter((m) => ok.has(m.userId));
  }

  const rank = { online: 2, away: 1, offline: 0 } as const;
  const byUser = new Map<string, AssignmentCandidate>();
  for (const m of eligible) {
    const presence = (m.presence ?? 'offline') as AssignmentCandidate['presence'];
    const prev = byUser.get(m.userId);
    if (!prev || rank[presence] > rank[prev.presence]) {
      byUser.set(m.userId, { userId: m.userId, name: m.name, presence });
    }
  }

  const def = findStepDef(row.specJsonb, row.nodeOid, row.stepOid);
  return {
    assignmentId: row.a.id,
    status: row.a.status as AssignmentStatus,
    stepName: typeof def?.local_id === 'string' ? def.local_id : null,
    candidates: [...byUser.values()].sort((x, y) => (x.name ?? '').localeCompare(y.name ?? '')),
  };
}
