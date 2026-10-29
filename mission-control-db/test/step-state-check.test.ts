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

// Repeating SCRIPT (spec 2026-10-13 §6.5): migration 0038 lets a step park WAITING_SCRIPT.
import { describe, it, expect } from 'vitest';
import { makeTestDb } from './helpers/db.js';
import { runtimeCols } from './helpers/instances.js';
import { workCenter, workflow, workflowInstance, stepInstance, ENGINE_STEP_STATES } from '../src/db/schema/index.js';

describe('step_instance_state_ck (migration 0038)', () => {
  it('accepts WAITING_SCRIPT and still rejects an unknown state', async () => {
    const { db, close } = await makeTestDb();
    const [wc] = await db.insert(workCenter).values({ name: `WC-${Math.random()}` }).returning();
    const [wf] = await db.insert(workflow).values({ oid: `w-${Math.random()}`, name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
    const [inst] = await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', ...runtimeCols({ specJsonb: {} }),
    }).returning();
    const row = { workflowInstanceId: inst.id, nodeOid: 'n', stepOid: 'sc', stepType: 'SCRIPT' };
    await expect(db.insert(stepInstance).values({ ...row, state: 'WAITING_SCRIPT' })).resolves.toBeDefined();
    await expect(db.insert(stepInstance).values({ ...row, stepOid: 'x', state: 'NOT_A_STATE' as never })).rejects.toThrow();
    expect(ENGINE_STEP_STATES).toContain('WAITING_SCRIPT');
    await close();
  });
});
