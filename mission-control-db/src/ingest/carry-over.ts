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

import { and, desc, eq, ne } from 'drizzle-orm';
import { workflow, workflowNode, workflowAllowedRole } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

export type PathNode = { id: string; parentNodeId: string | null; name: string };
export type CarryOverReport = {
  sourceWorkflowId: string | null;
  dispatchPolicy: string | null;
  rolesCarried: number;
  unmatchedPaths: string[];
};

// Node names come from Designer's user-authored local_id and nothing in the schema restricts
// characters — ratios ("50/50"), combined operations ("Fill/Cap"), and A/B labels all produce
// a literal '/' in a name. If that '/' were joined in unescaped, a single node named "Fill/Cap"
// under Root and a "Cap" node nested under a "Fill" node under Root would both render as the
// string "Root/Fill/Cap" and become indistinguishable, even though they are structurally
// different nodes possibly in different trees. Escaping '/' (and '%' itself, so the escape
// sequence can't itself collide with a literal '%2F' typed by an author) makes the join
// injective: two different segment arrays can never produce the same joined string.
export function escapeSegment(name: string): string {
  return name.replace(/%/g, '%25').replace(/\//g, '%2F');
}

/**
 * node id → its full path ('Root/Fill/Cap'), or null when that path is AMBIGUOUS.
 *
 * Designer remints every node oid on a version bump (New Version clones the subtree with
 * fresh uuids), so oids cannot match across versions. Names alone cannot either:
 * workflow_node is unique on (workflow_id, node_oid) but NOT on name, so two siblings may
 * share one. The full path disambiguates almost everything; whatever remains ambiguous is
 * reported rather than guessed, because a wrong role assignment is worse than none.
 */
export function buildNodePaths(nodes: PathNode[]): Map<string, string | null> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const raw = new Map<string, string | null>();

  for (const n of nodes) {
    const segments: string[] = [];
    let cur: PathNode | undefined = n;
    const seen = new Set<string>();
    let broken = false;
    while (cur) {
      if (seen.has(cur.id)) { broken = true; break; } // cycle guard
      seen.add(cur.id);
      segments.unshift(escapeSegment(cur.name));
      if (cur.parentNodeId === null) break;
      const parent: PathNode | undefined = byId.get(cur.parentNodeId);
      if (!parent) { broken = true; break; }          // orphan — parent not in this set
      cur = parent;
    }
    raw.set(n.id, broken ? null : segments.join('/'));
  }

  // A path shared by two nodes identifies neither.
  const counts = new Map<string, number>();
  for (const p of raw.values()) if (p !== null) counts.set(p, (counts.get(p) ?? 0) + 1);
  const out = new Map<string, string | null>();
  for (const [id, p] of raw) out.set(id, p !== null && counts.get(p) === 1 ? p : null);
  return out;
}

/**
 * Copy the dispatch override and per-node allowed roles from the most recently LOADED prior
 * entry with the same (work_center_id, oid) onto a freshly inserted entry. No prior entry is
 * not an error — it just carries nothing.
 */
export async function carryOverConfig(
  tx: Db,
  opts: { workCenterId: string; oid: string; newWorkflowId: string },
): Promise<CarryOverReport> {
  const empty: CarryOverReport = {
    sourceWorkflowId: null, dispatchPolicy: null, rolesCarried: 0, unmatchedPaths: [],
  };

  const [source] = await tx.select({ id: workflow.id, dispatchPolicy: workflow.dispatchPolicy, autoClaim: workflow.autoClaim })
    .from(workflow)
    .where(and(
      eq(workflow.workCenterId, opts.workCenterId),
      eq(workflow.oid, opts.oid),
      ne(workflow.id, opts.newWorkflowId),
    ))
    // "the entry the steward last worked with"; id breaks a same-timestamp tie deterministically
    .orderBy(desc(workflow.downloadedAt), desc(workflow.id))
    .limit(1);
  if (!source) return empty;

  // autoClaim rides the same rule as dispatchPolicy: a hand-set override (non-null) carries
  // to the freshly loaded version; null (inherit) carries nothing.
  if (source.dispatchPolicy !== null || source.autoClaim !== null) {
    await tx.update(workflow).set({
      ...(source.dispatchPolicy !== null ? { dispatchPolicy: source.dispatchPolicy } : {}),
      ...(source.autoClaim !== null ? { autoClaim: source.autoClaim } : {}),
    }).where(eq(workflow.id, opts.newWorkflowId));
  }

  const [oldNodes, newNodes] = await Promise.all([
    tx.select({ id: workflowNode.id, parentNodeId: workflowNode.parentNodeId, name: workflowNode.name })
      .from(workflowNode).where(eq(workflowNode.workflowId, source.id)),
    tx.select({ id: workflowNode.id, parentNodeId: workflowNode.parentNodeId, name: workflowNode.name })
      .from(workflowNode).where(eq(workflowNode.workflowId, opts.newWorkflowId)),
  ]);

  const oldPaths = buildNodePaths(oldNodes);
  const newByPath = new Map<string, string>();
  for (const [id, p] of buildNodePaths(newNodes)) if (p !== null) newByPath.set(p, id);

  const assignments = await tx.select({
    nodeId: workflowAllowedRole.workflowNodeId, roleId: workflowAllowedRole.roleId,
  }).from(workflowAllowedRole).where(eq(workflowAllowedRole.workflowId, source.id));

  const unmatched = new Set<string>();
  let carried = 0;
  for (const a of assignments) {
    const path = oldPaths.get(a.nodeId) ?? null;
    const target = path === null ? undefined : newByPath.get(path);
    if (!target) {
      // Ambiguous on either side, or the node no longer exists in the new entry.
      unmatched.add(path ?? `(ambiguous node ${a.nodeId})`);
      continue;
    }
    await tx.insert(workflowAllowedRole).values({
      workflowId: opts.newWorkflowId, workflowNodeId: target, roleId: a.roleId,
    }).onConflictDoNothing();
    carried++;
  }

  return {
    sourceWorkflowId: source.id,
    dispatchPolicy: source.dispatchPolicy,
    rolesCarried: carried,
    unmatchedPaths: [...unmatched],
  };
}
