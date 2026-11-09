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
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import {
  appUser, workCenter, workflow, workflowNode, workflowAllowedRole, role,
  runtimeSchedule, runtimeScheduleItem, scheduleOccurrence, scheduleItemRun, runtimeScheduleEvent,
  workflowInstance, runtimeHistory,
} from '../db/schema/index.js';
import { DaoError } from '../dao/errors.js';
import { deleteWorkflow } from '../dao/workflows.js';
import { deleteWorkCenter, workCenterDeleteImpact } from '../dao/work-centers.js';
import { setRuntimeIdTimezone } from '../dao/system-settings.js';
import { replaceWorkflowEntry } from '../ingest/replace-workflow-entry.js';
import { ingestWorkflowPackage } from '../ingest/wfmasterx.js';
import { buildWfmasterx } from '../seed/sample-bundle.js';
import { resolveStepAllowedRoles } from '../runtime/assignments.js';
import { createMasterSchedule, replaceMasterSchedule } from './master-dao.js';
import type { ScheduleActor } from './events.js';
import { enableMasterSchedule, previewEnable } from './enable.js';
import {
  listRuntimeSchedules, getRuntimeSchedule, listOccurrences, listRuntimeScheduleEvents,
  liveRuntimeScheduleForWorkflow, effectiveTimeZone,
} from './runtime-dao.js';

const NOW = new Date('2026-11-08T12:00:00Z');
const FUTURE = { type: 'once', at: '2026-11-10T06:00' };
const DAILY = { type: 'daily', every: 1, times: ['06:00'], range: { startDate: '2026-11-01', noEnd: true } };
let actor: ScheduleActor;

const spec = (extra: Record<string, unknown> = {}) => ({
  starting_parameter_specifications: [
    { id: 'BatchId', value_type: 'literal', default_value: '' },
    { id: 'Size', value_type: 'literal', default_value: '25' },
    { id: 'FromProp', value_type: 'property', default_value: 'Some.Prop' },
  ],
  output_parameter_specifications: [{ id: 'Yield' }],
  ...extra,
});

async function setup() {
  const t = await makeTestDb();
  const [wc] = await t.db.insert(workCenter).values({ name: 'Line 1', timeZone: 'America/Chicago' }).returning();
  const [u] = await t.db.insert(appUser).values({ email: 'una@example.com', displayName: 'Una', loginName: 'una' }).returning();
  actor = { kind: 'user', userId: u.id, name: 'Una' };
  const wf = async (name: string, version = '1.0.0', state = 'Effective', specJsonb: unknown = spec()) =>
    (await t.db.insert(workflow).values({
      oid: `o-${name}-${version}-${state}`, name, workCenterId: wc.id, version, state, specJsonb,
    }).returning())[0]!;
  return { ...t, wc, wf };
}
const master = (db: any, wcId: string, extra: Record<string, unknown> = {}) =>
  createMasterSchedule(db, wcId, {
    name: 'Nightly', recurrence: FUTURE,
    items: [
      { workflow: { name: 'Blend Batch' }, params: { BatchId: { value: 'B-1' } }, chain: [
        { workflow: { name: 'Move' }, triggerOn: ['completed'] },
        { workflow: { name: 'Lab' }, triggerOn: ['completed'], params: { BatchId: { from: 'trigger.input', name: 'BatchId' }, Size: { from: 'trigger.output', name: 'Yield' } } },
      ] },
      { workflow: { name: 'Inspect' } },
    ],
    ...extra,
  }, actor);
const seedFlows = async (wf: Awaited<ReturnType<typeof setup>>['wf']) => {
  await wf('Blend Batch'); await wf('Move'); await wf('Lab'); await wf('Inspect');
};
const errOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as DaoError; } return undefined; };

