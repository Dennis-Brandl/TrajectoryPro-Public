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

import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  role, workflow, workflowAllowedRole, workflowNode, workflowUiStep,
} from '../db/schema/index.js';
import { DaoError, pgErrorCode } from './errors.js';
import { UI_STEP_TYPES } from '../constants.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

export type AllowedRoleNode = {
  nodeId: string; nodeName: string; depth: number;
  /** false = an ancestor included for inherited grants only (owns no UI steps itself). */
  ownsUiSteps: boolean;
  roleIds: string[];
};
export type AllowedRolesView = { workflowId: string; nodes: AllowedRoleNode[] };
export type AllowedRoleKey = { workflowId: string; nodeId: string; roleId: string };

/**
 * The allowed-role editor's payload: the workflow's UI nodes (those owning at least one
 * workflow_ui_step of a UI_STEP_TYPES type) PLUS their ancestors, with the roles assigned on
 * this ENTRY. Ancestors are included (spec 2026-08-14 D9) because runtime resolution is
 * nearest-ancestor: a grant on a child-workflow node with no UI steps of its own is live for
 * every descendant UI step, and used to be invisible in this editor. Branches with no UI
 * steps anywhere below stay excluded — a grant there could never apply.
 * undefined = no such workflow.
 *
 * There is no work-center argument any more: a workflow belongs to exactly one work center,
 * and two work centers holding the same oid are separate rows with separate assignments.
 */
export async function listAllowedRoles(db: Db, workflowId: string): Promise<AllowedRolesView | undefined> {
  const [wf] = await db.select({ id: workflow.id }).from(workflow).where(eq(workflow.id, workflowId));
  if (!wf) return undefined;

  const uiNodes = await db.selectDistinct({
    nodeId: workflowNode.id,
  }).from(workflowUiStep)
    .innerJoin(workflowNode, eq(workflowNode.id, workflowUiStep.owningNodeId))
    .where(and(
      eq(workflowUiStep.workflowId, workflowId),
      inArray(workflowUiStep.stepType, [...UI_STEP_TYPES]),
    ));

  const allNodes = await db.select({
    nodeId: workflowNode.id, nodeName: workflowNode.name,
    depth: workflowNode.depth, parentNodeId: workflowNode.parentNodeId,
  }).from(workflowNode).where(eq(workflowNode.workflowId, workflowId));
  const byId = new Map(allNodes.map((n) => [n.nodeId, n]));
  const owning = new Set(uiNodes.map((n) => n.nodeId));
  const included = new Set(owning);
  for (const id of owning) {
    let cur = byId.get(id)?.parentNodeId ?? null;
    while (cur !== null && !included.has(cur)) { included.add(cur); cur = byId.get(cur)?.parentNodeId ?? null; }
  }
  // DFS pre-order, NOT level order (review fix): the dialog renders depth as indentation, so
  // every node must appear directly under its own ancestor chain — with two sibling branches,
  // (depth, name) ordering would indent a deep node under the WRONG branch and a grant made
  // through that mis-drawn tree changes live authorization. Siblings sort by name; every
  // included node's ancestors are included by construction, so roots are exactly the
  // included nodes whose parent is null or not included (defensive for orphaned data).
  const childrenOf = new Map<string | null, typeof allNodes>();
  for (const n of allNodes) {
    if (!included.has(n.nodeId)) continue;
    const parentKey = n.parentNodeId !== null && included.has(n.parentNodeId) ? n.parentNodeId : null;
    const bucket = childrenOf.get(parentKey) ?? [];
    bucket.push(n);
    childrenOf.set(parentKey, bucket);
  }
  const ordered: typeof allNodes = [];
  const visit = (parentKey: string | null) => {
    const bucket = [...(childrenOf.get(parentKey) ?? [])].sort((a, b) => a.nodeName.localeCompare(b.nodeName));
    for (const n of bucket) { ordered.push(n); visit(n.nodeId); }
  };
  visit(null);

  const assigned = await db.select({
    nodeId: workflowAllowedRole.workflowNodeId, roleId: workflowAllowedRole.roleId,
  }).from(workflowAllowedRole).where(eq(workflowAllowedRole.workflowId, workflowId));

  return {
    workflowId,
    nodes: ordered.map((n) => ({
      nodeId: n.nodeId, nodeName: n.nodeName, depth: n.depth,
      ownsUiSteps: owning.has(n.nodeId),
      roleIds: assigned.filter((a) => a.nodeId === n.nodeId).map((a) => a.roleId),
    })),
  };
}

