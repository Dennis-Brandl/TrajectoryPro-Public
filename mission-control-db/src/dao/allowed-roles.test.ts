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

import { expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { workCenter, workflow, workflowNode, workflowUiStep, role } from '../db/schema/index.js';
import { listAllowedRoles, addAllowedRole, removeAllowedRole, setAllowedRoles } from './allowed-roles.js';

async function seed(db: any, suffix = '') {
  const [wc] = await db.insert(workCenter).values({ name: 'Line 1' + suffix }).returning();
  const [wf] = await db.insert(workflow).values({
    oid: 'wf-1', name: 'Bottle Fill', workCenterId: wc.id, specJsonb: {},
  }).returning();
  const [node] = await db.insert(workflowNode).values({
    workflowId: wf.id, nodeOid: 'n-1', name: 'Fill Station', depth: 0,
  }).returning();
  await db.insert(workflowUiStep).values({
    workflowId: wf.id, owningNodeId: node.id, stepOid: 's-1', stepType: 'USER_INTERACTION',
  });
  const [r] = await db.insert(role).values({ name: 'Operator' + suffix }).returning();
  return { wcId: wc.id, wfId: wf.id, nodeId: node.id, roleId: r.id };
}

test('listAllowedRoles returns UI nodes with their assigned roles, keyed on the workflow', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wfId, nodeId, roleId } = await seed(db);
    await addAllowedRole(db, { workflowId: wfId, nodeId, roleId });
    const view = await listAllowedRoles(db, wfId);
    expect(view?.workflowId).toBe(wfId);
    expect(view?.nodes).toHaveLength(1);
    expect(view?.nodes[0]).toMatchObject({ nodeId, nodeName: 'Fill Station', roleIds: [roleId] });
  } finally { await close(); }
});

test('listAllowedRoles returns undefined for an unknown workflow', async () => {
  const { db, close } = await makeTestDb();
  try {
    expect(await listAllowedRoles(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined();
  } finally { await close(); }
});

test('addAllowedRole rejects a node belonging to another workflow', async () => {
  const { db, close } = await makeTestDb();
  try {
    const a = await seed(db, '-a');
    const b = await seed(db, '-b');
    await expect(addAllowedRole(db, { workflowId: a.wfId, nodeId: b.nodeId, roleId: a.roleId }))
      .rejects.toMatchObject({ code: 'LINK_TARGET_NOT_FOUND' });
  } finally { await close(); }
});

test('addAllowedRole is idempotent and removeAllowedRole undoes it', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wfId, nodeId, roleId } = await seed(db);
    await addAllowedRole(db, { workflowId: wfId, nodeId, roleId });
    await addAllowedRole(db, { workflowId: wfId, nodeId, roleId });
    expect((await listAllowedRoles(db, wfId))?.nodes[0].roleIds).toEqual([roleId]);
    await removeAllowedRole(db, { workflowId: wfId, nodeId, roleId });
    expect((await listAllowedRoles(db, wfId))?.nodes[0].roleIds).toEqual([]);
  } finally { await close(); }
});

test('two work centers holding the same oid keep independent role assignments', async () => {
  const { db, close } = await makeTestDb();
  try {
    const a = await seed(db, '-a');
    const b = await seed(db, '-b');
    await addAllowedRole(db, { workflowId: a.wfId, nodeId: a.nodeId, roleId: a.roleId });
    expect((await listAllowedRoles(db, a.wfId))?.nodes[0].roleIds).toHaveLength(1);
    expect((await listAllowedRoles(db, b.wfId))?.nodes[0].roleIds).toHaveLength(0);
  } finally { await close(); }
});

test('setAllowedRoles replaces the whole grant set', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wfId, nodeId, roleId } = await seed(db);
    const [other] = await db.insert(role).values({ name: 'Supervisor' }).returning();
    await addAllowedRole(db, { workflowId: wfId, nodeId, roleId });

    const view = await setAllowedRoles(db, wfId, [{ nodeId, roleIds: [other.id] }]);
    expect(view?.nodes[0].roleIds).toEqual([other.id]);
    expect((await listAllowedRoles(db, wfId))?.nodes[0].roleIds).toEqual([other.id]);
  } finally { await close(); }
});

