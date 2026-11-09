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

// Runtime Schedule reads (spec 2026-11-08 §5.4-5.5). Nothing here returns spec_jsonb: the
// frozen specs stay in the table and are read by the engine tick and Enable only.

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Schema } from '../db/client.js';
import {
  workCenter, runtimeSchedule, runtimeScheduleItem, scheduleOccurrence, scheduleItemRun,
  runtimeScheduleEvent, workflowInstance, runtimeHistory,
  type RuntimeSchedule, type RuntimeScheduleStatus, type ScheduleItemRunStatus,
} from '../db/schema/index.js';
import { compareVersions } from '../dao/environment-precedence.js';
import { getRuntimeIdTimezone } from '../dao/system-settings.js';
import { RemoteError } from '../runtime/remote-control/codes.js';
import { resolveMasterWorkflow } from '../runtime/remote-control/resolve.js';
import { masterDefinitionHashes } from './master-dao.js';
import { describeRecurrence, type Recurrence } from './recurrence.js';
import type { ValueSource } from './values.js';

type Db = PgDatabase<any, Schema>;

export type NeedsAttention = { failed: number; lost: number; missedWindow: boolean };

export type RuntimeScheduleView = {
  id: string;
  label: string;
  name: string;
  status: RuntimeScheduleStatus;
  nextFireAt: Date | null;
  timeZone: string;
  masterScheduleId: string | null;
  /** The Master's content differs from what was frozen at Enable. Edited and then changed back counts as unchanged. */
  masterChanged: boolean;
  /** Started by Run Once: it fires one time and then finishes. */
  runOnce: boolean;
  needsAttention: NeedsAttention;
};

export type RuntimeItemView = {
  id: string;
  workflowId: string | null;
  masterName: string;
  masterOid: string;
  masterVersion: string;
  masterState: string;
  triggerOn: string[] | null;
  params: Record<string, ValueSource>;
  disabled: boolean;
  disabledAt: Date | null;
  newerVersionAvailable: boolean;
  children: RuntimeItemView[];
};

export type RuntimeScheduleDetail = RuntimeScheduleView & {
  workCenterId: string | null;
  workCenterName: string;
  recurrence: Recurrence;
  recurrenceText: string;
  masterRevision: number;
  missedFrom: Date | null;
  missedTo: Date | null;
  catchupMode: string | null;
  enabledAt: Date;
  pausedAt: Date | null;
  endedAt: Date | null;
  items: RuntimeItemView[];
};

export type OccurrenceRunView = {
  id: string;
  itemId: string;
  /** The item's frozen workflow name, so a run is named even when the tree no longer shows it. */
  itemName: string | null;
  parentRunId: string | null;
  runtimeLabel: string | null;
  status: ScheduleItemRunStatus;
  finalState: string | null;
  detail: string | null;
  acknowledgedAt: Date | null;
  /** The run's own record to open: the live Runtime Workflow while it exists, else its history row. */
  open: { kind: 'live' | 'history'; id: string } | null;
};
export type OccurrenceView = {
  id: string;
  number: number;
  scheduledAt: Date;
  firedAt: Date | null;
  origin: string;
  runs: OccurrenceRunView[];
};
export type OccurrencePage = { rows: OccurrenceView[]; total: number };

const LIVE = ['active', 'paused'];

/** The live (active or paused) Runtime Schedule whose items use this workflow row, if any. */
export async function liveRuntimeScheduleForWorkflow(
  tx: Db, workflowId: string,
): Promise<{ id: string; label: string } | undefined> {
  const [row] = await tx.select({ id: runtimeSchedule.id, label: runtimeSchedule.label })
    .from(runtimeScheduleItem)
    .innerJoin(runtimeSchedule, eq(runtimeSchedule.id, runtimeScheduleItem.runtimeScheduleId))
    .where(and(eq(runtimeScheduleItem.workflowId, workflowId), inArray(runtimeSchedule.status, LIVE)))
    .orderBy(asc(runtimeSchedule.runtimeNumber)).limit(1);
  return row;
}

/** The work center's zone, else the deployment's runtime_id_timezone, else the server's. */
export async function effectiveTimeZone(db: Db, workCenterId: string): Promise<string> {
  const [row] = await db.select({ tz: workCenter.timeZone }).from(workCenter).where(eq(workCenter.id, workCenterId));
  return row?.tz ?? getRuntimeIdTimezone(db);
}

/** The zone schedule times are read in, and whether the work center chose it or fell back to the deployment's. */
export async function scheduleClock(db: Db, workCenterId: string): Promise<{ timeZone: string; workCenterZoneSet: boolean }> {
  const [row] = await db.select({ tz: workCenter.timeZone }).from(workCenter).where(eq(workCenter.id, workCenterId));
  return row?.tz ? { timeZone: row.tz, workCenterZoneSet: true } : { timeZone: await getRuntimeIdTimezone(db), workCenterZoneSet: false };
}