export async function addAllowedRole(db: Db, key: AllowedRoleKey): Promise<void> {
  const [node] = await db.select({ workflowId: workflowNode.workflowId })
    .from(workflowNode).where(eq(workflowNode.id, key.nodeId));
  if (!node || node.workflowId !== key.workflowId) {
    throw new DaoError('LINK_TARGET_NOT_FOUND', 'Node does not belong to this workflow');
  }
  try {
    await db.insert(workflowAllowedRole).values({
      workflowId: key.workflowId, workflowNodeId: key.nodeId, roleId: key.roleId,
    }).onConflictDoNothing();
  } catch (err) {
    if (pgErrorCode(err) === '23503') throw new DaoError('LINK_TARGET_NOT_FOUND', 'Role not found');
    throw err;
  }
}

export async function removeAllowedRole(db: Db, key: AllowedRoleKey): Promise<void> {
  await db.delete(workflowAllowedRole).where(and(
    eq(workflowAllowedRole.workflowId, key.workflowId),
    eq(workflowAllowedRole.workflowNodeId, key.nodeId),
    eq(workflowAllowedRole.roleId, key.roleId),
  ));
}

export type AllowedRolesInput = { nodeId: string; roleIds: string[] }[];

/**
 * Replace a workflow entry's ENTIRE allowed-role set in one transaction.
 *
 * The payload is the complete desired state, not a diff — the dialog that calls this is a
 * draft editor whose Save is all-or-nothing. Everything is validated BEFORE the first
 * write, so a rejected payload leaves the table exactly as it was; without that ordering a
 * bad node id partway down the list would arrive after the delete and clear the workflow's
 * grants as a side effect of failing.
 *
 * Delete-then-insert rather than a computed diff: the row set for one workflow is small,
 * and it is all inside the transaction, so no reader ever observes the intermediate state.
 *
 * undefined = no such workflow.
 */
export async function setAllowedRoles(
  db: Db, workflowId: string, nodes: AllowedRolesInput,
): Promise<AllowedRolesView | undefined> {
  const [wf] = await db.select({ id: workflow.id }).from(workflow).where(eq(workflow.id, workflowId));
  if (!wf) return undefined;

  const nodeIds = [...new Set(nodes.map((n) => n.nodeId))];
  const roleIds = [...new Set(nodes.flatMap((n) => n.roleIds))];

  // Set-based validation, not one query per item.
  if (nodeIds.length) {
    const owned = await db.select({ id: workflowNode.id }).from(workflowNode)
      .where(and(eq(workflowNode.workflowId, workflowId), inArray(workflowNode.id, nodeIds)));
    if (owned.length !== nodeIds.length) {
      throw new DaoError('LINK_TARGET_NOT_FOUND', 'Node does not belong to this workflow');
    }
  }
  if (roleIds.length) {
    const found = await db.select({ id: role.id }).from(role).where(inArray(role.id, roleIds));
    if (found.length !== roleIds.length) {
      throw new DaoError('LINK_TARGET_NOT_FOUND', 'Role not found');
    }
  }

  // Two entries naming the same nodeId both express intent for that node — merge (union) rather
  // than duplicate, so the insert below never carries two rows for the same
  // (workflowId, nodeId, roleId) and cannot trip the table's unique constraint.
  const roleIdsByNode = new Map<string, Set<string>>();
  for (const n of nodes) {
    const merged = roleIdsByNode.get(n.nodeId) ?? new Set<string>();
    for (const roleId of n.roleIds) merged.add(roleId);
    roleIdsByNode.set(n.nodeId, merged);
  }
  const rows = [...roleIdsByNode.entries()].flatMap(([workflowNodeId, ids]) =>
    [...ids].map((roleId) => ({ workflowId, workflowNodeId, roleId })),
  );

  // The error translation below sits OUTSIDE the transaction callback on purpose: Postgres
  // aborts the whole transaction on ANY statement error, so a catch INSIDE the callback could
  // not safely run another statement on that connection — it would fail with 25P02. By the time
  // this catch runs, db.transaction has already rolled back and the connection is healthy again,
  // so translating the error here is safe (same pattern as addAllowedRole's insert, above).
  try {
    await db.transaction(async (tx) => {
      await tx.delete(workflowAllowedRole).where(eq(workflowAllowedRole.workflowId, workflowId));
      if (rows.length) await tx.insert(workflowAllowedRole).values(rows);
    });
  } catch (err) {
    if (pgErrorCode(err) === '23503') throw new DaoError('LINK_TARGET_NOT_FOUND', 'Role or node not found');
    throw err;
  }

  return listAllowedRoles(db, workflowId);
}
