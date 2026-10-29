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

import { and, eq, isNull, ne, sql, inArray } from 'drizzle-orm';
import {
  workCenter, workCenterUser, workflowInstance, environmentSpec, schedule, stepInstance, workflow,
  type WorkCenter, RUNTIME_ACTIVE_STATUSES,
} from '../db/schema/index.js';
import { DaoError, assertDispatchPolicy, pgErrorCode } from './errors.js';
import { assertNameLength } from './names.js';
import { normalizeTypeName } from './type-name.js';
import { renderRuntimeId, runtimeIdBucket, validateRuntimeIdTemplate } from '../lib/runtime-id.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

// db.execute()'s return type collapses to `any` when Db uses `PgDatabase<any, Schema>`
// (the query-result HKT generic is erased), so the row shape is asserted explicitly here
// to keep the mapped result — and its downstream consumers — free of implicit `any`.
type SubtreeRow = { id: string; name: string; parent_work_center_id: string | null; type_name: string | null; depth: number };

export async function subtree(db: Db, rootId: string) {
  const res = await db.execute<SubtreeRow>(sql`
    with recursive wc as (
      select id, name, parent_work_center_id, type_name, 0 as depth from work_center where id = ${rootId}
      union all
      select c.id, c.name, c.parent_work_center_id, c.type_name, wc.depth + 1
      from work_center c join wc on c.parent_work_center_id = wc.id
    )
    select id, name, parent_work_center_id, type_name, depth from wc order by depth, name
  `);
  const rows = res.rows as SubtreeRow[];
  return rows.map((r) => ({ id: r.id, name: r.name, parentWorkCenterId: r.parent_work_center_id, typeName: r.type_name, depth: Number(r.depth) }));
}
export async function assignUserToWorkCenter(
  db: Db, workCenterId: string, userId: string,
  opts: { priority?: number; missionSystemCommander?: boolean } = {},
) {
  const set: Record<string, unknown> = {};
  if (opts.priority !== undefined) set.priority = opts.priority;
  if (opts.missionSystemCommander !== undefined) set.missionSystemCommander = opts.missionSystemCommander;
  try {
    const insert = db.insert(workCenterUser).values({
      workCenterId, userId,
      priority: opts.priority ?? 0,
      missionSystemCommander: opts.missionSystemCommander ?? false,
    });
    if (Object.keys(set).length) {
      await insert.onConflictDoUpdate({ target: [workCenterUser.workCenterId, workCenterUser.userId], set });
    } else {
      await insert.onConflictDoNothing();   // bare re-assign: change nothing
    }
  } catch (err) {
    // Same 23503 backstop as deleteWorkCenter below and deleteWorkflow in dao/workflows.ts:
    // a valid-but-nonexistent workCenterId/userId hits the NOT NULL FK on insert and would
    // otherwise propagate as a raw PG error, 500ing the route instead of 404ing it.
    const pgCode = pgErrorCode(err);
    if (pgCode === '23503') throw new DaoError('LINK_TARGET_NOT_FOUND');
    throw err;
  }
}

export async function isMissionSystemCommander(db: Db, workCenterId: string, userId: string): Promise<boolean> {
  const rows = await db.select({ userId: workCenterUser.userId }).from(workCenterUser)
    .where(and(
      eq(workCenterUser.workCenterId, workCenterId),
      eq(workCenterUser.userId, userId),
      eq(workCenterUser.missionSystemCommander, true),
    ));
  return rows.length > 0;
}

export async function missionSystemCommanderWorkCenters(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select({ wc: workCenterUser.workCenterId }).from(workCenterUser)
    .where(and(eq(workCenterUser.userId, userId), eq(workCenterUser.missionSystemCommander, true)));
  return rows.map((r) => r.wc);
}
/** Per-WC identity allocation (spec 2026-10-07 §6). TWO statements, deliberately: PostgreSQL's
 *  RETURNING evaluates against the NEW row — which is why the UPDATE below still writes
 *  `next_runtime_number - 1`. A single UPDATE that both SET runtime_seq_bucket and tested it in
 *  RETURNING would always see the value it had just written, take the "same bucket" branch every
 *  time, and never restart the sequence. The old bucket must be read before it is overwritten.
 *
 *  The SELECT … FOR UPDATE holds the row lock to the end of the transaction, so concurrent
 *  creators in the same work center still queue behind one another — the same guarantee the
 *  bare UPDATE gave before. Call inside the same transaction as the instance insert. */
