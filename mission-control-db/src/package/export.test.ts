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
import { makeTestDb } from '../../test/helpers/db.js';
import { workCenter, workflow, environmentSpec, workflowEnvironment } from '../db/schema/index.js';
import { collectWorkCenters, previewWfcenterx } from './export.js';
import { role, workflowNode, workflowAllowedRole } from '../db/schema/index.js';
import { collectRolesAndGrants } from './export.js';
import AdmZip from 'adm-zip';
import { buildWfcenterx } from './export.js';
import { readZipEntries } from '../ingest/zip.js';

test('collectWorkCenters returns the subtree parent-before-child with escaped paths', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [root] = await db.insert(workCenter).values({ name: 'Bottle Line' }).returning();
    const [child] = await db.insert(workCenter)
      .values({ name: 'Station A', parentWorkCenterId: root.id }).returning();
    await db.insert(workCenter)
      .values({ name: 'Fill/Cap', parentWorkCenterId: child.id }).returning();

    const collected = await collectWorkCenters(db, root.id, 'all');

    expect(collected.map((c) => c.manifest.path)).toEqual([
      'Bottle Line', 'Bottle Line/Station A', 'Bottle Line/Station A/Fill%2FCap',
    ]);
    expect(collected.map((c) => c.manifest.parentPath)).toEqual([
      null, 'Bottle Line', 'Bottle Line/Station A',
    ]);
  } finally { await close(); }
});

test('collectWorkCenters carries work-center config onto the manifest', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [root] = await db.insert(workCenter).values({
      name: 'Line', description: 'desc', sortOrder: 3, dispatchPolicy: 'manual',
    }).returning();

    const [only] = await collectWorkCenters(db, root.id, 'all');

    expect(only.manifest).toMatchObject({
      name: 'Line', description: 'desc', sortOrder: 3, dispatchPolicy: 'manual',
    });
  } finally { await close(); }
});

test('collectWorkCenters attaches each work center its own artifacts', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [child] = await db.insert(workCenter)
      .values({ name: 'Station', parentWorkCenterId: root.id }).returning();
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective', specJsonb: { a: 1 },
    });
    await db.insert(workflow).values({
      oid: 'w2', name: 'Cap', workCenterId: child.id, version: '2.0.0', state: 'Draft', specJsonb: { b: 2 },
    });

    const collected = await collectWorkCenters(db, root.id, 'all');

    expect(collected[0].manifest.workflows.map((w) => w.name)).toEqual(['Mix']);
    expect(collected[1].manifest.workflows.map((w) => w.name)).toEqual(['Cap']);
    expect(collected[0].manifest.workflows[0].file)
      .toBe('workflows/Line/Mix-1.0.0-Effective.WFmaster');
    expect(collected[1].manifest.workflows[0].file)
      .toBe('workflows/Line/Station/Cap-2.0.0-Draft.WFmaster');
  } finally { await close(); }
});

test('collectWorkCenters with scope=effective drops non-Effective entries', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(workflow).values([
      { oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective', specJsonb: {} },
      { oid: 'w2', name: 'Cap', workCenterId: root.id, version: '1.0.0', state: 'Draft', specJsonb: {} },
    ]);
    await db.insert(environmentSpec).values([
      { oid: 'e1', name: 'Env A', workCenterId: root.id, version: '1.0.0', state: 'Effective', specJsonb: {} },
      { oid: 'e2', name: 'Env B', workCenterId: root.id, version: '1.0.0', state: 'Draft', specJsonb: {} },
    ]);

    const [only] = await collectWorkCenters(db, root.id, 'effective');

    expect(only.manifest.workflows.map((w) => w.name)).toEqual(['Mix']);
    expect(only.manifest.environments.map((e) => e.name)).toEqual(['Env A']);
  } finally { await close(); }
});

test('collectWorkCenters expresses workflow-environment links by natural key', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'e1', name: 'Env', workCenterId: root.id, version: '1.0.0', state: 'Effective', specJsonb: {},
    }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective', specJsonb: {},
    }).returning();
    await db.insert(workflowEnvironment)
      .values({ workflowId: wf.id, environmentSpecId: env.id, source: 'manual' });

    const [only] = await collectWorkCenters(db, root.id, 'all');

    expect(only.manifest.workflows[0].environments).toEqual([
      { oid: 'e1', version: '1.0.0', state: 'Effective', source: 'manual' },
    ]);
  } finally { await close(); }
});

