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

// When a scheduled run ends, its chained workflows start (spec 2026-11-08 §6.3), and a Runtime
// Schedule with nothing left to do finishes (§6.5). A history row is proof of an ending: it is
// written in the same transaction as the run's final state, so a crash just leaves the item run
// `started` until a later tick sees it. Each ending is one transaction, and the `started` to
// `finished` change in it is what keeps its chain from firing twice.

import { and, asc, eq, inArray, isNull, lt, notExists, notInArray, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Schema } from '../db/client.js';
import {
  runtimeHistory, runtimeSchedule, runtimeScheduleItem, scheduleItemRun, scheduleOccurrence, workflowInstance,
  type RuntimeSchedule, type RuntimeScheduleItem, type ScheduleItemRun, type ScheduleItemRunStatus,
  type ScheduleOccurrence,
} from '../db/schema/index.js';
import { appendScheduleEvent } from './events.js';
import { lockItemWorkflows, logOnce, reasonOf, startScheduleItem } from './fire.js';
import type { ResolveContext } from './values.js';

type Db = PgDatabase<any, Schema>;

const MAX_ENDINGS_PER_CALL = 50;
/** Endings that throw do not use up the 50, so this is what bounds a tick when many are broken. */
const MAX_ATTEMPTS_PER_CALL = 100;
/** The run and its link commit together, so this long a wait is simple caution. */
const LOST_AFTER_MS = 60_000;
const LOST_DETAIL = 'The run disappeared and left no history';
const SYSTEM = { kind: 'system' } as const;
/** A held row can still start, so it keeps its Runtime Schedule open as a running one does. */
const STARTABLE_STATUSES: ScheduleItemRunStatus[] = ['held', 'start_requested'];
const HOLDS_OPEN_STATUSES: ScheduleItemRunStatus[] = ['started', ...STARTABLE_STATUSES];

export type ChainContext = ResolveContext & { label: string };
type TriggerValues = NonNullable<ResolveContext['trigger']>;

/** Outputs in history are a list of `{name, value}`; null means the run recorded none. */
function outputsByName(outputs: unknown): Record<string, string> {
  if (!Array.isArray(outputs)) return {};
  return Object.fromEntries((outputs as Array<{ name: string; value: string }>).map((o) => [o.name, o.value]));
}

/**
 * What a chained item's values and label come from. It reads the parent's stored trigger_values,
 * not history, so a held chain does not depend on the history row staying.
 */
export function chainContext(
  parentRun: ScheduleItemRun,
  runtime: Pick<RuntimeSchedule, 'label' | 'timeZone'>,
  occurrence: Pick<ScheduleOccurrence, 'scheduledAt' | 'number'>,
): ChainContext {
  return {
    slot: { at: occurrence.scheduledAt, number: occurrence.number },
    zone: runtime.timeZone,
    trigger: (parentRun.triggerValues as TriggerValues | null) ?? { inputs: {}, outputs: {} },
    label: `${runtime.label} / occurrence ${occurrence.number}`,
  };
}

/**
 * Starts one chained item, recording `started` or `failed_to_start` on its run row: the held row
 * if it has one (catch-up), otherwise a new one. A row that has already moved on is left as it is
 * and its status returned, so no run starts for it. The caller holds the Runtime Schedule row and
 * the workflow locks (lockItemWorkflows).
 */
export async function startChainItem(
  tx: Db, parentRun: ScheduleItemRun, item: RuntimeScheduleItem, ctx: ChainContext,
): Promise<ScheduleItemRunStatus> {
  const [existing] = await tx.select({ id: scheduleItemRun.id, status: scheduleItemRun.status })
    .from(scheduleItemRun)
    .where(and(eq(scheduleItemRun.occurrenceId, parentRun.occurrenceId), eq(scheduleItemRun.itemId, item.id)))
    .for('update');
  if (existing && !STARTABLE_STATUSES.includes(existing.status as ScheduleItemRunStatus)) {
    return existing.status as ScheduleItemRunStatus;
  }
  const { label, ...values } = ctx;
  return startScheduleItem(tx, {
    occurrenceId: parentRun.occurrenceId, item, label, values, parentRun, existingRunId: existing?.id,
  });
}

