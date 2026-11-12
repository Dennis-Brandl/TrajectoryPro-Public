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
//
// Fixed button row (spec 2026-11-11), Task 3: the engine remembers each screen's back target
// (EngineState.backFrom) as the cascade routes, and each screen's latest submitted form values
// (EngineState.lastFormValues).
import { expect, test, describe } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { workCenter, workflow, workflowInstance } from 'mission-control-db/src/db/schema/index';
import { submitUserAction } from '../src/core/submit.js';
import { carriedBackTarget } from '../src/core/back-target.js';
import { loadEngineState } from '../src/core/engine-state.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

async function seedQueued(db: any, spec: unknown, oid: string): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return wi;
}

async function engineState(db: any, instanceId: string): Promise<any> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row.engineState;
}

const submit = (db: any, id: string, oid: string, form_values: Record<string, unknown> = {}) =>
  submitUserAction(db, id, { step_oid: oid, action: 'submit', form_values }, 'auto', testDeps());

const script = (oid: string) => step(oid, 'SCRIPT', { script_config: { source: `output.done = '${oid}';` } });

describe('carriedBackTarget', () => {
  test.each([
    ['USER_INTERACTION', 's', undefined, 1, 's'],
    ['SCRIPT', 'x', 's', 1, 's'],
    ['SCRIPT', 'x', 's', 2, null],
    ['PARALLEL', 'p', 's', 2, null],
    ['WORKFLOW PROXY', 'w', 's', 1, null],
    ['START', 'st', undefined, 1, null],
  ] as const)('(%s, %s, %s, %d) -> %s', (type, oid, carry, count, expected) => {
    expect(carriedBackTarget(type, oid, carry, count)).toBe(expected);
  });
});

test('straight line through automated steps', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: 'wf-bt-line', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('s1', 'START'), step('A', 'USER_INTERACTION'), script('x1'), script('x2'), step('B', 'USER_INTERACTION'), step('e1', 'END')],
    connections: [
      { from_step_id: 's1', to_step_id: 'A' },
      { from_step_id: 'A', to_step_id: 'x1' },
      { from_step_id: 'x1', to_step_id: 'x2' },
      { from_step_id: 'x2', to_step_id: 'B' },
      { from_step_id: 'B', to_step_id: 'e1' },
    ],
  };
  const wi = await seedQueued(db, spec, 'wf-bt-line');
  await pumpUntilQuiet(db, testDeps());
  expect((await engineState(db, wi.id)).backFrom.A).toBeNull();
  await submit(db, wi.id, 'A');
  expect((await engineState(db, wi.id)).backFrom.B).toBe('A');
  await close();
});

const SPLIT_SPEC = {
  local_id: 'wf', oid: 'wf-bt-split', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'), step('A', 'USER_INTERACTION'), step('p1', 'PARALLEL'),
    step('B', 'USER_INTERACTION'), step('B2', 'USER_INTERACTION'), step('C', 'USER_INTERACTION'),
    step('wa', 'WAIT ALL'), step('D', 'USER_INTERACTION'), step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'A' },
    { from_step_id: 'A', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'B' },
    { from_step_id: 'p1', to_step_id: 'C' },
    { from_step_id: 'B', to_step_id: 'B2' },
    { from_step_id: 'B2', to_step_id: 'wa' },
    { from_step_id: 'C', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'D' },
    { from_step_id: 'D', to_step_id: 'e1' },
  ],
};

test('cleared at a split, kept inside a branch, cleared after a join', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, SPLIT_SPEC, 'wf-bt-split');
  await pumpUntilQuiet(db, testDeps());
  await submit(db, wi.id, 'A');
  let st = await engineState(db, wi.id);
  // cleared at a split
  expect(st.backFrom.B).toBeNull();
  expect(st.backFrom.C).toBeNull();
  // inside a branch after a split
  await submit(db, wi.id, 'B');
  st = await engineState(db, wi.id);
  expect(st.backFrom.B2).toBe('B');
  // cleared after a join
  await submit(db, wi.id, 'B2');
  await submit(db, wi.id, 'C');
  st = await engineState(db, wi.id);
  expect(st.backFrom).toHaveProperty('D');
  expect(st.backFrom.D).toBeNull();
  await close();
});

test('sub-workflow boundary', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: 'wf-bt-child', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [
      step('s1', 'START'), step('A', 'USER_INTERACTION'),
      { ...step('proxy', 'WORKFLOW PROXY'), local_id: 'ChildRef' },
      step('B', 'USER_INTERACTION'), step('e1', 'END'),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 'A' },
      { from_step_id: 'A', to_step_id: 'proxy' },
      { from_step_id: 'proxy', to_step_id: 'B' },
      { from_step_id: 'B', to_step_id: 'e1' },
    ],
    children: [{
      local_id: 'ChildRef', oid: 'child-bt', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      steps: [step('c-start', 'START'), step('C1', 'USER_INTERACTION'), step('c-end', 'END')],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'C1' },
        { from_step_id: 'C1', to_step_id: 'c-end' },
      ],
    }],
  };
  const wi = await seedQueued(db, spec, 'wf-bt-child');
  await pumpUntilQuiet(db, testDeps());
  await submit(db, wi.id, 'A');
  let st = await engineState(db, wi.id);
  expect(st.backFrom).toHaveProperty('C1');
  expect(st.backFrom.C1).toBeNull();
  await submit(db, wi.id, 'C1');
  st = await engineState(db, wi.id);
  expect(st.backFrom).toHaveProperty('B');
  expect(st.backFrom.B).toBeNull();
  await close();
});

