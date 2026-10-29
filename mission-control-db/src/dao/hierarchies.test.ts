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
import {
  workCenter, appUser, workflow, role, environmentSpec, workflowEnvironment,
  workflowNode,
} from '../db/schema/index.js';
import { workCenterView, userView, workflowView, roleView, envSpecView } from './hierarchies.js';
import { createWorkCenter, assignUserToWorkCenter } from './work-centers.js';
import { createUser } from './users.js';
import { createRole } from './roles.js';
import { addAllowedRole } from './allowed-roles.js';
import { setWorkCenterUserRoles } from './work-center-user-roles.js';
import { setEnvironmentBinding } from './environment-bindings.js';
import { setActionServerTrust, setActionServerAllowlist } from './system-settings.js';

// M6: workflows and environment specs belong directly to a work center (work_center_id),
// there is no more work_center_workflow/work_center_environment link table to fixture
// through, and workflow_allowed_role references the workflow directly (no work-center leg).

test('workCenterView surfaces its own workflows, environments, assigned users, and roles', async () => {
  const { db, close } = await makeTestDb();
  try {
    const parent = await createWorkCenter(db, { name: 'Plant Floor' });
    const child = await createWorkCenter(db, { name: 'Line 1', parentWorkCenterId: parent.id });

    const [wf] = await db.insert(workflow).values({
      oid: 'demo-wf-1', name: 'Demo Workflow', workCenterId: child.id, specJsonb: {},
    }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'demo-env-1', name: 'DemoLine', workCenterId: child.id, specJsonb: {},
    }).returning();
    const [rootNode] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n-root', name: 'Root', depth: 0,
    }).returning();

    const operator = await createRole(db, { name: 'Operator' });
    await addAllowedRole(db, { workflowId: wf.id, nodeId: rootNode.id, roleId: operator.id });

    const alice = await createUser(db, { email: 'alice@demo.trajectorypro.io', displayName: 'Alice' });
    const bob = await createUser(db, { email: 'bob@demo.trajectorypro.io', displayName: 'Bob' });
    await assignUserToWorkCenter(db, child.id, alice.id, { priority: 10 });
    await assignUserToWorkCenter(db, child.id, bob.id, { priority: 5 });
    await setWorkCenterUserRoles(db, child.id, alice.id, [operator.id]);

    const view = await workCenterView(db, child.id);
    expect(view?.workCenter.id).toBe(child.id);
    expect(view?.subtree.map((n) => n.id)).toContain(child.id);
    expect(view?.workflows.map((w) => w.id)).toEqual([wf.id]);
    expect(view?.environments.map((e) => e.id)).toEqual([env.id]);
    expect(view?.users.map((u) => u.id).sort()).toEqual([alice.id, bob.id].sort());
    expect(view?.roles.map((r) => r.id)).toEqual([operator.id]);
    const aliceRow = view?.users.find((u) => u.id === alice.id);
    expect(aliceRow?.roles.map((r) => r.name)).toEqual(['Operator']);
    expect(view?.users.find((u) => u.id === bob.id)?.roles).toEqual([]);

    // The parent has no workflows/environments of its own — ownership does not inherit down.
    const parentView = await workCenterView(db, parent.id);
    expect(parentView?.workflows).toEqual([]);
    expect(parentView?.environments).toEqual([]);
    expect(parentView?.roles).toEqual([]);

    expect(await workCenterView(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined();
  } finally { await close(); }
});

test('userView returns the user\'s work centers with the roles held in each', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    const wc2 = await createWorkCenter(db, { name: 'Line 2' });
    const supervisor = await createRole(db, { name: 'Supervisor' });
    const carol = await createUser(db, { email: 'carol@demo.trajectorypro.io', displayName: 'Carol' });
    await assignUserToWorkCenter(db, wc.id, carol.id, { priority: 10, missionSystemCommander: true });
    await assignUserToWorkCenter(db, wc2.id, carol.id);
    await setWorkCenterUserRoles(db, wc.id, carol.id, [supervisor.id]);

    const view = await userView(db, carol.id);
    expect(view?.user.id).toBe(carol.id);
    expect(view).not.toHaveProperty('roles');
    expect(view?.workCenters.map((w) => w.workCenter.id)).toEqual([wc.id, wc2.id]);
    expect(view?.workCenters[0]?.missionSystemCommander).toBe(true);
    expect(view?.workCenters[0]?.roles.map((r) => r.id)).toEqual([supervisor.id]);
    expect(view?.workCenters[1]?.roles).toEqual([]);

    expect(await userView(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined();
  } finally { await close(); }
});