test('masterChanged follows the content, not the revision: A, B, A is unchanged again', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await seedFlows(wf);
    const a = { name: 'Nightly', recurrence: FUTURE, items: [{ workflow: { name: 'Inspect' }, params: { BatchId: { value: 'B-1' } } }] };
    const b = { ...a, description: 'Changed' };
    const m = await createMasterSchedule(db, wc.id, a, actor);
    const { runtime } = await enableMasterSchedule(db, m.id, actor, NOW);
    const changed = async () => [
      (await listRuntimeSchedules(db, wc.id)).find((r) => r.id === runtime.id)!.masterChanged,
      (await getRuntimeSchedule(db, runtime.id))!.masterChanged,
    ];
    expect(await changed()).toEqual([false, false]);

    await replaceMasterSchedule(db, m.id, b, actor);
    expect(await changed()).toEqual([true, true]);

    const back = await replaceMasterSchedule(db, m.id, a, actor);
    expect(back.revision).toBe(3);
    expect(await changed()).toEqual([false, false]);
  } finally { await close(); }
});

test('enable creates RS-1 then RS-2 with the frozen tree, specs, zone and first fire', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await seedFlows(wf);
    const m = await master(db, wc.id);
    const { runtime, warnings } = await enableMasterSchedule(db, m.id, actor, NOW);
    expect(runtime).toMatchObject({
      label: 'RS-1', name: 'Nightly', status: 'active', timeZone: 'America/Chicago',
      masterScheduleId: m.id, masterChanged: false, needsAttention: { failed: 0, lost: 0, missedWindow: false },
    });
    expect(runtime.nextFireAt).toEqual(new Date('2026-11-10T12:00:00Z')); // 06:00 CST
    expect(warnings).toEqual([]);

    const detail = (await getRuntimeSchedule(db, runtime.id))!;
    expect(detail.items.map((i) => i.masterName)).toEqual(['Blend Batch', 'Inspect']);
    expect(detail.items[0]!.children.map((i) => i.masterName)).toEqual(['Move', 'Lab']);
    expect(detail.items[0]).toMatchObject({ disabled: false, masterVersion: '1.0.0', masterState: 'Effective', newerVersionAvailable: false });
    expect(JSON.stringify(detail)).not.toContain('spec_jsonb');
    expect(JSON.stringify(detail)).not.toContain('specJsonb');
    const rows = await db.select().from(runtimeScheduleItem).where(eq(runtimeScheduleItem.runtimeScheduleId, runtime.id));
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.specJsonb !== null && r.workflowId !== null)).toBe(true);
    const listed = await listRuntimeSchedules(db, wc.id);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('specJsonb');

    await db.update(runtimeSchedule).set({ status: 'cancelled', endedAt: NOW }).where(eq(runtimeSchedule.id, runtime.id));
    const second = await enableMasterSchedule(db, m.id, actor, NOW);
    expect(second.runtime.label).toBe('RS-2');
    expect((await listRuntimeSchedules(db, wc.id, 'active')).map((r) => r.label)).toEqual(['RS-2']);
  } finally { await close(); }
});

test('a literal default left out of the params is frozen in', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await seedFlows(wf);
    const m = await master(db, wc.id);
    const { runtime } = await enableMasterSchedule(db, m.id, actor, NOW);
    const detail = (await getRuntimeSchedule(db, runtime.id))!;
    expect(detail.items[0]!.params).toEqual({ BatchId: { value: 'B-1' }, Size: { value: '25' } });
    // property-typed parameter is not frozen as a value; empty literal default is not either
    expect(detail.items[1]!.params).toEqual({ Size: { value: '25' } });
  } finally { await close(); }
});

