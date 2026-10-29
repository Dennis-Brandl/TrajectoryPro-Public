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

import { and, desc, eq, notExists, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { workflowInstance, runtimeHistory, type RuntimeWorkflowStatus } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';
import { pathOf } from '../runtime/remote-control/resolve.js';

type Db = PgDatabase<any, Schema>;

/** Spec 2026-10-19 §A: the runtimes one runtime created (live rows + finished history rows). */
export const CREATED_RUNTIMES_LIMIT = 200;

export type CreatedRuntimeTarget = { kind: 'live' | 'history'; id: string };
export type CreatedRuntimeRow = {
  runtimeLabel: string;
  workCenterPath: string | null; workflowName: string | null; workflowVersion: string | null; workflowState: string | null;
  createdAt: Date | null; state: RuntimeWorkflowStatus | null;
  open: CreatedRuntimeTarget | null;
};
export type CreatedRuntimesPage = { items: CreatedRuntimeRow[]; total: number };

export async function listCreatedRuntimes(
  db: Db, parentInstanceId: string,
  opts: { canSee?: (workCenterId: string | null) => boolean | Promise<boolean>; limit?: number } = {},
): Promise<CreatedRuntimesPage> {
  const limit = opts.limit ?? CREATED_RUNTIMES_LIMIT;
  const canSee = opts.canSee ?? (() => true);

  const liveWhere = eq(workflowInstance.createdByInstanceId, parentInstanceId);
  const histWhere = and(
    eq(runtimeHistory.createdByInstanceId, parentInstanceId),
    notExists(db.select({ x: sql`1` }).from(workflowInstance).where(eq(workflowInstance.id, runtimeHistory.workflowInstanceId))),
  );

  const [live, hist, [liveCount], [histCount]] = await Promise.all([
    db.select({
      id: workflowInstance.id, workCenterId: workflowInstance.workCenterId, runtimeLabel: workflowInstance.runtimeLabel,
      masterName: workflowInstance.masterName, masterVersion: workflowInstance.masterVersion, masterState: workflowInstance.masterState,
      status: workflowInstance.status, createdAt: workflowInstance.createdAt,
    }).from(workflowInstance).where(liveWhere).orderBy(desc(workflowInstance.createdAt)).limit(limit),
    db.select({
      id: runtimeHistory.id, workCenterId: runtimeHistory.workCenterId, workCenterName: runtimeHistory.workCenterName,
      runtimeLabel: runtimeHistory.runtimeLabel, masterName: runtimeHistory.masterName, masterVersion: runtimeHistory.masterVersion,
      masterState: runtimeHistory.masterState, finalState: runtimeHistory.finalState,
      startedAt: runtimeHistory.startedAt, createdAt: runtimeHistory.createdAt,
    }).from(runtimeHistory).where(histWhere)
      .orderBy(sql`coalesce(${runtimeHistory.startedAt}, ${runtimeHistory.createdAt}) desc`).limit(limit),
    db.select({ n: sql<number>`count(*)::int` }).from(workflowInstance).where(liveWhere),
    db.select({ n: sql<number>`count(*)::int` }).from(runtimeHistory).where(histWhere),
  ]);

  const paths = new Map<string, Promise<string>>();
  const pathFor = (id: string) => {
    let p = paths.get(id);
    if (!p) { p = pathOf(db, id); paths.set(id, p); }
    return p;
  };
  const hidden = (runtimeLabel: string): CreatedRuntimeRow => ({
    runtimeLabel, workCenterPath: null, workflowName: null, workflowVersion: null, workflowState: null,
    createdAt: null, state: null, open: null,
  });

  const rows: CreatedRuntimeRow[] = [];
  for (const r of live) {
    if (!(await canSee(r.workCenterId))) { rows.push(hidden(r.runtimeLabel)); continue; }
    rows.push({
      runtimeLabel: r.runtimeLabel,
      workCenterPath: (await pathFor(r.workCenterId)) || null,
      workflowName: r.masterName, workflowVersion: r.masterVersion, workflowState: r.masterState,
      createdAt: r.createdAt, state: r.status as RuntimeWorkflowStatus, open: { kind: 'live', id: r.id },
    });
  }
  for (const r of hist) {
    if (!(await canSee(r.workCenterId))) { rows.push(hidden(r.runtimeLabel)); continue; }
    const path = r.workCenterId ? await pathFor(r.workCenterId) : '';
    rows.push({
      runtimeLabel: r.runtimeLabel,
      workCenterPath: path || r.workCenterName,
      workflowName: r.masterName, workflowVersion: r.masterVersion, workflowState: r.masterState,
      createdAt: r.startedAt ?? r.createdAt, state: r.finalState as RuntimeWorkflowStatus, open: { kind: 'history', id: r.id },
    });
  }
  // A hidden row has no createdAt to sort by; keep a stable order via the source rows' time.
  const key = new Map<CreatedRuntimeRow, number>();
  live.forEach((r, i) => key.set(rows[i]!, r.createdAt.getTime()));
  hist.forEach((r, i) => key.set(rows[live.length + i]!, (r.startedAt ?? r.createdAt).getTime()));
  rows.sort((a, b) => key.get(b)! - key.get(a)!);

  return { items: rows.slice(0, limit), total: (liveCount?.n ?? 0) + (histCount?.n ?? 0) };
}
