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

import { and, asc, eq, notInArray } from 'drizzle-orm';
import { environmentSpec, workCenter, workflowInstance, schedule, RUNTIME_FINAL_STATES, type EnvironmentSpec } from '../db/schema/index.js';
import { DaoError, pgErrorCode } from './errors.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

export function listEnvironmentSpecs(db: Db): Promise<EnvironmentSpec[]> {
  return db.select().from(environmentSpec);
}

/**
 * work_center_environment is gone — an environment spec belongs to its work center directly
 * (spec §5) — but two references still block deletion per spec §7.4 ("An entry referenced by
 * an instance or a schedule is refused with a 409 naming the blocker"):
 * workflow_instance.environment_spec_id and schedule.environment_spec_id are both
 * ON DELETE SET NULL, which would otherwise silently sever an unfinished run's or an enabled
 * schedule's environment out from under it. A FINISHED runtime (completed/aborted/stopped/
 * errored) does not block, same as deleteWorkflow: it is information only, its permanent record
 * is its runtime_history row, and the SET NULL merely clears its link. Not blocking: workflow_environment (CASCADE — an
 * embedded env arrives with a package routinely, and the join row is owned by the workflow
 * side, never the spec) and environment_spec.parent_environment_spec_id (SET NULL, self-FK).
 * Same idiom as deleteWorkflow's instance/schedule pre-checks.
 */
export async function deleteEnvironmentSpec(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const unfinished = await tx.select({ id: workflowInstance.id }).from(workflowInstance)
      .where(and(
        eq(workflowInstance.environmentSpecId, id),
        notInArray(workflowInstance.status, [...RUNTIME_FINAL_STATES]),
      )).limit(1);
    if (unfinished.length) {
      throw new DaoError('ENVIRONMENT_IN_USE', 'Environment spec has runtime workflows that have not finished');
    }

    const schedules = await tx.select({ id: schedule.id }).from(schedule)
      .where(eq(schedule.environmentSpecId, id)).limit(1);
    if (schedules.length) throw new DaoError('ENVIRONMENT_IN_USE', 'Environment spec is referenced by one or more schedules');

    try {
      await tx.delete(environmentSpec).where(eq(environmentSpec.id, id));
    } catch (err) {
      if (pgErrorCode(err) === '23503') throw new DaoError('ENVIRONMENT_IN_USE');
      throw err;
    }
  });
}

export type EnvironmentSummary = {
  id: string; oid: string; name: string;
  workCenterId: string; workCenterName: string;
  version: string; state: string; effectiveFrom: Date | null;
  sourceLibraryName: string | null; sourceLibraryOid: string | null;
};

export function listEnvironmentSpecSummaries(db: Db): Promise<EnvironmentSummary[]> {
  return db.select({
    id: environmentSpec.id, oid: environmentSpec.oid, name: environmentSpec.name,
    workCenterId: environmentSpec.workCenterId, workCenterName: workCenter.name,
    version: environmentSpec.version, state: environmentSpec.state, effectiveFrom: environmentSpec.effectiveFrom,
    sourceLibraryName: environmentSpec.sourceLibraryName, sourceLibraryOid: environmentSpec.sourceLibraryOid,
  }).from(environmentSpec)
    .innerJoin(workCenter, eq(workCenter.id, environmentSpec.workCenterId))
    .orderBy(asc(workCenter.name), asc(environmentSpec.name), asc(environmentSpec.version), asc(environmentSpec.state));
}