test('every problem is reported together under ENABLE_INVALID', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await wf('Parent'); await wf('Kid');
    const m = await createMasterSchedule(db, wc.id, {
      name: 'Bad', recurrence: { type: 'once', at: '2026-11-01T06:00' },
      items: [
        { workflow: { name: 'Missing' } },
        { workflow: { name: 'Parent' }, params: { Nope: { value: 'x' } }, chain: [
          { workflow: { name: 'Kid' }, triggerOn: ['completed'], params: { BatchId: { from: 'trigger.output', name: 'NotAnOutput' } } },
          { workflow: { name: 'Kid' }, triggerOn: ['completed'], params: { BatchId: { from: 'trigger.input', name: 'BatchId' } } },
          { workflow: { name: 'Kid' }, triggerOn: ['completed'], params: { BatchId: { from: 'trigger.input', name: 'FromProp' } } },
        ] },
      ],
    }, actor);
    const err = await errOf(enableMasterSchedule(db, m.id, actor, NOW));
    expect(err?.code).toBe('ENABLE_INVALID');
    const problems = err!.details as Array<{ path: string; code: string; message: string }>;
    const codes = problems.map((p) => `${p.path}|${p.code}`);
    expect(codes).toEqual(expect.arrayContaining([
      'items[0].workflow|WORKFLOW_NOT_FOUND',
      'items[1].params.Nope|PARAM_UNKNOWN',
      'items[1].chain[0].params.BatchId|TRIGGER_OUTPUT_UNKNOWN',
      'items[1].chain[1].params.BatchId|TRIGGER_INPUT_NO_VALUE',
      'items[1].chain[2].params.BatchId|TRIGGER_INPUT_PROPERTY',
      '|NO_FUTURE_START',
    ]));
    expect(problems).toHaveLength(6);
    expect(problems.find((p) => p.code === 'TRIGGER_INPUT_PROPERTY')!.message).toMatch(/output/i);
    expect(await db.select().from(runtimeSchedule)).toHaveLength(0);
  } finally { await close(); }
});

test('a fixed value that fails validation is a problem', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await wf('Solo');
    const m = await createMasterSchedule(db, wc.id, {
      name: 'Long', recurrence: FUTURE, items: [{ workflow: { name: 'Solo' }, params: { BatchId: { value: 'x'.repeat(10_001) } } }],
    }, actor);
    const err = await errOf(enableMasterSchedule(db, m.id, actor, NOW));
    expect((err!.details as any[]).map((p) => p.code)).toEqual(['PARAM_INVALID']);
  } finally { await close(); }
});

test('pinned versions: Superseded and Obsolete refused, Draft warns; unpinned picks in-force Effective, else fallback with a warning', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await wf('Old', '1.0.0', 'Superseded'); await wf('Gone', '1.0.0', 'Obsolete');
    await wf('Dr', '2.0.0', 'Draft'); await wf('Pick', '1.0.0', 'Effective'); await wf('Pick', '2.0.0', 'Draft');
    await wf('OnlyDraft', '1.0.0', 'Draft');
    const bad = await createMasterSchedule(db, wc.id, {
      name: 'Bad', recurrence: FUTURE,
      items: [{ workflow: { name: 'Old', version: '1.0.0' } }, { workflow: { name: 'Gone', version: '1.0.0' } }],
    }, actor);
    const err = await errOf(enableMasterSchedule(db, bad.id, actor, NOW));
    expect(err?.code).toBe('ENABLE_INVALID');
    expect((err!.details as any[]).map((p) => p.code)).toEqual(['WORKFLOW_UNUSABLE', 'WORKFLOW_UNUSABLE']);

    const ok = await createMasterSchedule(db, wc.id, {
      name: 'Ok', recurrence: FUTURE,
      items: [{ workflow: { name: 'Dr', version: '2.0.0' } }, { workflow: { name: 'Pick' } }, { workflow: { name: 'OnlyDraft' } }],
    }, actor);
    const { runtime, warnings } = await enableMasterSchedule(db, ok.id, actor, NOW);
    const items = (await getRuntimeSchedule(db, runtime.id))!.items;
    expect(items.map((i) => [i.masterName, i.masterVersion, i.masterState])).toEqual([
      ['Dr', '2.0.0', 'Draft'], ['Pick', '1.0.0', 'Effective'], ['OnlyDraft', '1.0.0', 'Draft'],
    ]);
    expect(items[1]!.newerVersionAvailable).toBe(false);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('Dr');
    expect(warnings[1]).toContain('OnlyDraft');
  } finally { await close(); }
});