/** §6.3's table, up to "value source empty": the status a child gets without starting, or null to start it. */
function statusWithoutStart(
  item: RuntimeScheduleItem, ending: string, runtimeStatus: string,
): ScheduleItemRunStatus | null {
  if (!item.triggerOn?.includes(ending)) return 'not_triggered';
  if (item.disabled) return 'skipped_disabled';
  if (runtimeStatus === 'active') return null;
  // A finished Runtime has no `started` rows (§6.5), so cannot get here; it must not start anything.
  return runtimeStatus === 'paused' ? 'held' : 'cancelled';
}

type EndedRun = {
  run: ScheduleItemRun;
  occurrence: ScheduleOccurrence;
  finalState: string;
  startingParams: unknown;
  outputs: unknown;
  finishedAt: Date;
};

async function processEnding(tx: Db, ended: EndedRun): Promise<void> {
  const { run, occurrence, finalState } = ended;
  const [parent] = await tx.update(scheduleItemRun).set({
    status: 'finished', finalState, finishedAt: ended.finishedAt,
    triggerValues: {
      inputs: (ended.startingParams as Record<string, string> | null) ?? {},
      outputs: outputsByName(ended.outputs),
    },
  }).where(eq(scheduleItemRun.id, run.id)).returning();

  // Serializes with Pause and Cancel: one committed first is seen here; one after waits for this.
  const [runtime] = await tx.select().from(runtimeSchedule)
    .where(eq(runtimeSchedule.id, occurrence.runtimeScheduleId)).for('share');

  const children = await tx.select().from(runtimeScheduleItem)
    .where(eq(runtimeScheduleItem.parentItemId, run.itemId))
    .orderBy(asc(runtimeScheduleItem.position), asc(runtimeScheduleItem.id));
  const decided = children.map((item) => ({ item, status: statusWithoutStart(item, finalState, runtime!.status) }));

  await lockItemWorkflows(tx, decided.flatMap(({ item, status }) => (!status && item.workflowId ? [item.workflowId] : [])));

  const ctx = chainContext(parent!, runtime!, occurrence);
  for (const { item, status } of decided) {
    if (status) {
      await tx.insert(scheduleItemRun).values({
        occurrenceId: run.occurrenceId, itemId: item.id, parentRunId: run.id, status,
      });
    } else {
      await startChainItem(tx, parent!, item, ctx);
    }
  }
}

/**
 * Processes runs that have ended, oldest ending first, at most 50 per call and one per
 * transaction. An ending that throws rolls back whole and stays `started` for a later tick, is
 * logged, and does not use up the 50; 100 attempts is the limit for one call either way. Returns
 * the endings processed.
 */
export async function processEndedRuns(db: Db, _now: Date): Promise<number> {
  const tried: string[] = [];
  let processed = 0;
  for (let attempts = 0; processed < MAX_ENDINGS_PER_CALL && attempts < MAX_ATTEMPTS_PER_CALL; attempts++) {
    const seen: { ended?: EndedRun } = {};
    try {
      const found = await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        const [ended] = await tx.select({
          run: scheduleItemRun,
          occurrence: scheduleOccurrence,
          finalState: runtimeHistory.finalState,
          startingParams: runtimeHistory.startingParams,
          outputs: runtimeHistory.outputs,
          finishedAt: runtimeHistory.finishedAt,
        }).from(scheduleItemRun)
          .innerJoin(runtimeHistory, eq(runtimeHistory.workflowInstanceId, scheduleItemRun.workflowInstanceId))
          .innerJoin(scheduleOccurrence, eq(scheduleOccurrence.id, scheduleItemRun.occurrenceId))
          .where(and(
            eq(scheduleItemRun.status, 'started'),
            tried.length ? notInArray(scheduleItemRun.id, tried) : undefined,
          ))
          .orderBy(asc(runtimeHistory.finishedAt), asc(scheduleItemRun.id)).limit(1)
          .for('update', { of: scheduleItemRun, skipLocked: true });
        if (!ended) return false;
        seen.ended = ended;
        await processEnding(tx, ended);
        return true;
      });
      if (!found) break;
      processed++;
    } catch (err) {
      // Nothing seen yet means the query for one failed, which is not this run's fault.
      if (!seen.ended) throw err;
      tried.push(seen.ended.run.id);
      logOnce(seen.ended.occurrence.runtimeScheduleId, reasonOf(err));
    }
  }
  return processed;
}

