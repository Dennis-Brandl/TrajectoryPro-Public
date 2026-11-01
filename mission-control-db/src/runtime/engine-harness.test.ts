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
import { buildWfmasterx } from '../seed/sample-bundle.js';
import { ingestWorkflowPackage } from '../ingest/wfmasterx.js';
import { wcResource, wcValueProperty, workCenter, workflow } from '../db/schema/index.js';
import { stepInstance, instanceAssignment, traceEntry } from '../db/schema/execution.js';
import { startInstance } from './engine-harness.js';

// Designer writes Value Types into a .WFmasterX's environments/ files for its own import. Nothing
// on the runtime side reads them: the load must behave as if they were not there.
test('a package whose environment carries Value Types loads and starts, with the same registry', async () => {
  const load = async (extra: Record<string, unknown>) => {
    const { db, close } = await makeTestDb();
    try {
      const env = {
        local_id: 'Kitchen', oid: 'env-1', version: '1.0.0', state: 'Effective', included_actions: [],
        resource_property_specifications: [{ name: 'Oven', resource_type: 'binary exclusive use', scope: 'environment' }],
        value_property_specifications: [{ name: 'Temp', oid: 'p1', entries: [{ name: 'Value', value: '450' }] }],
        ...extra,
      };
      const spec = { local_id: 'Bake', oid: 'wf-1', version: '1.0.0', state: 'Effective',
        steps: [{ local_id: 'Start', oid: 's0', step_type: 'START' }, { local_id: 'Confirm', oid: 's1', step_type: 'USER_INTERACTION' }],
        connections: [], environment_specifications: [env] };
      const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
      const result = await ingestWorkflowPackage(db, buildWfmasterx(spec, [{
        libName: 'KitchenLib',
        lib: { local_id: 'KitchenLib', oid: 'envlib-1', version: '1.0.0', environment_specifications: [env] },
      }]), { workCenterId: wc.id });
      const [wf] = await db.select().from(workflow).where(eq(workflow.oid, 'wf-1'));
      const { instanceId } = await startInstance(db, { workflowId: wf.id, triggeredBy: 'manual' });
      const steps = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
      const resources = await db.select({ name: wcResource.name }).from(wcResource);
      const properties = await db.select({ name: wcValueProperty.propertyName, entry: wcValueProperty.entryName, value: wcValueProperty.value }).from(wcValueProperty);
      return { status: result.status, warnings: result.warnings, steps: steps.length, resources, properties };
    } finally { await close(); }
  };

  const plain = await load({});
  const withValueTypes = await load({
    value_type_specifications: [{ name: 'Order', oid: 'vt-1', entries: [{ name: 'Size', value: 'Large' }] }],
  });
  expect(plain.status).toBe('loaded');
  expect(plain.resources).toEqual([{ name: 'Oven' }]);
  expect(plain.properties).toEqual([{ name: 'Temp', entry: 'Value', value: '450' }]);
  expect(withValueTypes).toEqual(plain);
});

// Assignment rows are no longer created by startInstance in the new suggest-only dispatch
// model (spec 2026-08-03 F6) — the reconcile mechanism (Task 4/5) is the sole writer of
// instance_assignment, and it runs independently of instance start. This test used to also
// assert a hard-assigned operator; that purpose collapsed with dispatchStep's removal, so it
// now just proves startInstance materializes runtime rows and creates NO assignment rows.
test('startInstance materializes step and trace rows, and creates no instance_assignment rows', async () => {
  const { db, close } = await makeTestDb();
  const spec = { local_id: 'Bake', oid: 'wf-1', version: '1.0.0', state: 'Effective',
    steps: [{ local_id: 'Start', oid: 's0', step_type: 'START' }, { local_id: 'Confirm', oid: 's1', step_type: 'USER_INTERACTION' }], connections: [], children: [] };
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await ingestWorkflowPackage(db, buildWfmasterx(spec), { workCenterId: wc.id });
  const [wf] = await db.select().from(workflow).where(eq(workflow.oid, 'wf-1'));

  const { instanceId } = await startInstance(db, { workflowId: wf.id, triggeredBy: 'manual' });
  expect((await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId)))).toHaveLength(2);
  expect((await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId))).length).toBeGreaterThan(0);
  expect(await db.select().from(instanceAssignment)).toHaveLength(0);
  await close();
});
