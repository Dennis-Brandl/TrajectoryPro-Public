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
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { runtimeCols } from '../../test/helpers/instances.js';
import { buildWfmasterx } from '../seed/sample-bundle.js';
import { ingestWorkflowPackage } from './wfmasterx.js';
import { insertWorkflowEntry } from './insert-workflow-entry.js';
import { replaceWorkflowEntry } from './replace-workflow-entry.js';
import { instantiateSpec } from '../runtime/instantiate.js';
import { resolveStepAllowedRoles } from '../runtime/assignments.js';
import {
  workflow, workflowNode, workflowUiStep, workflowEnvironment, environmentSpec, workCenter,
  workflowAllowedRole, role, workflowInstance,
} from '../db/schema/index.js';

// A Draft root with two children; UI steps on the root (s1) and on c1 (s3).
function draftSpec(): any {
  return {
    local_id: 'Mix', oid: 'wf-1', version: '1.0.0', state: 'Draft', schemaVersion: '4.0',
    steps: [
      { local_id: 'Start', oid: 's0', step_type: 'START' },
      { local_id: 'Confirm', oid: 's1', step_type: 'USER_INTERACTION' },
    ],
    connections: [],
    environment_specifications: [],
    children: [
      { local_id: 'Child 1', oid: 'c1', parentChildSpecId: null, version: '1.0.0', state: 'Draft',
        steps: [{ local_id: 'Plate', oid: 's3', step_type: 'USER_INTERACTION' }], connections: [] },
      { local_id: 'Child 2', oid: 'c2', parentChildSpecId: null, version: '1.0.0', state: 'Draft',
        steps: [], connections: [] },
    ],
  };
}

async function setup() {
  const t = await makeTestDb();
  const [wc] = await t.db.insert(workCenter).values({ name: 'Line 1' }).returning();
  return { ...t, wc };
}

async function nodeByOid(db: any, workflowId: string, oid: string) {
  const [n] = await db.select().from(workflowNode)
    .where(and(eq(workflowNode.workflowId, workflowId), eq(workflowNode.nodeOid, oid)));
  return n;
}

async function grantOn(db: any, workflowId: string, nodeOid: string) {
  const [op] = await db.insert(role).values({ name: `Operator ${nodeOid}` }).returning();
  const node = await nodeByOid(db, workflowId, nodeOid);
  await db.insert(workflowAllowedRole).values({ workflowId, workflowNodeId: node.id, roleId: op.id });
  return node;
}

test('a changed Draft reload keeps the workflow id and replaces spec_jsonb', async () => {
  const { db, close, wc } = await setup();
  try {
    const first = await ingestWorkflowPackage(db, buildWfmasterx(draftSpec()), { workCenterId: wc.id });
    const next = draftSpec();
    next.steps[1].local_id = 'Confirm twice';
    const second = await ingestWorkflowPackage(db, buildWfmasterx(next), { workCenterId: wc.id });
    expect(second.status).toBe('replaced');
    expect(second.workflowId).toBe(first.workflowId);
    const rows = await db.select().from(workflow);
    expect(rows).toHaveLength(1);
    expect((rows[0].specJsonb as any).steps[1].local_id).toBe('Confirm twice');
    const [ui] = await db.select().from(workflowUiStep).where(eq(workflowUiStep.stepOid, 's1'));
    expect(ui.name).toBe('Confirm twice');
  } finally { await close(); }
});

test('node grants survive a reload', async () => {
  const { db, close, wc } = await setup();
  try {
    const first = await ingestWorkflowPackage(db, buildWfmasterx(draftSpec()), { workCenterId: wc.id });
    const before = await grantOn(db, first.workflowId, 'c1');
    const next = draftSpec();
    next.children[0].local_id = 'Child One';
    const second = await ingestWorkflowPackage(db, buildWfmasterx(next), { workCenterId: wc.id });
    expect(second.status).toBe('replaced');
    const after = await nodeByOid(db, first.workflowId, 'c1');
    expect(after.id).toBe(before.id);
    expect(after.name).toBe('Child One');
    const grants = await db.select().from(workflowAllowedRole).where(eq(workflowAllowedRole.workflowNodeId, before.id));
    expect(grants).toHaveLength(1);
    expect(second).toMatchObject({ nodesRemoved: 0, nodesRetained: 0, grantsDropped: 0 });
  } finally { await close(); }
});

