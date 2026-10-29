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

import { and, eq } from 'drizzle-orm';
import { workflow, workflowNode, workflowUiStep } from '../db/schema/index.js';
import { UI_STEP_TYPES } from '../constants.js';
import { DaoError } from '../dao/errors.js';
import { assertNameLength } from '../dao/names.js';
import { lenientTypeName } from '../dao/type-name.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

export type InsertEntryMeta = {
  workCenterId: string;
  version: string;
  state: string;
  effectiveFrom?: Date | null;
  dispatchPolicy?: string | null;
  autoClaim?: boolean | null;
  sourceFilename?: string | null;
  checksum?: string | null;
  sourceLibraryName?: string | null;
  sourceLibraryOid?: string | null;
  downloadedBy?: string | null;
  schemaVersion?: string | null;
};

export type InsertEntryResult =
  | { status: 'already_present'; workflowId: string; nodeCount: 0; uiStepCount: 0 }
  | { status: 'inserted'; workflowId: string; nodeCount: number; uiStepCount: number };

/**
 * Insert one workflow entry and index its node / UI-step tree.
 *
 * Shared by ingestWorkflowPackage (the .WFmasterX load path) and the .WFcenterX importer, so
 * both produce identical rows from identical specs.
 *
 * **It deliberately does NOT call carryOverConfig** (spec D8). Carry-over copies the dispatch
 * override and per-node grants from the most recent prior entry with the same
 * (work_center_id, oid). That is right for an interactive load and actively wrong for an
 * import: a package holding both Mix 1.0.0 and Mix 2.0.0 would give v2 v1's grants even when
 * the package records that v2 has none, and because the package's own grants are applied
 * afterwards with onConflictDoNothing the fabricated extras survive silently. Ingest still
 * calls carry-over — at its own layer, after this function returns.
 */
export async function insertWorkflowEntry(
  tx: Db, rootSpec: any, meta: InsertEntryMeta,
): Promise<InsertEntryResult> {
  const name = rootSpec.local_id;
  assertNameLength(name);

  // Fast path. The UNIQUE (work_center_id, oid, version, state) index is what actually
  // settles this — see the ON CONFLICT DO NOTHING below — so this read is an optimisation.
  const [existing] = await tx.select({ id: workflow.id }).from(workflow).where(and(
    eq(workflow.workCenterId, meta.workCenterId),
    eq(workflow.oid, rootSpec.oid),
    eq(workflow.version, meta.version),
    eq(workflow.state, meta.state),
  )).limit(1);
  if (existing) {
    return { status: 'already_present', workflowId: existing.id, nodeCount: 0, uiStepCount: 0 };
  }

  // ON CONFLICT DO NOTHING rather than catching a unique violation: Postgres aborts the whole
  // transaction on ANY statement error, so a caught 23505 would poison every later statement
  // with 25P02. Losing the race yields an empty returning() instead, leaving the transaction
  // healthy to recover in.
  const [wf] = await tx.insert(workflow).values({
    oid: rootSpec.oid, name, workCenterId: meta.workCenterId,
    typeName: lenientTypeName(rootSpec.type_name),
    version: meta.version, state: meta.state,
    dispatchPolicy: meta.dispatchPolicy ?? null,
    autoClaim: meta.autoClaim ?? null,
    effectiveFrom: meta.effectiveFrom ?? null,
    schemaVersion: meta.schemaVersion ?? rootSpec.schemaVersion ?? null,
    specJsonb: rootSpec,
    sourceFilename: meta.sourceFilename ?? null,
    checksum: meta.checksum ?? null,
    sourceLibraryName: meta.sourceLibraryName ?? null,
    sourceLibraryOid: meta.sourceLibraryOid ?? null,
    downloadedBy: meta.downloadedBy ?? null,
  }).onConflictDoNothing({
    target: [workflow.workCenterId, workflow.oid, workflow.version, workflow.state],
  }).returning();

  if (!wf) {
    const [row] = await tx.select({ id: workflow.id }).from(workflow).where(and(
      eq(workflow.workCenterId, meta.workCenterId), eq(workflow.oid, rootSpec.oid),
      eq(workflow.version, meta.version), eq(workflow.state, meta.state),
    )).limit(1);
    if (!row) throw new DaoError('INGEST_FAILED', `workflow ${rootSpec.oid} vanished after insert/relookup`);
    return { status: 'already_present', workflowId: row.id, nodeCount: 0, uiStepCount: 0 };
  }

  let nodeCount = 0, uiStepCount = 0;
  async function insertNode(spec: any, parentNodeId: string | null, depth: number): Promise<void> {
    const [node] = await tx.insert(workflowNode).values({
      workflowId: wf!.id, nodeOid: spec.oid, parentNodeId,
      parentChildSpecOid: spec.parentChildSpecId ?? null,
      name: spec.local_id, version: spec.version, state: spec.state, depth,
    }).returning();
    nodeCount++;
    for (const step of spec.steps ?? []) {
      if (UI_STEP_TYPES.has(step.step_type)) {
        await tx.insert(workflowUiStep).values({
          workflowId: wf!.id, owningNodeId: node!.id, stepOid: step.oid,
          name: step.local_id, stepType: step.step_type,
        });
        uiStepCount++;
      }
    }
    for (const child of spec.children ?? []) await insertNode(child, node!.id, depth + 1);
  }
  await insertNode(rootSpec, null, 0);

  return { status: 'inserted', workflowId: wf.id, nodeCount, uiStepCount };
}
