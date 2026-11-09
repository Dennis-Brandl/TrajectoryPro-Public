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

import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import { runtimeHistory, scheduleHistory, scheduleItemRun, type RuntimeFinalState } from '../db/schema/index.js';
import { summaryOf, type ScheduleHistorySummary } from '../scheduling/history.js';
import { stepSignature, stepRun, runtimeControlEvent } from '../db/schema/execution.js';
import { appUser } from '../db/schema/identity.js';
import { listStepRuns, deleteStepRunsForInstances, type StepRunView } from './step-runs.js';
import { listControlEvents, deleteControlEventsForInstances, type ControlEventView } from './control-events.js';
import { DaoError } from './errors.js';
import { listStepSignatures, deleteStepSignaturesForInstances, type StepSignatureView } from './step-signatures.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

export type RuntimeHistorySummary = {
  id: string; workflowInstanceId: string | null; workCenterId: string | null; workCenterName: string;
  runtimeNumber: number; runtimeLabel: string; masterName: string; masterOid: string; masterVersion: string; masterState: string;
  // The DB CHECK (generated from RUNTIME_FINAL_STATES) guarantees the narrowing.
  finalState: RuntimeFinalState; startedAt: Date | null; finishedAt: Date; createdAt: Date;
  scheduleLabel: string | null;
};

export type RuntimeHistoryFilter = {
  workCenterId?: string; orphansOnly?: boolean;
  finalState?: RuntimeFinalState;
  nameSearch?: string; finishedFrom?: Date; finishedTo?: Date;
};

export type RuntimeHistoryDetail = RuntimeHistorySummary & {
  startingParams: Record<string, string> | null; trace: unknown; properties: Record<string, string> | null;
  stepParams: unknown | null; stepNames: Record<string, string> | null;
  signatures: StepSignatureView[];
  stepRuns: StepRunView[];
  /** Who sent every Stop/Abort/skip-cleanup, oldest first (spec 2026-11-06 U8). */
  controlEvents: ControlEventView[];
  startedByUserId: string | null; startedByLoginName: string | null;
  /** login names for every uuid that appears as `[by <uuid>]` in the trace error texts; unknown ids omitted. */
  userNames: Record<string, string>;
  createdByLabel: string | null; createdByInstanceId: string | null;
  outputs: Array<{ name: string; value: string }> | null;
};

// Summary projection NEVER ships trace/properties/step_params/starting_params/step_names
// (M6 over-fetch lesson) — only getRuntimeHistoryDetail's full-row select carries those.
const SUMMARY_COLS = {
  id: runtimeHistory.id, workflowInstanceId: runtimeHistory.workflowInstanceId,
  workCenterId: runtimeHistory.workCenterId, workCenterName: runtimeHistory.workCenterName,
  runtimeNumber: runtimeHistory.runtimeNumber, runtimeLabel: runtimeHistory.runtimeLabel,
  masterName: runtimeHistory.masterName, masterOid: runtimeHistory.masterOid,
  masterVersion: runtimeHistory.masterVersion, masterState: runtimeHistory.masterState,
  finalState: runtimeHistory.finalState,
  startedAt: runtimeHistory.startedAt, finishedAt: runtimeHistory.finishedAt, createdAt: runtimeHistory.createdAt,
  scheduleLabel: runtimeHistory.scheduleLabel,
};

/** Escapes `\`, `%`, `_` for a Postgres ILIKE pattern (backslash is the default escape char).
 *  Order-independent: a single left-to-right scan of the ORIGINAL string, so a literal
 *  backslash in the input can't accidentally re-escape a wildcard we just inserted. */
function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export const RUNTIME_HISTORY_MAX_PAGE_SIZE = 200;
const RUNTIME_HISTORY_DEFAULT_PAGE_SIZE = 50;

function filterConds(f: RuntimeHistoryFilter) {
  if (f.workCenterId !== undefined && f.orphansOnly) {
    throw new DaoError('HISTORY_FILTER_INVALID', 'workCenterId and orphansOnly are mutually exclusive');
  }
  const conds = [];
  if (f.workCenterId !== undefined) conds.push(eq(runtimeHistory.workCenterId, f.workCenterId));
  if (f.orphansOnly) conds.push(isNull(runtimeHistory.workCenterId));
  if (f.finalState !== undefined) conds.push(eq(runtimeHistory.finalState, f.finalState));
  if (f.nameSearch !== undefined) conds.push(ilike(runtimeHistory.masterName, `%${escapeLikePattern(f.nameSearch)}%`));
  if (f.finishedFrom !== undefined) conds.push(gte(runtimeHistory.finishedAt, f.finishedFrom));
  if (f.finishedTo !== undefined) conds.push(lte(runtimeHistory.finishedAt, f.finishedTo));
  return conds;
}

