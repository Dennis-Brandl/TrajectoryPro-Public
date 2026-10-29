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

import { afterEach, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import { loadCaller } from 'mission-control-db/src/runtime/remote-control/index';
import { makeTestDb } from './helpers/db.js';
import { execute } from '../src/execute.js';
import { ACTIONS } from '../src/catalog.js';
import { group } from '../src/wire.js';

const NOW = new Date('2026-10-16T12:00:00Z');
const act = (key: string) => ACTIONS.find((a) => a.key === key)!;
const out = (e: { outputs: Array<{ name: string; value: string }> }, name: string) =>
  Object.fromEntries((JSON.parse(e.outputs.find((o) => o.name === name)!.value) as Array<{ name: string; value: string }>).map((x) => [x.name, x.value]));

let close: (() => Promise<void>) | null = null;
afterEach(async () => { await close?.(); close = null; });

async function world() {
  const t = await makeTestDb(); close = t.close; const db = t.db;
  const callerSpec = { oid: 'root', steps: [{ oid: 'act', step_type: 'ACTION PROXY', action_proxy_config: { action_name: 'x' } }] };
  const childSpec = { oid: 'child', steps: [], connections: [], starting_parameter_specifications: [{ id: 'Note', default_value: '' }],
    output_parameter_specifications: [{ id: 'Echo', target: 'Echo' }] };
  const [wc] = await db.insert(workCenter).values({ name: 'Line A', nextRuntimeNumber: 2 }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'root', name: 'Caller', workCenterId: wc.id, specJsonb: callerSpec }).returning();
  await db.insert(workflow).values({ oid: 'child', name: 'Child', workCenterId: wc.id, state: 'Effective', specJsonb: childSpec });
  const [ci] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', specJsonb: callerSpec,
    runtimeNumber: 1, runtimeLabel: 'RW-1', masterName: 'Caller', masterOid: 'root', masterVersion: '1.0.0', masterState: 'Draft',
  }).returning();
  const caller = async () => {
    const [s] = await db.insert(stepInstance).values({ workflowInstanceId: ci.id, nodeOid: 'root', stepOid: 'act', stepType: 'ACTION PROXY', state: 'WAITING_ACTION', startedAt: new Date() }).returning();
    return loadCaller(db, ci.id, s.id, 'act');
  };
  return { db, caller };
}

test('create and start returns ID, Label and code 0; params read from the whole-property form', async () => {
  const { db, caller } = await world();
  const e = await execute(db, await caller(), act('createStart'), [
    { name: 'WorkCenter', value: group({ Name: '' }) },
    { name: 'Workflow', value: 'Child' },
    { name: 'StartingParameters', value: group({ Value: 'Note=hi' }) },
  ], NOW);
  expect(e.state).toBe('COMPLETED');
  if (e.state !== 'COMPLETED') return;
  expect(out(e, 'Completion')).toEqual({ Code: '0' });
  expect(out(e, 'RuntimeWorkflow')).toMatchObject({ Label: 'RW-2' });
  const id = out(e, 'RuntimeWorkflow').ID;
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, id));
  expect(row).toMatchObject({ status: 'queued', startingParams: { Note: 'hi' } });
});

test('a refusal is COMPLETED with the code and text, and blank ID/Label', async () => {
  const { db, caller } = await world();
  const e = await execute(db, await caller(), act('create'), [{ name: 'Workflow', value: 'Ghost' }], NOW);
  expect(e.state).toBe('COMPLETED');
  if (e.state !== 'COMPLETED') return;
  expect(out(e, 'Completion')).toEqual({ Code: '2' });
  expect(out(e, 'Error').Text).toMatch(/Ghost/);
  expect(out(e, 'RuntimeWorkflow')).toEqual({ ID: '', Label: '' });
});

test('status, outputs and commands', async () => {
  const { db, caller } = await world();
  const made = await execute(db, await caller(), act('create'), [{ name: 'Workflow', value: 'Child' }], NOW);
  if (made.state !== 'COMPLETED') throw new Error('expected COMPLETED');
  const id = out(made, 'RuntimeWorkflow').ID;
  const ref = [{ name: 'RuntimeWorkflow', value: id }];
  const st = await execute(db, await caller(), act('status'), ref, NOW);
  if (st.state !== 'COMPLETED') throw new Error('expected COMPLETED');
  expect(out(st, 'Runtime')).toEqual({ State: 'Created' });
  await db.update(workflowInstance).set({ propertyStore: { Echo: 'hi!' } }).where(eq(workflowInstance.id, id));
  const o = await execute(db, await caller(), act('outputs'), ref, NOW);
  if (o.state !== 'COMPLETED') throw new Error('expected COMPLETED');
  expect(JSON.parse(o.outputs.find((x) => x.name === 'Outputs')!.value)).toEqual([{ name: 'Echo', value: 'hi!' }]);
  const s = await execute(db, await caller(), act('start'), ref, NOW);
  if (s.state !== 'COMPLETED') throw new Error('expected COMPLETED');
  expect(out(s, 'Completion')).toEqual({ Code: '0' });
  const w = await execute(db, await caller(), act('wait'), ref, NOW);
  expect(w).toEqual({ state: 'RUNNING', targetInstanceId: id });
});

test('wait on an already finished or unknown runtime completes at once', async () => {
  const { db, caller } = await world();
  const made = await execute(db, await caller(), act('create'), [{ name: 'Workflow', value: 'Child' }], NOW);
  if (made.state !== 'COMPLETED') throw new Error('expected COMPLETED');
  const id = out(made, 'RuntimeWorkflow').ID;
  await db.update(workflowInstance).set({ status: 'completed' }).where(eq(workflowInstance.id, id));
  const w = await execute(db, await caller(), act('wait'), [{ name: 'RuntimeWorkflow', value: id }], NOW);
  if (w.state !== 'COMPLETED') throw new Error('expected COMPLETED');
  expect(out(w, 'Runtime')).toEqual({ State: 'Completed' });
  const u = await execute(db, await caller(), act('wait'), [{ name: 'RuntimeWorkflow', value: '99999999-9999-9999-9999-999999999999' }], NOW);
  if (u.state !== 'COMPLETED') throw new Error('expected COMPLETED');
  expect(out(u, 'Completion')).toEqual({ Code: '2' });
  expect(out(u, 'Runtime')).toEqual({ State: 'Unknown' });
});