// D6 / §5.3. This is the assertion that would otherwise be missed: a leaked uuid or
// downloaded_by produces no error and a package that still looks correct.
test('collectWorkCenters never emits ids, downloaded_by, or downloaded_at', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective', specJsonb: {},
    });

    const [only] = await collectWorkCenters(db, root.id, 'all');
    const json = JSON.stringify(only.manifest);

    expect(json).not.toContain(root.id);
    expect(only.manifest.workflows[0]).not.toHaveProperty('id');
    expect(only.manifest.workflows[0]).not.toHaveProperty('downloadedBy');
    expect(only.manifest.workflows[0]).not.toHaveProperty('downloadedAt');
  } finally { await close(); }
});

// A link to an environment that scope excludes has no natural key in the package (the
// environment itself was dropped), so the link must be dropped too — never emitted as a
// ref with an undefined oid/version/state.
test('collectWorkCenters drops a link to an environment excluded by scope', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'e1', name: 'Env', workCenterId: root.id, version: '1.0.0', state: 'Draft', specJsonb: {},
    }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective', specJsonb: {},
    }).returning();
    await db.insert(workflowEnvironment)
      .values({ workflowId: wf.id, environmentSpecId: env.id, source: 'manual' });

    const [only] = await collectWorkCenters(db, root.id, 'effective');

    expect(only.manifest.workflows[0].environments).toEqual([]);
  } finally { await close(); }
});

// Regression for review finding "Minor 1": (name, version, state) TIES across different
// oids — the exact real case spec §4.2 names, two different Designer specs sharing a
// local_id. Without an oid tiebreak, Postgres is free to return tied rows in any order
// (here, physical/insertion order), so two exports of unchanged data could disagree on
// which entry is first.
test('collectWorkCenters breaks a name/version/state tie by oid, not insertion order', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    // Inserted in DESCENDING oid order, so a passing result proves the ordering came from
    // an explicit oid tiebreak rather than incidentally matching insertion order.
    await db.insert(workflow).values([
      { oid: 'b', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective', specJsonb: {} },
      { oid: 'a', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective', specJsonb: {} },
    ]);
    await db.insert(environmentSpec).values([
      { oid: 'y', name: 'Env', workCenterId: root.id, version: '1.0.0', state: 'Effective', specJsonb: {} },
      { oid: 'x', name: 'Env', workCenterId: root.id, version: '1.0.0', state: 'Effective', specJsonb: {} },
    ]);

    const [only] = await collectWorkCenters(db, root.id, 'all');

    expect(only.manifest.workflows.map((w) => w.oid)).toEqual(['a', 'b']);
    expect(only.manifest.environments.map((e) => e.oid)).toEqual(['x', 'y']);
  } finally { await close(); }
});

test('collectRolesAndGrants expresses grants by node path and role name', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [r] = await db.insert(role).values({ name: 'Operator', description: 'Runs it' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: wc.id, version: '1.0.0', state: 'Effective', specJsonb: {},
    }).returning();
    const [root] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n0', name: 'Root', depth: 0,
    }).returning();
    const [fill] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n1', parentNodeId: root.id, name: 'Fill', depth: 1,
    }).returning();
    await db.insert(workflowAllowedRole)
      .values({ workflowId: wf.id, workflowNodeId: fill.id, roleId: r.id });

    const collected = await collectWorkCenters(db, wc.id, 'all');
    const { roles, grants, warnings } = await collectRolesAndGrants(db, collected);

    expect(roles).toEqual([{ name: 'Operator', description: 'Runs it', isSystem: false }]);
    expect(grants).toEqual([{
      workCenterPath: 'Line',
      workflow: { oid: 'w1', version: '1.0.0', state: 'Effective' },
      nodePath: 'Root/Fill',
      role: 'Operator',
    }]);
    expect(warnings).toEqual([]);
  } finally { await close(); }
});

// Referenced-only (§5.1): exporting the whole role table would push unrelated
// organisational structure into a work-center package.
test('collectRolesAndGrants omits roles no grant in this package uses', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(role).values({ name: 'Unused' });
    const collected = await collectWorkCenters(db, wc.id, 'all');

    const { roles } = await collectRolesAndGrants(db, collected);

    expect(roles).toEqual([]);
  } finally { await close(); }
});

