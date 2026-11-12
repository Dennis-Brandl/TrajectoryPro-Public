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
// Fixed button row (spec 2026-11-11), Task 4: an operator presses Back on a screen — the screen
// is set aside (its run recorded 'went_back'), the previous screen reopens prefilled with what
// was submitted there, and the reopened screen goes straight back to the same operator.
import { expect, test, vi } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import {
  workCenter, workCenterUser, workflow, workflowNode, workflowAllowedRole, role, appUser,
  workflowInstance, stepInstance, instanceAssignment, stepRun, stepSignature, traceEntry,
} from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { submitUserAction, EngineError } from '../src/core/submit.js';
import { goBack } from '../src/core/go-back.js';

// The after-commit claim can be made to throw, to prove a committed Back still succeeds.
const claimFault = vi.hoisted(() => ({ throwNext: false }));
vi.mock('mission-control-db/src/runtime/assignments', async (importOriginal) => {
  const orig = await importOriginal<typeof import('mission-control-db/src/runtime/assignments')>();
  return {
    ...orig,
    claimStepForUser: async (...args: Parameters<typeof orig.claimStepForUser>) => {
      if (claimFault.throwNext) { claimFault.throwNext = false; throw new Error('claim failed'); }
      return orig.claimStepForUser(...args);
    },
  };
});

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});
const FIXED = { button_bar: { format: 'fixed' } };
const screen = (oid: string, allowBack: boolean, extra: Record<string, unknown> = {}) =>
  step(oid, 'USER_INTERACTION', { ...FIXED, allow_back: allowBack, ...extra });
const script = (oid: string) => step(oid, 'SCRIPT', { script_config: { source: `output.done = '${oid}';` } });

function line(oid: string, steps: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const connections = steps.slice(1).map((s, i) => ({ from_step_id: steps[i]!.oid, to_step_id: s.oid }));
  return { local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01', steps, connections, ...extra };
}

// START -> A (fixed, no Back) -> x (SCRIPT) -> B (fixed, Back) -> END
const A_X_B = line('wf-gb-axb', [step('s1', 'START'), screen('A', false), script('x'), screen('B', true), step('e1', 'END')]);

interface Seeded { id: string; workCenterId: string; workflowId: string }

async function seedQueued(db: any, spec: any): Promise<Seeded> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id, workflowId: wf.id };
}

async function seedMember(db: any, wcId: string, name: string): Promise<string> {
  const [u] = await db.insert(appUser).values({ email: `${name}-${Math.random()}@t.test`, displayName: name, loginName: `${name}-${Math.random()}` }).returning();
  await db.insert(workCenterUser).values({ workCenterId: wcId, userId: u.id });
  return u.id;
}

async function liveAssignment(db: any, instanceId: string, stepOid: string): Promise<any> {
  const rows = await db.select({ a: instanceAssignment }).from(instanceAssignment)
    .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
    .where(and(eq(stepInstance.workflowInstanceId, instanceId), eq(stepInstance.stepOid, stepOid)));
  return rows.map((r: any) => r.a).find((a: any) => a.status === 'offered' || a.status === 'claimed');
}

/** The claim route's effect, done directly: the live offer for `stepOid` becomes `userId`'s claim. */
async function claim(db: any, instanceId: string, stepOid: string, userId: string): Promise<string> {
  const a = await liveAssignment(db, instanceId, stepOid);
  if (!a) throw new Error(`no live assignment for ${stepOid}`);
  await db.update(instanceAssignment).set({ status: 'claimed', assignedUserId: userId, claimedAt: new Date() })
    .where(eq(instanceAssignment.id, a.id));
  return a.id;
}

async function claimAndSubmit(db: any, instanceId: string, stepOid: string, userId: string, form_values: Record<string, unknown> = {}) {
  const assignmentId = await claim(db, instanceId, stepOid, userId);
  await submitUserAction(db, instanceId, { step_oid: stepOid, action: 'submit', form_values }, 'auto', testDeps(), { assignmentId, userId });
}

async function stepRow(db: any, instanceId: string, stepOid: string): Promise<any> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === stepOid);
}

async function runsOf(db: any, instanceId: string, stepOid: string): Promise<any[]> {
  return db.select().from(stepRun)
    .where(and(eq(stepRun.workflowInstanceId, instanceId), eq(stepRun.stepOid, stepOid)))
    .orderBy(asc(stepRun.runNumber));
}

async function engineState(db: any, instanceId: string): Promise<any> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row.engineState;
}

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(EngineError);
  expect((err as EngineError).code).toBe(code);
}

/** Runs A_X_B up to B claimed by `user` (A submitted with `values`). */
async function atB(db: any, spec: any = A_X_B, values: Record<string, unknown> = { qty: 3 }) {
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, testDeps());
  const user = await seedMember(db, wi.workCenterId, 'op');
  await claimAndSubmit(db, wi.id, 'A', user, values);
  const bAssignment = await claim(db, wi.id, 'B', user);
  return { wi, user, bAssignment };
}