test('newerVersionAvailable appears once a later version is in force', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await wf('Solo', '1.0.0');
    const m = await createMasterSchedule(db, wc.id, { name: 'N', recurrence: FUTURE, items: [{ workflow: { name: 'Solo' } }] }, actor);
    const { runtime } = await enableMasterSchedule(db, m.id, actor, NOW);
    await wf('Solo', '2.0.0');
    // 2.0.0 is Effective too, both in force with no effective_from; the newer version wins.
    const detail = (await getRuntimeSchedule(db, runtime.id))!;
    expect(detail.items[0]).toMatchObject({ masterVersion: '1.0.0', newerVersionAvailable: true });
  } finally { await close(); }
});

test('a second Enable while live is RUNTIME_ACTIVE; allowed again after it ends', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await seedFlows(wf);
    const m = await master(db, wc.id);
    const first = await enableMasterSchedule(db, m.id, actor, NOW);
    expect((await errOf(enableMasterSchedule(db, m.id, actor, NOW)))?.code).toBe('RUNTIME_ACTIVE');
    await db.update(runtimeSchedule).set({ status: 'paused' }).where(eq(runtimeSchedule.id, first.runtime.id));
    expect((await errOf(enableMasterSchedule(db, m.id, actor, NOW)))?.code).toBe('RUNTIME_ACTIVE');
    await db.update(runtimeSchedule).set({ status: 'finished', endedAt: NOW }).where(eq(runtimeSchedule.id, first.runtime.id));
    expect((await enableMasterSchedule(db, m.id, actor, NOW)).runtime.label).toBe('RS-2');
  } finally { await close(); }
});

test('previewEnable returns problems, warnings and the next fire times without writing', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await seedFlows(wf);
    const m = await master(db, wc.id, { recurrence: DAILY });
    const p = await previewEnable(db, m.id, NOW);
    expect(p.problems).toEqual([]);
    expect(p.nextFireTimes).toHaveLength(5);
    expect(p.nextFireTimes[0]!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(p.nextFireTimes[1]!.getTime() - p.nextFireTimes[0]!.getTime()).toBe(86_400_000);
    expect(await db.select().from(runtimeSchedule)).toHaveLength(0);
    const bad = await master(db, wc.id, { name: 'Bad', items: [{ workflow: { name: 'Nope' } }] });
    expect((await previewEnable(db, bad.id, NOW)).problems.map((x) => x.code)).toEqual(['WORKFLOW_NOT_FOUND']);
  } finally { await close(); }
});

test('Review Focus: changing the work center zone after Enable changes nothing frozen', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await seedFlows(wf);
    const m = await master(db, wc.id, { recurrence: DAILY });
    const { runtime } = await enableMasterSchedule(db, m.id, actor, NOW);
    const before = (await getRuntimeSchedule(db, runtime.id))!;
    await db.update(workCenter).set({ timeZone: 'Asia/Tokyo' }).where(eq(workCenter.id, wc.id));
    const after = (await getRuntimeSchedule(db, runtime.id))!;
    expect(after.timeZone).toBe('America/Chicago');
    expect(after.nextFireAt).toEqual(before.nextFireAt);
    expect(after.recurrence).toEqual(before.recurrence);
    expect(await effectiveTimeZone(db, wc.id)).toBe('Asia/Tokyo');
  } finally { await close(); }
});

