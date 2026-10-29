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
// Task 17 (spec §9), reworked by data-safety Task 5: the retention sweeper. `runtime_history`
// (written by settleTerminal — core/context.ts) is the permanent record of a terminal instance;
// the `workflow_instance` row itself is disposable after its work center's own
// `finished_retention_secs` window has elapsed (default 3600s, migration 0018).
//
// Each work center is swept in set-based batches: one DELETE ... WHERE id IN (SELECT ... ORDER BY
// completed_at LIMIT n FOR UPDATE SKIP LOCKED) per batch, served by workflow_instance_finished_idx
// (migration 0042), so a backlog clears in a handful of statements instead of one row at a time
// and two engines sweeping at once never delete (or wait on) the same row. A run is bounded by
// `maxBatches` row-deleting batches so a huge backlog cannot monopolise a connection; the next timer tick continues.
// Child rows (step_instance, trace_entry, wc_resource_waiter) cascade; runtime_history survives.
//
// The cutoff binds `now()` from the caller, never SQL's own clock: config.ts's EngineDeps doc
// states the engine-wide invariant that every time read goes through `deps.now`, so tests can
// pump the clock deterministically (a literal SQL `now()` made other tests' historical fake-clock
// instances look permanently expired).
import { sql } from 'drizzle-orm';
import { RUNTIME_FINAL_STATES } from 'mission-control-db/src/db/schema/index';
import type { Db } from '../db.js';

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_BATCHES = 10;

export interface SweepOptions {
  batchSize?: number;
  maxBatches?: number;
  /** Test-only: sweep just these work centers, so a test against a shared database never
   *  deletes rows it didn't create. Production callers never pass it (every work center). */
  workCenterIds?: string[];
}

/**
 * Delete retention-expired terminal `workflow_instance` rows in batches of `batchSize`, taking
 * turns across work centers (ordered by id). A work center is re-queried while its last batch was
 * full and fewer than `maxBatches` batches have deleted rows (counted across all work centers). A probe that
 * finds nothing is free, so idle work centers cannot use up the budget. Returns rows deleted.
 */
export async function runSweep(db: Db, now: () => Date, opts: SweepOptions = {}): Promise<number> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = opts.maxBatches ?? DEFAULT_MAX_BATCHES;
  const asOf = now();
  const terminal = sql.join(RUNTIME_FINAL_STATES.map((s) => sql`${s}`), sql`, `);

  const only = opts.workCenterIds;
  if (only && only.length === 0) return 0;
  const centers = only
    ? await db.execute(sql`select id, finished_retention_secs from work_center
        where id in (${sql.join(only.map((id) => sql`${id}::uuid`), sql`, `)}) order by id`)
    : await db.execute(sql`select id, finished_retention_secs from work_center order by id`);
  let deleted = 0;
  let batches = 0;
  // Round-robin: one batch per work center per pass, so a work center with a huge backlog cannot
  // starve the ones after it. A short batch means "done for now"; a full one may have more.
  let active = centers.rows as { id: string; finished_retention_secs: number }[];
  while (active.length > 0 && batches < maxBatches) {
    const next: typeof active = [];
    for (const wc of active) {
      if (batches >= maxBatches) break;
      const cutoff = new Date(asOf.getTime() - wc.finished_retention_secs * 1000);
      const res = await db.execute(sql`
        delete from workflow_instance where id in (
          select id from workflow_instance
          where work_center_id = ${wc.id}
            and status in (${terminal})
            and completed_at < ${cutoff.toISOString()}
          order by completed_at
          limit ${batchSize}
          for update skip locked
        ) returning id
      `);
      deleted += res.rows.length;
      if (res.rows.length > 0) batches++;
      if (res.rows.length === batchSize) next.push(wc);
    }
    active = next;
  }
  return deleted;
}
