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

import { and, asc, eq } from 'drizzle-orm';
import { wcValueProperty } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

export type SharedValueRow = { propertyName: string; entryName: string; value: string };
export type SharedValueUpdate = SharedValueRow;

/**
 * Every shared value-property entry for one work center (spec §5.6).
 *
 * Read WITHOUT locks and WITHOUT narrowing: unlike resources, there is no statically derivable
 * touched set, because a property reference can be assembled at runtime (resolveDefault's
 * `property` mode, a group-prefix read of `Prop` that collects `Prop.*`). Transaction isolation
 * makes this snapshot-consistent for the whole transition, and the row locks are taken at
 * write-back instead, on exactly the rows that changed.
 */
export async function loadSharedValueProperties(tx: Db, workCenterId: string): Promise<SharedValueRow[]> {
  return tx.select({
    propertyName: wcValueProperty.propertyName,
    entryName: wcValueProperty.entryName,
    value: wcValueProperty.value,
  }).from(wcValueProperty)
    .where(eq(wcValueProperty.workCenterId, workCenterId))
    .orderBy(asc(wcValueProperty.propertyName), asc(wcValueProperty.entryName));
}

/**
 * Flush changed shared values. Each UPDATE takes its own row lock as it runs, so no separate
 * SELECT ... FOR UPDATE is needed — last writer wins against a concurrent Mission Commander edit,
 * and the polling pane reflects it within a cycle.
 *
 * `updated_by` is set to NULL: this write came from the engine, and a stale operator
 * attribution surviving an engine write would misreport who last moved the value.
 *
 * An update matching zero rows is NOT an error. The caller only routes a write here when the
 * exact (property, entry) pair was present in the registry at hydrate time, so a miss means the
 * row was removed underneath a long transition — nothing to repair, and failing the transition
 * over it would be worse than dropping one write.
 *
 * Returns the number of rows actually matched, so a caller that cares can log a discrepancy.
 */
export async function writeSharedValueProperties(
  tx: Db, workCenterId: string, updates: SharedValueUpdate[], now: Date,
): Promise<number> {
  let matched = 0;
  for (const u of updates) {
    const rows = await tx.update(wcValueProperty)
      .set({ value: u.value, updatedAt: now, updatedBy: null })
      .where(and(
        eq(wcValueProperty.workCenterId, workCenterId),
        eq(wcValueProperty.propertyName, u.propertyName),
        eq(wcValueProperty.entryName, u.entryName),
      ))
      .returning({ propertyName: wcValueProperty.propertyName });
    matched += rows.length;
  }
  return matched;
}

/**
 * A COMMANDER's edit of one shared value (Phase 4a, spec §7.1 / §7.2). The engine's own flush
 * above stamps `updated_by = NULL` on purpose; this is the one writer that stamps a user, so
 * the pane's "Updated · by" cell (Phase 3) can name who moved the value. Same row lock
 * semantics as the engine flush: the UPDATE itself takes the row lock, last writer wins.
 *
 * Returns `false` when no row matched — the caller turns that into 404, never inserts: the
 * registry is derived from environment specs (spec §4.5) and an operator cannot declare a new
 * value property by editing it.
 */
export async function writeSharedValueProperty(
  tx: Db, workCenterId: string, update: SharedValueUpdate, now: Date, updatedBy: string,
): Promise<boolean> {
  const rows = await tx.update(wcValueProperty)
    .set({ value: update.value, updatedAt: now, updatedBy })
    .where(and(
      eq(wcValueProperty.workCenterId, workCenterId),
      eq(wcValueProperty.propertyName, update.propertyName),
      eq(wcValueProperty.entryName, update.entryName),
    ))
    .returning({ propertyName: wcValueProperty.propertyName });
  return rows.length === 1;
}
