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

// Firing due slots and outage windows (spec 2026-11-08 §6.2, §6.4). One transaction per Runtime
// Schedule row: the row lock keeps two engines apart, and schedule_occurrence's unique key means
// a slot cannot fire twice. A failure in one item stays in that item's savepoint; any other
// failure rolls the whole slot back, so it stays due and is tried again on the next tick.

import { and, asc, eq, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Schema } from '../db/client.js';
import {
  runtimeSchedule, runtimeScheduleItem, scheduleItemRun, scheduleOccurrence, workflow,
  type RuntimeSchedule, type RuntimeScheduleItem, type ScheduleItemRun,
} from '../db/schema/index.js';
import { pgErrorCode, pgViolates } from '../dao/errors.js';
import { createRuntimeWorkflow } from '../dao/runtime-workflows.js';
import { getScheduleLateToleranceMinutes } from '../dao/system-settings.js';
import { appendScheduleEvent } from './events.js';
import { nextOccurrence, type Recurrence, type Slot } from './recurrence.js';
import { resolveParams, type ResolveContext, type ValueSource } from './values.js';

type Db = PgDatabase<any, Schema>;

export type SlotOrigin = 'on_time' | 'late' | 'resume';

const MAX_ROWS_PER_CALL = 20;
/** Rows that throw do not use up the 20, so this is what bounds a tick when many are broken. */
const MAX_ATTEMPTS_PER_CALL = 100;
/** Deadlock, serialization failure, lock not available: gone on a retry, so not the item's fault. */
const TRANSIENT_PG_CODES = new Set(['40P01', '40001', '55P03']);
export const SLOT_ALREADY_RECORDED = 'schedule_occurrence_slot_uq';
/** A slot this close to due is on time: the tick itself can take this long to reach it. */
const ON_TIME_WITHIN_MS = 60_000;
export const SYSTEM = { kind: 'system' } as const;

const recurrenceOf = (row: RuntimeSchedule) => row.recurrence as Recurrence;

/** The driver's message rather than drizzle's wrapper, which repeats the query and its values. */
export function reasonOf(err: unknown): string {
  const cause = (err as { cause?: unknown } | null)?.cause;
  const source = cause instanceof Error ? cause : err;
  return source instanceof Error ? source.message : String(source);
}

const MAX_REMEMBERED_LOGS = 1000;
const logged = new Set<string>();

/** A broken row fails on every tick, so each message for each id goes to the log only once. */
export function logOnce(runtimeId: string, message: string): void {
  const key = `${runtimeId}\n${message}`;
  if (logged.has(key)) return;
  if (logged.size >= MAX_REMEMBERED_LOGS) logged.clear();
  logged.add(key);
  console.error(`[scheduling] Runtime Schedule ${runtimeId}: ${message}`);
}

/**
 * Takes every workflow row the coming runs need FOR SHARE, in one statement and in id order.
 * Creating a run locks its workflow row and then the work center, and that work-center lock lasts
 * until commit. Taking the workflow rows one run at a time would wait on a later one while holding
 * the work center, the reverse of the workflow-then-work-center order the other writers rely on.
 */
export async function lockItemWorkflows(tx: Db, workflowIds: string[]): Promise<void> {
  if (workflowIds.length === 0) return;
  await tx.select({ id: workflow.id }).from(workflow)
    .where(inArray(workflow.id, [...new Set(workflowIds)])).orderBy(asc(workflow.id)).for('share');
}

export type ItemStart = {
  occurrenceId: string;
  item: RuntimeScheduleItem;
  /** The frozen label the run carries: `<RS label> / occurrence <n>`. */
  label: string;
  values: ResolveContext;
  /** A chained item: the run that triggered it, whose label names it when a value is empty. */
  parentRun?: { id: string; runtimeLabel: string | null };
  /** The item already has a run row, a held one: record the outcome there rather than adding one. */
  existingRunId?: string;
};

/**
 * Starts one item and records the outcome on its run row. The caller holds the workflow locks
 * (lockItemWorkflows). A failure in this item stays in its savepoint and records failed_to_start,
 * so one bad workflow never stops the others. A transient error rethrows: it says nothing about
 * this item, so the caller's whole transaction should run again on a later tick.
 */
