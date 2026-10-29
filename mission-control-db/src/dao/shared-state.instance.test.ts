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
import { runtimeCols } from '../../test/helpers/instances.js';
import {
  workCenter, workflow, workflowInstance, wcResource, wcResourceHolder, wcResourceWaiter, wcValueProperty,
} from '../db/schema/index.js';
import { listInstanceResources, listInstanceValueProperties, childNameFromSpec } from './shared-state.js';

const SPEC = {
  oid: 'wf-1', steps: [{ oid: 's-mix', local_id: 'Mix Step' }, { oid: 's-pack', local_id: 'Pack' }], connections: [],
  children: [{ oid: 'wf-1-c1', local_id: 'Sub', steps: [{ oid: 's-child', local_id: 'Child Step' }], connections: [] }],
};

// Mirrors SerializedResources (engine resources.ts) as it lands in engine_state.resources.
const ENGINE_RESOURCES = {
  resources: [
    ['wf-1:Lock', { type: 'binary exclusive use', inUse: 1, queue: ['s-pack'], ownerId: 'wf-1', scope: 'workflow', resourceKey: 'wf-1:Lock' }],
    ['wf-1:Slots', { type: 'countable use with pool limits', inUse: 2, useLimit: 5, queue: [{ stepOid: 's-child', amount: 4 }], ownerId: 'wf-1', scope: 'workflow', resourceKey: 'wf-1:Slots' }],
    ['wf-1:Bays', { type: 'named pool', available: ['B'], originalNames: ['A', 'B'], queue: [], ownerId: 'wf-1', scope: 'workflow', resourceKey: 'wf-1:Bays' }],
    ['wf-1:Chan', { type: 'sync', sendQueue: [{ stepOid: 's-mix', data: 'hi' }], receiveQueue: [], pendingSync: [], ownerId: 'wf-1', scope: 'workflow', resourceKey: 'wf-1:Chan' }],
    // A pre-cutover environment entry (spec §5.7): the registry owns it, so it is NOT listed here.
    ['env-1:Legacy', { type: 'binary exclusive use', inUse: 1, queue: [], ownerId: 'env-1', scope: 'environment', resourceKey: 'env-1:Legacy' }],
  ],
  pendingGrants: [], syncMatchedData: [], pendingNamedAssignments: [],
};

async function seed(db: any, engineState: unknown, propertyStore: unknown) {
  const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'wf-1', name: 'Fill', workCenterId: wc.id, specJsonb: SPEC }).returning();
  const [inst] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', engineState, propertyStore,
    ...runtimeCols({ specJsonb: SPEC, runtimeNumber: 12, masterName: 'Fill' }),
  }).returning();
  return { wc, wf, inst };
}

test('projects workflow-scoped resources out of engine_state and lists the env resources this instance touches', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, inst } = await seed(db, { resources: ENGINE_RESOURCES, childProperties: {} }, null);
    await db.insert(wcResource).values([
      { workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use', inUse: 1 },
      { workCenterId: wc.id, name: 'Oven', resourceType: 'binary exclusive use', inUse: 1 },
      { workCenterId: wc.id, name: 'Untouched', resourceType: 'sync' },
    ]);
    await db.insert(wcResourceHolder).values({ workCenterId: wc.id, name: 'Printer', instanceId: inst.id, stepOid: 's-mix', amount: 1 });
    await db.insert(wcResourceWaiter).values({ workCenterId: wc.id, name: 'Oven', instanceId: inst.id, stepOid: 's-pack', kind: 'acquire' });

    const view = (await listInstanceResources(db, inst.id))!;
    expect(view).toMatchObject({ instanceId: inst.id, runtimeNumber: 12, masterName: 'Fill' });
    expect(view.workflow.map((r) => r.name)).toEqual(['Bays', 'Chan', 'Lock', 'Slots']); // ordered; Legacy skipped
    const byName = Object.fromEntries(view.workflow.map((r) => [r.name, r]));
    expect(byName.Lock.summary.state).toBe('In use');
    expect(byName.Lock.queuedSteps).toEqual([{ stepOid: 's-pack', stepName: 'Pack', kind: 'acquire' }]);
    expect(byName.Slots.summary.state).toBe('2/5 in use');
    expect(byName.Slots.queuedSteps[0]).toMatchObject({ stepOid: 's-child', stepName: 'Child Step' });
    expect(byName.Bays.summary.state).toBe('1 available, 1 in use');
    expect(byName.Chan.summary.state).toBe('send:1 recv:0 sync:0');
    expect(byName.Chan.queuedSteps).toEqual([{ stepOid: 's-mix', stepName: 'Mix Step', kind: 'send' }]);
    expect(byName.Lock.ownerOid).toBe('wf-1');
    expect(view.environment.map((r) => r.name)).toEqual(['Oven', 'Printer']);
    expect(view.environment[1].holders[0]).toMatchObject({ runtimeNumber: 12, stepName: 'Mix Step' });
  } finally { await close(); }
});

test('an instance with no engine_state, no property_store and no registry rows renders empty, not undefined', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { inst } = await seed(db, null, null);
    expect(await listInstanceResources(db, inst.id)).toMatchObject({ workflow: [], environment: [] });
    expect(await listInstanceValueProperties(db, inst.id)).toMatchObject({ root: {}, children: [], shared: [] });
    expect(await listInstanceResources(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined();
    expect(await listInstanceValueProperties(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined();
  } finally { await close(); }
});

test('value properties: the root store, each child store named from the recipe, and the shared registry', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, inst } = await seed(db,
      { childProperties: { 'wf-1-c1': { 'Sub.X': '1' }, 'unknown-child': { 'Q.E': 'v' } } },
      { 'Batch.Size': '5', 'Batch.Description': 'note' });
    await db.insert(wcValueProperty).values({ workCenterId: wc.id, propertyName: 'Env', entryName: 'Temp', value: '70' });
    const view = (await listInstanceValueProperties(db, inst.id))!;
    expect(view.root).toEqual({ 'Batch.Size': '5', 'Batch.Description': 'note' });
    expect(view.children).toEqual([
      { childOid: 'wf-1-c1', childName: 'Sub', values: { 'Sub.X': '1' } },
      { childOid: 'unknown-child', childName: null, values: { 'Q.E': 'v' } },
    ]);
    expect(view.shared.map((v) => `${v.propertyName}.${v.entryName}=${v.value}`)).toEqual(['Env.Temp=70']);
  } finally { await close(); }
});

test('childNameFromSpec walks nested children', () => {
  const spec = { children: [{ oid: 'c1', local_id: 'One', children: [{ oid: 'c2', local_id: 'Two' }] }] };
  expect(childNameFromSpec(spec, 'c2')).toBe('Two');
  expect(childNameFromSpec(spec, 'c9')).toBeNull();
  expect(childNameFromSpec(null, 'c1')).toBeNull();
});
