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
//
// Phase 4a (spec §7.1): the operator verbs' TRANSACTIONS. A work-center verb is a transition
// whose "instance" is the operator (plan delta D11): lock the ONE resource row (§5.3 order —
// no instance lock precedes it, none follows it), hydrate a manager from the locked snapshot,
// run Task 3's pure core, diff with the nil operator id so every grant is a foreign handoff,
// write with applyOperatorRegistryWrites, trace the affected instances, and wake every
// instance whose state changed from the outside. What those instances DO about it — consume
// a grant, fail a cancelled wait (D12), forget a released hold — happens on their own next
// transition, under their own locks.
import { eq, and, sql } from 'drizzle-orm';
import {
  traceEntry, workflowInstance, stepInstance, wcResource, RUNTIME_FINAL_STATES,
} from 'mission-control-db/src/db/schema/index';
import {
  lockRegistry, readResourceHolders, applyOperatorRegistryWrites, NOTIFY_GRANT_CHANNEL,
} from 'mission-control-db/src/runtime/wc-resources';
import { writeSharedValueProperty } from 'mission-control-db/src/runtime/wc-value-properties';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type { OperatorEventHub } from '../api/events.js';
import { claimInstanceById } from '../loop.js';
import { openContext } from './context.js';
import { failStep, resumeGrantedSteps } from './transition.js';
import { InMemoryResourceManager } from './resources.js';
import { snapshotToSerialized, indexWaiters, diffRegistry, queuedTokens } from './env-resource-bridge.js';
import { applyResourceVerb, OPERATOR_INSTANCE_ID, VerbError, type ResourceVerbInput } from './registry-verbs.js';

export type WorkCenterVerbInput = ResourceVerbInput & { workCenterId: string; actorUserId: string };
export type VerbResult = { ok: true; summary: string; affectedInstanceIds: string[] };

/**
 * An operator intervention on somebody else's instance, recorded from OUTSIDE that instance's
 * transaction. `recordTrace` is not usable here: it bumps `engine_state.orderCounters`, which
 * only the instance's own transaction may write.
 *
 * ORDER INDEX — read this before trusting where the row lands. The engine's trace counters are
 * PER SPEC, not per instance: `Context.recordTrace` keys `orderCounters` by `this.spec.oid` and
 * restarts at 1 for each child spec (context.ts). `assembleReferenceTrace` then GROUPS rows by
 * the node their step belongs to and sorts (order_index, id) WITHIN each node's list
 * (trace-assembly.ts) — so an order index only ever competes with the other rows of its own
 * node. The `max(order_index)` below spans EVERY spec's rows on the instance, which means:
 *   - Single-spec instance (no child workflows): the instance-wide max IS that spec's counter,
 *     so the row lands exactly where it happened — after every prior entry, and before the
 *     instance's next own entry (which may reuse the number, but its higher id sorts it after).
 *   - Instance with child workflows, affected step in a LOWER-numbered spec: the instance-wide
 *     max exceeds that spec's own counter, so the row sorts to the TAIL of its node's segment
 *     instead of at the moment it occurred. It is never lost and never leaks into another
 *     node's segment — it is only late within its own.
 *
 * Placing it exactly would mean mapping the step to its spec and node through the frozen recipe
 * under the instance's own lock, and a work-center verb must never take an instance lock (spec
 * §5.3, plan delta D11). So `at` — the wall-clock `now` this verb ran — is the AUTHORITATIVE
 * moment of the intervention, and the order index is a display hint. Per-spec placement is a
 * recorded follow-up (spec §12.5, Phase 4b — the pane that displays these traces), not a gap
 * this transaction can close.
 */
