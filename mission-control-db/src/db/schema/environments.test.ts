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
import { workCenter } from './work-centers.js';
import { workflow } from './workflows.js';
import { environmentSpec, workflowEnvironment } from './environments.js';

// M6: oid alone is no longer unique (spec D1) — the (work_center, oid, version, state) entry
// is. Both inserts below take default version/state, so the duplicate DOES collide.
test('the (work_center, oid, version, state) entry is unique; workflow_environment links with source check', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w1', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
  const [env] = await db.insert(environmentSpec).values({ oid: 'e1', name: 'Kitchen', workCenterId: wc.id, specJsonb: {} }).returning();
  await db.insert(workflowEnvironment).values({ workflowId: wf.id, environmentSpecId: env.id, source: 'download' });
  await expect(db.insert(environmentSpec).values({ oid: 'e1', name: 'Dup', workCenterId: wc.id, specJsonb: {} })).rejects.toThrow();
  await expect(
    db.insert(workflowEnvironment).values({ workflowId: wf.id, environmentSpecId: env.id, source: 'bogus' as any }),
  ).rejects.toThrow();
  await close();
});

test('environment_spec carries the same nullable provenance columns', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
  const [row] = await db.insert(environmentSpec).values({
    oid: 'prov-env-1', name: 'ProvEnv', workCenterId: wc.id, specJsonb: {},
    sourceLibraryName: 'First Environment Library',
    sourceLibraryOid: '68d51585-9f25-4c10-91f3-b14d00b5f472',
  }).returning();
  expect(row.sourceLibraryName).toBe('First Environment Library');
  expect(row.sourceLibraryOid).toBe('68d51585-9f25-4c10-91f3-b14d00b5f472');
  await close();
});
