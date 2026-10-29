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

import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { runtimeCols } from '../../test/helpers/instances.js';
import {
  workCenter, workflow, role, appUser, workCenterUser, workCenterUserRole,
  workflowInstance, stepInstance, instanceAssignment,
} from '../db/schema/index.js';
import { buildInbox, isAssignmentVisibleTo, listWaitingTimedSteps, workflowPathOf } from './inbox.js';

// Frozen spec: one node ('rt_1') carrying three steps, each exercising a different payload
// shape — form_document present, yes_no_config present, and neither (formDocument -> null).
const SPEC = {
  oid: 'rt_1', master_oid: 'M-root', connections: [],
  steps: [
    { oid: 's-form', local_id: 'Form Step', step_type: 'USER_INTERACTION', form_document: { sections: [] } },
    { oid: 's-yesno', local_id: 'Yes No Step', step_type: 'YES_NO', yes_no_config: { yes_label: 'Y', no_label: 'N' } },
    { oid: 's-plain', local_id: 'Plain Step', step_type: 'USER_INTERACTION' },
  ],
  children: [],
};

async function seedWc(db: any) {
  const [wc] = await db.insert(workCenter).values({ name: `WC-${Math.random()}` }).returning();
  return wc;
}

async function seedUser(db: any, email: string) {
  const [u] = await db.insert(appUser).values({ email, displayName: email }).returning();
  return u;
}

async function seedInstance(db: any, workCenterId: string, specJsonb: unknown = SPEC) {
  const [wf] = await db.insert(workflow).values({ oid: `w-${Math.random()}`, name: 'W', workCenterId, specJsonb: {} }).returning();
  const [inst] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId, triggeredBy: 'manual', status: 'running',
    ...runtimeCols({ specJsonb }),
  }).returning();
  return inst;
}

async function seedStep(db: any, instanceId: string, overrides: Record<string, unknown> = {}) {
  const [step] = await db.insert(stepInstance).values({
    workflowInstanceId: instanceId, nodeOid: 'rt_1', stepOid: 's-plain',
    stepType: 'USER_INTERACTION', state: 'WAITING_USER',
    ...overrides,
  }).returning();
  return step;
}

async function seedAssignment(db: any, workCenterId: string, stepInstanceId: string, overrides: Record<string, unknown> = {}) {
  const [a] = await db.insert(instanceAssignment).values({
    stepInstanceId, workCenterId, status: 'offered', allowedRoleIds: [], ...overrides,
  }).returning();
  return a;
}

