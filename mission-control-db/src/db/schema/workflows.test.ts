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
import { makeTestDb } from '../../../test/helpers/db.js';
import { workflow, workflowNode, workflowUiStep } from './workflows.js';
import { workCenter } from './work-centers.js';

// M6: oid alone is no longer unique (spec D1) — one oid may repeat in a work center at
// different versions AND different states (covered separately in direct-load.test.ts).
// What's still unique is the exact (work_center, oid, version, state) entry.
test('the (work_center, oid, version, state) entry is unique; nodes/ui-steps hang off a workflow', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
  const [wf] = await db.insert(workflow).values({
    oid: 'wf-oid-1', name: 'Bake', workCenterId: wc.id, version: '1.0.0', state: 'Effective', specJsonb: { steps: [] },
  }).returning();
  const [root] = await db.insert(workflowNode).values({
    workflowId: wf.id, nodeOid: 'wf-oid-1', name: 'Bake', depth: 0,
  }).returning();
  await db.insert(workflowUiStep).values({
    workflowId: wf.id, owningNodeId: root.id, stepOid: 's1', name: 'Confirm', stepType: 'USER_INTERACTION',
  });
  await expect(db.insert(workflow).values({
    oid: 'wf-oid-1', name: 'Dup', workCenterId: wc.id, version: '1.0.0', state: 'Effective', specJsonb: {},
  })).rejects.toThrow();
  await close();
});

test('workflow carries nullable Designer provenance columns that default to null', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'ProvLib' }).returning();
  const [row] = await db.insert(workflow).values({
    oid: 'prov-1', name: 'Prov', workCenterId: wc.id, specJsonb: {},
  }).returning();
  // Absent in the package → absent in the row. Never defaulted to a string.
  expect(row.sourceLibraryName).toBeNull();
  expect(row.sourceLibraryOid).toBeNull();

  const [withProv] = await db.insert(workflow).values({
    oid: 'prov-2', name: 'Prov2', workCenterId: wc.id, specJsonb: {},
    sourceLibraryName: 'First Back Office Library',
    sourceLibraryOid: 'd21dc150-6763-4abe-8f15-548946b47ec1',
  }).returning();
  expect(withProv.sourceLibraryName).toBe('First Back Office Library');
  expect(withProv.sourceLibraryOid).toBe('d21dc150-6763-4abe-8f15-548946b47ec1');
  await close();
});