test('effectiveTimeZone: work center, else runtime_id_timezone, else server', async () => {
  const { db, close } = await setup();
  try {
    const [bare] = await db.insert(workCenter).values({ name: 'Bare' }).returning();
    expect(await effectiveTimeZone(db, bare.id)).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    await setRuntimeIdTimezone(db, 'Europe/Paris');
    expect(await effectiveTimeZone(db, bare.id)).toBe('Europe/Paris');
  } finally { await close(); }
});

test('needsAttention counts unacknowledged failed and lost runs; missedWindow follows missed_from', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await seedFlows(wf);
    const m = await master(db, wc.id);
    const { runtime } = await enableMasterSchedule(db, m.id, actor, NOW);
    const [item] = await db.select().from(runtimeScheduleItem).where(eq(runtimeScheduleItem.runtimeScheduleId, runtime.id));
    const [occ] = await db.insert(scheduleOccurrence).values({ runtimeScheduleId: runtime.id, number: 1, scheduledAt: NOW }).returning();
    const [occ2] = await db.insert(scheduleOccurrence).values({ runtimeScheduleId: runtime.id, number: 2, scheduledAt: new Date(NOW.getTime() + 1000) }).returning();
    const items = await db.select().from(runtimeScheduleItem).where(eq(runtimeScheduleItem.runtimeScheduleId, runtime.id));
    await db.insert(scheduleItemRun).values([
      { occurrenceId: occ.id, itemId: items[0]!.id, status: 'failed_to_start' },
      { occurrenceId: occ.id, itemId: items[1]!.id, status: 'lost' },
      { occurrenceId: occ.id, itemId: items[2]!.id, status: 'lost', acknowledgedAt: NOW },
      { occurrenceId: occ2.id, itemId: item!.id, status: 'finished' },
    ]);
    await db.update(runtimeSchedule).set({ missedFrom: NOW, missedTo: NOW }).where(eq(runtimeSchedule.id, runtime.id));
    const [view] = await listRuntimeSchedules(db, wc.id);
    expect(view!.needsAttention).toEqual({ failed: 1, lost: 1, missedWindow: true });

    const page = await listOccurrences(db, runtime.id, { limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ number: 2 });
    expect(page.rows[0]!.runs.map((r) => r.status)).toEqual(['finished']);
  } finally { await close(); }
});

test('deleteWorkflow refuses while a live schedule uses it, names RS-1, and succeeds once ended', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await seedFlows(wf);
    const m = await master(db, wc.id);
    const { runtime } = await enableMasterSchedule(db, m.id, actor, NOW);
    const [row] = await db.select().from(runtimeScheduleItem).where(eq(runtimeScheduleItem.runtimeScheduleId, runtime.id));
    const live = await liveRuntimeScheduleForWorkflow(db, row!.workflowId!);
    expect(live).toEqual({ id: runtime.id, label: 'RS-1' });
    const err = await errOf(deleteWorkflow(db, row!.workflowId!));
    expect(err?.code).toBe('WORKFLOW_IN_USE');
    expect(err?.message).toContain('RS-1');
    await db.update(runtimeSchedule).set({ status: 'cancelled', endedAt: NOW }).where(eq(runtimeSchedule.id, runtime.id));
    expect(await liveRuntimeScheduleForWorkflow(db, row!.workflowId!)).toBeUndefined();
    await deleteWorkflow(db, row!.workflowId!);
    expect(await db.select().from(workflow).where(eq(workflow.id, row!.workflowId!))).toHaveLength(0);
  } finally { await close(); }
});

function draftSpec(): any {
  return {
    local_id: 'Mix', oid: 'wf-1', version: '1.0.0', state: 'Draft', schemaVersion: '4.0',
    steps: [{ local_id: 'Start', oid: 's0', step_type: 'START' }, { local_id: 'Confirm', oid: 's1', step_type: 'USER_INTERACTION' }],
    connections: [], environment_specifications: [],
    children: [
      { local_id: 'Child 1', oid: 'c1', parentChildSpecId: null, version: '1.0.0', state: 'Draft',
        steps: [{ local_id: 'Plate', oid: 's3', step_type: 'USER_INTERACTION' }], connections: [] },
      { local_id: 'Child 2', oid: 'c2', parentChildSpecId: null, version: '1.0.0', state: 'Draft', steps: [], connections: [] },
    ],
  };
}

