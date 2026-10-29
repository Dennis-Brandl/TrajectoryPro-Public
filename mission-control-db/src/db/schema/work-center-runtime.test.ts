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
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from '../../../test/helpers/db.js';
import { runtimeCols } from '../../../test/helpers/instances.js';
import {
  workCenter, environmentSpec, workflow, workflowInstance,
  wcResource, wcResourceWaiter, wcResourceHolder, wcValueProperty,
} from './index.js';

async function seed(db: any) {
  const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
  const [env] = await db.insert(environmentSpec).values({
    oid: 'env-1', name: 'DemoLine', workCenterId: wc.id, specJsonb: {},
  }).returning();
  return { wc, env };
}

test('wc_resource is keyed on (work_center_id, name) and records provenance', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, env } = await seed(db);
    await db.insert(wcResource).values({
      workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use',
      definedByEnvSpecId: env.id, definedFromVersion: '1.0.0', definedFromState: 'Effective',
    });
    const [row] = await db.select().from(wcResource);
    expect(row.inUse).toBe(0);
    expect(row.poolNames).toEqual([]);
    expect(row.availableNames).toEqual([]);
    expect(row.definedFromState).toBe('Effective');

    // Same name in the SAME work center is one pool — the PK rejects a second row.
    await expect(db.insert(wcResource).values({
      workCenterId: wc.id, name: 'Printer', resourceType: 'named pool',
    })).rejects.toThrow();

    // The same name in a DIFFERENT work center is a different pool.
    const [wc2] = await db.insert(workCenter).values({ name: 'Line 2' }).returning();
    await db.insert(wcResource).values({
      workCenterId: wc2.id, name: 'Printer', resourceType: 'binary exclusive use',
    });
    expect(await db.select().from(wcResource)).toHaveLength(2);
  } finally { await close(); }
});

test('wc_resource rejects an unknown resource_type', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc } = await seed(db);
    await expect(db.insert(wcResource).values({
      workCenterId: wc.id, name: 'Printer', resourceType: 'teleporter',
    })).rejects.toThrow();
  } finally { await close(); }
});

test('deleting the declaring env spec orphans the resource rather than removing it', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, env } = await seed(db);
    await db.insert(wcResource).values({
      workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use',
      definedByEnvSpecId: env.id, definedFromVersion: '1.0.0', definedFromState: 'Effective',
    });
    await db.delete(environmentSpec).where(eq(environmentSpec.id, env.id));
    const [row] = await db.select().from(wcResource);
    expect(row).toBeDefined();
    expect(row.definedByEnvSpecId).toBeNull();
    // Provenance text survives so the pane can still say what defined it.
    expect(row.definedFromVersion).toBe('1.0.0');
  } finally { await close(); }
});

test('deleting the work center cascades the whole registry away', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc } = await seed(db);
    await db.insert(wcResource).values({
      workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use',
    });
    await db.insert(wcValueProperty).values({
      workCenterId: wc.id, propertyName: 'Recipe', entryName: 'Target', value: '80',
    });
    await db.delete(workCenter).where(eq(workCenter.id, wc.id));
    expect(await db.select().from(wcResource)).toHaveLength(0);
    expect(await db.select().from(wcValueProperty)).toHaveLength(0);
  } finally { await close(); }
});

test('waiters and holders hang off a resource and off an instance, and cascade from both', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc } = await seed(db);
    const [wf] = await db.insert(workflow).values({
      oid: 'wf-1', name: 'Fill', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [inst] = await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', ...runtimeCols(),
    }).returning();
    await db.insert(wcResource).values({
      workCenterId: wc.id, name: 'Printer', resourceType: 'countable use with pool limits', useLimit: 5,
    });

    await db.insert(wcResourceWaiter).values({
      workCenterId: wc.id, name: 'Printer', instanceId: inst.id, stepOid: 'step-1',
      kind: 'acquire', amount: 2,
    });
    await db.insert(wcResourceHolder).values({
      workCenterId: wc.id, name: 'Printer', instanceId: inst.id, stepOid: 'step-2', amount: 3,
    });
    const [waiter] = await db.select().from(wcResourceWaiter);
    expect(waiter.granted).toBe(false);
    expect(typeof waiter.id).toBe('number');

    // A waiter kind outside the vocabulary is rejected.
    await expect(db.insert(wcResourceWaiter).values({
      workCenterId: wc.id, name: 'Printer', instanceId: inst.id, stepOid: 'x', kind: 'teleport',
    })).rejects.toThrow();

    // Deleting the instance clears both ledgers for it.
    await db.delete(workflowInstance).where(eq(workflowInstance.id, inst.id));
    expect(await db.select().from(wcResourceWaiter)).toHaveLength(0);
    expect(await db.select().from(wcResourceHolder)).toHaveLength(0);
  } finally { await close(); }
});

test('wc_value_property is keyed on (work_center_id, property_name, entry_name)', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, env } = await seed(db);
    await db.insert(wcValueProperty).values([
      { workCenterId: wc.id, propertyName: 'Recipe', entryName: 'Target', value: '80', definedByEnvSpecId: env.id },
      { workCenterId: wc.id, propertyName: 'Recipe', entryName: 'Tolerance', value: '2', definedByEnvSpecId: env.id },
    ]);
    expect(await db.select().from(wcValueProperty)).toHaveLength(2);
    await expect(db.insert(wcValueProperty).values({
      workCenterId: wc.id, propertyName: 'Recipe', entryName: 'Target', value: '90',
    })).rejects.toThrow();
    const [row] = await db.select().from(wcValueProperty)
      .where(and(eq(wcValueProperty.propertyName, 'Recipe'), eq(wcValueProperty.entryName, 'Target')));
    expect(row.value).toBe('80');
  } finally { await close(); }
});
