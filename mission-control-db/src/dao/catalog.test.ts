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
import { workCenter, workflow, environmentSpec } from '../db/schema/index.js';
import { listWorkflows } from './workflows.js';
import { listEnvironmentSpecs } from './environments.js';

test('listWorkflows returns every workflow', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
  await db.insert(workflow).values({ oid: 'a', name: 'A', workCenterId: wc.id, specJsonb: {} });
  await db.insert(workflow).values({ oid: 'b', name: 'B', workCenterId: wc.id, specJsonb: {} });
  expect((await listWorkflows(db)).map((w) => w.name).sort()).toEqual(['A', 'B']);
  await close();
});

test('listEnvironmentSpecs returns every env spec', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
  await db.insert(environmentSpec).values({ oid: 'e', name: 'Env', workCenterId: wc.id, specJsonb: {} });
  expect((await listEnvironmentSpecs(db)).map((e) => e.name)).toEqual(['Env']);
  await close();
});