test('back reopens the previous screen for the same operator, prefilled', async () => {
  const { db, close } = await makeTestDb();
  const { wi, user, bAssignment } = await atB(db);

  expect(await goBack(db, wi.id, { assignmentId: bAssignment, userId: user }, testDeps())).toEqual({ targetStepOid: 'A' });

  expect(await stepRow(db, wi.id, 'B')).toBeUndefined();
  expect((await stepRow(db, wi.id, 'A')).state).toBe('WAITING_USER');
  const a = await liveAssignment(db, wi.id, 'A');
  expect(a.status).toBe('claimed');
  expect(a.assignedUserId).toBe(user);
  expect(a.dispatchReason).toBe('went_back');
  const st = await engineState(db, wi.id);
  expect(st.backPrefill.A).toEqual({ qty: 3 });
  const bRuns = await runsOf(db, wi.id, 'B');
  expect(bRuns).toHaveLength(1);
  expect(bRuns[0].result).toBe('went_back');
  expect(bRuns[0].performedByUserId).toBe(user);
  const trace = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, wi.id));
  expect(trace.some((t: any) => t.stepOid === 'B' && t.state === 'OPERATOR' && /went back/.test(t.error ?? ''))).toBe(true);
  await close();
});

test('forward again re-runs the automated step', async () => {
  const { db, close } = await makeTestDb();
  const { wi, user, bAssignment } = await atB(db);
  await goBack(db, wi.id, { assignmentId: bAssignment, userId: user }, testDeps());

  const aAssignment = (await liveAssignment(db, wi.id, 'A')).id;
  await submitUserAction(db, wi.id, { step_oid: 'A', action: 'submit', form_values: { qty: 4 } }, 'auto', testDeps(), { assignmentId: aAssignment, userId: user });

  expect(await runsOf(db, wi.id, 'x')).toHaveLength(2);
  expect((await stepRow(db, wi.id, 'B')).state).toBe('WAITING_USER');
  const st = await engineState(db, wi.id);
  expect(st.backPrefill.A).toBeUndefined();
  expect(st.backFrom.B).toBe('A');
  await close();
});

test("back keeps the reopened screen's own back target", async () => {
  const { db, close } = await makeTestDb();
  const spec = line('wf-gb-zab', [step('s1', 'START'), screen('Z', false), screen('A', true), screen('B', true), step('e1', 'END')]);
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, testDeps());
  const user = await seedMember(db, wi.workCenterId, 'op');
  await claimAndSubmit(db, wi.id, 'Z', user, { z: 'zz' });
  await claimAndSubmit(db, wi.id, 'A', user, { a: ['x', 'y'] });
  const bAssignment = await claim(db, wi.id, 'B', user);

  expect(await goBack(db, wi.id, { assignmentId: bAssignment, userId: user }, testDeps())).toEqual({ targetStepOid: 'A' });
  expect((await engineState(db, wi.id)).backFrom.A).toBe('Z');
  const aAssignment = (await liveAssignment(db, wi.id, 'A')).id;
  expect(await goBack(db, wi.id, { assignmentId: aAssignment, userId: user }, testDeps())).toEqual({ targetStepOid: 'Z' });
  expect((await stepRow(db, wi.id, 'Z')).state).toBe('WAITING_USER');
  expect(await stepRow(db, wi.id, 'A')).toBeUndefined();
  const st = await engineState(db, wi.id);
  expect(st.backPrefill.Z).toEqual({ z: 'zz' });
  expect(st.backPrefill.A).toBeUndefined();
  await close();
});

test("back supersedes the previous screen's signature", async () => {
  const { db, close } = await makeTestDb();
  const { wi, user, bAssignment } = await atB(db);
  const [sig] = await db.insert(stepSignature).values({
    workflowInstanceId: wi.id, runtimeNumber: 1, runtimeLabel: 'RW-1', workCenterId: wi.workCenterId, workCenterName: 'wc',
    stepOid: 'A', stepName: 'A', signerLoginName: 'op', operatorLoginName: 'op', outcome: 'signed',
  }).returning();

  await goBack(db, wi.id, { assignmentId: bAssignment, userId: user }, testDeps());
  const [after] = await db.select().from(stepSignature).where(eq(stepSignature.id, sig.id));
  expect(after.supersededAt).not.toBeNull();
  await close();
});

