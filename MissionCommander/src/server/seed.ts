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
import { and, eq, inArray } from 'drizzle-orm';
import { db } from './lib/db';
import {
  appUser, role, workCenter, workflow, workflowNode, workflowUiStep, workflowAllowedRole,
} from 'mission-control-db/src/db/schema/index';
import { setAccessLevel, type AccessLevel } from 'mission-control-db/src/dao/access';
import { updateUser } from 'mission-control-db/src/dao/users';
import { auth } from './lib/auth';

const DEMO = [
  { email: 'admin@command.local', name: 'Demo Administrator', level: 'administrator' as AccessLevel, login: 'admin' },
  { email: 'steward@command.local', name: 'Demo Steward', level: 'steward' as AccessLevel, login: 'steward' },
  { email: 'viewer@command.local', name: 'Demo Viewer', level: 'viewer' as AccessLevel, login: 'viewer' },
];
const PASSWORD = 'demo-pass-123';

/** Idempotently create the three demo logins with explicit login names (admin/steward/viewer,
 *  spec 2026-09-06 D6) — otherwise the 0031 trigger would derive one from the email local part.
 *  admin is created first so the first-run hook promotes it; the others are set explicitly. */
export async function seedDemo(): Promise<{ email: string; accessLevel: string }[]> {
  const out: { email: string; accessLevel: string }[] = [];
  for (const d of DEMO) {
    const [existing] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, d.email));
    if (!existing) {
      await auth.api.signUpEmail({ body: { email: d.email, password: PASSWORD, name: d.name } });
    }
    const [row] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, d.email));
    // admin is already 'administrator' via the first-run hook; setting again is a no-op.
    await setAccessLevel(db, row.id, d.level);
    await updateUser(db, row.id, { loginName: d.login });
    out.push({ email: d.email, accessLevel: d.level });
  }
  await seedDemoFixture();
  return out;
}

// Idempotent demo fixture so the Roles hierarchy is non-empty and the allowed-roles
// editor has real roles + UI nodes to edit in dev/e2e (spec §8). Direct row inserts —
// NOT the ingest path.
//
// M6: the work center comes FIRST, because a workflow cannot exist without one
// (work_center_id is NOT NULL). There is no library and no link row; ownership is the
// workflow's own column, and allowed roles hang off the workflow entry.
//
// The idempotence guard reads on the real natural key — (work_center_id, oid, version,
// state) — not on oid alone. Guarding on oid alone would look correct here but would stop
// matching the moment the demo fixture gained a second work center or a second state, and
// the unique index would then start rejecting the re-run instead of no-opping.
async function seedDemoFixture(): Promise<void> {
  await db.transaction(async (tx) => {
    const wantedRoles = ['Operator', 'Supervisor'];
    const existingRoles = await tx.select({ name: role.name }).from(role).where(inArray(role.name, wantedRoles));
    const missingRoles = wantedRoles.filter((n) => !existingRoles.some((r) => r.name === n));
    if (missingRoles.length) await tx.insert(role).values(missingRoles.map((name) => ({ name })));

    let [wc] = await tx.select({ id: workCenter.id }).from(workCenter).where(eq(workCenter.name, 'Demo Line'));
    if (!wc) {
      [wc] = await tx.insert(workCenter).values({ name: 'Demo Line' }).returning({ id: workCenter.id });
    }

    const [existingWf] = await tx.select({ id: workflow.id }).from(workflow).where(and(
      eq(workflow.workCenterId, wc.id),
      eq(workflow.oid, 'demo-wf-m2'),
      eq(workflow.version, '1.0.0'),
      eq(workflow.state, 'Effective'),
    ));
    if (existingWf) return;

    const [wf] = await tx.insert(workflow).values({
      oid: 'demo-wf-m2', name: 'Demo Workflow', workCenterId: wc.id,
      version: '1.0.0', state: 'Effective', specJsonb: {},
    }).returning();
    const workflowId = wf.id;

    const [review] = await tx.insert(workflowNode).values({
      workflowId, nodeOid: 'demo-n-review', name: 'Review', depth: 0,
    }).returning();
    const [approve] = await tx.insert(workflowNode).values({
      workflowId, nodeOid: 'demo-n-approve', name: 'Approve', parentNodeId: review.id, depth: 1,
    }).returning();
    await tx.insert(workflowUiStep).values([
      { workflowId, owningNodeId: review.id, stepOid: 'demo-s-review', name: 'Review order', stepType: 'USER_INTERACTION' },
      { workflowId, owningNodeId: approve.id, stepOid: 'demo-s-approve', name: 'Approve?', stepType: 'YES_NO' },
    ]);

    // Give the allowed-roles editor a real assignment to render. Inserted directly rather
    // than via addAllowedRole so the whole fixture stays in this one transaction.
    const [operator] = await tx.select({ id: role.id }).from(role).where(eq(role.name, 'Operator'));
    if (operator) {
      await tx.insert(workflowAllowedRole)
        .values({ workflowId, workflowNodeId: review.id, roleId: operator.id })
        .onConflictDoNothing();
    }
  });
}

// `npm run seed` entry point (skipped under Vitest, which imports seedDemo directly).
if (!process.env.VITEST) {
  seedDemo()
    .then((rows) => {
      console.log('Seeded demo logins:', rows);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