test('a removed node is deleted with its grants when nothing is unfinished', async () => {
  const { db, close, wc } = await setup();
  try {
    const first = await ingestWorkflowPackage(db, buildWfmasterx(draftSpec()), { workCenterId: wc.id });
    await grantOn(db, first.workflowId, 'c1');
    // A finished runtime does not hold the node.
    await db.insert(workflowInstance).values({
      workflowId: first.workflowId, workCenterId: wc.id, triggeredBy: 'manual', status: 'completed', ...runtimeCols(),
    });
    const next = draftSpec();
    next.children = [next.children[1]];
    const second = await ingestWorkflowPackage(db, buildWfmasterx(next), { workCenterId: wc.id });
    expect(second).toMatchObject({ status: 'replaced', nodesRemoved: 1, nodesRetained: 0, grantsDropped: 1 });
    expect(await nodeByOid(db, first.workflowId, 'c1')).toBeUndefined();
    expect(await db.select().from(workflowAllowedRole)).toHaveLength(0);
    expect(await db.select().from(workflowUiStep).where(eq(workflowUiStep.stepOid, 's3'))).toHaveLength(0);
    expect(await db.select().from(workflowNode)).toHaveLength(2);
  } finally { await close(); }
});

test('a removed node is retained while a runtime is unfinished, and removed on a later reload', async () => {
  const { db, close, wc } = await setup();
  try {
    const first = await ingestWorkflowPackage(db, buildWfmasterx(draftSpec()), { workCenterId: wc.id });
    const c1 = await grantOn(db, first.workflowId, 'c1');
    const [inst] = await db.insert(workflowInstance).values({
      workflowId: first.workflowId, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', ...runtimeCols(),
    }).returning();

    const next = draftSpec();
    next.children = [next.children[1]];
    const second = await ingestWorkflowPackage(db, buildWfmasterx(next), { workCenterId: wc.id });
    expect(second).toMatchObject({ status: 'replaced', nodesRemoved: 0, nodesRetained: 1, grantsDropped: 0 });
    // The running step still resolves its roles: the node and its grant are both still there.
    expect((await nodeByOid(db, first.workflowId, 'c1'))?.id).toBe(c1.id);
    expect(await db.select().from(workflowAllowedRole).where(eq(workflowAllowedRole.workflowNodeId, c1.id))).toHaveLength(1);

    await db.update(workflowInstance).set({ status: 'completed' }).where(eq(workflowInstance.id, inst.id));
    const later = draftSpec();
    later.children = [later.children[1]];
    later.steps[1].local_id = 'Confirm again';
    const third = await ingestWorkflowPackage(db, buildWfmasterx(later), { workCenterId: wc.id });
    expect(third).toMatchObject({ status: 'replaced', nodesRemoved: 1, nodesRetained: 0, grantsDropped: 1 });
    expect(await nodeByOid(db, first.workflowId, 'c1')).toBeUndefined();
  } finally { await close(); }
});