test('back is refused when not allowed', async () => {
  const { db, close } = await makeTestDb();
  // Legacy B: no button_bar, even with allow_back set.
  const legacy = line('wf-gb-legacy', [step('s1', 'START'), screen('A', false), step('B', 'USER_INTERACTION', { allow_back: true }), step('e1', 'END')]);
  let at = await atB(db, legacy);
  await expectCode(goBack(db, at.wi.id, { assignmentId: at.bAssignment, userId: at.user }, testDeps()), 'BACK_NOT_ALLOWED');
  // Fixed B without allow_back.
  const noBack = line('wf-gb-noback', [step('s1', 'START'), screen('A', false), screen('B', false), step('e1', 'END')]);
  at = await atB(db, noBack);
  await expectCode(goBack(db, at.wi.id, { assignmentId: at.bAssignment, userId: at.user }, testDeps()), 'BACK_NOT_ALLOWED');
  // B right after a PARALLEL split.
  const split = {
    local_id: 'wf', oid: 'wf-gb-split', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('s1', 'START'), screen('A', false), step('p1', 'PARALLEL'), screen('B', true), screen('C', true), step('wa', 'WAIT ALL'), step('e1', 'END')],
    connections: [
      { from_step_id: 's1', to_step_id: 'A' }, { from_step_id: 'A', to_step_id: 'p1' },
      { from_step_id: 'p1', to_step_id: 'B' }, { from_step_id: 'p1', to_step_id: 'C' },
      { from_step_id: 'B', to_step_id: 'wa' }, { from_step_id: 'C', to_step_id: 'wa' }, { from_step_id: 'wa', to_step_id: 'e1' },
    ],
  };
  at = await atB(db, split);
  await expectCode(goBack(db, at.wi.id, { assignmentId: at.bAssignment, userId: at.user }, testDeps()), 'BACK_NOT_ALLOWED');
  expect((await stepRow(db, at.wi.id, 'B')).state).toBe('WAITING_USER');
  await close();
});

test('back on a step no longer claimed by the caller is refused', async () => {
  const { db, close } = await makeTestDb();
  const { wi, bAssignment } = await atB(db);
  const other = await seedMember(db, wi.workCenterId, 'other');
  await expectCode(goBack(db, wi.id, { assignmentId: bAssignment, userId: other }, testDeps()), 'NOT_CLAIMANT');
  expect((await stepRow(db, wi.id, 'B')).state).toBe('WAITING_USER');
  expect(await runsOf(db, wi.id, 'B')).toHaveLength(0);
  expect((await stepRow(db, wi.id, 'A')).state).toBe('COMPLETED');
  await close();
});

test('back on a step that is not waiting is refused', async () => {
  const { db, close } = await makeTestDb();
  const { wi, user, bAssignment } = await atB(db);
  await db.update(stepInstance).set({ state: 'PAUSED' })
    .where(and(eq(stepInstance.workflowInstanceId, wi.id), eq(stepInstance.stepOid, 'B')));
  await expectCode(goBack(db, wi.id, { assignmentId: bAssignment, userId: user }, testDeps()), 'STEP_NOT_WAITING');
  await close();
});

test('back while paused is refused', async () => {
  const { db, close } = await makeTestDb();
  const { wi, user, bAssignment } = await atB(db);
  await db.update(workflowInstance).set({ status: 'paused' }).where(eq(workflowInstance.id, wi.id));
  await expectCode(goBack(db, wi.id, { assignmentId: bAssignment, userId: user }, testDeps()), 'NOT_RUNNING');
  expect((await stepRow(db, wi.id, 'B')).state).toBe('WAITING_USER');
  await close();
});

test('reopened screen is offered when the operator lacks its role', async () => {
  const { db, close } = await makeTestDb();
  const spec = { ...A_X_B, oid: 'wf-gb-role', master_oid: 'M-root' };
  const wi = await seedQueued(db, spec);
  const [node] = await db.insert(workflowNode).values({ workflowId: wi.workflowId, nodeOid: 'M-root', name: 'root', depth: 0 }).returning();
  const [r] = await db.insert(role).values({ name: `Inspector-${Math.random()}` }).returning();
  await db.insert(workflowAllowedRole).values({ workflowId: wi.workflowId, workflowNodeId: node.id, roleId: r.id });
  await pumpUntilQuiet(db, testDeps());
  const user = await seedMember(db, wi.workCenterId, 'op'); // member, but without the Inspector role
  await claimAndSubmit(db, wi.id, 'A', user, { qty: 3 });
  const bAssignment = await claim(db, wi.id, 'B', user);

  await goBack(db, wi.id, { assignmentId: bAssignment, userId: user }, testDeps());
  const a = await liveAssignment(db, wi.id, 'A');
  expect(a.status).toBe('offered');
  expect(a.assignedUserId).toBeNull();
  await close();
});

test('a committed Back still succeeds when the after-commit claim throws', async () => {
  const { db, close } = await makeTestDb();
  const { wi, user, bAssignment } = await atB(db);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  claimFault.throwNext = true;
  try {
    expect(await goBack(db, wi.id, { assignmentId: bAssignment, userId: user }, testDeps())).toEqual({ targetStepOid: 'A' });
    expect(claimFault.throwNext).toBe(false);
    expect((await stepRow(db, wi.id, 'A')).state).toBe('WAITING_USER');
    expect(await stepRow(db, wi.id, 'B')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('claim failed'));
  } finally {
    warn.mockRestore();
    await close();
  }
});