test('replaceWorkflowEntry retains removed nodes (and their grants) while a live schedule uses the row', async () => {
  const { db, close, wc } = await setup();
  try {
    const first = await ingestWorkflowPackage(db, buildWfmasterx(draftSpec()), { workCenterId: wc.id });
    const [c1] = await db.select().from(workflowNode).where(eq(workflowNode.workflowId, first.workflowId));
    const nodes = await db.select().from(workflowNode).where(eq(workflowNode.workflowId, first.workflowId));
    const child = nodes.find((n) => n.nodeOid === 'c1')!;
    void c1;
    const [op] = await db.insert(role).values({ name: 'Operator c1' }).returning();
    await db.insert(workflowAllowedRole).values({ workflowId: first.workflowId, workflowNodeId: child.id, roleId: op.id });
    const m = await createMasterSchedule(db, wc.id, { name: 'S', recurrence: FUTURE, items: [{ workflow: { name: 'Mix' } }] }, actor);
    const { runtime } = await enableMasterSchedule(db, m.id, actor, NOW);

    const next = draftSpec();
    next.children = [next.children[1]];
    const second = await ingestWorkflowPackage(db, buildWfmasterx(next), { workCenterId: wc.id });
    expect(second).toMatchObject({ status: 'replaced', nodesRemoved: 0, grantsDropped: 0 });
    expect((second as any).nodesRetained).toBeGreaterThan(0);
    const allowed = await resolveStepAllowedRoles(db, {
      workflowId: first.workflowId, specJsonb: { oid: 'rt_1', master_oid: 'c1', steps: [], connections: [] }, recipeNodeOid: 'rt_1',
    });
    expect(allowed).toContain(op.id);

    await db.update(runtimeSchedule).set({ status: 'cancelled', endedAt: NOW }).where(eq(runtimeSchedule.id, runtime.id));
    const later = draftSpec();
    later.children = [later.children[1]];
    later.steps[1].local_id = 'Confirm again';
    const third = await ingestWorkflowPackage(db, buildWfmasterx(later), { workCenterId: wc.id });
    expect(third).toMatchObject({ status: 'replaced', nodesRemoved: 1, nodesRetained: 0, grantsDropped: 1 });
  } finally { await close(); }
});

test('deleteWorkCenter refuses with a live schedule, succeeds when ended, and the record keeps the name', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await seedFlows(wf);
    const m = await master(db, wc.id);
    const { runtime } = await enableMasterSchedule(db, m.id, actor, NOW);
    const err = await errOf(deleteWorkCenter(db, wc.id, { confirmed: true }));
    expect(err?.code).toBe('WORK_CENTER_HAS_ACTIVE_RUNTIME');
    expect(err?.message).toContain('RS-1');
    await db.update(runtimeSchedule).set({ status: 'cancelled', endedAt: NOW }).where(eq(runtimeSchedule.id, runtime.id));
    await deleteWorkCenter(db, wc.id, { confirmed: true });
    const [kept] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, runtime.id));
    expect(kept).toMatchObject({ workCenterId: null, workCenterName: 'Line 1' });
  } finally { await close(); }
});

test('workCenterDeleteImpact counts master schedules', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await seedFlows(wf);
    await master(db, wc.id);
    await master(db, wc.id, { name: 'Other' });
    expect((await workCenterDeleteImpact(db, wc.id)).schedules).toBe(2);
  } finally { await close(); }
});