test('loop sets the target to the most recent screen', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: 'wf-bt-loop', version: '1.0.0', last_modified_date: '2026-01-01',
    value_property_specifications: [{ name: 'Loop', entries: [{ name: 'Done', value: 'no' }] }],
    steps: [
      step('s1', 'START'), step('A', 'USER_INTERACTION'),
      step('B', 'USER_INTERACTION', {
        form_layout_config: [{
          deviceType: 'phone', canvasWidth: 390, canvasHeight: 844,
          elements: [{ type: 'textInput', x: 0, y: 0, width: 300, height: 40, fieldName: 'done', label: 'Done', outputParameter: 'Loop.Done' }],
        }],
        output_parameter_specifications: [{ id: 'Loop.Done', target: 'Loop.Done' }],
      }),
      step('sel', 'SELECT_1', {
        select1_config: {
          input_name: 'Loop.Done', input_value_type: 'property',
          options: [
            { id: 'opt-again', label: 'Again', operator: '==', value: 'no', value_type: 'literal', is_default: false },
            { id: 'opt-exit', label: 'Exit', operator: '==', value: 'yes', value_type: 'literal', is_default: false },
          ],
        },
      }),
      step('e1', 'END'),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 'A' },
      { from_step_id: 'A', to_step_id: 'B' },
      { from_step_id: 'B', to_step_id: 'sel' },
      { from_step_id: 'sel', to_step_id: 'A', connection_id: 'opt-again' },
      { from_step_id: 'sel', to_step_id: 'e1', connection_id: 'opt-exit' },
    ],
  };
  const wi = await seedQueued(db, spec, 'wf-bt-loop');
  await pumpUntilQuiet(db, testDeps());
  expect((await engineState(db, wi.id)).backFrom.A).toBeNull();
  await submit(db, wi.id, 'A');
  expect((await engineState(db, wi.id)).backFrom.B).toBe('A');
  await submit(db, wi.id, 'B', { done: 'no' });
  // A's second visit: back target is the most recent screen, B
  expect((await engineState(db, wi.id)).backFrom.A).toBe('B');
  await submit(db, wi.id, 'A');
  expect((await engineState(db, wi.id)).backFrom.B).toBe('A');
  await submit(db, wi.id, 'B', { done: 'yes' });
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(row.status).toBe('completed');
  await close();
});

test('legacy engine state without backFrom offers no Back', () => {
  const st = loadEngineState({ routingContext: {} });
  expect(st.backFrom).toEqual({});
  expect(st.lastFormValues).toEqual({});
  expect(st.backPrefill).toEqual({});
});

test('submit records lastFormValues', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: 'wf-bt-lfv', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('s1', 'START'), step('A', 'USER_INTERACTION'), step('B', 'USER_INTERACTION'), step('e1', 'END')],
    connections: [
      { from_step_id: 's1', to_step_id: 'A' },
      { from_step_id: 'A', to_step_id: 'B' },
      { from_step_id: 'B', to_step_id: 'e1' },
    ],
  };
  const wi = await seedQueued(db, spec, 'wf-bt-lfv');
  await pumpUntilQuiet(db, testDeps());
  await submit(db, wi.id, 'A', { qty: 3 });
  expect((await engineState(db, wi.id)).lastFormValues.A).toEqual({ qty: 3 });
  await close();
});

test('a second path into a live screen keeps its back target', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: 'wf-bt-merge', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [
      step('s1', 'START'), step('p1', 'PARALLEL'),
      step('B', 'USER_INTERACTION'), step('C', 'USER_INTERACTION'), step('T', 'USER_INTERACTION'),
      step('wa', 'WAIT ALL'), step('e1', 'END'),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 'p1' },
      { from_step_id: 'p1', to_step_id: 'B' },
      { from_step_id: 'p1', to_step_id: 'C' },
      { from_step_id: 'B', to_step_id: 'T' },
      { from_step_id: 'C', to_step_id: 'T' },
      { from_step_id: 'T', to_step_id: 'wa' },
      { from_step_id: 'wa', to_step_id: 'e1' },
    ],
  };
  const wi = await seedQueued(db, spec, 'wf-bt-merge');
  await pumpUntilQuiet(db, testDeps());
  await submit(db, wi.id, 'B');
  expect((await engineState(db, wi.id)).backFrom.T).toBe('B');
  await submit(db, wi.id, 'C');
  expect((await engineState(db, wi.id)).backFrom.T).toBe('B');
  await close();
});
