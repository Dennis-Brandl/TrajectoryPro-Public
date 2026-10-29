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
// Auto-claim chains (spec 2026-08-14): integration proof that the reconcile-side chain logic
// (mission-control-db/src/runtime/assignments.ts) fires through the engine's own submit
// transaction — the operator who claimed the previous step in a scope receives the next one
// pre-claimed — and that a child workflow starts its OWN scope (its first UI step is offered
// normally, so a different role can pick it up). Harness reused from offers.test.ts /
// child-workflows.test.ts.
import { expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  appUser, workCenter, workCenterUser, workflow, workflowInstance, stepInstance,
  instanceAssignment, operatorPresence,
} from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { submitUserAction } from '../src/core/submit.js';

function step(localId: string, oid: string, stepType: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { local_id: localId, oid, step_type: stepType, version: '1.0.0', last_modified_date: '2026-01-01', ...extra };
}

const TWO_UI_SPEC = {
  local_id: 'wf', oid: 'wf-chain', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('start', 'start', 'START'),
    step('ui-1', 'ui-1', 'USER_INTERACTION'),
    step('ui-2', 'ui-2', 'USER_INTERACTION'),
    step('end', 'end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'ui-1' },
    { from_step_id: 'ui-1', to_step_id: 'ui-2' },
    { from_step_id: 'ui-2', to_step_id: 'end' },
  ],
};

// Parent UI step, then a WORKFLOW proxy whose child holds its own UI step.
const CHILD_UI_SPEC = {
  local_id: 'wf', oid: 'wf-chain-child', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('p-start', 'p-start', 'START'),
    step('ui-p', 'ui-p', 'USER_INTERACTION'),
    step('ChildRef', 'proxy', 'WORKFLOW PROXY'),
    step('p-end', 'p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'ui-p' },
    { from_step_id: 'ui-p', to_step_id: 'proxy' },
    { from_step_id: 'proxy', to_step_id: 'p-end' },
  ],
  children: [
    {
      local_id: 'ChildRef', oid: 'child-review', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      steps: [
        step('c-start', 'c-start', 'START'),
        step('c-ui', 'c-ui', 'USER_INTERACTION'),
        step('c-end', 'c-end', 'END'),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-ui' },
        { from_step_id: 'c-ui', to_step_id: 'c-end' },
      ],
    },
  ],
};

async function seedQueued(db: any, spec: unknown, oid: string): Promise<{ id: string; workCenterId: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, autoClaim: true }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id };
}

async function seedOnlineOperator(db: any, workCenterId: string): Promise<{ id: string }> {
  const [user] = await db.insert(appUser).values({ email: `op-${Math.random()}@t.test`, displayName: 'Op' }).returning();
  await db.insert(workCenterUser).values({ workCenterId, userId: user.id, priority: 0 });
  await db.insert(operatorPresence).values({
    userId: user.id, attendingWorkCenterId: workCenterId, sessionId: `sess-${Math.random()}`, status: 'online',
  });
  return user;
}

async function assignmentForStep(db: any, instanceId: string, stepOid: string): Promise<any> {
  const rows = await db.select({
    a: instanceAssignment, stepOid: stepInstance.stepOid,
  }).from(instanceAssignment)
    .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
    .where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === stepOid)?.a;
}

/** The claim route's CAS, minus HTTP (api/app.ts:225-233). */
async function claimAs(db: any, assignmentId: string, userId: string): Promise<void> {
  const updated = await db.update(instanceAssignment)
    .set({ status: 'claimed', assignedUserId: userId, claimedAt: new Date(), resolvedRoleId: null })
    .where(and(eq(instanceAssignment.id, assignmentId), eq(instanceAssignment.status, 'offered')))
    .returning({ id: instanceAssignment.id });
  expect(updated).toHaveLength(1);
}

test('submit chains: the next UI step in the same scope arrives pre-claimed for the submitter', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, TWO_UI_SPEC, 'wf-chain-a');
  const op = await seedOnlineOperator(db, wi.workCenterId);
  // A second online member keeps the candidate pool contested (D11's sole-candidate rule only
  // fires for a pool of exactly one) so ui-1's birth offer proves THIS test's own point — chain
  // claiming — rather than being pre-empted by the sole-candidate rule (spec 2026-08-17 D11,
  // same seed-strengthening pattern Task 3 applied to the mission-control-db package's own
  // pre-existing chain tests).
  await seedOnlineOperator(db, wi.workCenterId);
  await pumpUntilQuiet(db, testDeps());

  const offer1 = await assignmentForStep(db, wi.id, 'ui-1');
  expect(offer1.status).toBe('offered');
  await claimAs(db, offer1.id, op.id);

  await submitUserAction(db, wi.id, { step_oid: 'ui-1', action: 'submit', form_values: {} }, 'auto', testDeps(), {
    assignmentId: offer1.id, userId: op.id,
  });

  const next = await assignmentForStep(db, wi.id, 'ui-2');
  expect(next.status).toBe('claimed');
  expect(next.assignedUserId).toBe(op.id);
  expect(next.dispatchPolicy).toBe('auto_claim');
  expect(next.dispatchReason).toBe('auto_claim_chain');

  await close();
});

test('child boundary: the child workflow\'s first UI step is offered, never chained from the parent', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, CHILD_UI_SPEC, 'wf-chain-b');
  const op = await seedOnlineOperator(db, wi.workCenterId);
  // A second online member keeps the candidate pool contested (D11's sole-candidate rule only
  // fires for a pool of exactly one) so ui-p's and the child's c-ui birth offers both prove
  // THIS test's own point — chain-scope isolation — rather than being pre-empted by the
  // sole-candidate rule (spec 2026-08-17 D11, same seed-strengthening pattern Task 3 applied to
  // the mission-control-db package's own pre-existing chain tests).
  await seedOnlineOperator(db, wi.workCenterId);
  await pumpUntilQuiet(db, testDeps());

  const parentOffer = await assignmentForStep(db, wi.id, 'ui-p');
  expect(parentOffer.status).toBe('offered');
  await claimAs(db, parentOffer.id, op.id);

  // Submitting the parent step drains straight into the proxy, which starts the child; the
  // child's UI step parks WAITING_USER inside the same submit transaction's cascade.
  await submitUserAction(db, wi.id, { step_oid: 'ui-p', action: 'submit', form_values: {} }, 'auto', testDeps(), {
    assignmentId: parentOffer.id, userId: op.id,
  });

  const childAssign = await assignmentForStep(db, wi.id, 'c-ui');
  expect(childAssign).toBeDefined();
  expect(childAssign.status).toBe('offered');       // new scope, no chain memory (spec D6)
  expect(childAssign.assignedUserId).toBeNull();

  await close();
});
