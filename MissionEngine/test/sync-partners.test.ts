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
// Spec 2026-11-27: a Synchronize waits for N partners (`partners`, or `partners_property` read when
// the step first reaches the SYNC; omitted = 2). A bad count, or a count that differs from the
// group already waiting, fails the step before it joins the queue.
import { expect, test, describe } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { submitUserAction } from '../src/core/submit.js';
import { validate } from '../src/spec/validator.js';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});
const CHAN = { name: 'Chan', resource_type: 'sync' };
const orderCount = (value: string) => [{ name: 'Order', entries: [{ name: 'Count', value }] }];
const sync = (oid: string, fields: Record<string, unknown>) =>
  step(oid, 'MATH', { resource_command_specifications: [{ command_type: 'Synchronize', resource_name: 'Chan', ...fields }] });

async function seed(db: AnyDb, spec: { oid: string }) {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return wi as { id: string };
}
async function instanceRow(db: AnyDb, id: string) {
  return (await db.select().from(workflowInstance).where(eq(workflowInstance.id, id)))[0];
}
async function stepRow(db: AnyDb, id: string, stepOid: string) {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, id));
  return rows.find((r: { stepOid: string }) => r.stepOid === stepOid);
}
async function errorsOf(db: AnyDb, id: string): Promise<(string | null)[]> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, id));
  return rows.filter((t: { state: string }) => t.state === 'ERRORED').map((t: { error: string | null }) => t.error);
}
const blockedOn = async (db: AnyDb, id: string) =>
  Object.keys(((await instanceRow(db, id)).engineState as { blockedOnResources: Record<string, unknown> }).blockedOnResources).sort();

type Fields = Record<string, unknown>;
/** b1 and b2 reach the SYNC at once; b3 only after the user submits gate g3. */
const threeBranches = (oid: string, fields: [Fields, Fields, Fields], props?: unknown) => ({
  local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
  ...(props ? { value_property_specifications: props } : {}),
  resource_property_specifications: [CHAN],
  steps: [
    step('s1', 'START'), step('p1', 'PARALLEL'),
    sync('b1', fields[0]), sync('b2', fields[1]), step('g3', 'USER_INTERACTION'), sync('b3', fields[2]),
    step('wa', 'WAIT ALL'), step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'b1' }, { from_step_id: 'p1', to_step_id: 'b2' }, { from_step_id: 'p1', to_step_id: 'g3' },
    { from_step_id: 'g3', to_step_id: 'b3' },
    { from_step_id: 'b1', to_step_id: 'wa' }, { from_step_id: 'b2', to_step_id: 'wa' }, { from_step_id: 'b3', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
});

describe('validator: Synchronize partners', () => {
  const specWith = (cmd: Fields) => ({
    local_id: 'wf', oid: 'wf-val', version: '1.0.0', last_modified_date: '2026-01-01',
    resource_property_specifications: [CHAN],
    steps: [step('s1', 'START'), sync('m', cmd), step('e1', 'END')],
    connections: [{ from_step_id: 's1', to_step_id: 'm' }, { from_step_id: 'm', to_step_id: 'e1' }],
  });
  test.each([1, 2.5, 0, '3', 'abc'])('partners %j is rejected', (partners) => {
    expect(validate(specWith({ partners }))).toMatchObject({
      valid: false, error_code: 'INVALID_RESOURCE_COMMAND', error_message: 'Synchronize partners must be a whole number of at least 2',
    });
  });
  test('partners 3 and partners omitted are accepted', () => {
    expect(validate(specWith({ partners: 3 }))).toMatchObject({ valid: true });
    expect(validate(specWith({}))).toMatchObject({ valid: true });
  });
  test('partners_property must be a non-empty key', () => {
    expect(validate(specWith({ partners_property: ' ' }))).toMatchObject({
      valid: false, error_code: 'INVALID_RESOURCE_COMMAND', error_message: 'Synchronize partners_property must be a non-empty property key',
    });
    expect(validate(specWith({ partners_property: 'Order.Count' }))).toMatchObject({ valid: true });
  });
});

test('three branches with partners 3: none moves on until the third arrives', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seed(db, threeBranches('wf-sp-3', [{ partners: 3 }, { partners: 3 }, { partners: 3 }]));
  await pumpUntilQuiet(db, testDeps());
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  expect(await blockedOn(db, wi.id)).toEqual(['b1', 'b2']);
  await submitUserAction(db, wi.id, { step_oid: 'g3', action: 'submit' }, 0, testDeps());
  await pumpUntilQuiet(db, testDeps());
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  await close();
});

test('partners_property reads the count from a property', async () => {
  const { db, close } = await makeTestDb();
  const p = { partners_property: 'Order.Count' };
  const wi = await seed(db, threeBranches('wf-sp-prop', [p, p, p], orderCount(' 3 ')));
  await pumpUntilQuiet(db, testDeps());
  expect(await blockedOn(db, wi.id)).toEqual(['b1', 'b2']);
  await submitUserAction(db, wi.id, { step_oid: 'g3', action: 'submit' }, 0, testDeps());
  await pumpUntilQuiet(db, testDeps());
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  await close();
});

test.each(['1', '2.0', ''])('a bad partner count %j fails the step with the partner-count message', async (value) => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: `wf-sp-bad-${Math.random().toString(36).slice(2, 8)}`, version: '1.0.0', last_modified_date: '2026-01-01',
    value_property_specifications: orderCount(value),
    resource_property_specifications: [CHAN],
    steps: [step('s1', 'START'), sync('m', { partners_property: 'Order.Count' }), step('e1', 'END')],
    connections: [{ from_step_id: 's1', to_step_id: 'm' }, { from_step_id: 'm', to_step_id: 'e1' }],
  };
  const wi = await seed(db, spec);
  await pumpUntilQuiet(db, testDeps());
  const message = `Synchronize on "Chan" could not use "${value}" from Order.Count as a partner count: it must be a whole number of at least 2`;
  expect((await instanceRow(db, wi.id)).status).toBe('errored');
  expect(await stepRow(db, wi.id, 'm')).toMatchObject({ state: 'ERRORED', error: message });
  await close();
});

test('two branches with partners 3 and 2: the later one fails with the mismatch message', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seed(db, threeBranches('wf-sp-mismatch', [{ partners: 3 }, { partners: 3 }, { partners: 2 }]));
  await pumpUntilQuiet(db, testDeps());
  expect(await blockedOn(db, wi.id)).toEqual(['b1', 'b2']);
  await submitUserAction(db, wi.id, { step_oid: 'g3', action: 'submit' }, 0, testDeps());
  await pumpUntilQuiet(db, testDeps());
  const message = 'Sync "Chan" is waiting for 3 partners; this step expects 2';
  expect(await stepRow(db, wi.id, 'b3')).toMatchObject({ state: 'ERRORED', error: message });
  expect(await errorsOf(db, wi.id)).toContain(message);
  await close();
});