// §7.3 — a grant on an ambiguous node has no portable expression. Reporting beats
// guessing: a wrong role assignment is worse than none.
test('collectRolesAndGrants warns instead of guessing when a node path is ambiguous', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [r] = await db.insert(role).values({ name: 'Operator' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: wc.id, version: '1.0.0', state: 'Effective', specJsonb: {},
    }).returning();
    const [root] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n0', name: 'Root', depth: 0,
    }).returning();
    // Two siblings sharing a name — workflow_node is unique on (workflow_id, node_oid),
    // NOT on name, so this is legal and makes both paths 'Root/Fill'.
    const [a] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n1', parentNodeId: root.id, name: 'Fill', depth: 1,
    }).returning();
    await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n2', parentNodeId: root.id, name: 'Fill', depth: 1,
    });
    await db.insert(workflowAllowedRole)
      .values({ workflowId: wf.id, workflowNodeId: a.id, roleId: r.id });

    const collected = await collectWorkCenters(db, wc.id, 'all');
    const { grants, warnings } = await collectRolesAndGrants(db, collected);

    expect(grants).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Mix');
  } finally { await close(); }
});

// Regression for review finding "Important 2": referenced-only must be computed AFTER the
// ambiguity check, not before. A role whose only grant sits on an ambiguous node must not
// leak into `roles` even though its role_id is visible during the assignments/role lookup —
// this fails if `usedRoleIds.add` is hoisted above the `nodePath === null` branch.
test('collectRolesAndGrants keeps a role out of the referenced-only list when its only grant is on an ambiguous node', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [r] = await db.insert(role).values({ name: 'Operator' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: wc.id, version: '1.0.0', state: 'Effective', specJsonb: {},
    }).returning();
    const [root] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n0', name: 'Root', depth: 0,
    }).returning();
    const [a] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n1', parentNodeId: root.id, name: 'Fill', depth: 1,
    }).returning();
    await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n2', parentNodeId: root.id, name: 'Fill', depth: 1,
    });
    await db.insert(workflowAllowedRole)
      .values({ workflowId: wf.id, workflowNodeId: a.id, roleId: r.id });

    const collected = await collectWorkCenters(db, wc.id, 'all');
    const { roles, grants, warnings } = await collectRolesAndGrants(db, collected);

    expect(grants).toEqual([]);
    expect(roles).toEqual([]);
    expect(warnings).toHaveLength(1);
  } finally { await close(); }
});

// Regression for review finding "Important 1": no ORDER BY on the workflow_allowed_role
// select means Postgres is free to return rows in any order, so two exports of unchanged
// data could emit grants in a different sequence and make packages undiffable. Both grants
// sit on the same node, so their relative order is decided solely by role_id ascending —
// computed here from the DB's own returned ids rather than assumed from insert order.
test('collectRolesAndGrants orders multiple grants on the same workflow deterministically', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: wc.id, version: '1.0.0', state: 'Effective', specJsonb: {},
    }).returning();
    const [root] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n0', name: 'Root', depth: 0,
    }).returning();
    const [ra] = await db.insert(role).values({ name: 'Operator' }).returning();
    const [rb] = await db.insert(role).values({ name: 'Supervisor' }).returning();
    await db.insert(workflowAllowedRole).values([
      { workflowId: wf.id, workflowNodeId: root.id, roleId: ra.id },
      { workflowId: wf.id, workflowNodeId: root.id, roleId: rb.id },
    ]);

    const collected = await collectWorkCenters(db, wc.id, 'all');
    const expectedOrder = [ra, rb]
      .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
      .map((r) => r.name);

    const first = await collectRolesAndGrants(db, collected);
    const second = await collectRolesAndGrants(db, collected);

    expect(first.grants.map((g) => g.role)).toEqual(expectedOrder);
    expect(second.grants.map((g) => g.role)).toEqual(expectedOrder);
  } finally { await close(); }
});

const AT = new Date('2026-07-28T12:00:00.000Z');