// §6.2 (corrected 2026-10-08 after the whole-branch review): the probe runs on EVERY
// allocation, not only on a bucket change, and it checks runtime_history as well as
// workflow_instance. §6.1's original reasoning — "a continuation's stored sequence has never
// been used in this bucket, so it's free by induction" — assumed a bucket's used labels form a
// contiguous prefix. They do not: MissionEngine/src/core/sweep.ts deletes terminal
// workflow_instance rows after work_center.finished_retention_secs (1h default), leaving a
// sparse TAIL. Trusting the stored sequence unprobed is exactly what let a restart-then-
// continuation pair re-issue an already-used label and jam runtime_seq_next behind a permanent
// collision. The permanent record (runtime_history) must be checked too, or the probe could
// re-issue a label History still holds, aliasing two different runs under one identifier
// (spec §2 ruling 1). Bounded: after this many attempts (counted from baseSeq, not from 1 — a
// continuation can start anywhere), the allocator gives up probing and suffixes the candidate
// with the row's own (always-unique) runtime_number instead.
const MAX_LABEL_PROBE_ATTEMPTS = 1000;

export async function allocateRuntimeIdentity(
  db: Db,
  workCenterId: string,
  now: Date,
  timeZone: string,
): Promise<{ runtimeNumber: number; runtimeLabel: string }> {
  const prev = await db.execute<{
    runtime_seq_bucket: string | null; runtime_seq_next: number;
    name: string; runtime_id_template: string | null; next_runtime_number: number;
  }>(sql`
    select runtime_seq_bucket, runtime_seq_next, name, runtime_id_template, next_runtime_number
    from work_center where id = ${workCenterId} for update
  `);
  const row = (prev.rows as {
    runtime_seq_bucket: string | null; runtime_seq_next: number;
    name: string; runtime_id_template: string | null; next_runtime_number: number;
  }[])[0];
  if (!row) throw new DaoError('WORK_CENTER_NOT_FOUND');

  // Stable for the rest of this call: the FOR UPDATE lock above holds the row to the end of
  // the transaction, so next_runtime_number cannot change before the UPDATE below writes it.
  const runtimeNumber = Number(row.next_runtime_number);
  const template = row.runtime_id_template;
  const bucket = runtimeIdBucket(template, { now, timeZone });
  const sameBucket = (row.runtime_seq_bucket ?? '') === bucket;
  const baseSeq = sameBucket ? Number(row.runtime_seq_next) : 1;

  // §7: strict on the way in, forgiving on the way out — a formatting problem must never stop
  // a run from starting. Narrowed (whole-branch review) to wrap ONLY validation: a DB fault in
  // the probe below must propagate as itself, not get reported as "has an unusable runtime ID
  // format" and then die on the next statement with "current transaction is aborted".
  let formatOk = true;
  let formatError: unknown = null;
  try {
    const check = validateRuntimeIdTemplate(template ?? '', { workCenterName: row.name });
    if (!check.ok) throw new Error(check.reason);
  } catch (err) {
    formatOk = false;
    formatError = err;
  }

  let runtimeLabel: string;
  let nextSeq: number;
  if (!formatOk) {
    console.warn(
      `[mission-control-db] work center ${workCenterId} has an unusable runtime ID format ` +
      `(${String(formatError)}); falling back to RW-${runtimeNumber}`,
    );
    // Invariant that keeps this fallback from ever colliding with a label the DEFAULT
    // template would render: the default template renders RW-<seq>, this fallback renders
    // RW-<runtime_number>, and seq ≤ runtime_number always holds — seq only advances when a
    // label is actually issued in a per-template bucket, while runtime_number advances on
    // EVERY allocation, including every fallback. A future change to sequence handling that
    // let seq outrun runtime_number would silently break this.
    runtimeLabel = `RW-${runtimeNumber}`;
    // Fixed counter bug: nothing was consumed from the per-template sequence on this call (it
    // rendered RW-<runtime_number> instead), so runtime_seq_next must be left exactly as
    // found. The old code advanced it to baseSeq + 1 unconditionally, manufacturing a gap in
    // the bucket that a later, successful allocation would then have to probe past.
    nextSeq = baseSeq;
  } else {
    // §6.1/§6.2: probe for a free label on EVERY allocation, starting from baseSeq — 1 on a
    // bucket change (restart), the stored sequence on a continuation. One shared loop: a
    // continuation differs from a restart only in where the probe starts, never in whether it
    // runs. The probe stays inside the FOR UPDATE lock, so no concurrent creator can take the
    // sequence between a probe and the eventual insert.
    let seq = baseSeq;
    let candidate = '';
    let free = false;
    for (let attempt = 0; attempt < MAX_LABEL_PROBE_ATTEMPTS; attempt++, seq++) {
      // §7's "a formatting problem must never stop a run" now rests on renderRuntimeId being
      // TOTAL — this call sits outside the narrowed try/catch above on purpose, so it must
      // never throw. It currently holds: a bad/unknown timeZone is caught internally and falls
      // back to UTC, and its String.replace callback always returns a string for every token
      // branch. A future edit to that function that removes either property would silently
      // reopen the hole this narrowing just closed.
      candidate = renderRuntimeId(template, { now, timeZone, workCenterName: row.name, seq });
      // One round trip per candidate: checks the live table AND the permanent audit record,
      // so a label runtime_history still holds (its workflow_instance row already swept) is
      // never re-issued (spec §6.2) — indexed by workflow_instance_wc_label_uq and, since
      // migration 0036, by runtime_history_wc_label_idx.
      const hit = await db.execute<{ one: number }>(sql`
        select 1 as one where exists (
          select 1 from workflow_instance
          where work_center_id = ${workCenterId} and runtime_label = ${candidate}
        ) or exists (
          select 1 from runtime_history
          where work_center_id = ${workCenterId} and runtime_label = ${candidate}
        )
      `);
      if ((hit.rows as { one: number }[]).length === 0) { free = true; break; }
    }
    if (free) {
      runtimeLabel = candidate;
      nextSeq = seq + 1;   // seq is the value that was just used — resume just past it.
    } else {
      // Bounded give-up: suffix with runtime_number, unique per work center by
      // workflow_instance_wc_number_uq — guaranteed free. Prettiness degrades, not the run.
      runtimeLabel = `${candidate}-${runtimeNumber}`;
      // Off-by-one fix: the loop's own increment runs once more after its final (failed)
      // iteration, so seq is already baseSeq + MAX_LABEL_PROBE_ATTEMPTS here — exactly the
      // next value nobody has probed yet. `seq + 1` would skip that value without ever trying
      // it; every value in [baseSeq, seq) was probed and found taken, and none of them was
      // actually used (the label that WAS used is the suffixed one above), so the next real
      // allocation should resume probing at seq, not past it.
      nextSeq = seq;
    }
  }

  const res = await db.execute<{ n: number }>(sql`
    update work_center set
      next_runtime_number = next_runtime_number + 1,
      runtime_seq_next    = ${nextSeq},
      runtime_seq_bucket  = ${bucket},
      updated_at          = now()
    where id = ${workCenterId}
    returning next_runtime_number - 1 as n
  `);
  const updated = (res.rows as { n: number }[])[0];
  if (!updated) throw new DaoError('WORK_CENTER_NOT_FOUND');
  return { runtimeNumber: Number(updated.n), runtimeLabel };
}