/** Finished-run log list (spec §4): paged, filtered summaries ordered newest-finished-first.
 *  NaN-proof clamps mirror listRuntimeWorkflowsPage's shape (runtime-workflows.ts). */
export async function listRuntimeHistoryPage(
  db: Db, opts: RuntimeHistoryFilter & { page?: number; pageSize?: number } = {},
): Promise<{ items: RuntimeHistorySummary[]; total: number; page: number; pageSize: number }> {
  const conds = filterConds(opts);
  const where = conds.length ? and(...conds) : undefined;
  const rawPageSize = Number.isFinite(opts.pageSize) ? opts.pageSize! : RUNTIME_HISTORY_DEFAULT_PAGE_SIZE;
  const rawPage = Number.isFinite(opts.page) ? opts.page! : 1;
  const pageSize = Math.min(Math.max(1, rawPageSize), RUNTIME_HISTORY_MAX_PAGE_SIZE);
  const page = Math.max(1, rawPage);
  const n = (await db.select({ n: sql<number>`count(*)::int` }).from(runtimeHistory).where(where))[0]!.n;
  const rows = await db.select(SUMMARY_COLS).from(runtimeHistory)
    .where(where)
    .orderBy(desc(runtimeHistory.finishedAt))
    .limit(pageSize).offset((page - 1) * pageSize);
  return { items: rows as RuntimeHistorySummary[], total: n, page, pageSize };
}

/** One row of the History list: a workflow run, or a completed schedule pass. */
export type HistoryEntry =
  | ({ kind: 'workflow' } & RuntimeHistorySummary)
  | ({ kind: 'schedule' } & ScheduleHistorySummary);

function scheduleFilterConds(f: RuntimeHistoryFilter) {
  const conds = [];
  if (f.workCenterId !== undefined) conds.push(eq(scheduleHistory.workCenterId, f.workCenterId));
  if (f.orphansOnly) conds.push(isNull(scheduleHistory.workCenterId));
  if (f.nameSearch !== undefined) {
    const pattern = `%${escapeLikePattern(f.nameSearch)}%`;
    conds.push(or(
      ilike(scheduleHistory.scheduleName, pattern),
      sql`exists (select 1 from jsonb_array_elements(${scheduleHistory.workflows}) w where w->>'name' ilike ${pattern})`,
    )!);
  }
  if (f.finishedFrom !== undefined) conds.push(gte(scheduleHistory.finishedAt, f.finishedFrom));
  if (f.finishedTo !== undefined) conds.push(lte(scheduleHistory.finishedAt, f.finishedTo));
  return conds;
}

/**
 * The History list: workflow runs and completed schedule passes in one list, newest finished
 * first, paged together. A pass has no single ending, so a state filter shows workflow runs only;
 * a name search matches a pass by its schedule's name or any of its workflows.
 */