test('workflowView returns the owning work center and embedded environments', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    // A second, unrelated work center: without it, a join that returned "any work center"
    // (e.g. an unconstrained cross join) would still pass, since there'd be only one candidate.
    await createWorkCenter(db, { name: 'Line 2' });
    const [wf] = await db.insert(workflow).values({
      oid: 'v-1', name: 'Bake', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'env-1', name: 'Kitchen', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await db.insert(workflowEnvironment).values({ workflowId: wf.id, environmentSpecId: env.id });

    const view = await workflowView(db, wf.id);
    expect(view?.workflow.id).toBe(wf.id);
    expect(view?.workCenter.id).toBe(wc.id);
    expect(view?.environments.map((e) => e.id)).toEqual([env.id]);

    expect(await workflowView(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined();
  } finally { await close(); }
});

test('envSpecView surfaces the spec, its owning work center, and the workflows that embed it', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    // A second, unrelated work center: without it, a join that returned "any work center"
    // (e.g. an unconstrained cross join) would still pass, since there'd be only one candidate.
    await createWorkCenter(db, { name: 'Line 2' });
    const [env] = await db.insert(environmentSpec).values({
      oid: 'env-1', name: 'DemoLine', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'wf-env', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await db.insert(workflowEnvironment).values({ workflowId: wf.id, environmentSpecId: env.id });

    const view = await envSpecView(db, env.id);
    expect(view?.environmentSpec.id).toBe(env.id);
    expect(view?.workCenter.id).toBe(wc.id);
    expect(view?.workflows.map((w) => w.id)).toEqual([wf.id]);

    expect(await envSpecView(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined();
  } finally { await close(); }
});

test('roleView surfaces users holding the role and the workflows that use it via allowed-role, omitting specJsonb', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    const [wf] = await db.insert(workflow).values({
      oid: 'wf-role-spec', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [node] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n0', name: 'Root', depth: 0,
    }).returning();
    const roleRow = await createRole(db, { name: 'RoleSpecOmit' });
    await addAllowedRole(db, { workflowId: wf.id, nodeId: node.id, roleId: roleRow.id });

    const alice = await createUser(db, { email: 'alice-role@demo.trajectorypro.io', displayName: 'Alice' });
    await assignUserToWorkCenter(db, wc.id, alice.id);
    await setWorkCenterUserRoles(db, wc.id, alice.id, [roleRow.id]);

    const view = await roleView(db, roleRow.id);
    expect(view?.role.id).toBe(roleRow.id);
    expect(view).not.toHaveProperty('users');
    expect(view?.members.map((m) => m.workCenter.id)).toEqual([wc.id]);
    expect(view?.members[0]?.users.map((u) => u.id)).toEqual([alice.id]);
    expect(view?.workflows.map((w) => w.id)).toEqual([wf.id]);
    expect(view?.workflows[0]).not.toHaveProperty('specJsonb');

    expect(await roleView(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined();
  } finally { await close(); }
});

// Guards the roleView join: a role must not pick up a workflow it is not actually assigned
// to just because that workflow shares a work center with an assigned one.
test('roleView does not surface a workflow the role is not assigned to', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    const [assigned] = await db.insert(workflow).values({
      oid: 'assigned', name: 'Assigned', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await db.insert(workflow).values({ oid: 'other', name: 'Other', workCenterId: wc.id, specJsonb: {} });
    const [node] = await db.insert(workflowNode).values({
      workflowId: assigned.id, nodeOid: 'n0', name: 'Root', depth: 0,
    }).returning();
    const roleRow = await createRole(db, { name: 'Scoped' });
    await addAllowedRole(db, { workflowId: assigned.id, nodeId: node.id, roleId: roleRow.id });

    const view = await roleView(db, roleRow.id);
    expect(view?.workflows.map((w) => w.id)).toEqual([assigned.id]);
  } finally { await close(); }
});

test('workCenterView counts DISTINCT roles per workflow', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [wfA] = await db.insert(workflow).values({
      oid: 'wf-a', name: 'A', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [wfB] = await db.insert(workflow).values({
      oid: 'wf-b', name: 'B', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [n1] = await db.insert(workflowNode).values({
      workflowId: wfA.id, nodeOid: 'n1', name: 'One', depth: 0,
    }).returning();
    const [n2] = await db.insert(workflowNode).values({
      workflowId: wfA.id, nodeOid: 'n2', name: 'Two', depth: 0,
    }).returning();
    const [op] = await db.insert(role).values({ name: 'Operator' }).returning();
    const [sup] = await db.insert(role).values({ name: 'Supervisor' }).returning();

    // Operator on BOTH nodes (must count once), Supervisor on one.
    await addAllowedRole(db, { workflowId: wfA.id, nodeId: n1.id, roleId: op.id });
    await addAllowedRole(db, { workflowId: wfA.id, nodeId: n2.id, roleId: op.id });
    await addAllowedRole(db, { workflowId: wfA.id, nodeId: n1.id, roleId: sup.id });

    const view = await workCenterView(db, wc.id);
    const byId = new Map(view!.workflows.map((w) => [w.id, w.allowedRoleCount]));
    expect(byId.get(wfA.id)).toBe(2);
    // A workflow with no grants must get 0, not a missing key.
    expect(byId.get(wfB.id)).toBe(0);
    expect(view!.workflows.every((w) => typeof w.allowedRoleCount === 'number')).toBe(true);
  } finally { await close(); }
});

test('workCenterView handles a work center with no workflows', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Empty' }).returning();
    const view = await workCenterView(db, wc.id);
    expect(view!.workflows).toEqual([]);
  } finally { await close(); }
});

test('workCenterView does not ship spec_jsonb for its workflows', async () => {
  // This branch removed the identical over-fetch from workflowView with an explicit
  // rationale, so leaving it on the LARGER payload contradicted its own stated principle —
  // and refresh() re-runs this after every mutation, including each allowed-roles Save.
  const { db, close } = await makeTestDb();
  try {
    const wc = await createWorkCenter(db, { name: 'WC' });
    await db.insert(workflow).values({
      oid: 'o-wf', name: 'WF', workCenterId: wc.id,
      // A non-empty blob, so a leak shows up as a real payload rather than an empty object.
      specJsonb: { steps: [{ oid: 's1', name: 'Big' }] },
    });
    const view = await workCenterView(db, wc.id);
    expect(view!.workflows).toHaveLength(1);
    expect(view!.workflows[0]).not.toHaveProperty('specJsonb');
  } finally { await close(); }
});

test('envSpecView exposes actions, declared action servers and the work center binding', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    const [env] = await db.insert(environmentSpec).values({
      oid: 'env-a', name: 'Env A', workCenterId: wc.id,
      specJsonb: {
        action_server_specifications: [{ name: 'Main', uri: 'http://srv:8080/x' }, { name: '', uri: '' }],
        included_actions: [
          {
            oid: 'o1', version: '1.0', local_id: 'Mix', action_name: 'Mix It', description: 'Mixes',
            action_library: 'Kitchen', action_visibility: 'public',
            input_parameter_specifications: [{ id: 'speed' }, { id: 'time' }],
            output_parameter_specifications: [{ id: 'done' }],
          },
          { action_name: 'Legacy', action_library: 'Old' },
          { local_id: 'OnlyLocal' },
        ],
      },
    }).returning();

    // unbound
    let view = await envSpecView(db, env.id);
    expect(view?.binding).toBeNull();
    expect(view?.actionServers).toEqual([{ name: 'Main', uri: 'http://srv:8080/x' }, { name: '', uri: '' }]);
    expect(view?.actions).toEqual([
      { name: 'Mix It', library: 'Kitchen', version: '1.0', description: 'Mixes', visibility: 'public', inputs: ['speed', 'time'], outputs: ['done'] },
      { name: 'Legacy', library: 'Old', version: null, description: null, visibility: null, inputs: [], outputs: [] },
      { name: 'OnlyLocal', library: null, version: null, description: null, visibility: null, inputs: [], outputs: [] },
    ]);

    // bound, strict, not allowlisted
    await setEnvironmentBinding(db, { workCenterId: wc.id, environmentOid: 'env-a', serverUri: 'http://srv:8080/x', userId: null });
    await setActionServerTrust(db, 'strict');
    await setActionServerAllowlist(db, []);
    view = await envSpecView(db, env.id);
    expect(view?.binding).toEqual({ serverUri: 'http://srv:8080/x', allowlisted: false });

    // bound, strict, allowlisted by origin
    await setActionServerAllowlist(db, ['http://srv:8080']);
    view = await envSpecView(db, env.id);
    expect(view?.binding).toEqual({ serverUri: 'http://srv:8080/x', allowlisted: true });

    // loose trust
    await setActionServerAllowlist(db, []);
    await setActionServerTrust(db, 'loose');
    view = await envSpecView(db, env.id);
    expect(view?.binding?.allowlisted).toBe(true);
  } finally { await close(); }
});

test('envSpecView tolerates a spec with no actions or servers', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    const [env] = await db.insert(environmentSpec).values({ oid: 'e0', name: 'E0', workCenterId: wc.id, specJsonb: {} }).returning();
    const view = await envSpecView(db, env.id);
    expect(view?.actions).toEqual([]);
    expect(view?.actionServers).toEqual([]);
    expect(view?.binding).toBeNull();
  } finally { await close(); }
});