export async function usersInWorkCenter(db: Db, workCenterId: string) {
  const rows = await db.select({ userId: workCenterUser.userId, priority: workCenterUser.priority })
    .from(workCenterUser).where(eq(workCenterUser.workCenterId, workCenterId));
  return rows;
}

export type CreateWorkCenterInput = {
  name: string;
  parentWorkCenterId?: string | null;
  description?: string | null;
  typeName?: string | null;
  sortOrder?: number;
  dispatchPolicy?: string;
  autoClaim?: boolean;
  runtimeIdTemplate?: string | null;
};
// Note for anyone adding a field here: `PATCH /api/work-centers/:id`
// (MissionCommander/src/server/routes/work-centers.ts) passes its parsed request body
// into `updateWorkCenter` through a type CAST rather than a field whitelist, so the runtime
// object is whatever JSON the caller sent. Widening this type therefore widens what any
// `work_center:edit` caller can write, in a file this type does not mention. That seam is what
// turned the former `dispatchParams` field into a live D1 leak (raw jsonb, embedded verbatim
// into `.WFcenterX` packages by `buildWfcenterx`); the column has since been removed outright.
// `runtimeIdTemplate` rides that same cast, so the route MUST whitelist and type-check it
// explicitly (it does — routes/work-centers.ts), and the DAO validates it again below.
export type UpdateWorkCenterPatch = Partial<CreateWorkCenterInput>;

