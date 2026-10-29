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
import { workCenter, workflow, workflowNode, workflowAllowedRole, role } from '../db/schema/index.js';
import { buildNodePaths, carryOverConfig } from './carry-over.js';

test('buildNodePaths joins ancestor names root-first', () => {
  const paths = buildNodePaths([
    { id: 'a', parentNodeId: null, name: 'Root' },
    { id: 'b', parentNodeId: 'a', name: 'Fill' },
    { id: 'c', parentNodeId: 'b', name: 'Cap' },
  ]);
  expect(paths.get('a')).toBe('Root');
  expect(paths.get('b')).toBe('Root/Fill');
  expect(paths.get('c')).toBe('Root/Fill/Cap');
});

test('duplicate sibling names make BOTH paths ambiguous (null), never a guess', () => {
  // workflow_node is unique on (workflow_id, node_oid) but NOT on name, so two siblings
  // may share one. Matching on a bare name would silently assign the wrong roles.
  const paths = buildNodePaths([
    { id: 'a', parentNodeId: null, name: 'Root' },
    { id: 'b', parentNodeId: 'a', name: 'Fill' },
    { id: 'c', parentNodeId: 'a', name: 'Fill' },
  ]);
  expect(paths.get('b')).toBeNull();
  expect(paths.get('c')).toBeNull();
  expect(paths.get('a')).toBe('Root');
});

test('the same name under different parents stays unambiguous', () => {
  const paths = buildNodePaths([
    { id: 'a', parentNodeId: null, name: 'Root' },
    { id: 'b', parentNodeId: 'a', name: 'Left' },
    { id: 'c', parentNodeId: 'a', name: 'Right' },
    { id: 'd', parentNodeId: 'b', name: 'Fill' },
    { id: 'e', parentNodeId: 'c', name: 'Fill' },
  ]);
  expect(paths.get('d')).toBe('Root/Left/Fill');
  expect(paths.get('e')).toBe('Root/Right/Fill');
});

test('an orphaned node (missing parent) is ambiguous rather than silently rooted', () => {
  const paths = buildNodePaths([{ id: 'b', parentNodeId: 'missing', name: 'Fill' }]);
  expect(paths.get('b')).toBeNull();
});

test('a literal "/" inside a name cannot collide with the path delimiter', () => {
  // A single combined-operation node named "Fill/Cap" directly under Root must render as a
  // DIFFERENT string than a "Cap" node nested two levels down, under a "Fill" node, under
  // Root — even though an unescaped join would produce "Root/Fill/Cap" for both.
  const combined = buildNodePaths([
    { id: 'root', parentNodeId: null, name: 'Root' },
    { id: 'combo', parentNodeId: 'root', name: 'Fill/Cap' },
  ]);
  const nested = buildNodePaths([
    { id: 'root', parentNodeId: null, name: 'Root' },
    { id: 'fill', parentNodeId: 'root', name: 'Fill' },
    { id: 'cap', parentNodeId: 'fill', name: 'Cap' },
  ]);
  expect(combined.get('combo')).not.toBeNull();
  expect(nested.get('cap')).not.toBeNull();
  expect(combined.get('combo')).not.toBe(nested.get('cap'));
});

async function entry(db: any, wcId: string, version: string, nodeNames: string[]) {
  const [wf] = await db.insert(workflow).values({
    oid: 'wf-1', name: 'Bottle Fill', workCenterId: wcId, version, state: 'Draft', specJsonb: {},
  }).returning();
  const ids: string[] = [];
  for (const name of nodeNames) {
    const [n] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: `${version}-${name}`, name, depth: 0,
    }).returning();
    ids.push(n.id);
  }
  return { id: wf.id as string, nodeIds: ids };
}

