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
import { sql } from 'drizzle-orm';
import { makeTestDb } from '../../../test/helpers/db.js';
import { workCenter, workflow, workflowNode, role } from './index.js';
import { workflowAllowedRole } from './work-centers.js';

test('work_center_role view lists the allowed roles of a work center', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
  const [node] = await db.insert(workflowNode).values({ workflowId: wf.id, nodeOid: 'w', name: 'W', depth: 0 }).returning();
  const [op] = await db.insert(role).values({ name: 'Operator' }).returning();
  await db.insert(workflowAllowedRole).values({ workflowId: wf.id, workflowNodeId: node.id, roleId: op.id });

  const res = await db.execute<{ role_id: string }>(sql`select role_id from work_center_role where work_center_id = ${wc.id}`);
  expect(res.rows.map((r) => r.role_id)).toEqual([op.id]);
  await close();
});