export async function startScheduleItem(tx: Db, start: ItemStart): Promise<'started' | 'failed_to_start'> {
  const { occurrenceId, item, label, parentRun, existingRunId } = start;
  const itemRunId = existingRunId ?? crypto.randomUUID();
  const record = async (db: Db, outcome: Partial<ScheduleItemRun>): Promise<void> => {
    if (existingRunId) {
      await db.update(scheduleItemRun).set(outcome).where(eq(scheduleItemRun.id, existingRunId));
    } else {
      await db.insert(scheduleItemRun).values({
        id: itemRunId, occurrenceId, itemId: item.id, parentRunId: parentRun?.id ?? null, ...outcome,
      });
    }
  };
  try {
    // The run and its item-run row commit or roll back together: a run with no item-run row
    // would never be seen to end.
    await tx.transaction(async (t) => {
      const savepoint = t as unknown as Db;
      const resolved = resolveParams((item.params ?? {}) as Record<string, ValueSource>, start.values);
      if (!resolved.ok) {
        const from = parentRun?.runtimeLabel;
        throw new Error(from ? resolved.reason.replace(/the triggering run$/, () => from) : resolved.reason);
      }
      if (!item.workflowId) throw new Error('This schedule item has no workflow');
      const run = await createRuntimeWorkflow(savepoint, {
        workflowId: item.workflowId, params: resolved.values, userId: null, start: true,
        triggeredBy: 'schedule', ignoreUnknownParams: false,
        specSnapshot: {
          spec: item.specJsonb, name: item.masterName, oid: item.masterOid,
          version: item.masterVersion, state: item.masterState,
        },
        schedule: { itemRunId, label },
      });
      await record(savepoint, {
        status: 'started', workflowInstanceId: run.id, runtimeLabel: run.runtimeLabel, detail: null,
      });
    });
    return 'started';
  } catch (err) {
    if (TRANSIENT_PG_CODES.has(pgErrorCode(err) ?? '')) throw err;
    // Outside the rolled-back savepoint. If the transaction itself is gone, this throws too and
    // the caller's whole transaction is retried.
    await record(tx, { status: 'failed_to_start', detail: reasonOf(err) });
    return 'failed_to_start';
  }
}

/**
 * Records one slot: its occurrence, one item run per start-list item, and the audit event. The
 * caller holds the Runtime's row lock and advances next_fire_at. An occurrence that already
 * exists throws, and any error other than one item's own rolls back the caller's transaction.
 */
export async function fireOneSlot(tx: Db, runtime: RuntimeSchedule, slot: Slot, origin: SlotOrigin): Promise<void> {
  const [occurrence] = await tx.insert(scheduleOccurrence).values({
    runtimeScheduleId: runtime.id, number: slot.number, scheduledAt: slot.at, firedAt: sql`now()`, origin,
  }).returning({ id: scheduleOccurrence.id });
  const occurrenceId = occurrence!.id;

  const items = await tx.select().from(runtimeScheduleItem)
    .where(and(eq(runtimeScheduleItem.runtimeScheduleId, runtime.id), isNull(runtimeScheduleItem.parentItemId)))
    .orderBy(asc(runtimeScheduleItem.position), asc(runtimeScheduleItem.id));

  await lockItemWorkflows(tx, items.flatMap((i) => (!i.disabled && i.workflowId ? [i.workflowId] : [])));

  const label = `${runtime.label} / occurrence ${slot.number}`;
  const counts = { started: 0, failed: 0, skipped: 0 };
  for (const item of items) {
    if (item.disabled) {
      await tx.insert(scheduleItemRun).values({ occurrenceId, itemId: item.id, status: 'skipped_disabled' });
      counts.skipped++;
      continue;
    }
    const outcome = await startScheduleItem(tx, {
      occurrenceId, item, label, values: { slot, zone: runtime.timeZone, trigger: null },
    });
    if (outcome === 'started') counts.started++;
    else counts.failed++;
  }

  await appendScheduleEvent(tx, {
    runtimeScheduleId: runtime.id, action: 'slot_fired', actor: SYSTEM,
    detail: { number: slot.number, scheduledAt: slot.at.toISOString(), origin, ...counts },
  });
}

/** §6.4: the whole window up to now waits for a person's decision; only later slots go on. */
async function recordMissedWindow(tx: Db, row: RuntimeSchedule, slot: Slot, now: Date): Promise<void> {
  const next = nextOccurrence(recurrenceOf(row), row.timeZone, now);
  await tx.update(runtimeSchedule).set({
    missedFrom: row.missedFrom ?? slot.at, missedTo: now, nextFireAt: next?.at ?? null,
  }).where(eq(runtimeSchedule.id, row.id));
  await appendScheduleEvent(tx, {
    runtimeScheduleId: row.id, action: 'slots_missed', actor: SYSTEM,
    detail: { from: slot.at.toISOString(), to: now.toISOString() },
  });
}

