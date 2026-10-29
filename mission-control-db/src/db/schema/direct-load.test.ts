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
import { makeTestDb } from '../../../test/helpers/db.js';
import { runtimeCols } from '../../../test/helpers/instances.js';
import { workCenter, workflow, workflowInstance } from './index.js';

async function seedWorkCenter(db: any, name: string) {
  const [wc] = await db.insert(workCenter).values({ name }).returning();
  return wc.id as string;
}

test('one oid may repeat in a work center at different versions and states', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await seedWorkCenter(db, 'Line 1');
    const base = { oid: 'wf-1', name: 'Bottle Fill', workCenterId: wc, specJsonb: {} };
    await db.insert(workflow).values({ ...base, version: '1.0.0', state: 'Draft' });
    await db.insert(workflow).values({ ...base, version: '1.0.0', state: 'Effective' });
    await db.insert(workflow).values({ ...base, version: '2.0.0', state: 'Draft' });
    expect(await db.select().from(workflow)).toHaveLength(3);
  } finally { await close(); }
});

test('the same (work_center, oid, version, state) is rejected — this IS the no-op rule', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await seedWorkCenter(db, 'Line 1');
    const row = { oid: 'wf-1', name: 'Bottle Fill', workCenterId: wc, version: '1.0.0', state: 'Draft', specJsonb: {} };
    await db.insert(workflow).values(row);
    await expect(db.insert(workflow).values(row)).rejects.toThrow();
  } finally { await close(); }
});

test('the same oid in a DIFFERENT work center is an independent copy', async () => {
  const { db, close } = await makeTestDb();
  try {
    const a = await seedWorkCenter(db, 'Line 1');
    const b = await seedWorkCenter(db, 'Line 2');
    const row = { oid: 'wf-1', name: 'Bottle Fill', version: '1.0.0', state: 'Draft', specJsonb: {} };
    const [one] = await db.insert(workflow).values({ ...row, workCenterId: a }).returning();
    const [two] = await db.insert(workflow).values({ ...row, workCenterId: b }).returning();
    expect(one.id).not.toBe(two.id);
  } finally { await close(); }
});

test('the composite FK rejects an instance whose work center disagrees with its workflow', async () => {
  const { db, close } = await makeTestDb();
  try {
    const a = await seedWorkCenter(db, 'Line 1');
    const b = await seedWorkCenter(db, 'Line 2');
    const [wf] = await db.insert(workflow).values({
      oid: 'wf-1', name: 'Bottle Fill', workCenterId: a, specJsonb: {},
    }).returning();
    await expect(db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: b, triggeredBy: 'manual',
      ...runtimeCols(),
    })).rejects.toThrow();
  } finally { await close(); }
});

test('deleting a work center cascades its workflows', async () => {
  const { db, close } = await makeTestDb();
  try {
    const wc = await seedWorkCenter(db, 'Line 1');
    await db.insert(workflow).values({ oid: 'wf-1', name: 'WF', workCenterId: wc, specJsonb: {} });
    await db.delete(workCenter).where(eq(workCenter.id, wc));
    expect(await db.select().from(workflow)).toHaveLength(0);
  } finally { await close(); }
});
