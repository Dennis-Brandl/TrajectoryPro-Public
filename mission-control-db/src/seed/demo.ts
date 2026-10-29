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

import { eq, and } from 'drizzle-orm';
import { createUser } from '../dao/users.js';
import { createRole } from '../dao/roles.js';
import { setWorkCenterUserRoles } from '../dao/work-center-user-roles.js';
import { assignUserToWorkCenter } from '../dao/work-centers.js';
import { addAllowedRole } from '../dao/allowed-roles.js';
import { ingestWorkflowPackage } from '../ingest/wfmasterx.js';
import { buildWfmasterx } from './sample-bundle.js';
import { workCenter, workflowNode, schedule } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

const DEMO_WORKFLOW_SPEC = {
  local_id: 'DemoWorkflow', oid: 'demo-wf-1', version: '1.0.0', state: 'Effective', schemaVersion: '4.0',
  steps: [
    { local_id: 'Start', oid: 'demo-s0', step_type: 'START' },
    { local_id: 'ReviewOrder', oid: 'demo-s1', step_type: 'USER_INTERACTION' },
  ],
  connections: [],
  environment_specifications: [
    { local_id: 'DemoLine', oid: 'demo-env-1', version: '1.0.0', library_name: 'DemoEnvLib', included_actions: [] },
  ],
  children: [],
};

export async function seedDemo(db: Db): Promise<void> {
  // Roles
  const operatorRole = await createRole(db, { name: 'Operator' });
  const supervisorRole = await createRole(db, { name: 'Supervisor' });

  // Users
  const alice = await createUser(db, { email: 'alice@demo.trajectorypro.io', displayName: 'Alice Operator' });
  const bob = await createUser(db, { email: 'bob@demo.trajectorypro.io', displayName: 'Bob Operator' });
  const carol = await createUser(db, { email: 'carol@demo.trajectorypro.io', displayName: 'Carol Supervisor' });

  // Work centers: parent + child
  const [parentWc] = await db.insert(workCenter).values({ name: 'Plant Floor' }).returning();
  const [childWc] = await db.insert(workCenter).values({
    name: 'Line 1', parentWorkCenterId: parentWc.id,
  }).returning();

  // Assign users to work centers with priorities
  await assignUserToWorkCenter(db, childWc.id, alice.id, { priority: 10 });
  await assignUserToWorkCenter(db, childWc.id, bob.id, { priority: 5 });
  await assignUserToWorkCenter(db, parentWc.id, carol.id, { priority: 10 });

  // Roles are per work center (spec 2026-09-06): the operators hold Operator on Line 1,
  // the supervisor holds Supervisor on the parent.
  await setWorkCenterUserRoles(db, childWc.id, alice.id, [operatorRole.id]);
  await setWorkCenterUserRoles(db, childWc.id, bob.id, [operatorRole.id]);
  await setWorkCenterUserRoles(db, parentWc.id, carol.id, [supervisorRole.id]);

  // Load the demo workflow (+ inline environment spec) directly into the child work center —
  // since M6, loading an artifact into a work center IS the linking step; there is no
  // separate library or link-table hop.
  const buf = buildWfmasterx(DEMO_WORKFLOW_SPEC);
  const { workflowId } = await ingestWorkflowPackage(db, buf, { workCenterId: childWc.id });
  const [rootNode] = await db.select().from(workflowNode)
    .where(and(eq(workflowNode.workflowId, workflowId), eq(workflowNode.depth, 0)));

  // Grant the root node's allowed role directly on the workflow entry.
  await addAllowedRole(db, { workflowId, nodeId: rootNode.id, roleId: operatorRole.id });

  // One recurring schedule for that work center + workflow
  await db.insert(schedule).values({
    workCenterId: childWc.id, workflowId, name: 'Demo daily run',
    kind: 'recurring', cronExpr: '0 6 * * *', timezone: 'UTC',
  });
}