// True when another work center already uses `name` among the given parent's children
// (or among roots when parentId is null). `excludeId` skips the row being updated.
async function siblingNameConflict(
  db: Db, name: string, parentId: string | null, excludeId?: string,
): Promise<boolean> {
  const conds = [
    eq(workCenter.name, name),
    parentId === null ? isNull(workCenter.parentWorkCenterId) : eq(workCenter.parentWorkCenterId, parentId),
  ];
  if (excludeId) conds.push(ne(workCenter.id, excludeId));
  const rows = await db.select({ id: workCenter.id }).from(workCenter).where(and(...conds));
  return rows.length > 0;
}

/** Normalises blank → null and validates against the name the row will have (§5.3 rule 5). */
function normaliseTemplate(raw: string | null | undefined, workCenterName: string): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw.trim() === '') return null;
  const check = validateRuntimeIdTemplate(raw, { workCenterName });
  if (!check.ok) throw new DaoError('INVALID_RUNTIME_ID_TEMPLATE', check.reason);
  return raw.trim();
}

export async function createWorkCenter(db: Db, input: CreateWorkCenterInput): Promise<WorkCenter> {
  assertNameLength(input.name);
  assertDispatchPolicy(input.dispatchPolicy);
  const template = normaliseTemplate(input.runtimeIdTemplate, input.name);
  const typeName = input.typeName !== undefined ? normalizeTypeName(input.typeName) : undefined;
  const parentId = input.parentWorkCenterId ?? null;
  return db.transaction(async (tx) => {
    if (parentId !== null) {
      const [parent] = await tx.select({ id: workCenter.id }).from(workCenter).where(eq(workCenter.id, parentId));
      if (!parent) throw new DaoError('PARENT_NOT_FOUND');
    }
    if (await siblingNameConflict(tx, input.name, parentId)) throw new DaoError('WORK_CENTER_NAME_CONFLICT');
    const [wc] = await tx.insert(workCenter).values({
      name: input.name,
      parentWorkCenterId: parentId,
      description: input.description ?? null,
      ...(typeName !== undefined ? { typeName } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.dispatchPolicy !== undefined ? { dispatchPolicy: input.dispatchPolicy } : {}),
      ...(input.autoClaim !== undefined ? { autoClaim: input.autoClaim } : {}),
      ...(template !== undefined ? { runtimeIdTemplate: template } : {}),
    }).returning();
    return wc!;
  });
}

