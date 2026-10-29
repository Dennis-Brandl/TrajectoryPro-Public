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
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db } from './lib/db';
import {
  appUser, role, workflow, workflowNode, workflowUiStep, workCenter, workflowAllowedRole,
} from 'mission-control-db/src/db/schema/index';
import { eq, inArray } from 'drizzle-orm';
import { migrateTestDb, resetDb } from './test/fixture';
import { seedDemo } from './seed';
import { auth } from './lib/auth';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
});

describe('demo seed', () => {
  it('creates three working logins with the right access levels', async () => {
    await seedDemo();
    const rows = await db.select().from(appUser);
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r.accessLevel]));
    expect(byEmail['admin@command.local']).toBe('administrator');
    expect(byEmail['steward@command.local']).toBe('steward');
    expect(byEmail['viewer@command.local']).toBe('viewer');

    // The viewer login actually works (proves better-auth account rows were created).
    const signIn = await auth.api.signInEmail({
      body: { email: 'viewer@command.local', password: 'demo-pass-123' },
      asResponse: true,
    });
    expect(signIn.status).toBe(200);
  });

  it('is idempotent', async () => {
    await seedDemo();
    await seedDemo();
    const rows = await db.select().from(appUser);
    expect(rows).toHaveLength(3);
  });
});

describe('seedDemo demo fixture', () => {
  it('seeds a work center owning the demo workflow, with allowed roles attached', async () => {
    await seedDemo();

    const [wc] = await db.select().from(workCenter).where(eq(workCenter.name, 'Demo Line'));
    expect(wc).toBeTruthy();

    // M6: the workflow is owned by the work center directly — no library, no link row.
    const rows = await db.select().from(workflow).where(eq(workflow.workCenterId, wc.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].oid).toBe('demo-wf-m2');

    const roleRows = await db.select().from(role).where(inArray(role.name, ['Operator', 'Supervisor']));
    expect(roleRows.length).toBe(2);

    const nodes = await db.select().from(workflowNode).where(eq(workflowNode.workflowId, rows[0].id));
    expect(nodes.length).toBe(2);
    const steps = await db.select().from(workflowUiStep).where(eq(workflowUiStep.workflowId, rows[0].id));
    expect(steps.map((s) => s.stepType).sort()).toEqual(['USER_INTERACTION', 'YES_NO']);

    // Allowed roles hang off the workflow now, not off a link row — so the allowed-roles
    // editor has something real to show in dev/e2e.
    const roles = await db.select().from(workflowAllowedRole)
      .where(eq(workflowAllowedRole.workflowId, rows[0].id));
    expect(roles.length).toBeGreaterThan(0);
  });

  it('is idempotent — a second run adds nothing', async () => {
    await seedDemo();
    const before = (await db.select().from(workflow)).length;
    const rolesBefore = (await db.select().from(workflowAllowedRole)).length;

    await seedDemo();

    // The natural key is now (work_center_id, oid, version, state), so a re-run that changed
    // any of those four would silently double the fixture rather than no-op.
    expect((await db.select().from(workflow)).length).toBe(before);
    expect((await db.select().from(workflowAllowedRole)).length).toBe(rolesBefore);
    expect((await db.select().from(workCenter)).length).toBe(1);
  });
});