test('carryOverConfig copies dispatch and roles onto the new entry, matched by path', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [r] = await db.insert(role).values({ name: 'Operator' }).returning();
    const v1 = await entry(db, wc.id, '1.0.0', ['Fill', 'Cap']);
    await db.update(workflow).set({ dispatchPolicy: 'round_robin' }).where(eq(workflow.id, v1.id));
    await db.insert(workflowAllowedRole).values({
      workflowId: v1.id, workflowNodeId: v1.nodeIds[0], roleId: r.id,
    });

    const v2 = await entry(db, wc.id, '2.0.0', ['Fill', 'Seal']);
    const report = await carryOverConfig(db, { workCenterId: wc.id, oid: 'wf-1', newWorkflowId: v2.id });

    expect(report.sourceWorkflowId).toBe(v1.id);
    expect(report.dispatchPolicy).toBe('round_robin');
    expect(report.rolesCarried).toBe(1);
    expect(report.unmatchedPaths).toEqual([]);
    const [updated] = await db.select().from(workflow).where(eq(workflow.id, v2.id));
    expect(updated.dispatchPolicy).toBe('round_robin');
  } finally { await close(); }
});

test('a role on a node that no longer exists is reported, not dropped silently', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [r] = await db.insert(role).values({ name: 'Operator' }).returning();
    const v1 = await entry(db, wc.id, '1.0.0', ['Retired']);
    await db.insert(workflowAllowedRole).values({
      workflowId: v1.id, workflowNodeId: v1.nodeIds[0], roleId: r.id,
    });
    const v2 = await entry(db, wc.id, '2.0.0', ['Fill']);
    const report = await carryOverConfig(db, { workCenterId: wc.id, oid: 'wf-1', newWorkflowId: v2.id });
    expect(report.rolesCarried).toBe(0);
    expect(report.unmatchedPaths).toEqual(['Retired']);
  } finally { await close(); }
});

test('a role on an ambiguous source node is reported, not silently dropped', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [r] = await db.insert(role).values({ name: 'Operator' }).returning();
    const [v1] = await db.insert(workflow).values({
      oid: 'wf-1', name: 'Bottle Fill', workCenterId: wc.id, version: '1.0.0', state: 'Draft', specJsonb: {},
    }).returning();
    // Two same-named siblings (both root-level, same parentNodeId of null) — buildNodePaths
    // marks both ambiguous, so neither can be a carry-over target or source unambiguously.
    const [fillA] = await db.insert(workflowNode).values({
      workflowId: v1.id, nodeOid: '1.0.0-Fill-A', name: 'Fill', depth: 0,
    }).returning();
    await db.insert(workflowNode).values({
      workflowId: v1.id, nodeOid: '1.0.0-Fill-B', name: 'Fill', depth: 0,
    });
    await db.insert(workflowAllowedRole).values({
      workflowId: v1.id, workflowNodeId: fillA.id, roleId: r.id,
    });

    const v2 = await entry(db, wc.id, '2.0.0', ['Fill']);
    const report = await carryOverConfig(db, { workCenterId: wc.id, oid: 'wf-1', newWorkflowId: v2.id });
    expect(report.rolesCarried).toBe(0);
    expect(report.unmatchedPaths).toEqual([`(ambiguous node ${fillA.id})`]);
  } finally { await close(); }
});

test('no prior entry carries nothing and is not an error', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const only = await entry(db, wc.id, '1.0.0', ['Fill']);
    const report = await carryOverConfig(db, { workCenterId: wc.id, oid: 'wf-1', newWorkflowId: only.id });
    expect(report).toEqual({ sourceWorkflowId: null, dispatchPolicy: null, rolesCarried: 0, unmatchedPaths: [] });
  } finally { await close(); }
});

test('carry-over never crosses work centers', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [a] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [b] = await db.insert(workCenter).values({ name: 'Line 2' }).returning();
    const [r] = await db.insert(role).values({ name: 'Operator' }).returning();
    const inA = await entry(db, a.id, '1.0.0', ['Fill']);
    await db.insert(workflowAllowedRole).values({
      workflowId: inA.id, workflowNodeId: inA.nodeIds[0], roleId: r.id,
    });
    const inB = await entry(db, b.id, '1.0.0', ['Fill']);
    const report = await carryOverConfig(db, { workCenterId: b.id, oid: 'wf-1', newWorkflowId: inB.id });
    expect(report.sourceWorkflowId).toBeNull();
    expect(report.rolesCarried).toBe(0);
  } finally { await close(); }
});