test('a new node and a new UI step are inserted; a removed UI step is deleted', async () => {
  const { db, close, wc } = await setup();
  try {
    const first = await ingestWorkflowPackage(db, buildWfmasterx(draftSpec()), { workCenterId: wc.id });
    const next = draftSpec();
    next.steps = [next.steps[0], { local_id: 'Ask', oid: 's9', step_type: 'YES_NO' }]; // s1 gone, s9 new
    // c3 nests under c2 — a new node at depth 2.
    next.children[1].children = [{ local_id: 'Child 3', oid: 'c3', parentChildSpecId: 'c2', version: '1.0.0',
      state: 'Draft', steps: [{ local_id: 'Weigh', oid: 's7', step_type: 'USER_INTERACTION' }], connections: [] }];
    const second = await ingestWorkflowPackage(db, buildWfmasterx(next), { workCenterId: wc.id });
    expect(second).toMatchObject({ status: 'replaced', nodeCount: 4, uiStepCount: 3 });
    const c2 = await nodeByOid(db, first.workflowId, 'c2');
    const c3 = await nodeByOid(db, first.workflowId, 'c3');
    expect(c3).toMatchObject({ parentNodeId: c2.id, depth: 2, name: 'Child 3', parentChildSpecOid: 'c2' });
    const steps = (await db.select().from(workflowUiStep)).map((s) => s.stepOid).sort();
    expect(steps).toEqual(['s3', 's7', 's9']);
    const [s7] = await db.select().from(workflowUiStep).where(eq(workflowUiStep.stepOid, 's7'));
    expect(s7.owningNodeId).toBe(c3.id);
  } finally { await close(); }
});

test('a moved node is re-pointed to its new parent and keeps its id', async () => {
  const { db, close, wc } = await setup();
  try {
    const first = await ingestWorkflowPackage(db, buildWfmasterx(draftSpec()), { workCenterId: wc.id });
    const before = await nodeByOid(db, first.workflowId, 'c1');
    const next = draftSpec();
    const [c1, c2] = next.children;
    c2.children = [c1];
    next.children = [c2];
    await ingestWorkflowPackage(db, buildWfmasterx(next), { workCenterId: wc.id });
    const c2Row = await nodeByOid(db, first.workflowId, 'c2');
    const after = await nodeByOid(db, first.workflowId, 'c1');
    expect(after).toMatchObject({ id: before.id, parentNodeId: c2Row.id, depth: 2 });
  } finally { await close(); }
});

test('a released duplicate stays already_present with the raise-the-version message', async () => {
  const { db, close, wc } = await setup();
  try {
    const spec = { ...draftSpec(), state: 'Effective' };
    await ingestWorkflowPackage(db, buildWfmasterx(spec), { workCenterId: wc.id });
    const changed = structuredClone(spec);
    changed.steps[1].local_id = 'Changed';
    const second = await ingestWorkflowPackage(db, buildWfmasterx(changed), { workCenterId: wc.id });
    expect(second.status).toBe('already_present');
    expect(second.message).toBe('Version 1.0.0 Effective is already loaded; raise the version to load changes.');
    const [row] = await db.select().from(workflow);
    expect((row.specJsonb as any).steps[1].local_id).toBe('Confirm');
  } finally { await close(); }
});

test('an identical reload is already_present with "No changes since the last load."', async () => {
  const { db, close, wc } = await setup();
  try {
    const buf = buildWfmasterx(draftSpec());
    const first = await ingestWorkflowPackage(db, buf, { workCenterId: wc.id });
    const [before] = await db.select().from(workflow);
    const second = await ingestWorkflowPackage(db, buf, { workCenterId: wc.id });
    expect(second).toMatchObject({ status: 'already_present', workflowId: first.workflowId,
      message: 'No changes since the last load.', nodesRemoved: 0, nodesRetained: 0, grantsDropped: 0 });
    const [after] = await db.select().from(workflow);
    expect(after.downloadedAt).toEqual(before.downloadedAt);
  } finally { await close(); }
});