async function attentionFor(db: Db, rows: RuntimeSchedule[]): Promise<Map<string, NeedsAttention>> {
  const out = new Map<string, NeedsAttention>();
  for (const r of rows) out.set(r.id, { failed: 0, lost: 0, missedWindow: r.missedFrom !== null });
  if (rows.length === 0) return out;
  const counts = await db.select({
    runtimeId: scheduleOccurrence.runtimeScheduleId, status: scheduleItemRun.status, n: sql<number>`count(*)::int`,
  }).from(scheduleItemRun)
    .innerJoin(scheduleOccurrence, eq(scheduleOccurrence.id, scheduleItemRun.occurrenceId))
    .where(and(
      inArray(scheduleOccurrence.runtimeScheduleId, rows.map((r) => r.id)),
      inArray(scheduleItemRun.status, ['failed_to_start', 'lost']),
      isNull(scheduleItemRun.acknowledgedAt),
    ))
    .groupBy(scheduleOccurrence.runtimeScheduleId, scheduleItemRun.status);
  for (const c of counts) {
    const a = out.get(c.runtimeId)!;
    if (c.status === 'failed_to_start') a.failed = c.n; else a.lost = c.n;
  }
  return out;
}

async function toViews(db: Db, rows: RuntimeSchedule[]): Promise<RuntimeScheduleView[]> {
  const masterIds = [...new Set(rows.map((r) => r.masterScheduleId).filter((x): x is string => x !== null))];
  const [attention, hashes] = await Promise.all([attentionFor(db, rows), masterDefinitionHashes(db, masterIds)]);
  return rows.map((r) => ({
    id: r.id, label: r.label, name: r.name, status: r.status as RuntimeScheduleStatus,
    nextFireAt: r.nextFireAt, timeZone: r.timeZone, masterScheduleId: r.masterScheduleId,
    masterChanged: r.masterScheduleId !== null && hashes.has(r.masterScheduleId)
      && hashes.get(r.masterScheduleId) !== r.definitionHash,
    runOnce: r.runOnce,
    needsAttention: attention.get(r.id)!,
  }));
}

/** The view of one Runtime Schedule, as Enable returns it. */
export async function loadRuntimeScheduleView(db: Db, id: string): Promise<RuntimeScheduleView | undefined> {
  const [row] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, id));
  return row ? (await toViews(db, [row]))[0] : undefined;
}

export async function listRuntimeSchedules(
  db: Db, workCenterId: string, status?: RuntimeScheduleStatus,
): Promise<RuntimeScheduleView[]> {
  const rows = await db.select().from(runtimeSchedule)
    .where(and(eq(runtimeSchedule.workCenterId, workCenterId), isNull(runtimeSchedule.removedAt), status ? eq(runtimeSchedule.status, status) : undefined))
    .orderBy(desc(runtimeSchedule.runtimeNumber));
  return toViews(db, rows);
}

export async function getRuntimeSchedule(db: Db, id: string): Promise<RuntimeScheduleDetail | undefined> {
  const [row] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, id));
  if (!row) return undefined;
  const [view] = await toViews(db, [row]);
  // Explicit column list: spec_jsonb never leaves the database here.
  const items = await db.select({
    id: runtimeScheduleItem.id, parentItemId: runtimeScheduleItem.parentItemId, position: runtimeScheduleItem.position,
    triggerOn: runtimeScheduleItem.triggerOn, params: runtimeScheduleItem.params,
    workflowId: runtimeScheduleItem.workflowId, masterName: runtimeScheduleItem.masterName,
    masterOid: runtimeScheduleItem.masterOid, masterVersion: runtimeScheduleItem.masterVersion,
    masterState: runtimeScheduleItem.masterState, disabled: runtimeScheduleItem.disabled,
    disabledAt: runtimeScheduleItem.disabledAt,
  }).from(runtimeScheduleItem).where(eq(runtimeScheduleItem.runtimeScheduleId, id));
  type ItemRow = (typeof items)[number];

  const now = new Date();
  const newer = new Map<string, boolean>();
  if (row.workCenterId !== null) {
    for (const name of new Set(items.map((i) => i.masterName))) {
      let pick: { version: string } | undefined;
      try {
        pick = await resolveMasterWorkflow(db, row.workCenterId, name, now);
      } catch (e) {
        if (!(e instanceof RemoteError)) throw e;
      }
      for (const i of items.filter((x) => x.masterName === name)) {
        newer.set(i.id, pick !== undefined && compareVersions(pick.version, i.masterVersion) > 0);
      }
    }
  }
  const byParent = new Map<string | null, ItemRow[]>();
  for (const i of items) {
    const list = byParent.get(i.parentItemId) ?? [];
    list.push(i);
    byParent.set(i.parentItemId, list);
  }
  const build = (parent: string | null): RuntimeItemView[] =>
    (byParent.get(parent) ?? []).sort((a, b) => a.position - b.position).map((i) => ({
      id: i.id, workflowId: i.workflowId, masterName: i.masterName, masterOid: i.masterOid,
      masterVersion: i.masterVersion, masterState: i.masterState, triggerOn: i.triggerOn,
      params: (i.params ?? {}) as Record<string, ValueSource>, disabled: i.disabled, disabledAt: i.disabledAt,
      newerVersionAvailable: newer.get(i.id) ?? false, children: build(i.id),
    }));
  const recurrence = row.recurrence as Recurrence;
  return {
    ...view!, workCenterId: row.workCenterId, workCenterName: row.workCenterName,
    recurrence, recurrenceText: describeRecurrence(recurrence), masterRevision: row.masterRevision,
    missedFrom: row.missedFrom, missedTo: row.missedTo, catchupMode: row.catchupMode,
    enabledAt: row.enabledAt, pausedAt: row.pausedAt, endedAt: row.endedAt, items: build(null),
  };
}