export async function updateWorkCenter(db: Db, id: string, patch: UpdateWorkCenterPatch): Promise<WorkCenter> {
  if (patch.dispatchPolicy !== undefined) assertDispatchPolicy(patch.dispatchPolicy);
  const typeName = patch.typeName !== undefined ? normalizeTypeName(patch.typeName) : undefined;
  return db.transaction(async (tx) => {
    // Serialize concurrent reparents so the cycle guard below can't be defeated by a TOCTOU
    // race (two admins cross-reparenting A under X and X under A at the same time). The
    // self-referential FK has no cycle backstop, so this advisory lock IS the guard's integrity.
    // Reparents are rare, so serializing them is negligible. (PGlite is single-connection.)
    await tx.execute(sql`select pg_advisory_xact_lock(91001)`);

    const [current] = await tx.select().from(workCenter).where(eq(workCenter.id, id));
    if (!current) throw new DaoError('WORK_CENTER_NOT_FOUND');

    const nextName = patch.name ?? current.name;
    const nextParent = patch.parentWorkCenterId !== undefined
      ? patch.parentWorkCenterId
      : current.parentWorkCenterId;

    if (patch.parentWorkCenterId !== undefined && patch.parentWorkCenterId !== null) {
      const [parent] = await tx.select({ id: workCenter.id }).from(workCenter)
        .where(eq(workCenter.id, patch.parentWorkCenterId));
      if (!parent) throw new DaoError('PARENT_NOT_FOUND');
      // subtree(id) returns this node (depth 0) + all descendants; the new parent may be neither.
      const inSubtree = await subtree(tx, id);
      if (inSubtree.some((n) => n.id === patch.parentWorkCenterId)) throw new DaoError('WORK_CENTER_CYCLE');
    }

    if (patch.name !== undefined) assertNameLength(patch.name);
    if (nextName !== current.name || nextParent !== current.parentWorkCenterId) {
      if (await siblingNameConflict(tx, nextName, nextParent, id)) throw new DaoError('WORK_CENTER_NAME_CONFLICT');
    }

    // Validate only when THIS patch changes the template or the name (§7). Re-validating on
    // every update would brick the edit form for a work center whose stored template predates
    // a tightened rule — you could not fix its description without first fixing its template.
    // Validate against the name the row will HAVE, so renaming into a too-long {WC} is caught.
    const touchesTemplateOrName = patch.runtimeIdTemplate !== undefined || patch.name !== undefined;
    const template = touchesTemplateOrName
      ? normaliseTemplate(
          patch.runtimeIdTemplate !== undefined ? patch.runtimeIdTemplate : current.runtimeIdTemplate,
          nextName,
        )
      : undefined;

    const [updated] = await tx.update(workCenter).set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(typeName !== undefined ? { typeName } : {}),
      ...(patch.parentWorkCenterId !== undefined ? { parentWorkCenterId: patch.parentWorkCenterId } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
      ...(patch.dispatchPolicy !== undefined ? { dispatchPolicy: patch.dispatchPolicy } : {}),
      ...(patch.autoClaim !== undefined ? { autoClaim: patch.autoClaim } : {}),
      ...(template !== undefined ? { runtimeIdTemplate: template } : {}),
      updatedAt: new Date(),
    }).where(eq(workCenter.id, id)).returning();
    return updated!;
  });
}

export type DeleteImpact = {
  workflows: number; environments: number; instances: number;
  stepInstances: number; schedules: number; hasChildren: boolean;
};

const count = async (tx: Db, table: any, where: any): Promise<number> => {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(table).where(where);
  return row?.n ?? 0;
};

// The counts here must mirror exactly what deleteWorkCenter's ordered teardown touches, so the
// number shown to a steward in the confirmation dialog never drifts from what actually gets
// destroyed. stepInstances has no direct work_center_id column, so it's reached by joining
// through workflow_instance.
export async function workCenterDeleteImpact(db: Db, id: string): Promise<DeleteImpact> {
  const [workflows, environments, instances, schedules, kids] = await Promise.all([
    count(db, workflow, eq(workflow.workCenterId, id)),
    count(db, environmentSpec, eq(environmentSpec.workCenterId, id)),
    count(db, workflowInstance, eq(workflowInstance.workCenterId, id)),
    count(db, schedule, eq(schedule.workCenterId, id)),
    count(db, workCenter, eq(workCenter.parentWorkCenterId, id)),
  ]);
  const [steps] = await db.select({ n: sql<number>`count(*)::int` })
    .from(stepInstance)
    .innerJoin(workflowInstance, eq(workflowInstance.id, stepInstance.workflowInstanceId))
    .where(eq(workflowInstance.workCenterId, id));
  return {
    workflows, environments, instances, stepInstances: steps?.n ?? 0,
    schedules, hasChildren: kids > 0,
  };
}

/**
 * Children always block — the steward removes a subtree bottom-up (spec §8.3).
 * Everything else is destroyed only with `confirmed: true`, after the caller has shown the
 * user workCenterDeleteImpact().
 */