describe('buildInbox', () => {
  it('role filter: [] unrestricted visible to everyone, [R] visible only to role holders', async () => {
    const { db, close } = await makeTestDb();
    const wc = await seedWc(db);
    const inst = await seedInstance(db, wc.id);
    const restrictedStep = await seedStep(db, inst.id, { stepOid: 's-form' });
    const openStep = await seedStep(db, inst.id, { stepOid: 's-plain' });

    const [roleR] = await db.insert(role).values({ name: 'RoleR' }).returning();
    const holder = await seedUser(db, `holder-${Math.random()}@t.test`);
    await db.insert(workCenterUser).values({ workCenterId: wc.id, userId: holder.id });
    await db.insert(workCenterUserRole).values({ workCenterId: wc.id, userId: holder.id, roleId: roleR.id });
    const outsider = await seedUser(db, `outsider-${Math.random()}@t.test`);

    await seedAssignment(db, wc.id, restrictedStep.id, { allowedRoleIds: [roleR.id] });
    await seedAssignment(db, wc.id, openStep.id, { allowedRoleIds: [] });

    const holderInbox = await buildInbox(db, holder.id, wc.id);
    expect(holderInbox.offers.map((o) => o.stepOid).sort()).toEqual(['s-form', 's-plain']);

    const outsiderInbox = await buildInbox(db, outsider.id, wc.id);
    expect(outsiderInbox.offers.map((o) => o.stepOid)).toEqual(['s-plain']);

    await close();
  });

  it('myClaims: mine (including PAUSED) show under myClaims never offers; someone else\'s claim is invisible to me', async () => {
    const { db, close } = await makeTestDb();
    const wc = await seedWc(db);
    const inst = await seedInstance(db, wc.id);
    const me = await seedUser(db, `me-${Math.random()}@t.test`);
    const other = await seedUser(db, `other-${Math.random()}@t.test`);

    const myStep = await seedStep(db, inst.id, { stepOid: 's-form' });
    await seedAssignment(db, wc.id, myStep.id, { status: 'claimed', assignedUserId: me.id, claimedAt: new Date() });

    const myPausedStep = await seedStep(db, inst.id, { stepOid: 's-yesno', state: 'PAUSED' });
    await seedAssignment(db, wc.id, myPausedStep.id, { status: 'claimed', assignedUserId: me.id, claimedAt: new Date() });

    const othersStep = await seedStep(db, inst.id, { stepOid: 's-plain' });
    await seedAssignment(db, wc.id, othersStep.id, { status: 'claimed', assignedUserId: other.id, claimedAt: new Date() });

    const inbox = await buildInbox(db, me.id, wc.id);
    expect(inbox.offers).toEqual([]);
    expect(inbox.myClaims.map((c) => c.stepOid).sort()).toEqual(['s-form', 's-yesno']);
    expect(inbox.myClaims.find((c) => c.stepOid === 's-yesno')?.paused).toBe(true);
    expect(inbox.myClaims.find((c) => c.stepOid === 's-form')?.paused).toBe(false);

    await close();
  });

  it('sort: suggestedForMe offers first, then assignedAt ascending', async () => {
    const { db, close } = await makeTestDb();
    const wc = await seedWc(db);
    const inst = await seedInstance(db, wc.id);
    const me = await seedUser(db, `me-${Math.random()}@t.test`);

    const stepEarly = await seedStep(db, inst.id, { stepOid: 's-form' });
    const stepLate = await seedStep(db, inst.id, { stepOid: 's-yesno' });
    const stepSuggested = await seedStep(db, inst.id, { stepOid: 's-plain' });

    await seedAssignment(db, wc.id, stepEarly.id, { assignedAt: new Date('2030-01-01T00:00:00Z') });
    await seedAssignment(db, wc.id, stepLate.id, { assignedAt: new Date('2030-01-02T00:00:00Z') });
    await seedAssignment(db, wc.id, stepSuggested.id, {
      preferredUserId: me.id, assignedAt: new Date('2030-01-03T00:00:00Z'),
    });

    const inbox = await buildInbox(db, me.id, wc.id);
    expect(inbox.offers.map((o) => o.stepOid)).toEqual(['s-plain', 's-form', 's-yesno']);
    expect(inbox.offers[0].suggestedForMe).toBe(true);
    expect(inbox.offers[1].suggestedForMe).toBe(false);
    expect(inbox.offers[2].suggestedForMe).toBe(false);

    await close();
  });

  it('payload: formDocument/yesNoConfig extracted from the frozen spec by (nodeOid,stepOid); stepName populated; missing form_document -> null', async () => {
    const { db, close } = await makeTestDb();
    const wc = await seedWc(db);
    const inst = await seedInstance(db, wc.id);
    const me = await seedUser(db, `me-${Math.random()}@t.test`);

    const formStep = await seedStep(db, inst.id, { stepOid: 's-form' });
    const yesNoStep = await seedStep(db, inst.id, { stepOid: 's-yesno' });
    const plainStep = await seedStep(db, inst.id, { stepOid: 's-plain' });
    await seedAssignment(db, wc.id, formStep.id);
    await seedAssignment(db, wc.id, yesNoStep.id);
    await seedAssignment(db, wc.id, plainStep.id);

    const inbox = await buildInbox(db, me.id, wc.id);
    const byOid = Object.fromEntries(inbox.offers.map((o) => [o.stepOid, o]));

    expect(byOid['s-form'].formDocument).toEqual({ sections: [] });
    expect(byOid['s-form'].stepName).toBe('Form Step');
    expect(byOid['s-form'].yesNoConfig).toBeNull();

    expect(byOid['s-yesno'].yesNoConfig).toEqual({ yes_label: 'Y', no_label: 'N' });
    expect(byOid['s-yesno'].stepName).toBe('Yes No Step');

    expect(byOid['s-plain'].formDocument).toBeNull();
    expect(byOid['s-plain'].stepName).toBe('Plain Step');

    await close();
  });

  it('payload additions (spec 2026-10-09 §5.7): masterVersion, child-workflow path, step updated time, work-center name', async () => {
    const { db, close } = await makeTestDb();
    const wc = await seedWc(db);
    const nested = {
      ...SPEC,
      children: [{
        oid: 'c1', local_id: 'Charge sub-flow', connections: [],
        steps: [{ oid: 's-child', local_id: 'Charge Kettle', step_type: 'USER_INTERACTION' }],
        children: [{
          oid: 'c2', local_id: 'Inner', connections: [],
          steps: [{ oid: 's-inner', local_id: 'Inner Step', step_type: 'USER_INTERACTION' }],
          children: [],
        }],
      }],
    };
    const inst = await seedInstance(db, wc.id, nested);
    const me = await seedUser(db, `me-${Math.random()}@t.test`);
    const at = new Date('2030-02-03T04:05:06.000Z');
    const rootStep = await seedStep(db, inst.id, { stepOid: 's-plain', updatedAt: at });
    const childStep = await seedStep(db, inst.id, { nodeOid: 'c1', stepOid: 's-child' });
    const innerStep = await seedStep(db, inst.id, { nodeOid: 'c2', stepOid: 's-inner' });
    for (const s of [rootStep, childStep, innerStep]) await seedAssignment(db, wc.id, s.id);

    const inbox = await buildInbox(db, me.id, wc.id);
    const byOid = Object.fromEntries(inbox.offers.map((o) => [o.stepOid, o]));

    expect(inbox.workCenterName).toBe(wc.name);
    expect(byOid['s-plain'].masterVersion).toBe('1.0.0');
    expect(byOid['s-plain'].workflowPath).toEqual([]);
    expect(byOid['s-plain'].stepUpdatedAt).toBe('2030-02-03T04:05:06.000Z');
    expect(byOid['s-child'].stepName).toBe('Charge Kettle');
    expect(byOid['s-child'].workflowPath).toEqual(['Charge sub-flow']);
    expect(byOid['s-inner'].workflowPath).toEqual(['Charge sub-flow', 'Inner']);

    await close();
  });

  // 2026-09-14: the completion-button label authored in Designer's form-designer Actions panel
  // travels as a `Button` UI parameter; the inbox lifts it so Mission Pilot can show it.
  it('payload: continueLabel is the step\'s Button UI parameter value; blank or absent -> null', async () => {
    const spec = {
      oid: 'rt_1', master_oid: 'M-root', connections: [],
      steps: [
        { oid: 's-label', local_id: 'Labelled', step_type: 'USER_INTERACTION',
          ui_parameter_specifications: [{ type: 'Text', value: 'not a button' }, { type: 'Button', value: 'Record Reading' }] },
        { oid: 's-blank', local_id: 'Blank', step_type: 'USER_INTERACTION',
          ui_parameter_specifications: [{ type: 'Button', value: '   ' }] },
        { oid: 's-plain', local_id: 'Plain Step', step_type: 'USER_INTERACTION' },
      ],
      children: [],
    };
    const { db, close } = await makeTestDb();
    const wc = await seedWc(db);
    const inst = await seedInstance(db, wc.id, spec);
    const me = await seedUser(db, `me-${Math.random()}@t.test`);
    for (const stepOid of ['s-label', 's-blank', 's-plain']) {
      const step = await seedStep(db, inst.id, { stepOid });
      await seedAssignment(db, wc.id, step.id);
    }

    const inbox = await buildInbox(db, me.id, wc.id);
    const byOid = Object.fromEntries(inbox.offers.map((o) => [o.stepOid, o]));

    expect(byOid['s-label'].continueLabel).toBe('Record Reading');
    expect(byOid['s-blank'].continueLabel).toBeNull();
    expect(byOid['s-plain'].continueLabel).toBeNull();

    await close();
  });

  it('offers exclude steps not WAITING_USER: flipping a step to PAUSED drops its unclaimed offer entirely', async () => {
    const { db, close } = await makeTestDb();
    const wc = await seedWc(db);
    const inst = await seedInstance(db, wc.id);
    const me = await seedUser(db, `me-${Math.random()}@t.test`);
    const step = await seedStep(db, inst.id, { stepOid: 's-plain' });
    await seedAssignment(db, wc.id, step.id);

    let inbox = await buildInbox(db, me.id, wc.id);
    expect(inbox.offers).toHaveLength(1);

    await db.update(stepInstance).set({ state: 'PAUSED' }).where(eq(stepInstance.id, step.id));
    inbox = await buildInbox(db, me.id, wc.id);
    expect(inbox.offers).toEqual([]);
    expect(inbox.myClaims).toEqual([]); // unclaimed — invisible to everyone while paused

    await close();
  });

  it('scopes everything to the requested work center only', async () => {
    const { db, close } = await makeTestDb();
    const wc1 = await seedWc(db);
    const wc2 = await seedWc(db);
    const inst1 = await seedInstance(db, wc1.id);
    const inst2 = await seedInstance(db, wc2.id);
    const me = await seedUser(db, `me-${Math.random()}@t.test`);

    const step1 = await seedStep(db, inst1.id, { stepOid: 's-plain' });
    await seedAssignment(db, wc1.id, step1.id);

    const step2 = await seedStep(db, inst2.id, { stepOid: 's-form' });
    await seedAssignment(db, wc2.id, step2.id, { status: 'claimed', assignedUserId: me.id, claimedAt: new Date() });

    const inbox1 = await buildInbox(db, me.id, wc1.id);
    expect(inbox1.workCenterId).toBe(wc1.id);
    expect(inbox1.offers.map((o) => o.stepOid)).toEqual(['s-plain']);
    expect(inbox1.myClaims).toEqual([]);

    const inbox2 = await buildInbox(db, me.id, wc2.id);
    expect(inbox2.workCenterId).toBe(wc2.id);
    expect(inbox2.offers).toEqual([]);
    expect(inbox2.myClaims.map((c) => c.stepOid)).toEqual(['s-form']);

    await close();
  });

  it('substitutes {{param}} tokens in text/header content from the step input snapshot; no snapshot -> verbatim', async () => {
    const { db, close } = await makeTestDb();
    const wc = await seedWc(db);
    const spec = {
      oid: 'rt_1', master_oid: 'M-root', connections: [],
      steps: [{
        oid: 's-form', local_id: 'Form Step', step_type: 'USER_INTERACTION',
        form_document: { version: 2, sections: [{ id: 'sec1', rows: [{ id: 'r1', blocks: [
          { id: 'b1', type: 'text', content: 'Lot {{Lot}} / {{Gone}}' },
        ] }] }] },
      }],
      children: [],
    };
    const inst = await seedInstance(db, wc.id, spec);
    await db.update(workflowInstance).set({
      engineState: { stepSnapshots: { 's-form': { inputParameters: { Lot: 'L<9>' } } } },
    }).where(eq(workflowInstance.id, inst.id));
    const me = await seedUser(db, `sub-${Math.random()}@t.test`);
    const step = await seedStep(db, inst.id, { stepOid: 's-form' });
    await seedAssignment(db, wc.id, step.id);

    const inbox = await buildInbox(db, me.id, wc.id);
    const content = (inbox.offers[0].formDocument as { sections: Array<{ rows: Array<{ blocks: Array<{ content: string }> }> }> })
      .sections[0].rows[0].blocks[0].content;
    expect(content).toBe('Lot L&lt;9&gt; / {{Gone}}');

    // A second instance with NO engine_state snapshot ships the document verbatim.
    const inst2 = await seedInstance(db, wc.id, spec);
    const step2 = await seedStep(db, inst2.id, { stepOid: 's-form' });
    await seedAssignment(db, wc.id, step2.id);
    const inbox2 = await buildInbox(db, me.id, wc.id);
    const raw = inbox2.offers.map((o) => (o.formDocument as { sections: Array<{ rows: Array<{ blocks: Array<{ content: string }> }> }> })
      .sections[0].rows[0].blocks[0].content).sort();
    expect(raw).toEqual(['Lot L&lt;9&gt; / {{Gone}}', 'Lot {{Lot}} / {{Gone}}'].sort());

    await close();
  });

  it('role scope: holding the role in ANOTHER work center does not make an offer visible here', async () => {
    const { db, close } = await makeTestDb();
    const wc = await seedWc(db);
    const otherWc = await seedWc(db);
    const inst = await seedInstance(db, wc.id);
    const restrictedStep = await seedStep(db, inst.id, { stepOid: 's-form' });
    const [roleR] = await db.insert(role).values({ name: 'RoleR' }).returning();
    const elsewhere = await seedUser(db, `elsewhere-${Math.random()}@t.test`);
    await db.insert(workCenterUser).values([
      { workCenterId: wc.id, userId: elsewhere.id },
      { workCenterId: otherWc.id, userId: elsewhere.id },
    ]);
    await db.insert(workCenterUserRole).values({ workCenterId: otherWc.id, userId: elsewhere.id, roleId: roleR.id });
    await seedAssignment(db, wc.id, restrictedStep.id, { allowedRoleIds: [roleR.id] });

    expect((await buildInbox(db, elsewhere.id, wc.id)).offers).toEqual([]);
    await close();
  });
});

