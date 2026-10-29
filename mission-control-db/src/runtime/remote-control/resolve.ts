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

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { workCenter, workflow, workflowInstance, runtimeHistory } from '../../db/schema/index.js';
import type { Schema } from '../../db/client.js';
import { compareVersions } from '../../dao/environment-precedence.js';
import { REMOTE_CODES, RemoteError } from './codes.js';

export type Db = PgDatabase<any, Schema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function pathOf(db: Db, id: string): Promise<string> {
  const names: string[] = [];
  let cur: string | null = id;
  for (let i = 0; cur && i < 64; i++) {
    const rows: Array<{ name: string; parent: string | null }> = await db
      .select({ name: workCenter.name, parent: workCenter.parentWorkCenterId }).from(workCenter).where(eq(workCenter.id, cur));
    if (!rows[0]) break;
    names.unshift(rows[0].name);
    cur = rows[0].parent;
  }
  return names.join('/');
}

/** Ruling R3: blank = the caller's work center; a "/" path walks from a root; a bare name must be
 *  unique across the whole tree. A name may itself contain "/" ("A/B"): the whole text is tried
 *  as a name first, and read as a path only when no single work center carries that name. */
export async function resolveWorkCenter(db: Db, ref: string, callerWorkCenterId: string): Promise<{ id: string; name: string }> {
  const text = ref.trim();
  if (text === '') {
    const [row] = await db.select({ id: workCenter.id, name: workCenter.name }).from(workCenter).where(eq(workCenter.id, callerWorkCenterId));
    if (!row) throw new RemoteError(REMOTE_CODES.NOT_FOUND, 'The calling work center no longer exists');
    return row;
  }
  const rows = await db.select({ id: workCenter.id, name: workCenter.name }).from(workCenter).where(eq(workCenter.name, text));
  if (rows.length === 1 && rows[0]) return rows[0];
  if (text.includes('/')) {
    let parent: string | null = null;
    let found: { id: string; name: string } | undefined;
    for (const segment of text.split('/').map((s) => s.trim())) {
      const hits: Array<{ id: string; name: string }> = await db.select({ id: workCenter.id, name: workCenter.name }).from(workCenter)
        .where(and(eq(workCenter.name, segment), parent === null ? isNull(workCenter.parentWorkCenterId) : eq(workCenter.parentWorkCenterId, parent)));
      found = hits[0];
      if (!found) break;
      parent = found.id;
    }
    if (found) return found;
    if (rows.length === 0) throw new RemoteError(REMOTE_CODES.NOT_FOUND, `Work center "${text}" not found`);
    // Several work centers are named exactly "text" and it is no path: ambiguous, below.
  }
  if (rows.length === 0) throw new RemoteError(REMOTE_CODES.NOT_FOUND, `Work center "${text}" not found`);
  if (rows.length > 1) {
    // Alphabetically first path, so the example does not depend on row order.
    const example = (await Promise.all(rows.map((r) => pathOf(db, r.id)))).sort()[0];
    throw new RemoteError(REMOTE_CODES.INVALID_INPUT, `Work center "${text}" is ambiguous; use its path, e.g. "${example}"`);
  }
  return rows[0]!;
}

const FALLBACK_TIERS = ['Approved', 'InReview', 'InTest', 'Draft'] as const;

type MasterRow = { id: string; version: string; state: string; effectiveFrom: Date | null; updatedAt: Date };

const newestFirst = (a: MasterRow, b: MasterRow) =>
  compareVersions(b.version, a.version) || b.updatedAt.getTime() - a.updatedAt.getTime();