test('problem paths point at the workflow of a chained item, and an unknown parent parameter has its own code', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await wf('Parent'); await wf('Kid');
    const m = await createMasterSchedule(db, wc.id, {
      name: 'Paths', recurrence: FUTURE,
      items: [{ workflow: { name: 'Parent' }, chain: [
        { workflow: { name: 'Kid' }, triggerOn: ['completed'] },
        { workflow: { name: 'Absent' }, triggerOn: ['completed'] },
        { workflow: { name: 'Kid' }, triggerOn: ['completed'], params: { BatchId: { from: 'trigger.input', name: 'NoSuchParam' } } },
      ] }],
    }, actor);
    const err = await errOf(enableMasterSchedule(db, m.id, actor, NOW));
    const problems = err!.details as Array<{ path: string; code: string }>;
    expect(problems.map((p) => `${p.path}|${p.code}`)).toEqual([
      'items[0].chain[1].workflow|WORKFLOW_NOT_FOUND',
      'items[0].chain[2].params.BatchId|UNKNOWN_PARENT_PARAMETER',
    ]);
  } finally { await close(); }
});

test('a pinned future-dated Effective version is refused and the message names the version', async () => {
  const { db, close, wc } = await setup();
  try {
    await db.insert(workflow).values({
      oid: 'o-F', name: 'Future', workCenterId: wc.id, version: '3.0.0', state: 'Effective',
      effectiveFrom: new Date('2027-01-01T00:00:00Z'), specJsonb: spec(),
    });
    const m = await createMasterSchedule(db, wc.id, {
      name: 'F', recurrence: FUTURE, items: [{ workflow: { name: 'Future', version: '3.0.0' } }],
    }, actor);
    const err = await errOf(enableMasterSchedule(db, m.id, actor, NOW));
    const [problem] = err!.details as Array<{ path: string; code: string; message: string }>;
    expect(problem).toMatchObject({ path: 'items[0].workflow', code: 'WORKFLOW_NOT_FOUND' });
    expect(problem!.message).toContain('3.0.0');
  } finally { await close(); }
});

test('a Draft reload after Enable leaves the frozen spec unchanged', async () => {
  const { db, close, wc } = await setup();
  try {
    const first = await ingestWorkflowPackage(db, buildWfmasterx(draftSpec()), { workCenterId: wc.id });
    const m = await createMasterSchedule(db, wc.id, { name: 'S', recurrence: FUTURE, items: [{ workflow: { name: 'Mix' } }] }, actor);
    const { runtime } = await enableMasterSchedule(db, m.id, actor, NOW);
    const [row] = await db.select().from(workflow).where(eq(workflow.id, first.workflowId));
    const [frozenBefore] = await db.select().from(runtimeScheduleItem).where(eq(runtimeScheduleItem.runtimeScheduleId, runtime.id));
    expect(frozenBefore!.specJsonb).toEqual(row!.specJsonb);

    const next = draftSpec();
    next.steps[1].local_id = 'Confirm twice';
    const second = await ingestWorkflowPackage(db, buildWfmasterx(next), { workCenterId: wc.id });
    expect(second.status).toBe('replaced');
    const [live] = await db.select().from(workflow).where(eq(workflow.id, first.workflowId));
    expect(live!.specJsonb).not.toEqual(row!.specJsonb);
    const [frozenAfter] = await db.select().from(runtimeScheduleItem).where(eq(runtimeScheduleItem.runtimeScheduleId, runtime.id));
    expect(frozenAfter!.specJsonb).toEqual(row!.specJsonb);
  } finally { await close(); }
});

test('enabling a Master that no longer exists is MASTER_SCHEDULE_NOT_FOUND', async () => {
  const { db, close } = await setup();
  try {
    expect((await errOf(enableMasterSchedule(db, '00000000-0000-0000-0000-000000000000', actor, NOW)))?.code).toBe('MASTER_SCHEDULE_NOT_FOUND');
  } finally { await close(); }
});