/** Occurrences newest first, each with its item runs. */
export async function listOccurrences(
  db: Db, runtimeId: string, page: { limit: number; offset: number },
): Promise<OccurrencePage> {
  const where = eq(scheduleOccurrence.runtimeScheduleId, runtimeId);
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(scheduleOccurrence).where(where);
  const occ = await db.select().from(scheduleOccurrence).where(where)
    .orderBy(desc(scheduleOccurrence.number)).limit(page.limit).offset(page.offset);
  const runs = occ.length === 0 ? [] : await db.select({
    id: scheduleItemRun.id, occurrenceId: scheduleItemRun.occurrenceId, itemId: scheduleItemRun.itemId,
    itemName: runtimeScheduleItem.masterName,
    parentRunId: scheduleItemRun.parentRunId, runtimeLabel: scheduleItemRun.runtimeLabel,
    status: scheduleItemRun.status, finalState: scheduleItemRun.finalState, detail: scheduleItemRun.detail,
    acknowledgedAt: scheduleItemRun.acknowledgedAt, workflowInstanceId: scheduleItemRun.workflowInstanceId,
  }).from(scheduleItemRun)
    .leftJoin(runtimeScheduleItem, eq(runtimeScheduleItem.id, scheduleItemRun.itemId))
    .where(inArray(scheduleItemRun.occurrenceId, occ.map((o) => o.id)))
    .orderBy(asc(scheduleItemRun.createdAt));
  const instanceIds = [...new Set(runs.map((r) => r.workflowInstanceId).filter((x): x is string => x !== null))];
  const live = new Set(instanceIds.length === 0 ? [] : (await db.select({ id: workflowInstance.id }).from(workflowInstance)
    .where(inArray(workflowInstance.id, instanceIds))).map((r) => r.id));
  const history = new Map(instanceIds.length === 0 ? [] : (await db.select({ id: runtimeHistory.id, instanceId: runtimeHistory.workflowInstanceId })
    .from(runtimeHistory).where(inArray(runtimeHistory.workflowInstanceId, instanceIds))).map((r) => [r.instanceId!, r.id]));
  const openOf = (instanceId: string | null): OccurrenceRunView['open'] =>
    instanceId === null ? null
      : live.has(instanceId) ? { kind: 'live', id: instanceId }
        : history.has(instanceId) ? { kind: 'history', id: history.get(instanceId)! } : null;
  return {
    total: counted?.n ?? 0,
    rows: occ.map((o) => ({
      id: o.id, number: o.number, scheduledAt: o.scheduledAt, firedAt: o.firedAt, origin: o.origin,
      runs: runs.filter((r) => r.occurrenceId === o.id).map(({ occurrenceId: _o, workflowInstanceId, ...r }) => ({
        ...r, status: r.status as ScheduleItemRunStatus, open: openOf(workflowInstanceId),
      })),
    })),
  };
}

export type RuntimeScheduleEventView = {
  id: string;
  action: string;
  actorKind: 'user' | 'api_client' | 'system';
  actorName: string | null;
  detail: unknown;
  at: Date;
};
export type RuntimeScheduleEventPage = { rows: RuntimeScheduleEventView[]; total: number };

/** A Runtime Schedule's audit log, newest first (spec §5.5, §10). */
export async function listRuntimeScheduleEvents(
  db: Db, runtimeId: string, page: { limit: number; offset: number },
): Promise<RuntimeScheduleEventPage> {
  const where = eq(runtimeScheduleEvent.runtimeScheduleId, runtimeId);
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(runtimeScheduleEvent).where(where);
  const rows = await db.select().from(runtimeScheduleEvent).where(where)
    .orderBy(desc(runtimeScheduleEvent.at), desc(runtimeScheduleEvent.id)).limit(page.limit).offset(page.offset);
  return {
    total: counted?.n ?? 0,
    rows: rows.map((r) => ({
      id: r.id, action: r.action, actorKind: r.actorKind as RuntimeScheduleEventView['actorKind'],
      actorName: r.actorName, detail: r.detail, at: r.at,
    })),
  };
}