test('buildWfcenterx writes a manifest, the artifacts, and the two role files', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: wc.id, version: '1.0.0', state: 'Effective',
      specJsonb: { local_id: 'Mix', oid: 'w1' },
    });
    await db.insert(environmentSpec).values({
      oid: 'e1', name: 'Env', workCenterId: wc.id, version: '1.0.0', state: 'Effective',
      specJsonb: { local_id: 'Env', oid: 'e1' },
    });

    const { buffer, filename } = await buildWfcenterx(db, wc.id, { scope: 'all', exportedAt: AT });

    expect(filename).toBe('Line.WFcenterX');
    const names = new AdmZip(buffer).getEntries().map((e) => e.entryName).sort();
    expect(names).toEqual([
      'Line.WFcenter',
      'environments/Line/Env-1.0.0-Effective.WFenvir',
      'roles/allowed-roles.json',
      'roles/roles.json',
      'workflows/Line/Mix-1.0.0-Effective.WFmaster',
    ]);
  } finally { await close(); }
});

test('buildWfcenterx stamps the format envelope', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const { buffer } = await buildWfcenterx(db, wc.id, { scope: 'effective', exportedAt: AT });

    const entries = readZipEntries(buffer);
    const manifest = entries.find((e) => e.name === 'Line.WFcenter')!.json as any;

    expect(manifest.format).toBe('WFcenter');
    expect(manifest.formatVersion).toBe('1.0');
    expect(manifest.scope).toBe('effective');
    expect(manifest.exportedAt).toBe('2026-07-28T12:00:00.000Z');
  } finally { await close(); }
});

// §6 — the artifact files ARE spec_jsonb, unchanged. P2's importer depends on this being
// the same shape ingest already consumes.
test('buildWfcenterx writes spec_jsonb back verbatim', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const spec = { local_id: 'Mix', oid: 'w1', steps: [{ local_id: 'Begin', oid: 's0' }] };
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: wc.id, version: '1.0.0', state: 'Effective', specJsonb: spec,
    });

    const { buffer } = await buildWfcenterx(db, wc.id, { scope: 'all', exportedAt: AT });
    const entries = readZipEntries(buffer);
    const written = entries.find((e) => e.name === 'workflows/Line/Mix-1.0.0-Effective.WFmaster')!;

    expect(written.json).toEqual(spec);
  } finally { await close(); }
});

// D1 — the assertion the whole format exists to satisfy.
test('buildWfcenterx leaks no uuid into any entry', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [r] = await db.insert(role).values({ name: 'Operator' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: wc.id, version: '1.0.0', state: 'Effective', specJsonb: {},
    }).returning();
    const [node] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n0', name: 'Root', depth: 0,
    }).returning();
    await db.insert(workflowAllowedRole)
      .values({ workflowId: wf.id, workflowNodeId: node.id, roleId: r.id });

    const { buffer } = await buildWfcenterx(db, wc.id, { scope: 'all', exportedAt: AT });
    const text = readZipEntries(buffer).map((e) => e.bytes.toString('utf8')).join('\n');

    for (const id of [wc.id, r.id, wf.id, node.id]) expect(text).not.toContain(id);
  } finally { await close(); }
});

test('buildWfcenterx escapes the root work-center name in the archive filename', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Fill/Cap' }).returning();
    const { filename } = await buildWfcenterx(db, wc.id, { scope: 'all', exportedAt: AT });
    expect(filename).toBe('Fill%2FCap.WFcenterX');
  } finally { await close(); }
});

// Regression for review finding "Minor 1": collectWorkCenters/subtree() orders by
// (depth, name), which groups ALL nodes at a given depth together (regardless of parent)
// rather than emitting each branch's descendants together. buildWfcenterx must re-sort by
// manifest.path so the manifest's workCenters array is reproducible AND reads as a tree,
// not depth bands. A lexicographic sort on path also preserves parent-before-child, since
// a parent's path is always a proper prefix of its children's paths.
test('buildWfcenterx emits workCenters ordered by path, not subtree depth-then-name order', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [root] = await db.insert(workCenter).values({ name: 'Root' }).returning();
    const [a] = await db.insert(workCenter)
      .values({ name: 'A', parentWorkCenterId: root.id }).returning();
    const [z] = await db.insert(workCenter)
      .values({ name: 'Z', parentWorkCenterId: root.id }).returning();
    // Depth-2 names chosen so depth-then-name order ('B' < 'Y') interleaves the two
    // branches, while path order keeps each branch's descendant immediately after it.
    await db.insert(workCenter).values({ name: 'Y', parentWorkCenterId: a.id });
    await db.insert(workCenter).values({ name: 'B', parentWorkCenterId: z.id });

    const { buffer } = await buildWfcenterx(db, root.id, { scope: 'all', exportedAt: AT });
    const entries = readZipEntries(buffer);
    const manifest = entries.find((e) => e.name === 'Root.WFcenter')!.json as any;

    expect(manifest.workCenters.map((c: any) => c.path)).toEqual([
      'Root', 'Root/A', 'Root/A/Y', 'Root/Z', 'Root/Z/B',
    ]);
  } finally { await close(); }
});

