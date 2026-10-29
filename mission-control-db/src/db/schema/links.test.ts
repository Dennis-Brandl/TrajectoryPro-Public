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
import { makeTestDb } from '../../../test/helpers/db.js';
import { workCenter, workflowAllowedRole } from './work-centers.js';
import { workflow, workflowNode } from './workflows.js';
import { role } from './identity.js';

// M6: work_center_workflow / work_center_workflow_allowed_role are gone — a workflow node's
// allowed roles are keyed directly on the workflow entry (spec §4.3), with no work-center
// link hop to fixture through.
test('a workflow node can carry multiple allowed roles, keyed on the workflow entry', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
  const [node] = await db.insert(workflowNode).values({ workflowId: wf.id, nodeOid: 'w', name: 'W', depth: 0 }).returning();
  const [op] = await db.insert(role).values({ name: 'Operator' }).returning();
  const [qa] = await db.insert(role).values({ name: 'QA' }).returning();
  await db.insert(workflowAllowedRole).values([
    { workflowId: wf.id, workflowNodeId: node.id, roleId: op.id },
    { workflowId: wf.id, workflowNodeId: node.id, roleId: qa.id },
  ]);
  // duplicate (workflow, node, role) rejected
  await expect(db.insert(workflowAllowedRole).values(
    { workflowId: wf.id, workflowNodeId: node.id, roleId: op.id },
  )).rejects.toThrow();
  await close();
});