describe('isAssignmentVisibleTo', () => {
  it('isAssignmentVisibleTo: claimed is visible only to the claimant, regardless of step state', () => {
    const a = { status: 'claimed', assignedUserId: 'u1', allowedRoleIds: [] as string[] };
    expect(isAssignmentVisibleTo(a, 'EXECUTING', 'u1', new Set())).toBe(true);
    expect(isAssignmentVisibleTo(a, 'WAITING_USER', 'u2', new Set())).toBe(false);
  });

  it('isAssignmentVisibleTo: offered needs WAITING_USER and a role match (empty list = everyone)', () => {
    const open = { status: 'offered', assignedUserId: null, allowedRoleIds: [] as string[] };
    const gated = { status: 'offered', assignedUserId: null, allowedRoleIds: ['r1'] };
    expect(isAssignmentVisibleTo(open, 'WAITING_USER', 'u1', new Set())).toBe(true);
    expect(isAssignmentVisibleTo(open, 'PAUSED', 'u1', new Set())).toBe(false);
    expect(isAssignmentVisibleTo(gated, 'WAITING_USER', 'u1', new Set(['r1']))).toBe(true);
    expect(isAssignmentVisibleTo(gated, 'WAITING_USER', 'u1', new Set(['r2']))).toBe(false);
  });

  it('isAssignmentVisibleTo: completed/cancelled are never visible', () => {
    expect(isAssignmentVisibleTo({ status: 'completed', assignedUserId: 'u1', allowedRoleIds: [] }, 'COMPLETED', 'u1', new Set())).toBe(false);
  });
});

