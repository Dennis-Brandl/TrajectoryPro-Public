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
import { workflowNode, workflowAllowedRole } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

/**
 * Walk from nodeId up through parents, returning the roles assigned at the nearest node
 * that has any (own node first, else nearest ancestor). A workflow belongs to exactly one
 * work center (spec §5), so there is no more work-center-scoped link to resolve through —
 * allowed roles are looked up directly off the workflow entry (spec §4.3).
 */
export async function resolveAllowedRoles(
  db: Db,
  args: { workflowId: string; nodeId: string },
): Promise<string[]> {
  let nodeId: string | null = args.nodeId;
  while (nodeId) {
    const rows = await db.select({ roleId: workflowAllowedRole.roleId })
      .from(workflowAllowedRole)
      .where(and(
        eq(workflowAllowedRole.workflowId, args.workflowId),
        eq(workflowAllowedRole.workflowNodeId, nodeId),
      ));
    if (rows.length) return rows.map((r) => r.roleId);
    const [node] = await db.select({ parent: workflowNode.parentNodeId }).from(workflowNode).where(eq(workflowNode.id, nodeId));
    nodeId = node?.parent ?? null;
  }
  return [];
}
