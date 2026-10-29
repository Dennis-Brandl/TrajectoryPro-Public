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
import { brokerActionInstance } from './index.js';

test('broker_action_instance: defaults, state check', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [row] = await db.insert(brokerActionInstance).values({
      actionKey: 'wait', workflowInstanceId: '11111111-1111-1111-1111-111111111111',
      stepInstanceId: '22222222-2222-2222-2222-222222222222',
    }).returning();
    expect(row).toMatchObject({ state: 'RUNNING', outputs: [] });
    await expect(db.insert(brokerActionInstance).values({
      actionKey: 'wait', workflowInstanceId: row.workflowInstanceId, stepInstanceId: row.stepInstanceId, state: 'PAUSED',
    })).rejects.toThrow();
  } finally { await close(); }
});

test('broker_action_instance: one row per step activation; rows without an activation are not limited', async () => {
  const { db, close } = await makeTestDb();
  try {
    const base = { actionKey: 'create', workflowInstanceId: '11111111-1111-1111-1111-111111111111', stepInstanceId: '22222222-2222-2222-2222-222222222222' };
    const at = new Date('2026-10-23T10:00:00.123Z');
    const [row] = await db.insert(brokerActionInstance).values({ ...base, stepStartedAt: at }).returning();
    expect(row.stepStartedAt?.toISOString()).toBe(at.toISOString());
    await expect(db.insert(brokerActionInstance).values({ ...base, stepStartedAt: at })).rejects.toThrow();
    await db.insert(brokerActionInstance).values({ ...base, stepStartedAt: new Date('2026-10-23T10:05:00Z') });
    await db.insert(brokerActionInstance).values(base);
    await db.insert(brokerActionInstance).values(base);
    expect(await db.select().from(brokerActionInstance)).toHaveLength(4);
  } finally { await close(); }
});