test('setAllowedRoles with an empty roleIds list clears every grant', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wfId, nodeId, roleId } = await seed(db);
    await addAllowedRole(db, { workflowId: wfId, nodeId, roleId });
    await setAllowedRoles(db, wfId, [{ nodeId, roleIds: [] }]);
    expect((await listAllowedRoles(db, wfId))?.nodes[0].roleIds).toEqual([]);
  } finally { await close(); }
});

test('setAllowedRoles rejects a node from another workflow AND writes nothing', async () => {
  const { db, close } = await makeTestDb();
  try {
    const a = await seed(db, '-a');
    const b = await seed(db, '-b');
    await addAllowedRole(db, { workflowId: a.wfId, nodeId: a.nodeId, roleId: a.roleId });

    await expect(setAllowedRoles(db, a.wfId, [
      { nodeId: a.nodeId, roleIds: [] },        // would have cleared it
      { nodeId: b.nodeId, roleIds: [a.roleId] }, // the offending entry
    ])).rejects.toMatchObject({ code: 'LINK_TARGET_NOT_FOUND' });

    // The pre-existing grant must survive: validation runs before any write.
    expect((await listAllowedRoles(db, a.wfId))?.nodes[0].roleIds).toEqual([a.roleId]);
  } finally { await close(); }
});

test('setAllowedRoles rejects an unknown role AND writes nothing', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wfId, nodeId, roleId } = await seed(db);
    await addAllowedRole(db, { workflowId: wfId, nodeId, roleId });
    const NIL = '00000000-0000-0000-0000-000000000000';

    await expect(setAllowedRoles(db, wfId, [{ nodeId, roleIds: [NIL] }]))
      .rejects.toMatchObject({ code: 'LINK_TARGET_NOT_FOUND' });
    expect((await listAllowedRoles(db, wfId))?.nodes[0].roleIds).toEqual([roleId]);
  } finally { await close(); }
});

test('setAllowedRoles returns undefined for an unknown workflow', async () => {
  const { db, close } = await makeTestDb();
  try {
    expect(await setAllowedRoles(db, '00000000-0000-0000-0000-000000000000', []))
      .toBeUndefined();
  } finally { await close(); }
});

test('setAllowedRoles with no nodes clears every existing grant', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wfId, nodeId, roleId } = await seed(db);
    await addAllowedRole(db, { workflowId: wfId, nodeId, roleId });

    const view = await setAllowedRoles(db, wfId, []);
    expect(view?.nodes[0].roleIds).toEqual([]);
    expect((await listAllowedRoles(db, wfId))?.nodes[0].roleIds).toEqual([]);
  } finally { await close(); }
});

test('setAllowedRoles merges repeated nodeId entries into the union of their roles', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wfId, nodeId, roleId } = await seed(db);
    const [other] = await db.insert(role).values({ name: 'Supervisor' }).returning();

    // roleId is named by BOTH entries for the same node — without merging, that is a literal
    // duplicate (workflowId, workflowNodeId, roleId) row and trips the unique constraint. The
    // union across both entries must still resolve to {roleId, other.id}, not throw.
    const view = await setAllowedRoles(db, wfId, [
      { nodeId, roleIds: [roleId, other.id] },
      { nodeId, roleIds: [roleId] },
    ]);
    expect(view?.nodes[0].roleIds.slice().sort()).toEqual([roleId, other.id].sort());
    expect((await listAllowedRoles(db, wfId))?.nodes[0].roleIds.slice().sort()).toEqual([roleId, other.id].sort());
  } finally { await close(); }
});

test('setAllowedRoles translates an insert-time FK violation into LINK_TARGET_NOT_FOUND', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wfId, nodeId, roleId } = await seed(db);

    // PGlite serializes every query onto one connection, so a real concurrent transaction
    // can't be forced through this harness (see wfmasterx.test.ts's poisoned-transaction test
    // for the same constraint). This reproduces the same insert-time failure deterministically:
    // intercept setAllowedRoles's own db.transaction call and delete the just-validated role
    // immediately before it runs, landing the delete exactly between validation and the write.
    const realTransaction = db.transaction.bind(db);
    const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(async (cb: any) => {
      await db.delete(role).where(eq(role.id, roleId));
      return realTransaction(cb);
    });
    try {
      await expect(setAllowedRoles(db, wfId, [{ nodeId, roleIds: [roleId] }]))
        .rejects.toMatchObject({ code: 'LINK_TARGET_NOT_FOUND' });
    } finally {
      spy.mockRestore();
    }
  } finally { await close(); }
});

