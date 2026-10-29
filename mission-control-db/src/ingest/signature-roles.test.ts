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
import { eq, sql } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { role, workCenter, workflow, workflowNode, workflowAllowedRole, workflowSignatureRole } from '../db/schema/index.js';
import { createRole, deleteRole } from '../dao/roles.js';
import { workCenterView } from '../dao/hierarchies.js';
import { MAX_NAME_LENGTH } from '../dao/names.js';
import { collectSignatureRoleNames, linkSignatureRoles } from './signature-roles.js';

const esig = (roleName: unknown, extra: Record<string, unknown> = {}) =>
  ({ id: 'b', type: 'esignature', fieldName: 'sig', roleName, ...extra });
const doc = (...blocks: unknown[]) => ({ version: 2, sections: [{ id: 's', rows: [{ id: 'r', blocks }] }] });
const uiStep = (oid: string, form_document: unknown) => ({ local_id: oid, oid, step_type: 'USER_INTERACTION', form_document });

test('collectSignatureRoleNames: trims, de-duplicates, skips blank/non-string names, recurses into children', () => {
  const root = {
    steps: [
      uiStep('s1', doc({ id: 'x', type: 'textInput', fieldName: 'f' }, esig('  Time Sheet Approver '))),
      uiStep('s2', doc(esig(''))),                // blank = any member: not a role
      uiStep('s3', doc(esig(undefined))),         // absent = any member
      uiStep('s4', doc(esig(42))),                // malformed: skipped, not thrown
      { local_id: 'no-form', oid: 's5', step_type: 'YES_NO' },
      null,
    ],
    children: [
      { steps: [uiStep('c1', doc(esig('Time Sheet Approver'), esig('Line Lead')))],
        children: [{ steps: [uiStep('g1', doc(esig('Auditor')))] }] },
      'garbage',
    ],
  };
  expect(collectSignatureRoleNames(root)).toEqual(['Time Sheet Approver', 'Line Lead', 'Auditor']);
  expect(collectSignatureRoleNames(null)).toEqual([]);
  expect(collectSignatureRoleNames({ steps: 'nope', children: {} })).toEqual([]);
  expect(collectSignatureRoleNames({ steps: [uiStep('s', { sections: [{ rows: 'x' }, null] })] })).toEqual([]);
});

test('linkSignatureRoles: creates missing roles by exact name, reuses existing ones, links every referenced role, and is idempotent', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
    const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
    const lead = await createRole(db, { name: 'Line Lead', description: 'kept' });
    const root = { steps: [uiStep('s1', doc(esig('Time Sheet Approver'), esig(' Line Lead ')))] };

    const first = await db.transaction((tx) => linkSignatureRoles(tx, wf.id, root));
    expect(first).toEqual({ referenced: ['Time Sheet Approver', 'Line Lead'], created: ['Time Sheet Approver'], warnings: [] });

    const roles = await db.select().from(role).orderBy(role.name);
    expect(roles.map((r) => r.name)).toEqual(['Line Lead', 'Time Sheet Approver']);
    expect(roles.find((r) => r.name === 'Line Lead')).toMatchObject({ id: lead.id, description: 'kept' }); // reused, not replaced
    const approver = roles.find((r) => r.name === 'Time Sheet Approver')!;
    expect(approver.isSystem).toBe(false);

    const links = await db.select().from(workflowSignatureRole).where(eq(workflowSignatureRole.workflowId, wf.id));
    expect(links.map((l) => l.roleId).sort()).toEqual([approver.id, lead.id].sort());

    // Second run (a re-load): nothing new, nothing duplicated.
    const second = await db.transaction((tx) => linkSignatureRoles(tx, wf.id, root));
    expect(second).toEqual({ referenced: ['Time Sheet Approver', 'Line Lead'], created: [], warnings: [] });
    expect(await db.select().from(workflowSignatureRole)).toHaveLength(2);
    expect(await db.select().from(role)).toHaveLength(2);
  } finally { await close(); }
});

test('linkSignatureRoles: a role name over the catalogue limit is reported, not created, and never fails the load', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
    const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
    const tooLong = 'x'.repeat(MAX_NAME_LENGTH + 1);
    const out = await db.transaction((tx) => linkSignatureRoles(tx, wf.id, { steps: [uiStep('s1', doc(esig(tooLong), esig('Ok')))] }));
    expect(out.referenced).toEqual(['Ok']);
    expect(out.created).toEqual(['Ok']);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/exceeds 200 characters/);
    expect(await db.select().from(role)).toHaveLength(1);
  } finally { await close(); }
});

test('work_center_role view is the union of allowed roles and e-signature roles, de-duplicated', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
    const [other] = await db.insert(workCenter).values({ name: 'Other' }).returning();
    const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
    const [node] = await db.insert(workflowNode).values({ workflowId: wf.id, nodeOid: 'w', name: 'W', depth: 0 }).returning();
    const [op] = await db.insert(role).values({ name: 'Operator' }).returning();
    const [both] = await db.insert(role).values({ name: 'Both' }).returning();
    const [signer] = await db.insert(role).values({ name: 'Signer' }).returning();
    await db.insert(workflowAllowedRole).values([
      { workflowId: wf.id, workflowNodeId: node.id, roleId: op.id },
      { workflowId: wf.id, workflowNodeId: node.id, roleId: both.id },
    ]);
    await db.insert(workflowSignatureRole).values([{ workflowId: wf.id, roleId: both.id }, { workflowId: wf.id, roleId: signer.id }]);

    const res = await db.execute<{ role_id: string }>(sql`select role_id from work_center_role where work_center_id = ${wc.id}`);
    expect(res.rows.map((r) => r.role_id).sort()).toEqual([op.id, both.id, signer.id].sort());
    const none = await db.execute<{ role_id: string }>(sql`select role_id from work_center_role where work_center_id = ${other.id}`);
    expect(none.rows).toEqual([]);

    // The Roles tab reads the view through workCenterView.
    const view = await workCenterView(db, wc.id);
    expect(view?.roles.map((r) => r.name).sort()).toEqual(['Both', 'Operator', 'Signer']);
  } finally { await close(); }
});

test('a role linked only by an e-signature block cannot be deleted (ROLE_IN_USE); deleting the workflow drops the link', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
    const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
    const signer = await createRole(db, { name: 'Signer' });
    await db.insert(workflowSignatureRole).values({ workflowId: wf.id, roleId: signer.id });
    await expect(deleteRole(db, signer.id)).rejects.toMatchObject({ code: 'ROLE_IN_USE' });

    await db.delete(workflow).where(eq(workflow.id, wf.id));
    expect(await db.select().from(workflowSignatureRole)).toEqual([]);
    await deleteRole(db, signer.id);
    expect(await db.select().from(role)).toEqual([]);
  } finally { await close(); }
});