test('a workflow reload updates its own embedded environment row but not other workflows', async () => {
  const { db, close, wc } = await setup();
  try {
    const env = { local_id: 'Kitchen', oid: 'env-1', version: '1.0.0', state: 'Draft', included_actions: [] };
    const a = { ...draftSpec(), environment_specifications: [env] };
    const b = { ...draftSpec(), oid: 'wf-2', local_id: 'Other', environment_specifications: [env] };
    await ingestWorkflowPackage(db, buildWfmasterx(a), { workCenterId: wc.id });
    const bLoad = await ingestWorkflowPackage(db, buildWfmasterx(b), { workCenterId: wc.id });
    const [envBefore] = await db.select().from(environmentSpec);

    const env2 = { ...env, included_actions: [{ local_id: 'Heat', oid: 'act-1' }] };
    const a2 = { ...draftSpec(), environment_specifications: [env2] };
    const second = await ingestWorkflowPackage(db, buildWfmasterx(a2), { workCenterId: wc.id });
    expect(second.status).toBe('replaced');
    const envRows = await db.select().from(environmentSpec);
    expect(envRows).toHaveLength(1);
    expect(envRows[0].id).toBe(envBefore.id);
    expect((envRows[0].specJsonb as any).included_actions).toHaveLength(1);
    const [bRow] = await db.select().from(workflow).where(eq(workflow.id, bLoad.workflowId));
    expect((bRow.specJsonb as any).environment_specifications[0].included_actions).toHaveLength(0);
  } finally { await close(); }
});

test('an environment-only change (library entry) is replaced even when the workflow spec is unchanged', async () => {
  const { db, close, wc } = await setup();
  try {
    const lib = (actions: any[]) => [{ libName: 'KitchenLib', lib: { local_id: 'KitchenLib', oid: 'lib-1', version: '1.0.0',
      environment_specifications: [{ local_id: 'Kitchen', oid: 'env-1', version: '1.0.0', state: 'Draft', included_actions: actions }] } }];
    await ingestWorkflowPackage(db, buildWfmasterx(draftSpec(), lib([])), { workCenterId: wc.id });
    const second = await ingestWorkflowPackage(db, buildWfmasterx(draftSpec(), lib([{ local_id: 'Heat', oid: 'act-1' }])), { workCenterId: wc.id });
    expect(second.status).toBe('replaced');
    expect(second.message).toBeUndefined();
    // Env-only replace reports the workflow's actual counts, not 0.
    expect(second).toMatchObject({ nodeCount: 3, uiStepCount: 2 });
    const [envRow] = await db.select().from(environmentSpec);
    expect((envRow.specJsonb as any).included_actions).toHaveLength(1);
  } finally { await close(); }
});

test('links to environments no longer embedded are removed', async () => {
  const { db, close, wc } = await setup();
  try {
    const e1 = { local_id: 'Kitchen', oid: 'env-1', version: '1.0.0', state: 'Draft', included_actions: [] };
    const e2 = { local_id: 'Pantry', oid: 'env-2', version: '1.0.0', state: 'Draft', included_actions: [] };
    const first = await ingestWorkflowPackage(db, buildWfmasterx({ ...draftSpec(), environment_specifications: [e1, e2] }), { workCenterId: wc.id });
    expect(await db.select().from(workflowEnvironment)).toHaveLength(2);
    const second = await ingestWorkflowPackage(db, buildWfmasterx({ ...draftSpec(), environment_specifications: [e1] }), { workCenterId: wc.id });
    expect(second).toMatchObject({ status: 'replaced', envCount: 1 });
    const links = await db.select().from(workflowEnvironment).where(eq(workflowEnvironment.workflowId, first.workflowId));
    const [e1Row] = await db.select().from(environmentSpec).where(eq(environmentSpec.oid, 'env-1'));
    expect(links.map((l) => l.environmentSpecId)).toEqual([e1Row.id]);
  } finally { await close(); }
});

test('dispatch_policy and auto_claim are unchanged by a reload', async () => {
  const { db, close, wc } = await setup();
  try {
    const first = await ingestWorkflowPackage(db, buildWfmasterx(draftSpec()), { workCenterId: wc.id });
    const eff = new Date('2026-01-01T00:00:00Z');
    await db.update(workflow).set({ dispatchPolicy: 'round_robin', autoClaim: true, effectiveFrom: eff })
      .where(eq(workflow.id, first.workflowId));
    const next = draftSpec();
    next.local_id = 'Mix Renamed';
    const second = await ingestWorkflowPackage(db, buildWfmasterx(next), { workCenterId: wc.id, sourceFilename: 'mix2.WFmasterX' });
    expect(second.status).toBe('replaced');
    const [row] = await db.select().from(workflow);
    expect(row).toMatchObject({ dispatchPolicy: 'round_robin', autoClaim: true, effectiveFrom: eff,
      name: 'Mix Renamed', sourceFilename: 'mix2.WFmasterX' });
  } finally { await close(); }
});