/** Ruling R4: the in-force Effective version, else Approved, InReview, InTest, Draft. */
export async function resolveMasterWorkflow(db: Db, workCenterId: string, name: string, now: Date): Promise<{ id: string; version: string; state: string }> {
  const text = name.trim();
  const rows: MasterRow[] = await db.select({
    id: workflow.id, version: workflow.version, state: workflow.state, effectiveFrom: workflow.effectiveFrom, updatedAt: workflow.updatedAt,
  }).from(workflow).where(and(eq(workflow.workCenterId, workCenterId), eq(workflow.name, text)));
  if (rows.length === 0) throw new RemoteError(REMOTE_CODES.NOT_FOUND, `Master Workflow "${text}" not found in that work center`);
  const inForce = rows.filter((r) => r.state === 'Effective' && (r.effectiveFrom === null || r.effectiveFrom.getTime() <= now.getTime()));
  if (inForce.length) {
    // Spec §2: the in-force version is the one with the greatest effective_from ≤ now (NULL = oldest).
    const pick = inForce.sort((a, b) =>
      (b.effectiveFrom?.getTime() ?? 0) - (a.effectiveFrom?.getTime() ?? 0)
      || compareVersions(b.version, a.version)
      || b.updatedAt.getTime() - a.updatedAt.getTime())[0]!;
    return { id: pick.id, version: pick.version, state: pick.state };
  }
  for (const tier of FALLBACK_TIERS) {
    const [top] = rows.filter((r) => r.state === tier).sort(newestFirst);
    if (top) return { id: top.id, version: top.version, state: top.state };
  }
  throw new RemoteError(REMOTE_CODES.NOT_FOUND,
    `Master Workflow "${text}" has no usable version (only Superseded, Obsolete or future-dated Effective versions)`);
}

export type RuntimeTarget = {
  id: string; workCenterId: string | null; label: string;
  live: { status: string } | null;
  finalState: string | null;
};

async function byId(db: Db, id: string): Promise<RuntimeTarget | null> {
  const [live] = await db.select({ id: workflowInstance.id, wc: workflowInstance.workCenterId, label: workflowInstance.runtimeLabel, status: workflowInstance.status })
    .from(workflowInstance).where(eq(workflowInstance.id, id));
  if (live) return { id: live.id, workCenterId: live.wc, label: live.label, live: { status: live.status }, finalState: null };
  const [h] = await db.select({ wc: runtimeHistory.workCenterId, label: runtimeHistory.runtimeLabel, finalState: runtimeHistory.finalState })
    .from(runtimeHistory).where(eq(runtimeHistory.workflowInstanceId, id));
  if (h) return { id, workCenterId: h.wc, label: h.label, live: null, finalState: h.finalState };
  return null;
}

async function byLabel(db: Db, workCenterId: string, label: string): Promise<RuntimeTarget | null> {
  const [live] = await db.select({ id: workflowInstance.id }).from(workflowInstance)
    .where(and(eq(workflowInstance.workCenterId, workCenterId), eq(workflowInstance.runtimeLabel, label)));
  if (live) return byId(db, live.id);
  const [h] = await db.select({ id: runtimeHistory.workflowInstanceId }).from(runtimeHistory)
    .where(and(eq(runtimeHistory.workCenterId, workCenterId), eq(runtimeHistory.runtimeLabel, label)))
    .orderBy(desc(runtimeHistory.finishedAt)).limit(1);
  if (h?.id) return byId(db, h.id);
  return null;
}

/** Ruling R5: the UUID, or a runtime label — bare (caller's work center) or qualified by the
 *  work center's name or path ("Mixing/RW-5"). A swept runtime resolves through its history row.
 *  A label may itself contain "/" (a work center's ID template can render one, "Batch/5"): the
 *  whole text is tried as a label in the caller's work center first, and only then split on the
 *  LAST "/" into work center + label. */
export async function resolveRuntime(db: Db, ref: string, callerWorkCenterId: string): Promise<RuntimeTarget> {
  const text = ref.trim();
  if (text === '') throw new RemoteError(REMOTE_CODES.INVALID_INPUT, 'Runtime workflow ID is blank');
  if (UUID_RE.test(text)) {
    const hit = await byId(db, text.toLowerCase());
    if (!hit) throw new RemoteError(REMOTE_CODES.NOT_FOUND, `Runtime workflow ${text} not found`);
    return hit;
  }
  const cut = text.lastIndexOf('/');
  if (cut >= 0) {
    const whole = await byLabel(db, callerWorkCenterId, text);
    if (whole) return whole;
  }
  const label = (cut < 0 ? text : text.slice(cut + 1)).trim();
  const wc = await resolveWorkCenter(db, cut < 0 ? '' : text.slice(0, cut), callerWorkCenterId);
  const hit = await byLabel(db, wc.id, label);
  if (hit) return hit;
  throw new RemoteError(REMOTE_CODES.NOT_FOUND, `Runtime workflow "${text}" not found`);
}
