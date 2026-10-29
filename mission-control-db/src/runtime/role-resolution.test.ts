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

import { expect, test } from 'vitest';
import { makeTestDb } from '../../test/helpers/db.js';
import { workCenter, workflow, workflowNode, workflowAllowedRole, role } from '../db/schema/index.js';
import { resolveAllowedRoles } from './role-resolution.js';

test('child inherits parent allowed roles unless it defines its own', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
  const [root] = await db.insert(workflowNode).values({ workflowId: wf.id, nodeOid: 'w', name: 'root', depth: 0 }).returning();
  const [child] = await db.insert(workflowNode).values({ workflowId: wf.id, nodeOid: 'w-c', parentNodeId: root.id, name: 'child', depth: 1 }).returning();
  const [grand] = await db.insert(workflowNode).values({ workflowId: wf.id, nodeOid: 'w-g', parentNodeId: child.id, name: 'grand', depth: 2 }).returning();
  const [op] = await db.insert(role).values({ name: 'Operator' }).returning();
  const [qa] = await db.insert(role).values({ name: 'QA' }).returning();
  await db.insert(workflowAllowedRole).values({ workflowId: wf.id, workflowNodeId: root.id, roleId: op.id });
  await db.insert(workflowAllowedRole).values({ workflowId: wf.id, workflowNodeId: child.id, roleId: qa.id });

  expect(await resolveAllowedRoles(db, { workflowId: wf.id, nodeId: root.id })).toEqual([op.id]);
  expect(await resolveAllowedRoles(db, { workflowId: wf.id, nodeId: child.id })).toEqual([qa.id]);
  // grandchild has none -> inherits nearest ancestor (child's QA)
  expect(await resolveAllowedRoles(db, { workflowId: wf.id, nodeId: grand.id })).toEqual([qa.id]);
  await close();
});