test('buildWfcenterx produces identical manifest ordering across two exports of unchanged data', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [root] = await db.insert(workCenter).values({ name: 'Root' }).returning();
    const [a] = await db.insert(workCenter)
      .values({ name: 'A', parentWorkCenterId: root.id }).returning();
    const [z] = await db.insert(workCenter)
      .values({ name: 'Z', parentWorkCenterId: root.id }).returning();
    await db.insert(workCenter).values({ name: 'Y', parentWorkCenterId: a.id });
    await db.insert(workCenter).values({ name: 'B', parentWorkCenterId: z.id });

    const first = await buildWfcenterx(db, root.id, { scope: 'all', exportedAt: AT });
    const second = await buildWfcenterx(db, root.id, { scope: 'all', exportedAt: AT });

    const pathsOf = (buf: Buffer) => {
      const m = readZipEntries(buf).find((e) => e.name === 'Root.WFcenter')!.json as any;
      return m.workCenters.map((c: any) => c.path);
    };
    expect(pathsOf(first.buffer)).toEqual(pathsOf(second.buffer));
  } finally { await close(); }
});

test('previewWfcenterx counts what the package would contain', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [child] = await db.insert(workCenter)
      .values({ name: 'Station', parentWorkCenterId: root.id }).returning();
    await db.insert(workflow).values([
      { oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective', specJsonb: {} },
      { oid: 'w2', name: 'Cap', workCenterId: child.id, version: '1.0.0', state: 'Draft', specJsonb: {} },
    ]);
    await db.insert(environmentSpec).values({
      oid: 'e1', name: 'Env', workCenterId: root.id, version: '1.0.0', state: 'Effective', specJsonb: {},
    });

    const preview = await previewWfcenterx(db, root.id, 'all');

    expect(preview).toMatchObject({
      workCenters: 2, workflows: 2, environments: 1, roles: 0, grants: 0, warnings: [],
    });
  } finally { await close(); }
});

test('previewWfcenterx honours scope', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(workflow).values([
      { oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective', specJsonb: {} },
      { oid: 'w2', name: 'Cap', workCenterId: root.id, version: '1.0.0', state: 'Draft', specJsonb: {} },
    ]);

    expect(await previewWfcenterx(db, root.id, 'effective')).toMatchObject({ workflows: 1 });
    expect(await previewWfcenterx(db, root.id, 'all')).toMatchObject({ workflows: 2 });
  } finally { await close(); }
});

// Auto-claim (spec 2026-08-14 D4) rides the manifest at both levels.
test('collectWorkCenters carries autoClaim onto the work-center manifest and workflow entries', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [root] = await db.insert(workCenter).values({ name: 'Line', autoClaim: true }).returning();
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Draft',
      specJsonb: { local_id: 'Mix', oid: 'w1' }, autoClaim: false,
    });

    const [only] = await collectWorkCenters(db, root.id, 'all');
    expect(only.manifest.autoClaim).toBe(true);
    expect(only.manifest.workflows[0].autoClaim).toBe(false);
  } finally { await close(); }
});

// ISA 88 type name rides the work-center manifest entry; always written (string or null).
test('collectWorkCenters carries typeName onto the work-center manifest (null when untyped)', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [root] = await db.insert(workCenter).values({ name: 'Line', typeName: 'Process Cell' }).returning();
    const [only] = await collectWorkCenters(db, root.id, 'all');
    expect(only.manifest.typeName).toBe('Process Cell');
    const [plain] = await db.insert(workCenter).values({ name: 'Plain' }).returning();
    const [p] = await collectWorkCenters(db, plain.id, 'all');
    expect(p.manifest.typeName).toBeNull();
  } finally { await close(); }
});