describe('workflowPathOf', () => {
  it('names an unnamed child "Sub-workflow" and gives [] for an unknown node or a malformed spec', () => {
    const spec = { oid: 'r', children: [{ oid: 'c', children: [] }] };
    expect(workflowPathOf(spec, 'r')).toEqual([]);
    expect(workflowPathOf(spec, 'c')).toEqual(['Sub-workflow']);
    expect(workflowPathOf(spec, 'nope')).toEqual([]);
    expect(workflowPathOf(null, 'c')).toEqual([]);
    expect(workflowPathOf('x', 'c')).toEqual([]);
  });
});

describe('waiting timed gates (spec 2026-10-13 §5.3)', () => {
  const GATE_SPEC = {
    oid: 'rt_1', master_oid: 'M-root', connections: [], children: [],
    steps: [
      { oid: 's-timer', local_id: 'Cool Down', step_type: 'GATE', gate_config: { mode: 'timer', delay_seconds: 600 } },
      { oid: 's-cond', local_id: 'Check', step_type: 'GATE', gate_config: { cycle_seconds: 5 } },
      { oid: 's-cot', local_id: 'Settle', step_type: 'GATE', gate_config: { mode: 'condition_or_timer', delay_seconds: 60, cycle_seconds: 3 } },
    ],
  };

  it('lists only timed WAITING_GATE steps of live instances, soonest deadline first', async () => {
    const { db, close } = await makeTestDb();
    const wc = await seedWc(db);
    const inst = await seedInstance(db, wc.id, GATE_SPEC);
    const started = new Date('2026-01-01T00:00:00.000Z');
    const t = await seedStep(db, inst.id, { stepOid: 's-timer', stepType: 'GATE', state: 'WAITING_GATE', startedAt: started });
    await seedStep(db, inst.id, { stepOid: 's-cond', stepType: 'GATE', state: 'WAITING_GATE', startedAt: started });
    const c = await seedStep(db, inst.id, { stepOid: 's-cot', stepType: 'GATE', state: 'WAITING_GATE', startedAt: started });
    await seedStep(db, inst.id, { stepOid: 's-timer', stepType: 'GATE', state: 'COMPLETED', startedAt: started });

    const waiting = await listWaitingTimedSteps(db, wc.id);
    expect(waiting.map((w) => [w.stepInstanceId, w.stepName, w.timer.mode, w.timer.deadline])).toEqual([
      [c.id, 'Settle', 'condition_or_timer', '2026-01-01T00:01:00.000Z'],
      [t.id, 'Cool Down', 'timer', '2026-01-01T00:10:00.000Z'],
    ]);
    expect(waiting[0]).toMatchObject({ instanceId: inst.id, paused: false, workflowPath: [] });

    const user = await seedUser(db, `w-${Math.random()}@t.test`);
    const snap = await buildInbox(db, user.id, wc.id);
    expect(snap.waiting.map((w) => w.stepOid)).toEqual(['s-cot', 's-timer']);
    await close();
  });

  it('leaves out an armed gate that has already opened, and instances with only condition gates', async () => {
    const { db, close } = await makeTestDb();
    const wc = await seedWc(db);
    const armed = await seedInstance(db, wc.id, GATE_SPEC);
    await seedStep(db, armed.id, { stepOid: 's-timer', stepType: 'GATE', state: 'WAITING_GATE', startedAt: new Date() });
    await db.update(workflowInstance)
      .set({ engineState: { armedGates: { 's-timer': { predecessorOid: 's-act', open: true, stopSent: true } } } })
      .where(eq(workflowInstance.id, armed.id));
    const condOnly = await seedInstance(db, wc.id, { ...GATE_SPEC, steps: [GATE_SPEC.steps[1]] });
    await seedStep(db, condOnly.id, { stepOid: 's-cond', stepType: 'GATE', state: 'WAITING_GATE', startedAt: new Date() });
    expect(await listWaitingTimedSteps(db, wc.id)).toEqual([]);

    await db.update(workflowInstance)
      .set({ engineState: { armedGates: { 's-timer': { predecessorOid: 's-act', open: false, stopSent: false } } } })
      .where(eq(workflowInstance.id, armed.id));
    expect((await listWaitingTimedSteps(db, wc.id)).map((w) => w.stepOid)).toEqual(['s-timer']);
    await close();
  });

  it('excludes terminal instances', async () => {
    const { db, close } = await makeTestDb();
    const wc = await seedWc(db);
    const inst = await seedInstance(db, wc.id, GATE_SPEC);
    await seedStep(db, inst.id, { stepOid: 's-timer', stepType: 'GATE', state: 'WAITING_GATE', startedAt: new Date() });
    await db.update(workflowInstance).set({ status: 'stopped' }).where(eq(workflowInstance.id, inst.id));
    expect(await listWaitingTimedSteps(db, wc.id)).toEqual([]);
    await close();
  });

  it('lists waiting repeating scripts too: limited ones by deadline, unlimited ones last; script-only recipes pass the SQL filter', async () => {
    const { db, close } = await makeTestDb();
    const wc = await seedWc(db);
    const SCRIPT_SPEC = {
      oid: 'rt_1', master_oid: 'M-root', connections: [], children: [],
      steps: [
        { oid: 's-poll', local_id: 'Poll', step_type: 'SCRIPT', script_config: { source: 'return false;', repeat: { cycle_seconds: 3 } } },
        { oid: 's-lim', local_id: 'Limited', step_type: 'SCRIPT', script_config: { source: 'return false;', repeat: { time_limit_seconds: 30 } } },
        { oid: 's-once', local_id: 'Once', step_type: 'SCRIPT', script_config: { source: 'return true;' } },
      ],
    };
    const inst = await seedInstance(db, wc.id, SCRIPT_SPEC);
    const started = new Date('2026-01-01T00:00:00.000Z');
    const poll = await seedStep(db, inst.id, { stepOid: 's-poll', stepType: 'SCRIPT', state: 'WAITING_SCRIPT', startedAt: started });
    const lim = await seedStep(db, inst.id, { stepOid: 's-lim', stepType: 'SCRIPT', state: 'WAITING_SCRIPT', startedAt: started });
    const gateInst = await seedInstance(db, wc.id, GATE_SPEC);
    const gate = await seedStep(db, gateInst.id, { stepOid: 's-timer', stepType: 'GATE', state: 'WAITING_GATE', startedAt: started });

    const waiting = await listWaitingTimedSteps(db, wc.id);
    expect(waiting.map((w) => [w.stepInstanceId, w.timer.mode, w.timer.deadline, w.timer.cycleSeconds])).toEqual([
      [lim.id, 'repeat_script', '2026-01-01T00:00:30.000Z', 5],
      [gate.id, 'timer', '2026-01-01T00:10:00.000Z', null],
      [poll.id, 'repeat_script', null, 3],
    ]);
    await close();
  });
});
