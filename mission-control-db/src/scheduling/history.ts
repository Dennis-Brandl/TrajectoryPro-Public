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

// Schedule history (2026-11-09 amendment): one record per completed pass of a Runtime Schedule,
// listed in History beside the workflow runs. A pass is complete when none of its runs is still
// going or waiting to start. A parent's ending and its chained starts commit together (chain.ts),
// so once nothing is open, nothing more can join the pass.

import { and, asc, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Schema } from '../db/client.js';
import {
  runtimeHistory, runtimeSchedule, runtimeScheduleItem, scheduleHistory, scheduleItemRun, scheduleOccurrence,
  type ScheduleHistoryWorkflow, type ScheduleItemRunStatus,
} from '../db/schema/index.js';
import { DaoError } from '../dao/errors.js';

type Db = PgDatabase<any, Schema>;

const OPEN: ScheduleItemRunStatus[] = ['started', 'held', 'start_requested'];
const MAX_PASSES_PER_CALL = 50;

const openRunsOf = (db: Db, occurrenceId: typeof scheduleOccurrence.id | string) =>
  db.select({ one: sql`1` }).from(scheduleItemRun)
    .where(and(eq(scheduleItemRun.occurrenceId, occurrenceId), inArray(scheduleItemRun.status, OPEN)));

const anyRunOf = (db: Db, occurrenceId: typeof scheduleOccurrence.id) =>
  db.select({ one: sql`1` }).from(scheduleItemRun).where(eq(scheduleItemRun.occurrenceId, occurrenceId));

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function asValues(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, x == null ? '' : String(x)]));
}

/** Writes one pass, unless it is still open or another tick got there first. True when written. */
async function recordPass(db: Db, occurrenceId: string, now: Date): Promise<boolean> {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    // NO KEY UPDATE: a chain insert's foreign key takes KEY SHARE on this row and must not wait on us.
    const [occ] = await tx.select().from(scheduleOccurrence)
      .where(and(eq(scheduleOccurrence.id, occurrenceId), isNull(scheduleOccurrence.historyRecordedAt)))
      .for('no key update', { skipLocked: true });
    if (!occ) return false;
    const [open] = await openRunsOf(tx, occurrenceId).limit(1);
    if (open) return false;

    const [runtime] = await tx.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, occ.runtimeScheduleId));
    const runs = await tx.select({
      run: scheduleItemRun, name: runtimeScheduleItem.masterName, version: runtimeScheduleItem.masterVersion,
    }).from(scheduleItemRun)
      .innerJoin(runtimeScheduleItem, eq(runtimeScheduleItem.id, scheduleItemRun.itemId))
      .where(eq(scheduleItemRun.occurrenceId, occurrenceId))
      // Runs started together share a timestamp, so the schedule's own order breaks the tie.
      .orderBy(asc(scheduleItemRun.createdAt), asc(runtimeScheduleItem.position), asc(scheduleItemRun.id));
    if (!runtime || runs.length === 0) return false;

    const instanceIds = runs.flatMap(({ run }) => (run.workflowInstanceId ? [run.workflowInstanceId] : []));
    const histories = new Map((instanceIds.length === 0 ? [] : await tx.select({
      instanceId: runtimeHistory.workflowInstanceId, startedAt: runtimeHistory.startedAt,
      finishedAt: runtimeHistory.finishedAt, startingParams: runtimeHistory.startingParams,
    }).from(runtimeHistory).where(inArray(runtimeHistory.workflowInstanceId, instanceIds))).map((h) => [h.instanceId!, h]));

    const workflows: ScheduleHistoryWorkflow[] = runs.map(({ run, name, version }) => {
      const h = run.workflowInstanceId ? histories.get(run.workflowInstanceId) : undefined;
      const recorded = (run.triggerValues as { inputs?: unknown } | null)?.inputs;
      const ran = run.workflowInstanceId !== null;
      return {
        runId: run.id, parentRunId: run.parentRunId, name, version,
        status: run.status as ScheduleItemRunStatus, finalState: run.finalState,
        runtimeLabel: run.runtimeLabel, workflowInstanceId: run.workflowInstanceId,
        startedAt: ran ? iso(h?.startedAt ?? run.createdAt) : null,
        finishedAt: iso(run.finishedAt ?? h?.finishedAt),
        startingValues: ran ? asValues(recorded ?? h?.startingParams) : null,
        detail: run.detail,
      };
    });
    const starts = workflows.flatMap((w) => (w.startedAt ? [w.startedAt] : [])).sort();
    const ends = workflows.flatMap((w) => (w.finishedAt ? [w.finishedAt] : [])).sort();

    await tx.insert(scheduleHistory).values({
      occurrenceId, runtimeScheduleId: runtime.id, workCenterId: runtime.workCenterId, workCenterName: runtime.workCenterName,
      scheduleLabel: runtime.label, scheduleName: runtime.name, runOnce: runtime.runOnce, timeZone: runtime.timeZone,
      occurrenceNumber: occ.number, scheduledAt: occ.scheduledAt,
      startedAt: starts[0] ? new Date(starts[0]) : occ.firedAt,
      finishedAt: ends.length ? new Date(ends[ends.length - 1]!) : now,
      origin: occ.origin, workflows,
    }).onConflictDoNothing({ target: scheduleHistory.occurrenceId });
    await tx.update(scheduleOccurrence).set({ historyRecordedAt: now }).where(eq(scheduleOccurrence.id, occurrenceId));
    return true;
  });
}