/** The slot already has an occurrence, so firing it can never succeed: move past it. */
export async function advancePastRecordedSlot(db: Db, seen: RuntimeSchedule, slot: Slot): Promise<void> {
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [row] = await tx.select().from(runtimeSchedule)
      .where(eq(runtimeSchedule.id, seen.id)).for('update', { skipLocked: true });
    // Locked, paused, or already moved on by someone else: nothing to do here.
    if (row?.status !== 'active' || row.nextFireAt?.getTime() !== seen.nextFireAt?.getTime()) return;
    const next = nextOccurrence(recurrenceOf(row), row.timeZone, slot.at);
    await tx.update(runtimeSchedule).set({ nextFireAt: next?.at ?? null }).where(eq(runtimeSchedule.id, row.id));
    await appendScheduleEvent(tx, {
      runtimeScheduleId: row.id, action: 'slot_already_recorded', actor: SYSTEM,
      detail: { number: slot.number, scheduledAt: slot.at.toISOString() },
    });
  });
}

/**
 * Starts what is due, at most one slot per Runtime and 20 Runtimes per call; a Runtime further
 * behind takes its next slot on the next tick. A Runtime that throws is logged and does not use
 * up the 20, so a few broken rows cannot hold the healthy ones back; 100 attempts is the limit
 * for one call either way. Returns the slots fired.
 */
export async function fireDueSlots(db: Db, now: Date): Promise<number> {
  const toleranceMs = (await getScheduleLateToleranceMinutes(db)) * 60_000;
  const tried: string[] = [];
  let rows = 0;
  let fired = 0;
  for (let attempts = 0; rows < MAX_ROWS_PER_CALL && attempts < MAX_ATTEMPTS_PER_CALL; attempts++) {
    const seen: { row?: RuntimeSchedule; slot?: Slot } = {};
    try {
      const outcome = await db.transaction(async (t): Promise<'none' | 'fired' | 'no_fire'> => {
        const tx = t as unknown as Db;
        // The status re-check under the lock: Postgres re-evaluates this WHERE on the row version
        // it locks, so a Pause or Cancel committed before the lock means the row is not returned,
        // and one arriving after it waits for this transaction.
        const [row] = await tx.select().from(runtimeSchedule).where(and(
          eq(runtimeSchedule.status, 'active'), lte(runtimeSchedule.nextFireAt, now),
          tried.length ? notInArray(runtimeSchedule.id, tried) : undefined,
        )).orderBy(asc(runtimeSchedule.nextFireAt), asc(runtimeSchedule.id)).limit(1)
          .for('update', { skipLocked: true });
        if (!row) return 'none';
        seen.row = row;

        // The first slot at or after next_fire_at; normally next_fire_at itself.
        const slot = nextOccurrence(recurrenceOf(row), row.timeZone, new Date(row.nextFireAt!.getTime() - 1));
        if (!slot || slot.at > now) {
          await tx.update(runtimeSchedule).set({ nextFireAt: slot?.at ?? null }).where(eq(runtimeSchedule.id, row.id));
          await appendScheduleEvent(tx, {
            runtimeScheduleId: row.id, action: 'next_fire_realigned', actor: SYSTEM,
            detail: { from: row.nextFireAt!.toISOString(), to: slot?.at.toISOString() ?? null },
          });
          return 'no_fire';
        }
        seen.slot = slot;

        const lateMs = now.getTime() - slot.at.getTime();
        if (lateMs > toleranceMs) {
          await recordMissedWindow(tx, row, slot, now);
          return 'no_fire';
        }
        await fireOneSlot(tx, row, slot, lateMs > ON_TIME_WITHIN_MS ? 'late' : 'on_time');
        const next = nextOccurrence(recurrenceOf(row), row.timeZone, slot.at);
        await tx.update(runtimeSchedule).set({ nextFireAt: next?.at ?? null }).where(eq(runtimeSchedule.id, row.id));
        return 'fired';
      });
      if (outcome === 'none') break;
      tried.push(seen.row!.id);
      rows++;
      if (outcome === 'fired') fired++;
    } catch (err) {
      // No row yet means the query for one failed, which is not this Runtime's fault.
      if (!seen.row) throw err;
      tried.push(seen.row.id);
      try {
        if (seen.slot && pgViolates(err, SLOT_ALREADY_RECORDED)) await advancePastRecordedSlot(db, seen.row, seen.slot);
        else logOnce(seen.row.id, reasonOf(err));
      } catch (again) {
        logOnce(seen.row.id, reasonOf(again));
      }
    }
  }
  return fired;
}