export async function deleteWorkCenter(
  db: Db, id: string, opts: { confirmed?: boolean } = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    // Lock order matches the run creators (createRuntimeWorkflow, the engine harness): they take
    // the workflow row (FOR SHARE) and THEN the work_center row (allocateRuntimeIdentity's
    // `for update`). So lock this work center's workflow rows first, in id order, then the
    // work_center row; the final cascading delete of workflow rows then never waits on a creator
    // that is itself waiting on us (no 40P01).
    await tx.select({ id: workflow.id }).from(workflow)
      .where(eq(workflow.workCenterId, id)).orderBy(workflow.id).for('update');
    // The work_center lock pairs with allocateRuntimeIdentity's `for update` on the same row: a
    // runtime being created is either committed before this point (the active check below sees
    // it) or runs after this delete commits and finds no work center. An empty result falls
    // through to the existing not-found handling.
    await tx.select({ id: workCenter.id }).from(workCenter).where(eq(workCenter.id, id)).for('update');

    const kids = await tx.select({ id: workCenter.id }).from(workCenter)
      .where(eq(workCenter.parentWorkCenterId, id)).limit(1);
    if (kids.length) throw new DaoError('WORK_CENTER_HAS_CHILDREN');

    // Lock EVERY instance row of the work center, with no status filter: a start request locks only
    // its own instance row, and Postgres re-checks only rows that matched the filter, so a
    // status-filtered lock would miss a pending row that is being queued. Engine claimers use
    // FOR UPDATE SKIP LOCKED, so they skip these rows rather than wait. The active check is
    // computed from the locked rows.
    const locked = await tx.select({ id: workflowInstance.id, status: workflowInstance.status })
      .from(workflowInstance).where(eq(workflowInstance.workCenterId, id)).for('update');
    const activeStatuses: readonly string[] = RUNTIME_ACTIVE_STATUSES;
    const active = locked.filter((r) => activeStatuses.includes(r.status));
    if (active.length > 0) throw new DaoError('WORK_CENTER_HAS_ACTIVE_RUNTIME', `${active.length} runtime workflows are active`);

    if (!opts.confirmed) {
      const inUse = locked[0];
      const [wf] = await tx.select({ id: workflow.id }).from(workflow)
        .where(eq(workflow.workCenterId, id)).limit(1);
      const [env] = await tx.select({ id: environmentSpec.id }).from(environmentSpec)
        .where(eq(environmentSpec.workCenterId, id)).limit(1);
      if (inUse || wf || env) {
        throw new DaoError('CONFIRMATION_REQUIRED', 'Work center has loaded artifacts or run history');
      }
    }

    // Ordered by hand rather than left to FK cascades. The deterministic blocker is
    // workflow_instance.work_center_id: a direct, first-degree RESTRICT on work_center itself
    // that is never cascade-scheduled, so it fires whenever any instance row exists, no matter
    // what order Postgres processes the rest of the cascade in — hence deleting
    // workflowInstance before workCenter below.
    // Deleting schedule first is defensive, not load-bearing on its own: schedule_wc_workflow_fk
    // is a RESTRICT on workflow, and RESTRICT is NOT NO ACTION — it fires immediately rather
    // than waiting for the statement's other cascade paths to finish, so whether it trips
    // depends on the relative firing order of two independent cascade paths off the same
    // work_center row (schedule's own cascade vs. workflow's), which Postgres does not
    // guarantee. Deleting schedule by hand means we never depend on that ordering.
    await tx.delete(schedule).where(eq(schedule.workCenterId, id));        // → trigger_condition, schedule_run
    await tx.delete(workflowInstance).where(eq(workflowInstance.workCenterId, id)); // → step_instance → instance_assignment, trace_entry
    try {
      await tx.delete(workCenter).where(eq(workCenter.id, id));            // → users, presence, workflow, environment_spec
    } catch (err) {
      // Defense-in-depth: the pre-checks/ordered deletes above catch the common cases, but a
      // concurrent insert in the gap — or a RESTRICT FK not pre-checked, e.g. instance_assignment
      // .work_center_id once cross-work-center dispatch exists — makes the DB reject the delete
      // with SQLSTATE 23503. Map it to a friendly code instead of leaking a raw Postgres error.
      if (pgErrorCode(err) === '23503') throw new DaoError('WORK_CENTER_IN_USE');
      throw err;
    }
  });
}

export function listRootWorkCenters(db: Db): Promise<WorkCenter[]> {
  return db.select().from(workCenter)
    .where(isNull(workCenter.parentWorkCenterId))
    .orderBy(workCenter.sortOrder, workCenter.name);
}

export async function removeUserFromWorkCenter(db: Db, workCenterId: string, userId: string): Promise<void> {
  await db.delete(workCenterUser)
    .where(and(eq(workCenterUser.workCenterId, workCenterId), eq(workCenterUser.userId, userId)));
}