export async function listHistoryEntriesPage(
  db: Db, opts: RuntimeHistoryFilter & { page?: number; pageSize?: number } = {},
): Promise<{ items: HistoryEntry[]; total: number; page: number; pageSize: number }> {
  if (opts.workCenterId !== undefined && opts.orphansOnly) {
    throw new DaoError('HISTORY_FILTER_INVALID', 'workCenterId and orphansOnly are mutually exclusive');
  }
  const wfConds = filterConds(opts);
  const wfWhere = wfConds.length ? and(...wfConds) : undefined;
  const withPasses = opts.finalState === undefined;
  const passConds = scheduleFilterConds(opts);
  const passWhere = passConds.length ? and(...passConds) : undefined;
  const rawPageSize = Number.isFinite(opts.pageSize) ? opts.pageSize! : RUNTIME_HISTORY_DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(Math.max(1, rawPageSize), RUNTIME_HISTORY_MAX_PAGE_SIZE);
  const page = Math.max(1, Number.isFinite(opts.page) ? opts.page! : 1);

  const wfCount = (await db.select({ n: sql<number>`count(*)::int` }).from(runtimeHistory).where(wfWhere))[0]!.n;
  const passCount = withPasses
    ? (await db.select({ n: sql<number>`count(*)::int` }).from(scheduleHistory).where(passWhere))[0]!.n : 0;

  const wfKeys = db.select({ kind: sql<string>`'workflow'`.as('kind'), id: runtimeHistory.id, finishedAt: runtimeHistory.finishedAt })
    .from(runtimeHistory).where(wfWhere);
  const passKeys = db.select({ kind: sql<string>`'schedule'`.as('kind'), id: scheduleHistory.id, finishedAt: scheduleHistory.finishedAt })
    .from(scheduleHistory).where(passWhere);
  const keys = (withPasses
    ? await unionAll(wfKeys, passKeys).orderBy(sql`3 desc`, sql`1`, sql`2`).limit(pageSize).offset((page - 1) * pageSize)
    : await wfKeys.orderBy(desc(runtimeHistory.finishedAt), runtimeHistory.id).limit(pageSize).offset((page - 1) * pageSize)
  ) as Array<{ kind: string; id: string }>;

  const wfIds = keys.filter((k) => k.kind === 'workflow').map((k) => k.id);
  const passIds = keys.filter((k) => k.kind === 'schedule').map((k) => k.id);
  const wfRows = new Map((wfIds.length === 0 ? [] : await db.select(SUMMARY_COLS).from(runtimeHistory)
    .where(inArray(runtimeHistory.id, wfIds))).map((r) => [r.id, r as RuntimeHistorySummary]));
  const passRows = new Map((passIds.length === 0 ? [] : await db.select().from(scheduleHistory)
    .where(inArray(scheduleHistory.id, passIds))).map((r) => [r.id, summaryOf(r)]));
  const items = keys.flatMap((k): HistoryEntry[] => {
    if (k.kind === 'workflow') { const r = wfRows.get(k.id); return r ? [{ kind: 'workflow', ...r }] : []; }
    const r = passRows.get(k.id);
    return r ? [{ kind: 'schedule', ...r }] : [];
  });
  return { items, total: wfCount + passCount, page, pageSize };
}

/** Full-row read for the detail dialog — every column including trace/properties/step_params/
 *  step_names, which the list projection above deliberately withholds. */
export async function getRuntimeHistoryDetail(db: Db, id: string): Promise<RuntimeHistoryDetail | undefined> {
  const [row] = await db.select().from(runtimeHistory).where(eq(runtimeHistory.id, id));
  if (!row) return undefined;
  const signatures = row.workflowInstanceId ? await listStepSignatures(db, row.workflowInstanceId) : [];
  const stepRuns = row.workflowInstanceId ? await listStepRuns(db, row.workflowInstanceId) : [];
  const controlEvents = row.workflowInstanceId ? await listControlEvents(db, row.workflowInstanceId) : [];
  const ids = new Set<string>();
  for (const m of JSON.stringify(row.trace ?? []).matchAll(/\[by ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi)) ids.add(m[1]!.toLowerCase());
  const userNames: Record<string, string> = {};
  if (ids.size > 0) {
    const users = await db.select({ id: appUser.id, loginName: appUser.loginName }).from(appUser)
      .where(inArray(appUser.id, [...ids]));
    for (const u of users) userNames[u.id] = u.loginName;
  }
  return { ...(row as Omit<RuntimeHistoryDetail, 'signatures' | 'stepRuns' | 'controlEvents' | 'userNames'>), signatures, stepRuns, controlEvents, userNames };
}

export async function deleteRuntimeHistory(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ workflowInstanceId: runtimeHistory.workflowInstanceId }).from(runtimeHistory).where(eq(runtimeHistory.id, id));
    if (!row) throw new DaoError('HISTORY_NOT_FOUND');
    if (row.workflowInstanceId) {
      // Spec 2026-11-08 §6.3: until the schedule tick has processed the ending, this row is the
      // only record of it, and deleting it would lose the run's chain.
      const [pending] = await tx.select({ id: scheduleItemRun.id }).from(scheduleItemRun).where(and(
        eq(scheduleItemRun.workflowInstanceId, row.workflowInstanceId), eq(scheduleItemRun.status, 'started'),
      )).limit(1);
      if (pending) {
        throw new DaoError('HISTORY_RUN_PENDING', 'Its Runtime Schedule has not processed this run\'s ending yet. Try again in a moment.');
      }
      await deleteStepSignaturesForInstances(tx, [row.workflowInstanceId]);
      await deleteStepRunsForInstances(tx, [row.workflowInstanceId]);
      await deleteControlEventsForInstances(tx, [row.workflowInstanceId]);
    }
    await tx.delete(runtimeHistory).where(eq(runtimeHistory.id, id));
  });
}

