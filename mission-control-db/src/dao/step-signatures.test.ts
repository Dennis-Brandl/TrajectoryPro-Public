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
import { appUser, role, stepSignature, workCenter } from '../db/schema/index.js';
import { createUser } from './users.js';
import { createRole } from './roles.js';
import { insertStepSignature, listStepSignatures, deleteStepSignaturesForInstances } from './step-signatures.js';

const INSTANCE_A = '11111111-1111-4111-8111-111111111111';
const INSTANCE_B = '22222222-2222-4222-8222-222222222222';

async function fixture(db: any) {
  const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
  const signer = await createUser(db, { email: 'jane@x.io', displayName: 'Jane Lee', loginName: 'jane' });
  const operator = await createUser(db, { email: 'bob@x.io', displayName: 'Bob Op', loginName: 'bob' });
  const qa = await createRole(db, { name: 'QA Lead' });
  return { wc, signer, operator, qa };
}

function row(f: Awaited<ReturnType<typeof fixture>>, instanceId: string, over: Partial<Parameters<typeof insertStepSignature>[1]> = {}) {
  return {
    workflowInstanceId: instanceId, runtimeNumber: 7, runtimeLabel: 'RW-7', workCenterId: f.wc.id, workCenterName: f.wc.name,
    stepInstanceId: null, stepOid: 's-1', stepName: 'Approve batch',
    signerUserId: f.signer.id, signerLoginName: 'jane', signerDisplayName: 'Jane Lee',
    roleId: f.qa.id, roleName: 'QA Lead', operatorUserId: f.operator.id, operatorLoginName: 'bob',
    meaning: 'I approve', decision: 'yes', outcome: 'signed' as const, failureCode: null, ...over,
  };
}

test('insert + list: rows come back oldest first as the view shape; a soft-linked instance id needs no instance row', async () => {
  const { db, close } = await makeTestDb();
  const f = await fixture(db);
  const first = await insertStepSignature(db, row(f, INSTANCE_A, { signedAt: new Date('2026-09-07T10:00:00Z') }));
  const second = await insertStepSignature(db, row(f, INSTANCE_A, {
    outcome: 'failed', failureCode: 'SIGNATURE_INVALID_CREDENTIALS', signerUserId: null, signerDisplayName: null,
    signerLoginName: 'nobody', roleId: null, roleName: null, decision: null, signedAt: new Date('2026-09-07T10:01:00Z'),
  }));
  await insertStepSignature(db, row(f, INSTANCE_B));
  expect(first.id).toBeTruthy();
  const list = await listStepSignatures(db, INSTANCE_A);
  expect(list.map((s) => s.id)).toEqual([first.id, second.id]);
  expect(list[0]).toEqual({
    id: first.id, stepOid: 's-1', stepName: 'Approve batch', signerLoginName: 'jane', signerDisplayName: 'Jane Lee',
    roleName: 'QA Lead', meaning: 'I approve', decision: 'yes', outcome: 'signed', failureCode: null, signedAt: new Date('2026-09-07T10:00:00Z'),
  });
  expect(list[1]).toMatchObject({ outcome: 'failed', failureCode: 'SIGNATURE_INVALID_CREDENTIALS', signerDisplayName: null, roleName: null });
  expect(await listStepSignatures(db, '33333333-3333-4333-8333-333333333333')).toEqual([]);
  await close();
});

test('outcome is CHECKed; deleting the signer, role or work center nulls the link and keeps the row', async () => {
  const { db, close } = await makeTestDb();
  const f = await fixture(db);
  await expect(insertStepSignature(db, row(f, INSTANCE_A, { outcome: 'maybe' as never }))).rejects.toMatchObject({ cause: { code: '23514' } });
  const kept = await insertStepSignature(db, row(f, INSTANCE_A));
  await db.delete(appUser).where(eq(appUser.id, f.signer.id));
  await db.delete(role).where(eq(role.id, f.qa.id));
  await db.delete(workCenter).where(eq(workCenter.id, f.wc.id));
  const [after] = await db.select().from(stepSignature).where(eq(stepSignature.id, kept.id));
  expect(after).toMatchObject({ signerUserId: null, signerLoginName: 'jane', signerDisplayName: 'Jane Lee', roleId: null, roleName: 'QA Lead', workCenterId: null, workCenterName: 'Line 1' });
  await close();
});

test('deleteStepSignaturesForInstances removes only the named instances and reports the count', async () => {
  const { db, close } = await makeTestDb();
  const f = await fixture(db);
  await insertStepSignature(db, row(f, INSTANCE_A));
  await insertStepSignature(db, row(f, INSTANCE_A));
  await insertStepSignature(db, row(f, INSTANCE_B));
  expect(await deleteStepSignaturesForInstances(db, [])).toBe(0);
  expect(await deleteStepSignaturesForInstances(db, [INSTANCE_A])).toBe(2);
  expect((await listStepSignatures(db, INSTANCE_B)).length).toBe(1);
  await close();
});
