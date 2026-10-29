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
// Spec 2026-10-27: the step-run records. One responsibility — write a run, count a step's runs,
// list an instance's runs, and delete an instance's runs when its history is deleted/purged.
import { and, asc, count, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  stepRun, type NewStepRun, type StepRunKind, type StepRunPathEntry, type StepRunResult,
} from '../db/schema/execution.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

export type StepRunView = {
  id: string; stepInstanceId: string | null; stepOid: string; stepName: string; stepType: string; runNumber: number;
  startedAt: Date | null; finishedAt: Date; result: StepRunResult; error: string | null;
  inputParameters: Record<string, string> | null; outputParameters: Record<string, string> | null;
  performedByLoginName: string | null; performedByKind: StepRunKind; nodePath: StepRunPathEntry[];
};

export async function insertStepRun(db: Db, row: NewStepRun): Promise<void> {
  await db.insert(stepRun).values(row);
}

export async function countStepRuns(db: Db, workflowInstanceId: string, stepOid: string): Promise<number> {
  const [r] = await db.select({ n: count() }).from(stepRun)
    .where(and(eq(stepRun.workflowInstanceId, workflowInstanceId), eq(stepRun.stepOid, stepOid)));
  return Number(r?.n ?? 0);
}

/** A step's runs that STARTED strictly before `before` — the engine numbers the currently active
 *  activation of a WORKFLOW PROXY this way, independent of whether that activation's own run row
 *  was already written earlier in the same transaction. Runs with no start time are not counted. */
export async function countStepRunsStartedBefore(
  db: Db, workflowInstanceId: string, stepOid: string, before: Date,
): Promise<number> {
  const [r] = await db.select({ n: count() }).from(stepRun).where(and(
    eq(stepRun.workflowInstanceId, workflowInstanceId), eq(stepRun.stepOid, stepOid), lt(stepRun.startedAt, before),
  ));
  return Number(r?.n ?? 0);
}

/** Oldest first; a run with no start time sorts by its finish; id breaks same-instant ties. */
export async function listStepRuns(db: Db, workflowInstanceId: string): Promise<StepRunView[]> {
  const rows = await db.select({
    id: stepRun.id, stepInstanceId: stepRun.stepInstanceId, stepOid: stepRun.stepOid, stepName: stepRun.stepName,
    stepType: stepRun.stepType, runNumber: stepRun.runNumber, startedAt: stepRun.startedAt,
    finishedAt: stepRun.finishedAt, result: stepRun.result, error: stepRun.error,
    inputParameters: stepRun.inputParameters, outputParameters: stepRun.outputParameters,
    performedByLoginName: stepRun.performedByLoginName, performedByKind: stepRun.performedByKind,
    nodePath: stepRun.nodePath,
  }).from(stepRun)
    .where(eq(stepRun.workflowInstanceId, workflowInstanceId))
    .orderBy(sql`coalesce(${stepRun.startedAt}, ${stepRun.finishedAt}) asc`, asc(stepRun.finishedAt), asc(stepRun.id));
  return rows.map((r) => ({
    ...r,
    result: r.result as StepRunResult,
    performedByKind: r.performedByKind as StepRunKind,
    inputParameters: r.inputParameters as Record<string, string> | null,
    outputParameters: r.outputParameters as Record<string, string> | null,
  }));
}

export async function deleteStepRunsForInstances(db: Db, instanceIds: string[]): Promise<number> {
  if (instanceIds.length === 0) return 0;
  const res = await db.delete(stepRun).where(inArray(stepRun.workflowInstanceId, instanceIds))
    .returning({ id: stepRun.id });
  return res.length;
}