function purgeConds(opts: { olderThan: Date; workCenterId?: string }) {
  const conds = [lt(runtimeHistory.finishedAt, opts.olderThan)];
  if (opts.workCenterId !== undefined) conds.push(eq(runtimeHistory.workCenterId, opts.workCenterId));
  // A record its Runtime Schedule has not processed yet is skipped, as deleteRuntimeHistory refuses it.
  conds.push(sql`not exists (select 1 from ${scheduleItemRun}
    where ${scheduleItemRun.workflowInstanceId} = ${runtimeHistory.workflowInstanceId}
      and ${scheduleItemRun.status} = 'started')`);
  return conds;
}

function schedulePurgeConds(opts: { olderThan: Date; workCenterId?: string }) {
  const conds = [lt(scheduleHistory.finishedAt, opts.olderThan)];
  if (opts.workCenterId !== undefined) conds.push(eq(scheduleHistory.workCenterId, opts.workCenterId));
  return conds;
}

/** Workflow History records and schedule passes older than the cutoff, together. */
export async function countRuntimeHistoryBefore(
  db: Db, opts: { olderThan: Date; workCenterId?: string },
): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(runtimeHistory)
    .where(and(...purgeConds(opts)));
  const passes = await db.select({ n: sql<number>`count(*)::int` }).from(scheduleHistory)
    .where(and(...schedulePurgeConds(opts)));
  return rows[0]!.n + passes[0]!.n;
}

/** Retention sweep (spec §5): deletes rows older than the cutoff, optionally scoped to one
 *  work center. Unscoped purge never touches orphans differently — `lt(finishedAt)` alone
 *  reaches every row regardless of work_center_id; the WC scope is purely additive.
 *
 *  Stays set-based on purpose: node-postgres caps a statement at 65,535 bind parameters, so
 *  a purge must never bind one parameter per victim row. The signature delete uses an
 *  `IN (SELECT ...)` subquery (constant parameter count regardless of victim count) instead
 *  of collecting victim ids client-side and re-binding them with `inArray`; the history
 *  delete is the ORIGINAL single `DELETE ... WHERE <purgeConds>` from before this branch.
 *
 *  Repeatable read: purgeConds reads schedule_item_run, which the schedule tick changes while this
 *  runs. Every statement must pick the same victims, or a record could be deleted here and keep
 *  the signatures an earlier statement passed over. */
export async function purgeRuntimeHistory(
  db: Db, opts: { olderThan: Date; workCenterId?: string },
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.delete(stepSignature).where(
      inArray(
        stepSignature.workflowInstanceId,
        tx.select({ id: runtimeHistory.workflowInstanceId }).from(runtimeHistory)
          .where(and(...purgeConds(opts), isNotNull(runtimeHistory.workflowInstanceId))),
      ),
    );
    await tx.delete(stepRun).where(
      inArray(
        stepRun.workflowInstanceId,
        tx.select({ id: runtimeHistory.workflowInstanceId }).from(runtimeHistory)
          .where(and(...purgeConds(opts), isNotNull(runtimeHistory.workflowInstanceId))),
      ),
    );
    await tx.delete(runtimeControlEvent).where(
      inArray(
        runtimeControlEvent.workflowInstanceId,
        tx.select({ id: runtimeHistory.workflowInstanceId }).from(runtimeHistory)
          .where(and(...purgeConds(opts), isNotNull(runtimeHistory.workflowInstanceId))),
      ),
    );
    const res = await tx.delete(runtimeHistory).where(and(...purgeConds(opts)))
      .returning({ id: runtimeHistory.id });
    const passes = await tx.delete(scheduleHistory).where(and(...schedulePurgeConds(opts)))
      .returning({ id: scheduleHistory.id });
    return res.length + passes.length;
  }, { isolationLevel: 'repeatable read' });
}

/** Access-gate lookup for routes (spec §6): resolves a history row's work center without
 *  paying for the full detail payload. undefined = not found; `{ workCenterId: null }` = orphan. */
export async function historyRowGate(db: Db, id: string): Promise<{ workCenterId: string | null } | undefined> {
  const [row] = await db.select({ workCenterId: runtimeHistory.workCenterId }).from(runtimeHistory)
    .where(eq(runtimeHistory.id, id));
  return row;
}