// The recipe (remapped) oid of the node instantiated from the given master oid.
function recipeOidOf(spec: any, masterOid: string): string {
  if (spec.master_oid === masterOid) return spec.oid;
  for (const c of spec.children ?? []) { const hit = recipeOidOf(c, masterOid); if (hit) return hit; }
  return '';
}

test('a re-parented node keeps resolving the roles of its snapshot ancestry for a running runtime', async () => {
  const { db, close, wc } = await setup();
  try {
    // R > P (granted X) > c1 (no grants of its own).
    const tree = draftSpec();
    const [c1, c2] = tree.children;
    tree.children = [{ local_id: 'P', oid: 'p', parentChildSpecId: null, version: '1.0.0', state: 'Draft',
      steps: [], connections: [], children: [c1] }, c2];
    const first = await ingestWorkflowPackage(db, buildWfmasterx(tree), { workCenterId: wc.id });
    const p = await nodeByOid(db, first.workflowId, 'p');
    const [x] = await db.insert(role).values({ name: 'X' }).returning();
    await db.insert(workflowAllowedRole).values({ workflowId: first.workflowId, workflowNodeId: p.id, roleId: x.id });

    const running = instantiateSpec(tree);
    await db.insert(workflowInstance).values({
      workflowId: first.workflowId, workCenterId: wc.id, triggeredBy: 'manual', status: 'running',
      ...runtimeCols({ specJsonb: running }),
    });
    const runningArgs = { workflowId: first.workflowId, specJsonb: running, recipeNodeOid: recipeOidOf(running, 'c1') };
    expect(await resolveStepAllowedRoles(db, runningArgs)).toEqual([x.id]);

    // Reload with c1 lifted directly under R (ungranted); P stays, still granted.
    const moved = structuredClone(tree);
    moved.children = [moved.children[0], moved.children[0].children[0], moved.children[1]];
    moved.children[0].children = [];
    const second = await ingestWorkflowPackage(db, buildWfmasterx(moved), { workCenterId: wc.id });
    expect(second.status).toBe('replaced');
    const c1Row = await nodeByOid(db, first.workflowId, 'c1');
    expect(c1Row.parentNodeId).not.toBe(p.id); // the live tree really moved

    // (a) The running runtime still resolves c1 through its snapshot: R > P > c1.
    expect(await resolveStepAllowedRoles(db, runningArgs)).toEqual([x.id]);

    // (b) A new runtime from the reloaded spec follows the new tree: c1 under R, unrestricted.
    const [row] = await db.select().from(workflow).where(eq(workflow.id, first.workflowId));
    const fresh = instantiateSpec(row.specJsonb);
    expect(await resolveStepAllowedRoles(db, {
      workflowId: first.workflowId, specJsonb: fresh, recipeNodeOid: recipeOidOf(fresh, 'c1'),
    })).toEqual([]);
  } finally { await close(); }
});

test('replaceWorkflowEntry overwrites type_name and clears it when the package has none', async () => {
  const { db, close, wc } = await setup();
  try {
    const meta = { workCenterId: wc.id, version: '1.0.0', state: 'Draft' };
    const ins = await insertWorkflowEntry(db, { ...draftSpec(), type_name: 'Phase' }, meta);
    const typeNow = async () => (await db.select().from(workflow).where(eq(workflow.id, ins.workflowId)))[0]!.typeName;
    expect(await typeNow()).toBe('Phase');
    await db.transaction((tx) => replaceWorkflowEntry(tx, ins.workflowId, { ...draftSpec(), type_name: 'Operation' }, meta));
    expect(await typeNow()).toBe('Operation');
    await db.transaction((tx) => replaceWorkflowEntry(tx, ins.workflowId, draftSpec(), meta));
    expect(await typeNow()).toBeNull();
  } finally { await close(); }
});