export async function insertOperatorTrace(tx: Db, instanceId: string, stepOid: string | null, detail: string, now: Date): Promise<void> {
  const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${traceEntry.orderIndex}), 0)` })
    .from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId));
  await tx.insert(traceEntry).values({
    workflowInstanceId: instanceId, stepOid, state: 'OPERATOR', orderIndex: Number(max) + 1, error: detail, at: now,
  });
}

/** One operator trace line: produced INSIDE the registry transaction, written AFTER it commits
 *  (Ruling P9 — see `writeOperatorTraces` for why it cannot live inside). `detail` already
 *  carries the ` [by <actor>]` suffix. */
export type OperatorTraceLine = { instanceId: string; stepOid: string | null; detail: string };

/**
 * The registry half of a work-center verb: registry row locks ONLY, and nothing else — see
 * `writeOperatorTraces` for why the trace rows this returns must not be inserted here. The
 * `pg_notify` calls stay inside: a notification takes no lock, and firing it from the committing
 * transaction is what makes the wake atomic with the change it announces.
 *
 * `now` is no longer read here (Ruling P9 moved the only use — the trace insert — out of this
 * transaction). It stays in the signature so a caller passes ONE clock for the whole verb and
 * hands that same instant to `writeOperatorTraces`, which stamps it as the trace rows' `at`.
 */
export async function workCenterResourceVerbTx(
  tx: Db, now: Date, input: WorkCenterVerbInput,
): Promise<VerbResult & { traces: OperatorTraceLine[] }> {
  void now;
  const snap = await lockRegistry(tx, input.workCenterId, [input.name]);
  const row = snap.resources[0];
  if (!row) throw new VerbError('RESOURCE_NOT_FOUND', `no resource "${input.name}" in this work center`);
  const holders = await readResourceHolders(tx, input.workCenterId, input.name);
  const manager = InMemoryResourceManager.fromJSON(snapshotToSerialized(snap, input.workCenterId));
  const index = indexWaiters(snap);

  const effect = applyResourceVerb({ manager, row, holders, waiters: snap.waiters, input });

  const d = diffRegistry({ snap, manager, index, instanceId: OPERATOR_INSTANCE_ID, holds: [] });
  if (d.insertWaiters.length > 0) {
    // Global Constraint: the operator never enqueues. A non-empty insert set means a token
    // appeared in a queue that no row backs — refuse to write rather than attribute it.
    throw new Error(`operator verb "${input.verb}" on "${input.name}" produced ${d.insertWaiters.length} waiter insert(s) — refusing to write`);
  }
  await applyOperatorRegistryWrites(tx, {
    workCenterId: input.workCenterId,
    counters: d.counters,
    deleteWaiterIds: [...d.deleteWaiterIds, ...effect.extraDeleteWaiterIds],
    grantWaiters: d.grantWaiters,
    deleteHolderIds: effect.deleteHolderIds,
  });
  const traces: OperatorTraceLine[] = effect.touched.map((t) => ({
    instanceId: t.instanceId, stepOid: t.stepOid, detail: `${t.detail} [by ${input.actorUserId}]`,
  }));
  const wake = new Set<string>([...effect.affectedInstanceIds, ...d.foreignGrantInstanceIds]);
  for (const id of wake) await tx.execute(sql`SELECT pg_notify(${NOTIFY_GRANT_CHANNEL}, ${id})`);
  return { ok: true, summary: effect.summary, affectedInstanceIds: [...wake], traces };
}

/**
 * Ruling P9, found by the real-Postgres proof (test/real-pg.engine.test.ts, T7-8): **a FOREIGN
 * KEY to `workflow_instance` IS an instance-row lock.** `trace_entry.workflow_instance_id`
 * references `workflow_instance.id`, and PostgreSQL enforces that on INSERT with
 * `SELECT 1 FROM ONLY workflow_instance WHERE id = $1 FOR KEY SHARE`, held until the inserting
 * transaction commits. So tracing from inside `workCenterResourceVerbTx` made the plan's "a
 * work-center verb takes NO instance lock" (spec §5.3, delta D11) false as written, and made the
 * verb an ABBA cycle against every transition — which locks the instance row first
 * (`claimInstanceById`, FOR UPDATE) and the registry rows second (`lockRegistry`, FOR UPDATE):
 *
 *   transition    holds workflow_instance -> wants wc_resource
 *   work-center verb  holds wc_resource   -> wants workflow_instance (via the trace FK)
 *
 * Postgres reported `deadlock detected` naming exactly those two statements on every run of the
 * proof; and in the interleaving where the verb's INSERT arrived first instead, the transition's
 * `claimInstanceById` — which uses SKIP LOCKED — silently missed the row and bounced
 * NOT_RUNNING with no worker involved at all.
 *
 * The traces are therefore written HERE, after that transaction has committed and dropped its
 * registry locks, ONE SHORT TRANSACTION PER LINE: each holds a single instance row's FOR KEY
 * SHARE, briefly, and never a registry row — so no ordering cycle exists and "never two instance
 * rows in one transaction" stays literally true. A `claimInstanceById` that lands inside one of
 * these brief windows can still be skipped ONCE; that is a one-cycle bounce the worker loop (or
 * one operator retry) covers, not a deadlock.
 *
 * ORDERING CONSEQUENCE: the wake fired inside the registry transaction can reach an instance
 * BEFORE its trace row exists, so an instance may hydrate and act on a change it cannot yet see
 * traced. `at` — the verb's own clock, passed in — is still the AUTHORITATIVE moment of the
 * intervention (see `insertOperatorTrace`'s note on the order index), so nothing about how these
 * rows display depends on when they landed.
 *
 * A failed line is WARNED, never thrown: the registry change is already committed and durable,
 * and the operator must not be told to retry a verb that has already taken effect. The realistic
 * failure is the instance row having disappeared between the two transactions (an FK violation).
 */
export async function writeOperatorTraces(db: Db, traces: OperatorTraceLine[], now: Date): Promise<void> {
  for (const line of traces) {
    try {
      await db.transaction((tx) => insertOperatorTrace(tx, line.instanceId, line.stepOid, line.detail, now));
    } catch (err) {
      console.warn(
        `[mission-engine] operator trace not written for instance ${line.instanceId} step ` +
        `${line.stepOid ?? '-'}: ${String((err as Error).message)} — the registry change itself is ` +
        `committed and stands. Lost line: ${line.detail}`,
      );
    }
  }
}

export async function runWorkCenterResourceVerb(
  db: Db, deps: EngineDeps, hub: OperatorEventHub | null, input: WorkCenterVerbInput,
): Promise<VerbResult> {
  const now = deps.now();
  const { traces, ...result } = await db.transaction((tx) => workCenterResourceVerbTx(tx, now, input));
  await writeOperatorTraces(db, traces, now); // Ruling P9: only after the registry locks are gone
  hub?.notifyWorkCenter(input.workCenterId); // this process's SSE clients; other replicas poll
  return result;
}

export type InstanceVerbInput = ResourceVerbInput & {
  instanceId: string; resourceKey: string; actorUserId: string;
  /** Workflow tier only: local queues hold STEP OIDS, not row ids (delta D16). */
  waiterStepOid?: string;
};

/**
 * Instance-scoped verbs (spec §7.1 `/internal/instances/:id/resources/:verb`). Delta D16: a
 * bare name that exists in this work center's registry is an ENVIRONMENT resource and takes the
 * work-center path in this same transaction — no instance lock, because the consequence for
 * this instance (a hold gone, a wait cancelled) is delivered in band like everybody else's.
 * Anything else is a WORKFLOW-tier key living in engine_state: lock the instance row (SKIP
 * LOCKED — back off if a worker has it), hydrate its context, mutate the LOCAL manager, and,
 * since this IS the instance's own transaction, resume its own grants and fail its own
 * cancelled step here rather than in band.
 *
 * LOCK ORDER (spec §5.3): instance row FIRST, registry rows second — `claimInstanceById` runs
 * BEFORE `openContext` (which is what takes `lockRegistry` on this instance's environment
 * names). The delegation branch above returns before either, so an environment name takes the
 * registry lock alone, exactly as the work-center route does. Only ever one instance row.
 */
export async function runInstanceResourceVerb(
  db: Db, deps: EngineDeps, hub: OperatorEventHub | null, input: InstanceVerbInput,
): Promise<VerbResult> {
  const now = deps.now();
  const { result, traces } = await db.transaction(async (tx) => {
    const [head] = await tx.select({ workCenterId: workflowInstance.workCenterId, status: workflowInstance.status })
      .from(workflowInstance).where(eq(workflowInstance.id, input.instanceId));
    if (!head) throw new VerbError('RUNTIME_NOT_FOUND', 'runtime workflow not found');

    const [env] = await tx.select({ name: wcResource.name }).from(wcResource)
      .where(and(eq(wcResource.workCenterId, head.workCenterId), eq(wcResource.name, input.resourceKey)));
    if (env) {
      // Delta D16: an environment name takes the work-center path in this same transaction —
      // registry locks only, no instance lock, so its traces defer past the commit too (P9).
      const { traces: envTraces, ...envResult } = await workCenterResourceVerbTx(
        tx, now, { ...input, workCenterId: head.workCenterId, name: input.resourceKey },
      );
      return { result: envResult as VerbResult, traces: envTraces };
    }

    if ((RUNTIME_FINAL_STATES as readonly string[]).includes(head.status)) {
      throw new VerbError('RUNTIME_INVALID_STATE', `runtime workflow is ${head.status}`);
    }
    if (!(await claimInstanceById(tx, input.instanceId))) {
      throw new VerbError('INSTANCE_BUSY', 'the engine is working this runtime workflow — try again');
    }
    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, input.instanceId));
    const context = await openContext(tx, row, deps);
    const mgr = context.resources;
    const key = input.resourceKey;
    if (!mgr || !mgr.hasResource(key)) throw new VerbError('RESOURCE_NOT_FOUND', `no workflow-scoped resource "${key}" on this runtime workflow`);
    const entry = mgr.getSnapshot().find((e) => e.name === key)!;
    let summary: string;
    let tracedStep: string | null = null;

    switch (input.verb) {
      case 'release-holder':
        throw new VerbError('NOT_SUPPORTED', 'a workflow-scoped resource has no holder ledger — use release');
      case 'release': {
        if (entry.type === 'sync') throw new VerbError('NOT_SUPPORTED', `"${key}" is a sync resource — use clear-sync`);
        if (entry.type === 'named pool' && !input.poolName) throw new VerbError('VALIDATION', 'poolName is required for a named pool');
        if (!mgr.release(key, input.amount, input.poolName)) throw new VerbError('NOTHING_TO_RELEASE', `"${key}" has nothing to release`);
        summary = `release "${key}"${input.poolName ? ` (${input.poolName})` : ''}${input.amount ? ` amount ${input.amount}` : ''}`;
        break;
      }
      case 'reset':
        mgr.resetResources(new Set([key]));
        summary = `reset "${key}"`;
        break;
      case 'clear-sync':
        if (entry.type !== 'sync') throw new VerbError('NOT_A_SYNC_RESOURCE', `"${key}" is a ${entry.type} resource, not sync`);
        mgr.resetResources(new Set([key]));
        summary = `clear-sync "${key}"`;
        break;
      case 'cancel-waiter': {
        const stepOid = input.waiterStepOid;
        // Scoped to THIS resource's queue, and to QUEUED tokens only (review Important 1).
        // allManagerTokens unions every resource's queue plus `pendingGrants`, while
        // cancelQueuedWaiters dequeues from EVERY resource — so a manager-wide guard would let a
        // step queued on B be dequeued by a request naming A (failed with A's message, and B's
        // queue never gets the runGrantPass that only runs on A). A token in `pendingGrants` is
        // not queued either: it already holds the counter tryGrantXxx reserved for it, and
        // dropping it here would leak that counter into the wedge shape (in_use with no holder
        // and no waiter). Its grant is consumed by the resumeGrantedSteps call below instead.
        if (!stepOid || !queuedTokens(mgr, key).some((q) => q.token === stepOid)) throw new VerbError('WAITER_NOT_FOUND', `step "${stepOid ?? '?'}" is not queued on "${key}"`);
        mgr.cancelQueuedWaiters(new Set([stepOid]));
        mgr.runGrantPass(key);
        const found = context.findStep(stepOid);
        const [stepRow] = await tx.select().from(stepInstance)
          .where(and(eq(stepInstance.workflowInstanceId, input.instanceId), eq(stepInstance.stepOid, stepOid), eq(stepInstance.state, 'READY')));
        summary = `cancel-waiter "${key}" step "${stepOid}"`;
        tracedStep = stepOid;
        if (found && stepRow) {
          const settled = await failStep(tx, found.context, { id: stepRow.id, stepOid }, 'ERROR', `Resource "${key}": wait cancelled by an operator`, deps);
          if (settled) return { result: { ok: true as const, summary, affectedInstanceIds: [input.instanceId] }, traces: [] as OperatorTraceLine[] };
        }
        break;
      }
      default:
        throw new VerbError('VALIDATION', `unknown verb "${String(input.verb)}"`);
    }

    const { settled } = await resumeGrantedSteps(tx, context, deps);
    if (!settled) {
      await context.recordTrace(tx, tracedStep, 'OPERATOR', undefined, `${summary} [by ${input.actorUserId}]`);
      await context.persist(tx);
    }
    await tx.execute(sql`SELECT pg_notify(${NOTIFY_GRANT_CHANNEL}, ${input.instanceId})`);
    // The workflow tier already traced through `context.recordTrace` above — correctly, because
    // THIS transaction owns the instance lock (claimInstanceById) and takes no registry lock
    // afterwards. Nothing to defer.
    return { result: { ok: true as const, summary, affectedInstanceIds: [input.instanceId] }, traces: [] as OperatorTraceLine[] };
  });
  await writeOperatorTraces(db, traces, now); // empty for the workflow tier; the D16 branch's lines otherwise
  const [wcRow] = await db.select({ workCenterId: workflowInstance.workCenterId }).from(workflowInstance).where(eq(workflowInstance.id, input.instanceId));
  if (wcRow) hub?.notifyWorkCenter(wcRow.workCenterId);
  return result;
}

export type WorkCenterValueInput = { workCenterId: string; propertyName: string; entryName: string; value: string; actorUserId: string };

/** A commander's edit of a SHARED value (spec §7.1 / U5). One UPDATE, row-locked by itself,
 *  stamped with the actor — the only writer that ever sets `updated_by` (Task 1). */
export async function setWorkCenterValueProperty(
  db: Db, deps: EngineDeps, hub: OperatorEventHub | null, input: WorkCenterValueInput,
): Promise<VerbResult> {
  const matched = await db.transaction((tx) => writeSharedValueProperty(
    tx, input.workCenterId, { propertyName: input.propertyName, entryName: input.entryName, value: input.value }, deps.now(), input.actorUserId,
  ));
  if (!matched) throw new VerbError('VALUE_NOT_FOUND', `no shared value "${input.propertyName}.${input.entryName}" in this work center`);
  hub?.notifyWorkCenter(input.workCenterId);
  return { ok: true, summary: `set ${input.propertyName}.${input.entryName}`, affectedInstanceIds: [] };
}

export type InstanceValueInput = { instanceId: string; specOid?: string; key: string; value: string; actorUserId: string };

/**
 * A commander's edit of an instance's LOCAL value (root store, or an ACTIVE child's store when
 * `specOid` names it). Delta D17: a key the target store does not hold locally is refused —
 * SHARED_KEY when the shared tier has it (the work-center route stamps the actor; an engine-
 * side shared flush would stamp NULL and misattribute the edit), VALUE_NOT_FOUND otherwise.
 * Never `props.set()` an unknown key here: PropertyStore routes it to the shared tier.
 */
export async function setInstanceValueProperty(
  db: Db, deps: EngineDeps, hub: OperatorEventHub | null, input: InstanceValueInput,
): Promise<VerbResult> {
  const result = await db.transaction(async (tx) => {
    const [head] = await tx.select({ workCenterId: workflowInstance.workCenterId, status: workflowInstance.status })
      .from(workflowInstance).where(eq(workflowInstance.id, input.instanceId));
    if (!head) throw new VerbError('RUNTIME_NOT_FOUND', 'runtime workflow not found');
    if ((RUNTIME_FINAL_STATES as readonly string[]).includes(head.status)) throw new VerbError('RUNTIME_INVALID_STATE', `runtime workflow is ${head.status}`);
    if (!(await claimInstanceById(tx, input.instanceId))) throw new VerbError('INSTANCE_BUSY', 'the engine is working this runtime workflow — try again');
    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, input.instanceId));
    const context = await openContext(tx, row, deps);
    let view = context;
    if (input.specOid && input.specOid !== context.spec.oid) {
      if (!Object.values(context.state.childActive).includes(input.specOid)) {
        throw new VerbError('CHILD_NOT_ACTIVE', `child workflow "${input.specOid}" is not active on this runtime workflow`);
      }
      view = context.contextForNode(input.specOid);
    }
    if (!(input.key in view.props.toFlatMap())) {
      if (context.sharedProps?.has(input.key)) throw new VerbError('SHARED_KEY', `"${input.key}" is a shared work-center value — edit it on the work center`);
      throw new VerbError('VALUE_NOT_FOUND', `"${input.key}" is not a value property of ${input.specOid ? `child "${input.specOid}"` : 'this runtime workflow'}`);
    }
    view.props.set(input.key, input.value);
    const summary = `set ${input.key}${input.specOid ? ` on child "${input.specOid}"` : ''}`;
    await context.recordTrace(tx, null, 'OPERATOR', undefined, `${summary} [by ${input.actorUserId}]`);
    await context.persist(tx);
    return { ok: true as const, summary, affectedInstanceIds: [input.instanceId], workCenterId: head.workCenterId };
  });
  hub?.notifyWorkCenter(result.workCenterId);
  return { ok: true, summary: result.summary, affectedInstanceIds: result.affectedInstanceIds };
}