test('listRuntimeScheduleEvents returns the log newest first, with actor and detail, and pages', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await seedFlows(wf);
    const m = await master(db, wc.id);
    const { runtime } = await enableMasterSchedule(db, m.id, actor, NOW);
    const at = (min: number) => new Date(Date.now() + (60 + min) * 60_000); // after the real-clock Enable event
    await db.insert(runtimeScheduleEvent).values([
      { runtimeScheduleId: runtime.id, actorKind: 'user', actorName: 'Una', action: 'paused', at: at(1) },
      { runtimeScheduleId: runtime.id, actorKind: 'system', action: 'slot_fired', detail: { number: 1 }, at: at(2) },
      { runtimeScheduleId: null, actorKind: 'system', action: 'master_created', at: at(3) },
    ]);
    const page = await listRuntimeScheduleEvents(db, runtime.id, { limit: 10, offset: 0 });
    expect(page.total).toBe(3); // enabled + paused + slot_fired; the Master's own event is not this Runtime's
    expect(page.rows.map((r) => r.action)).toEqual(['slot_fired', 'paused', 'enabled']);
    expect(page.rows[0]).toMatchObject({ actorKind: 'system', actorName: null, detail: { number: 1 } });
    expect(page.rows[1]).toMatchObject({ actorKind: 'user', actorName: 'Una' });
    const second = await listRuntimeScheduleEvents(db, runtime.id, { limit: 1, offset: 1 });
    expect(second.rows.map((r) => r.action)).toEqual(['paused']);
  } finally { await close(); }
});

test('listOccurrences tells each run where to open: live instance, else history row, else nothing', async () => {
  const { db, close, wc, wf } = await setup();
  try {
    await seedFlows(wf);
    const m = await master(db, wc.id);
    const { runtime } = await enableMasterSchedule(db, m.id, actor, NOW);
    const items = await db.select().from(runtimeScheduleItem).where(eq(runtimeScheduleItem.runtimeScheduleId, runtime.id));
    const [occ] = await db.insert(scheduleOccurrence).values({ runtimeScheduleId: runtime.id, number: 1, scheduledAt: NOW }).returning();
    const [wfRow] = await db.select().from(workflow).limit(1);
    const frozen = { runtimeNumber: 1, masterName: 'Blend Batch', masterOid: 'o', masterVersion: '1.0.0', masterState: 'Effective' };
    const [inst] = await db.insert(workflowInstance).values({
      workflowId: wfRow!.id, workCenterId: wc.id, triggeredBy: 'schedule', specJsonb: {}, runtimeLabel: 'RW-1', ...frozen,
    }).returning();
    const [hist] = await db.insert(runtimeHistory).values({
      workflowInstanceId: '00000000-0000-4000-8000-000000000001', workCenterId: wc.id, workCenterName: 'Line 1',
      runtimeLabel: 'RW-2', finalState: 'completed', finishedAt: NOW, trace: [], ...frozen,
    }).returning();
    await db.insert(scheduleItemRun).values([
      { occurrenceId: occ!.id, itemId: items[0]!.id, status: 'started', workflowInstanceId: inst!.id },
      { occurrenceId: occ!.id, itemId: items[1]!.id, status: 'finished', workflowInstanceId: '00000000-0000-4000-8000-000000000001' },
      { occurrenceId: occ!.id, itemId: items[2]!.id, status: 'failed_to_start' },
    ]);
    const runs = (await listOccurrences(db, runtime.id, { limit: 5, offset: 0 })).rows[0]!.runs;
    const byItem = new Map(runs.map((r) => [r.itemId, r.open]));
    expect(byItem.get(items[0]!.id)).toEqual({ kind: 'live', id: inst!.id });
    expect(byItem.get(items[1]!.id)).toEqual({ kind: 'history', id: hist!.id });
    expect(byItem.get(items[2]!.id)).toBeNull();
    expect(runs.find((r) => r.itemId === items[0]!.id)!.itemName).toBe(items[0]!.masterName);
  } finally { await close(); }
});
