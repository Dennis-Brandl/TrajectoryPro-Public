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
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { seedDemo } from './demo.js';
import { workCenter, workflow, appUser, role } from '../db/schema/index.js';
import { workCenterView, userView, workflowView, roleView } from '../dao/hierarchies.js';

test('seedDemo populates a usable demo dataset', async () => {
  const { db, close } = await makeTestDb();
  await seedDemo(db);
  expect((await db.select().from(workCenter)).length).toBeGreaterThanOrEqual(2);
  expect((await db.select().from(appUser)).length).toBeGreaterThanOrEqual(3);
  expect((await db.select().from(workflow)).length).toBeGreaterThanOrEqual(1);
  await close();
});

// Coverage debt: this is the only test that proves seedDemo() actually wires up through all
// four Planner hierarchy DAOs (workCenterView/userView/workflowView/roleView) — it was lost
// when hierarchies.test.ts was rewritten around fixture-based, non-seedDemo setups for M6.
// Restored here, updated for M6's shape: the demo workflow is now loaded directly into
// "Line 1" (workCenterId), not linked to it via the retired work_center_workflow table, and
// workflowView surfaces a single owning workCenter rather than a workCenters[] link array.
test('the four Planner hierarchies surface the collections seedDemo creates', async () => {
  const { db, close } = await makeTestDb();
  try {
    await seedDemo(db);

    // seedDemo loads the demo workflow (+ its allowed role) into "Line 1", not its parent "Plant Floor".
    const [line1] = await db.select().from(workCenter).where(eq(workCenter.name, 'Line 1'));
    const [alice] = await db.select().from(appUser).where(eq(appUser.email, 'alice@demo.trajectorypro.io'));
    const [wf] = await db.select().from(workflow).where(eq(workflow.oid, 'demo-wf-1'));
    const [operator] = await db.select().from(role).where(eq(role.name, 'Operator'));

    // 1. Work center view: Line 1 owns the workflow, 2 assigned users, and the Operator role
    // (via the work_center_role view). The demo's env spec arrives embedded in the workflow
    // package (linked via workflow_environment, not loaded standalone) but under M6's direct-load
    // model it is still inserted into environment_spec with work_center_id = Line 1, so it IS
    // one of Line 1's own environments too.
    const wcView = await workCenterView(db, line1.id);
    expect(wcView?.workCenter.id).toBe(line1.id);
    expect(wcView?.subtree.map((n) => n.id)).toContain(line1.id);
    expect(wcView?.workflows.map((w) => w.id)).toContain(wf.id);
    expect(wcView?.users.length).toBeGreaterThanOrEqual(2);
    expect(wcView?.users.map((u) => u.id)).toContain(alice.id);
    expect(wcView?.roles.map((r) => r.id)).toContain(operator.id);

    // 2. User view: Alice holds Operator and is assigned to Line 1.
    const uView = await userView(db, alice.id);
    expect(uView?.user.id).toBe(alice.id);
    expect(uView?.workCenters.flatMap((w) => w.roles).map((r) => r.id)).toContain(operator.id);
    expect(uView?.workCenters.map((w) => w.workCenter.id)).toContain(line1.id);

    // 3. Workflow view: owned by Line 1, and carries the inline "DemoLine" environment spec.
    const wfView = await workflowView(db, wf.id);
    expect(wfView?.workflow.id).toBe(wf.id);
    expect(wfView?.workCenter.id).toBe(line1.id);
    expect(wfView?.environments.length).toBeGreaterThanOrEqual(1);

    // 4. Role view: Operator has alice + bob, and is used by the demo workflow (via workflow_allowed_role).
    const rView = await roleView(db, operator.id);
    expect(rView?.role.id).toBe(operator.id);
    const holders = rView?.members.flatMap((m) => m.users) ?? [];
    expect(holders.length).toBeGreaterThanOrEqual(2);
    expect(holders.map((u) => u.id)).toContain(alice.id);
    expect(rView?.workflows.map((w) => w.id)).toContain(wf.id);
  } finally { await close(); }
});
