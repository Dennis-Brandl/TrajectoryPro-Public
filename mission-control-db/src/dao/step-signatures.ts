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
// Spec 2026-09-06 D6: the e-signature audit rows. One responsibility — write an attempt, list an
// instance's attempts, and delete an instance's attempts when its history is deleted/purged.
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { stepSignature, type SignatureOutcome, type StepSignature, type NewStepSignature } from '../db/schema/execution.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

export type { StepSignature, NewStepSignature };

/** What Mission Commander renders (history and live detail). Date stays a Date here; the wire serialises it. */
export type StepSignatureView = {
  id: string; stepOid: string; stepName: string;
  signerLoginName: string; signerDisplayName: string | null;
  roleName: string | null; meaning: string | null; decision: string | null;
  outcome: SignatureOutcome; failureCode: string | null; signedAt: Date;
  supersededAt: string | null;
};

export async function insertStepSignature(db: Db, row: NewStepSignature): Promise<StepSignature> {
  const [inserted] = await db.insert(stepSignature).values(row).returning();
  if (!inserted) throw new Error('insertStepSignature: insert returned no row');
  return inserted;
}

/** Oldest first (spec §5.5); id breaks same-instant ties deterministically. */
export async function listStepSignatures(db: Db, workflowInstanceId: string): Promise<StepSignatureView[]> {
  const rows = await db.select({
    id: stepSignature.id, stepOid: stepSignature.stepOid, stepName: stepSignature.stepName,
    signerLoginName: stepSignature.signerLoginName, signerDisplayName: stepSignature.signerDisplayName,
    roleName: stepSignature.roleName, meaning: stepSignature.meaning, decision: stepSignature.decision,
    outcome: stepSignature.outcome, failureCode: stepSignature.failureCode, signedAt: stepSignature.signedAt,
    supersededAt: stepSignature.supersededAt,
  }).from(stepSignature)
    .where(eq(stepSignature.workflowInstanceId, workflowInstanceId))
    .orderBy(asc(stepSignature.signedAt), asc(stepSignature.id));
  return rows.map((r) => ({
    ...r, outcome: r.outcome as SignatureOutcome, supersededAt: r.supersededAt ? r.supersededAt.toISOString() : null,
  }));
}

/** Back (spec 2026-11-11): the step's signed rows stop counting. Returns how many were marked. */
export async function markSignaturesSuperseded(
  db: Db, p: { workflowInstanceId: string; stepOid: string; at: Date },
): Promise<number> {
  const res = await db.update(stepSignature).set({ supersededAt: p.at })
    .where(and(
      eq(stepSignature.workflowInstanceId, p.workflowInstanceId), eq(stepSignature.stepOid, p.stepOid),
      eq(stepSignature.outcome, 'signed'), isNull(stepSignature.supersededAt),
    )).returning({ id: stepSignature.id });
  return res.length;
}

export async function deleteStepSignaturesForInstances(db: Db, instanceIds: string[]): Promise<number> {
  if (instanceIds.length === 0) return 0;
  const res = await db.delete(stepSignature).where(inArray(stepSignature.workflowInstanceId, instanceIds))
    .returning({ id: stepSignature.id });
  return res.length;
}