/**
 * §6.3 lost runs: a `started` row whose instance and history are both gone. Its chain never fires.
 * The age check is the "second look": a row counts only once it is over a minute old.
 */
export async function markLostRuns(db: Db, now: Date): Promise<number> {
  const rows = await db.update(scheduleItemRun).set({ status: 'lost', detail: LOST_DETAIL, finishedAt: now }).where(and(
    eq(scheduleItemRun.status, 'started'),
    lt(scheduleItemRun.createdAt, new Date(now.getTime() - LOST_AFTER_MS)),
    notExists(db.select({ one: sql`1` }).from(workflowInstance)
      .where(eq(workflowInstance.id, scheduleItemRun.workflowInstanceId))),
    notExists(db.select({ one: sql`1` }).from(runtimeHistory)
      .where(eq(runtimeHistory.workflowInstanceId, scheduleItemRun.workflowInstanceId))),
  )).returning({ id: scheduleItemRun.id });
  return rows.length;
}

/** §6.5: paused and cancelled Runtimes do not finish here; the status table has no such change. */
const NOTHING_MORE_TO_FIRE = and(
  eq(runtimeSchedule.status, 'active'),
  isNull(runtimeSchedule.nextFireAt),
  isNull(runtimeSchedule.missedFrom),
  isNull(runtimeSchedule.catchupMode),
);

const rowsHoldingOpen = (db: Db, runtimeId: string | typeof runtimeSchedule.id) =>
  db.select({ one: sql`1` }).from(scheduleItemRun)
    .innerJoin(scheduleOccurrence, eq(scheduleOccurrence.id, scheduleItemRun.occurrenceId))
    .where(and(
      eq(scheduleOccurrence.runtimeScheduleId, runtimeId),
      inArray(scheduleItemRun.status, HOLDS_OPEN_STATUSES),
    ));

/** §6.5: each Runtime with nothing left to do becomes `finished`, its frozen specs dropped. Returns how many. */
export async function finishCompletedSchedules(db: Db, now: Date): Promise<number> {
  const candidates = await db.select({ id: runtimeSchedule.id }).from(runtimeSchedule)
    .where(and(NOTHING_MORE_TO_FIRE, notExists(rowsHoldingOpen(db, runtimeSchedule.id))));

  let finished = 0;
  for (const { id } of candidates) {
    try {
      const done = await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        // Skips one busy with an ending, which holds this row FOR SHARE: the next tick sees what it did.
        const [row] = await tx.select({ id: runtimeSchedule.id }).from(runtimeSchedule)
          .where(and(eq(runtimeSchedule.id, id), NOTHING_MORE_TO_FIRE))
          .for('update', { skipLocked: true });
        if (!row) return false;
        // Asked again now the lock is held, as an ending may have committed since the first look.
        const [holding] = await rowsHoldingOpen(tx, id).limit(1);
        if (holding) return false;

        await tx.update(runtimeSchedule).set({ status: 'finished', endedAt: now }).where(eq(runtimeSchedule.id, id));
        await tx.update(runtimeScheduleItem).set({ specJsonb: null }).where(eq(runtimeScheduleItem.runtimeScheduleId, id));
        await appendScheduleEvent(tx, { runtimeScheduleId: id, action: 'finished', actor: SYSTEM });
        return true;
      });
      if (done) finished++;
    } catch (err) {
      logOnce(id, reasonOf(err));
    }
  }
  return finished;
}
