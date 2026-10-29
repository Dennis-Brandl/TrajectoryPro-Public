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

import { and, eq, inArray, notInArray, count } from 'drizzle-orm';
import { workflow, workflowNode, workflowUiStep, workflowAllowedRole, workflowInstance } from '../db/schema/index.js';
import { RUNTIME_FINAL_STATES } from '../db/schema/execution.js';
import { UI_STEP_TYPES } from '../constants.js';
import { DaoError } from '../dao/errors.js';
import { assertNameLength } from '../dao/names.js';
import { lenientTypeName } from '../dao/type-name.js';
import type { InsertEntryMeta } from './insert-workflow-entry.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

export type ReplaceEntryResult = {
  nodeCount: number; uiStepCount: number;
  nodesRemoved: number; nodesRetained: number; grantsDropped: number;
};

/**
 * Replace an existing workflow entry's spec IN PLACE (spec 2026-10-18 §2.1). The workflow id
 * never changes, so runtimes, schedules and operator configuration (dispatch_policy,
 * auto_claim, effective_from) stay attached; those columns are never written here.
 *
 * Nodes are matched by oid and updated in place, so their ids — and the workflow_allowed_role
 * grants that cascade from them — survive. A node absent from the new spec is deleted only
 * when no runtime of this workflow is unfinished: a running step resolves its roles live by
 * (workflow id, node oid), and a missing node would mean "no restriction". Removal is
 * all-or-nothing, which is what makes deleting a removed parent (parent_node_id cascades)
 * safe: no retained child can sit under it.
 *
 * Only the .WFmasterX load route calls this; the .WFcenterX importer keeps insertWorkflowEntry.
 */
export async function replaceWorkflowEntry(
  tx: Db, workflowId: string, rootSpec: any, meta: InsertEntryMeta,
): Promise<ReplaceEntryResult> {
  assertNameLength(rootSpec.local_id);

  const [locked] = await tx.select({ id: workflow.id }).from(workflow)
    .where(eq(workflow.id, workflowId)).for('update');
  if (!locked) throw new DaoError('INGEST_FAILED', `workflow ${workflowId} vanished before replace`);

  const now = new Date();
  await tx.update(workflow).set({
    specJsonb: rootSpec, name: rootSpec.local_id,
    typeName: lenientTypeName(rootSpec.type_name),
    schemaVersion: meta.schemaVersion ?? rootSpec.schemaVersion ?? null,
    sourceFilename: meta.sourceFilename ?? null,
    checksum: meta.checksum ?? null,
    sourceLibraryName: meta.sourceLibraryName ?? null,
    sourceLibraryOid: meta.sourceLibraryOid ?? null,
    downloadedBy: meta.downloadedBy ?? null,
    downloadedAt: now, updatedAt: now,
  }).where(eq(workflow.id, workflowId));

  const existingNodes = await tx.select({ id: workflowNode.id, nodeOid: workflowNode.nodeOid })
    .from(workflowNode).where(eq(workflowNode.workflowId, workflowId));

  // Depth-first, parent before child, so each child's parentNodeId is the id this walk just
  // upserted — a node the new spec moves is re-pointed to its new parent.
  const seenNodes = new Set<string>();
  const seenSteps = new Set<string>();
  let nodeCount = 0, uiStepCount = 0;
  async function syncNode(spec: any, parentNodeId: string | null, depth: number): Promise<void> {
    const values = {
      parentNodeId, parentChildSpecOid: spec.parentChildSpecId ?? null,
      name: spec.local_id, version: spec.version, state: spec.state, depth,
    };
    const [node] = await tx.insert(workflowNode)
      .values({ workflowId, nodeOid: spec.oid, ...values })
      .onConflictDoUpdate({ target: [workflowNode.workflowId, workflowNode.nodeOid], set: values })
      .returning({ id: workflowNode.id });
    seenNodes.add(spec.oid);
    nodeCount++;
    for (const step of spec.steps ?? []) {
      if (!UI_STEP_TYPES.has(step.step_type)) continue;
      const stepValues = { owningNodeId: node!.id, name: step.local_id, stepType: step.step_type };
      await tx.insert(workflowUiStep)
        .values({ workflowId, stepOid: step.oid, ...stepValues })
        .onConflictDoUpdate({ target: [workflowUiStep.workflowId, workflowUiStep.stepOid], set: stepValues });
      seenSteps.add(step.oid);
      uiStepCount++;
    }
    for (const child of spec.children ?? []) await syncNode(child, node!.id, depth + 1);
  }
  await syncNode(rootSpec, null, 0);

  const goneSteps = await tx.select({ id: workflowUiStep.id, stepOid: workflowUiStep.stepOid })
    .from(workflowUiStep).where(eq(workflowUiStep.workflowId, workflowId));
  const goneStepIds = goneSteps.filter((s) => !seenSteps.has(s.stepOid)).map((s) => s.id);
  if (goneStepIds.length) await tx.delete(workflowUiStep).where(inArray(workflowUiStep.id, goneStepIds));

  const removed = existingNodes.filter((n) => !seenNodes.has(n.nodeOid)).map((n) => n.id);
  let nodesRemoved = 0, nodesRetained = 0, grantsDropped = 0;
  if (removed.length) {
    const [{ unfinished }] = await tx.select({ unfinished: count() }).from(workflowInstance).where(and(
      eq(workflowInstance.workflowId, workflowId),
      notInArray(workflowInstance.status, [...RUNTIME_FINAL_STATES]),
    ));
    if (unfinished > 0) {
      nodesRetained = removed.length;
    } else {
      const [{ grants }] = await tx.select({ grants: count() }).from(workflowAllowedRole)
        .where(inArray(workflowAllowedRole.workflowNodeId, removed));
      grantsDropped = grants;
      // One statement: Postgres resolves the parent_node_id cascade within it, and every node
      // in the set is going (none is retained), so the cascade can't reach a surviving node.
      await tx.delete(workflowNode).where(inArray(workflowNode.id, removed));
      nodesRemoved = removed.length;
    }
  }

  return { nodeCount, uiStepCount, nodesRemoved, nodesRetained, grantsDropped };
}