// ── D9 tree widening (spec 2026-08-14): ancestors of UI-owning nodes are editable ────────

test('listAllowedRoles includes ancestors of UI-owning nodes, excludes UI-less branches', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Tree WC' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'wf-t', name: 'Treeflow', workCenterId: wc.id, specJsonb: {},
    }).returning();
    // root (no UI steps) -> child (owns a UI step); plus a UI-less sibling branch.
    const [root] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n-root', name: 'Root', depth: 0,
    }).returning();
    const [child] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n-child', name: 'Review', parentNodeId: root.id, depth: 1,
    }).returning();
    await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n-bare', name: 'No UI here', parentNodeId: root.id, depth: 1,
    });
    await db.insert(workflowUiStep).values({
      workflowId: wf.id, owningNodeId: child.id, stepOid: 's-r1', stepType: 'YES_NO',
    });

    const view = await listAllowedRoles(db, wf.id);
    expect(view?.nodes.map((n) => n.nodeName)).toEqual(['Root', 'Review']); // depth order; bare branch excluded
    expect(view?.nodes[0]).toMatchObject({ nodeId: root.id, depth: 0, ownsUiSteps: false });
    expect(view?.nodes[1]).toMatchObject({ nodeId: child.id, depth: 1, ownsUiSteps: true });
  } finally { await close(); }
});

test('listAllowedRoles orders multi-branch trees DFS pre-order so indentation nests correctly (review fix)', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'DFS WC' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'wf-dfs', name: 'DFSflow', workCenterId: wc.id, specJsonb: {},
    }).returning();
    // Root -> Assembly(d1) -> Check(d2, owns UI); Root -> Zoning(d1, owns UI).
    // Level order would emit [Root, Assembly, Zoning, Check], visually nesting Check under
    // Zoning; pre-order must keep Check directly under Assembly.
    const [root] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n-root', name: 'Root', depth: 0,
    }).returning();
    const [assembly] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n-asm', name: 'Assembly', parentNodeId: root.id, depth: 1,
    }).returning();
    const [zoning] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n-zone', name: 'Zoning', parentNodeId: root.id, depth: 1,
    }).returning();
    const [check] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n-check', name: 'Check', parentNodeId: assembly.id, depth: 2,
    }).returning();
    await db.insert(workflowUiStep).values({
      workflowId: wf.id, owningNodeId: check.id, stepOid: 's-c1', stepType: 'USER_INTERACTION',
    });
    await db.insert(workflowUiStep).values({
      workflowId: wf.id, owningNodeId: zoning.id, stepOid: 's-z1', stepType: 'USER_INTERACTION',
    });

    const view = await listAllowedRoles(db, wf.id);
    expect(view?.nodes.map((n) => n.nodeName)).toEqual(['Root', 'Assembly', 'Check', 'Zoning']);
  } finally { await close(); }
});

test('setAllowedRoles accepts a grant on an included ancestor node', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Tree WC 2' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'wf-t2', name: 'Treeflow2', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [root] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n-root', name: 'Root', depth: 0,
    }).returning();
    const [child] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n-child', name: 'Entry', parentNodeId: root.id, depth: 1,
    }).returning();
    await db.insert(workflowUiStep).values({
      workflowId: wf.id, owningNodeId: child.id, stepOid: 's-1', stepType: 'USER_INTERACTION',
    });
    const [r] = await db.insert(role).values({ name: 'Ancestor Role' }).returning();

    const view = await setAllowedRoles(db, wf.id, [{ nodeId: root.id, roleIds: [r.id] }]);
    expect(view?.nodes.find((n) => n.nodeId === root.id)?.roleIds).toEqual([r.id]);
  } finally { await close(); }
});