/** The tick's last step: writes every pass that has just completed, at most 50 per call. Returns how many. */
export async function recordFinishedPasses(db: Db, now: Date): Promise<number> {
  const candidates = await db.select({ id: scheduleOccurrence.id }).from(scheduleOccurrence)
    .where(and(
      isNull(scheduleOccurrence.historyRecordedAt),
      sql`exists (${anyRunOf(db, scheduleOccurrence.id)})`,
      notExists(openRunsOf(db, scheduleOccurrence.id)),
    ))
    .orderBy(asc(scheduleOccurrence.firedAt), asc(scheduleOccurrence.id)).limit(MAX_PASSES_PER_CALL);
  let recorded = 0;
  for (const { id } of candidates) {
    try {
      if (await recordPass(db, id, now)) recorded++;
    } catch (err) {
      console.error(`[schedule history] pass ${id} not recorded yet:`, err instanceof Error ? err.message : err);
    }
  }
  return recorded;
}

// ------------------------------------------------------------------------------------------- reads

export type ScheduleHistorySummary = {
  id: string; workCenterId: string | null; workCenterName: string;
  scheduleLabel: string; scheduleName: string; runOnce: boolean; occurrenceNumber: number;
  scheduledAt: Date; startedAt: Date | null; finishedAt: Date; timeZone: string;
  /** Workflows that ran, how many completed, and how many failed, were lost or ended otherwise. */
  counts: { ran: number; completed: number; problems: number; notStarted: number };
};

export type ScheduleHistoryWorkflowView = ScheduleHistoryWorkflow & {
  /** Its workflow History record, while one exists. */
  historyId: string | null;
};

export type ScheduleHistoryDetail = ScheduleHistorySummary & {
  origin: string; runtimeScheduleId: string | null; workflows: ScheduleHistoryWorkflowView[];
};

export function countsOf(workflows: ScheduleHistoryWorkflow[]): ScheduleHistorySummary['counts'] {
  const ran = workflows.filter((w) => w.status === 'finished');
  const completed = ran.filter((w) => w.finalState === 'completed').length;
  const failed = workflows.filter((w) => w.status === 'failed_to_start' || w.status === 'lost').length;
  return {
    ran: ran.length, completed, problems: ran.length - completed + failed,
    notStarted: workflows.length - ran.length - failed,
  };
}

export function summaryOf(row: typeof scheduleHistory.$inferSelect): ScheduleHistorySummary {
  return {
    id: row.id, workCenterId: row.workCenterId, workCenterName: row.workCenterName,
    scheduleLabel: row.scheduleLabel, scheduleName: row.scheduleName, runOnce: row.runOnce,
    occurrenceNumber: row.occurrenceNumber, scheduledAt: row.scheduledAt, startedAt: row.startedAt,
    finishedAt: row.finishedAt, timeZone: row.timeZone, counts: countsOf(row.workflows),
  };
}

export async function getScheduleHistoryDetail(db: Db, id: string): Promise<ScheduleHistoryDetail | undefined> {
  const [row] = await db.select().from(scheduleHistory).where(eq(scheduleHistory.id, id));
  if (!row) return undefined;
  const instanceIds = row.workflows.flatMap((w) => (w.workflowInstanceId ? [w.workflowInstanceId] : []));
  const historyIds = new Map((instanceIds.length === 0 ? [] : await db.select({ id: runtimeHistory.id, instanceId: runtimeHistory.workflowInstanceId })
    .from(runtimeHistory).where(inArray(runtimeHistory.workflowInstanceId, instanceIds))).map((h) => [h.instanceId!, h.id]));
  return {
    ...summaryOf(row), origin: row.origin, runtimeScheduleId: row.runtimeScheduleId,
    workflows: row.workflows.map((w) => ({ ...w, historyId: w.workflowInstanceId ? historyIds.get(w.workflowInstanceId) ?? null : null })),
  };
}

export async function deleteScheduleHistory(db: Db, id: string): Promise<void> {
  const rows = await db.delete(scheduleHistory).where(eq(scheduleHistory.id, id)).returning({ id: scheduleHistory.id });
  if (rows.length === 0) throw new DaoError('HISTORY_NOT_FOUND');
}

/** The record's work center, for the delete gate. undefined = not found; null = work center deleted. */
export async function scheduleHistoryRowGate(db: Db, id: string): Promise<{ workCenterId: string | null } | undefined> {
  const [row] = await db.select({ workCenterId: scheduleHistory.workCenterId }).from(scheduleHistory)
    .where(eq(scheduleHistory.id, id));
  return row;
}
