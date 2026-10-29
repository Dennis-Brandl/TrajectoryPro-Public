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
import AdmZip from 'adm-zip';
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import {
  workCenter, workflow, environmentSpec, workflowEnvironment, workflowNode, role, workflowAllowedRole, wcResource,
} from '../db/schema/index.js';
import { buildWfcenterx } from './export.js';
import { readWfcenterx, importWfcenterx } from './import.js';

const AT = new Date('2026-07-28T12:00:00.000Z');

async function seededPackage() {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
  await db.insert(workflow).values({
    oid: 'w1', name: 'Mix', workCenterId: wc.id, version: '1.0.0', state: 'Effective',
    specJsonb: { local_id: 'Mix', oid: 'w1' },
  });
  const { buffer } = await buildWfcenterx(db, wc.id, { scope: 'all', exportedAt: AT });
  await close();
  return buffer;
}

test('readWfcenterx returns the manifest, role files, and specs keyed by manifest file path', async () => {
  const buf = await seededPackage();
  const pkg = readWfcenterx(buf);

  expect(pkg.manifest.format).toBe('WFcenter');
  expect(pkg.manifest.workCenters).toHaveLength(1);
  expect(pkg.roles).toEqual([]);
  expect(pkg.grants).toEqual([]);
  const file = pkg.manifest.workCenters[0].workflows[0].file;
  expect(pkg.specByFile.get(file)).toEqual({ local_id: 'Mix', oid: 'w1' });
});

test('readWfcenterx rejects a buffer that is not a zip', () => {
  expect(() => readWfcenterx(Buffer.from('not a zip')))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

test('readWfcenterx rejects a zip with no root .WFcenter manifest', () => {
  const zip = new AdmZip();
  zip.addFile('workflows/Line/Mix.WFmaster', Buffer.from('{}'));
  expect(() => readWfcenterx(zip.toBuffer()))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

// Two root manifests are ambiguous, and `entries.find(...)` would silently pick whichever the
// zip's central directory happens to list first — making WHICH subtree gets imported a
// property of archive byte order. Harmless while an import is fire-and-forget, but P3's merge
// mode previews the resolution in a rolled-back transaction and then replays it on confirm:
// the two calls must agree on which manifest they read, so an ambiguous archive has to be
// refused outright rather than resolved by luck.
test('readWfcenterx rejects a zip containing two root .WFcenter manifests', () => {
  const manifest = JSON.stringify({
    format: 'WFcenter', formatVersion: '1.0', exportedAt: AT.toISOString(), scope: 'all',
    warnings: [], workCenters: [],
  });
  const zip = new AdmZip();
  zip.addFile('A.WFcenter', Buffer.from(manifest));
  zip.addFile('B.WFcenter', Buffer.from(manifest));
  expect(() => readWfcenterx(zip.toBuffer()))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

// A .WFmasterX has a root .WFmaster, not a .WFcenter — uploading one to the wrong route must
// fail with a clear code, not a confusing downstream error.
test('readWfcenterx rejects a package whose format field is wrong', () => {
  const zip = new AdmZip();
  zip.addFile('X.WFcenter', Buffer.from(JSON.stringify({ format: 'WFmaster', formatVersion: '1.0' })));
  expect(() => readWfcenterx(zip.toBuffer()))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

test('readWfcenterx rejects an unrecognised formatVersion', () => {
  const zip = new AdmZip();
  zip.addFile('X.WFcenter', Buffer.from(JSON.stringify({
    format: 'WFcenter', formatVersion: '99.0', workCenters: [],
  })));
  expect(() => readWfcenterx(zip.toBuffer()))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

// The manifest is authoritative; a `file` pointing at nothing is a corrupt package, and
// discovering that at insert time would abort a half-done transaction instead.
test('readWfcenterx rejects a manifest referencing a file the zip does not contain', () => {
  const zip = new AdmZip();
  zip.addFile('X.WFcenter', Buffer.from(JSON.stringify({
    format: 'WFcenter', formatVersion: '1.0', exportedAt: AT.toISOString(), scope: 'all', warnings: [],
    workCenters: [{
      path: 'X', parentPath: null, name: 'X', description: null, sortOrder: 0,
      dispatchPolicy: 'manual',
      workflows: [{ file: 'workflows/X/ghost.WFmaster', oid: 'g', name: 'Ghost',
        version: '1.0.0', state: 'Draft', dispatchPolicy: null, effectiveFrom: null,
        schemaVersion: null, sourceFilename: null, checksum: null,
        sourceLibraryName: null, sourceLibraryOid: null, environments: [] }],
      environments: [],
    }],
  })));
  expect(() => readWfcenterx(zip.toBuffer()))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

test('readWfcenterx tolerates a package with no roles files', () => {
  const zip = new AdmZip();
  zip.addFile('X.WFcenter', Buffer.from(JSON.stringify({
    format: 'WFcenter', formatVersion: '1.0', exportedAt: AT.toISOString(), scope: 'all',
    warnings: [], workCenters: [],
  })));
  const pkg = readWfcenterx(zip.toBuffer());
  expect(pkg.roles).toEqual([]);
  expect(pkg.grants).toEqual([]);
});

// Task 4's planned resolution is `idByPath.get(wc.parentPath) ?? null`, which would fold an
// unresolvable parentPath into the same branch as a legitimate root — silently building the
// wrong tree instead of failing. Catch it here, before any write.
test('readWfcenterx rejects a work center whose parentPath does not match any entry', () => {
  const zip = new AdmZip();
  zip.addFile('X.WFcenter', Buffer.from(JSON.stringify({
    format: 'WFcenter', formatVersion: '1.0', exportedAt: AT.toISOString(), scope: 'all', warnings: [],
    workCenters: [{
      path: 'X', parentPath: 'Ghost', name: 'X', description: null, sortOrder: 0,
      dispatchPolicy: 'manual', workflows: [], environments: [],
    }],
  })));
  expect(() => readWfcenterx(zip.toBuffer()))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

// Task 4 does `idByPath.set(wc.path, created.id)` — last-write-wins. Two entries sharing a
// `path` mean a descendant referencing that path attaches to whichever entry wrote last,
// silently, since the two need not collide on name+parent and so trip no DB constraint.
test('readWfcenterx rejects duplicate work center paths', () => {
  const zip = new AdmZip();
  const wc = (path: string) => ({
    path, parentPath: null, name: path, description: null, sortOrder: 0,
    dispatchPolicy: 'manual', workflows: [], environments: [],
  });
  zip.addFile('X.WFcenter', Buffer.from(JSON.stringify({
    format: 'WFcenter', formatVersion: '1.0', exportedAt: AT.toISOString(), scope: 'all', warnings: [],
    workCenters: [wc('Dup'), wc('Dup')],
  })));
  expect(() => readWfcenterx(zip.toBuffer()))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

const bareWc = (path: string, parentPath: string | null) => ({
  path, parentPath, name: path, description: null, sortOrder: 0,
  dispatchPolicy: 'manual', workflows: [], environments: [],
});

// Task 4 builds the tree in a single forward pass, populating idByPath only with entries
// already processed. Spec §5 promises parent-before-child ordering and the exporter
// guarantees it, but this reader validates an archive that may come from anywhere — a parent
// that EXISTS but appears later still falls through `idByPath.get(...) ?? null` into a
// silent root, exactly like the dangling case, just reached by out-of-order input instead of
// a missing entry.
test('readWfcenterx rejects a manifest where a child entry precedes its parent', () => {
  const zip = new AdmZip();
  zip.addFile('X.WFcenter', Buffer.from(JSON.stringify({
    format: 'WFcenter', formatVersion: '1.0', exportedAt: AT.toISOString(), scope: 'all', warnings: [],
    workCenters: [bareWc('X/Y', 'X'), bareWc('X', null)],
  })));
  expect(() => readWfcenterx(zip.toBuffer()))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

// A two-entry cycle: both paths exist (so the dangling check passes), but no member of the
// cycle can precede all the others, so the strictly-earlier-index check must catch it too.
test('readWfcenterx rejects a two-entry parentPath cycle', () => {
  const zip = new AdmZip();
  zip.addFile('X.WFcenter', Buffer.from(JSON.stringify({
    format: 'WFcenter', formatVersion: '1.0', exportedAt: AT.toISOString(), scope: 'all', warnings: [],
    workCenters: [bareWc('A', 'B'), bareWc('B', 'A')],
  })));
  expect(() => readWfcenterx(zip.toBuffer()))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

// readZipEntries swallows JSON parse errors (ingest/zip.ts), so a corrupt roles file reaches
// this function as an entry that EXISTS with json === undefined — indistinguishable from
// absent unless checked. workflow_allowed_role is an allowlist, so silently treating this the
// same as "no roles file" would make the imported subtree MORE PERMISSIVE, with no warning.
test('readWfcenterx rejects a present but unparseable roles/roles.json', () => {
  const zip = new AdmZip();
  zip.addFile('X.WFcenter', Buffer.from(JSON.stringify({
    format: 'WFcenter', formatVersion: '1.0', exportedAt: AT.toISOString(), scope: 'all',
    warnings: [], workCenters: [],
  })));
  zip.addFile('roles/roles.json', Buffer.from('not json'));
  expect(() => readWfcenterx(zip.toBuffer()))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

test('readWfcenterx rejects roles/roles.json present but missing its roles array', () => {
  const zip = new AdmZip();
  zip.addFile('X.WFcenter', Buffer.from(JSON.stringify({
    format: 'WFcenter', formatVersion: '1.0', exportedAt: AT.toISOString(), scope: 'all',
    warnings: [], workCenters: [],
  })));
  zip.addFile('roles/roles.json', Buffer.from(JSON.stringify({ notRoles: [] })));
  expect(() => readWfcenterx(zip.toBuffer()))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

test('readWfcenterx rejects a present but unparseable roles/allowed-roles.json', () => {
  const zip = new AdmZip();
  zip.addFile('X.WFcenter', Buffer.from(JSON.stringify({
    format: 'WFcenter', formatVersion: '1.0', exportedAt: AT.toISOString(), scope: 'all',
    warnings: [], workCenters: [],
  })));
  zip.addFile('roles/allowed-roles.json', Buffer.from('not json'));
  expect(() => readWfcenterx(zip.toBuffer()))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

test('readWfcenterx rejects roles/allowed-roles.json present but missing its grants array', () => {
  const zip = new AdmZip();
  zip.addFile('X.WFcenter', Buffer.from(JSON.stringify({
    format: 'WFcenter', formatVersion: '1.0', exportedAt: AT.toISOString(), scope: 'all',
    warnings: [], workCenters: [],
  })));
  zip.addFile('roles/allowed-roles.json', Buffer.from(JSON.stringify({ notGrants: [] })));
  expect(() => readWfcenterx(zip.toBuffer()))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

// §8.6.4 threads manifest.warnings straight into ImportReport.warnings, which the renderer
// (ImportPackageDialog's ImportReportSummary) calls `.map()` on with no further check and no
// ErrorBoundary anywhere in this app to catch a thrown TypeError — a present-but-wrong shape
// must be rejected here, the same as workCenters/roles/grants above.
test('readWfcenterx rejects a manifest whose warnings field is present but not an array', () => {
  const zip = new AdmZip();
  zip.addFile('X.WFcenter', Buffer.from(JSON.stringify({
    format: 'WFcenter', formatVersion: '1.0', exportedAt: AT.toISOString(), scope: 'all',
    warnings: 'boom', workCenters: [],
  })));
  expect(() => readWfcenterx(zip.toBuffer()))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
});

// Builds a package from one DB, then imports it into a SECOND, clean DB — the only shape that
// proves the format is portable rather than accidentally coupled to the source's ids.
// `scope` defaults to 'all' (every existing caller's expectation); pass 'effective' to build a
// scope-filtered package instead.
async function exportFrom(seed: (db: any) => Promise<string>, scope: 'all' | 'effective' = 'all') {
  const { db, close } = await makeTestDb();
  const rootId = await seed(db);
  const { buffer } = await buildWfcenterx(db, rootId, { scope, exportedAt: AT });
  await close();
  return buffer;
}

// Both new tests below corrupt an exported manifest post-hoc (rather than relying on
// readWfcenterx or the real exporter to produce the shape under test), so they share this
// lookup for the root .WFcenter entry inside the zip.
function findManifestEntry(zip: AdmZip) {
  return zip.getEntries().find(
    (e) => !e.entryName.includes('/') && e.entryName.endsWith('.WFcenter'),
  )!;
}
function writeManifest(zip: AdmZip, entry: ReturnType<typeof findManifestEntry>, manifest: unknown) {
  zip.updateFile(entry, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  return zip.toBuffer();
}

test('importWfcenterx recreates the work-center subtree parent-before-child', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({
      name: 'Bottle Line', description: 'desc', sortOrder: 2, dispatchPolicy: 'manual',
    }).returning();
    const [child] = await db.insert(workCenter)
      .values({ name: 'Station A', parentWorkCenterId: root.id }).returning();
    await db.insert(workCenter).values({ name: 'Cell 1', parentWorkCenterId: child.id });
    return root.id;
  });

  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId: null });

    expect(report.workCenters.created).toBe(3);
    const rows = await db.select().from(workCenter);
    expect(rows).toHaveLength(3);
    const root = rows.find((r) => r.name === 'Bottle Line')!;
    const station = rows.find((r) => r.name === 'Station A')!;
    const cell = rows.find((r) => r.name === 'Cell 1')!;
    expect(root.parentWorkCenterId).toBeNull();
    expect(station.parentWorkCenterId).toBe(root.id);
    expect(cell.parentWorkCenterId).toBe(station.id);
    expect(report.rootWorkCenterId).toBe(root.id);
    // config travels with the work center
    expect(root).toMatchObject({ description: 'desc', sortOrder: 2, dispatchPolicy: 'manual' });
  } finally { await close(); }
});

test('importWfcenterx nests the package under a chosen parent', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Imported' }).returning();
    return root.id;
  });

  const { db, close } = await makeTestDb();
  try {
    const [host] = await db.insert(workCenter).values({ name: 'Host' }).returning();
    const report = await importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId: host.id });

    const [imported] = await db.select().from(workCenter).where(eq(workCenter.name, 'Imported'));
    expect(imported.parentWorkCenterId).toBe(host.id);
    expect(report.rootWorkCenterId).toBe(imported.id);
  } finally { await close(); }
});

test('importWfcenterx recreates workflows with their node trees and row config', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '2.0.0', state: 'Effective',
      dispatchPolicy: 'round_robin', sourceLibraryName: 'Studio', sourceLibraryOid: 'lib-1',
      specJsonb: {
        local_id: 'Mix', oid: 'w1',
        steps: [{ local_id: 'Do it', oid: 's1', step_type: 'USER_INTERACTION' }],
        children: [{ local_id: 'Sub', oid: 'w1-c1', steps: [] }],
      },
    });
    return root.id;
  });

  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId: null });

    expect(report.workflows).toEqual({ created: 1, alreadyPresent: 0 });
    const [wf] = await db.select().from(workflow);
    expect(wf).toMatchObject({
      oid: 'w1', name: 'Mix', version: '2.0.0', state: 'Effective',
      dispatchPolicy: 'round_robin', sourceLibraryName: 'Studio', sourceLibraryOid: 'lib-1',
    });
    const nodes = await db.select().from(workflowNode).where(eq(workflowNode.workflowId, wf.id));
    expect(nodes).toHaveLength(2);
  } finally { await close(); }
});

test('importWfcenterx recreates environments and their workflow links', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'e1', name: 'Env', workCenterId: root.id, version: '1.0.0', state: 'Effective',
      specJsonb: { local_id: 'Env', oid: 'e1' },
    }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective',
      specJsonb: { local_id: 'Mix', oid: 'w1' },
    }).returning();
    await db.insert(workflowEnvironment)
      .values({ workflowId: wf.id, environmentSpecId: env.id, source: 'manual' });
    return root.id;
  });

  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId: null });

    expect(report.environments).toEqual({ created: 1, alreadyPresent: 0 });
    expect(report.links.created).toBe(1);
    const [link] = await db.select().from(workflowEnvironment);
    expect(link.source).toBe('manual');   // the recorded source, not the 'download' default
  } finally { await close(); }
});

// D8 — the property Task 1 built insertWorkflowEntry to guarantee, proven at the import layer.
test('importWfcenterx does not fabricate config for a second version of the same oid', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(workflow).values([
      { oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective',
        dispatchPolicy: 'manual', specJsonb: { local_id: 'Mix', oid: 'w1' } },
      { oid: 'w1', name: 'Mix', workCenterId: root.id, version: '2.0.0', state: 'Effective',
        dispatchPolicy: null, specJsonb: { local_id: 'Mix', oid: 'w1' } },
    ]);
    return root.id;
  });

  const { db, close } = await makeTestDb();
  try {
    await importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId: null });
    const rows = await db.select().from(workflow);
    const v1 = rows.find((r) => r.version === '1.0.0')!;
    const v2 = rows.find((r) => r.version === '2.0.0')!;
    expect(v1.dispatchPolicy).toBe('manual');
    expect(v2.dispatchPolicy).toBeNull();   // NOT inherited from v1
  } finally { await close(); }
});

test('importWfcenterx fails with WORK_CENTER_NAME_CONFLICT when the root name is taken', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    return root.id;
  });

  const { db, close } = await makeTestDb();
  try {
    await db.insert(workCenter).values({ name: 'Line' });
    await expect(importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId: null }))
      .rejects.toMatchObject({ code: 'WORK_CENTER_NAME_CONFLICT' });
  } finally { await close(); }
});

// One transaction (spec §8.3): a failure part-way must leave NOTHING behind, or the operator
// is left with an un-deletable fragment (parent_work_center_id is RESTRICT).
test('importWfcenterx writes nothing at all when the import fails', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(workCenter).values({ name: 'Station', parentWorkCenterId: root.id });
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective',
      specJsonb: { local_id: 'Mix', oid: 'w1' },
    });
    return root.id;
  });

  const { db, close } = await makeTestDb();
  try {
    await db.insert(workCenter).values({ name: 'Line' });   // forces the conflict mid-import
    await expect(importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId: null })).rejects.toThrow();

    expect(await db.select().from(workCenter)).toHaveLength(1);  // only the pre-existing one
    expect(await db.select().from(workflow)).toHaveLength(0);
  } finally { await close(); }
});

// The test above forces its conflict on the very FIRST createWorkCenter call: the pre-inserted
// 'Line' collides with the exported root's own name, and createWorkCenter checks for a sibling
// -name conflict BEFORE inserting — so zero rows are written either way, atomic or not. That
// test would pass unchanged against an implementation that opened a separate top-level
// transaction per work center; it never proves an already-succeeded write gets undone.
//
// This test instead lets a real write land — the root work center — before the failure fires,
// by corrupting the SECOND work center's dispatchPolicy post-export. readWfcenterx does not
// validate dispatchPolicy (only createWorkCenter's assertDispatchPolicy does, deep inside the
// transaction), so the corrupted package still parses and reaches the transaction.
//
// LOAD-BEARING CHECK (see task-4-report.md "Fix 1" for the full transcript): with
// `db.transaction(...)` temporarily removed from importWfcenterx, this test FAILS —
// `workCenter` comes back with 1 row (the root, committed for real by its own standalone
// `createWorkCenter` transaction) instead of 0. Restoring the wrapper makes it pass again.
test('importWfcenterx rolls back a work center already written when a later sibling fails', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(workCenter).values({ name: 'Cell', parentWorkCenterId: root.id });
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective',
      specJsonb: { local_id: 'Mix', oid: 'w1' },
    });
    return root.id;
  });

  const zip = new AdmZip(buf);
  const manifestEntry = findManifestEntry(zip);
  const manifest = JSON.parse(zip.readAsText(manifestEntry));
  expect(manifest.workCenters).toHaveLength(2);
  expect(manifest.workCenters[0].path).toBe('Line');       // the root — created successfully
  expect(manifest.workCenters[1].path).toBe('Line/Cell');  // the child — corrupted below
  manifest.workCenters[1].dispatchPolicy = 'nope';
  const corruptBuf = writeManifest(zip, manifestEntry, manifest);

  const { db, close } = await makeTestDb();
  try {
    await expect(importWfcenterx(db, corruptBuf, { mode: 'create', parentWorkCenterId: null }))
      .rejects.toMatchObject({ code: 'INVALID_DISPATCH_POLICY' });

    // Nothing survives — including the root work center and its workflow, both of which were
    // written to the transaction before the child's dispatchPolicy failure fired.
    expect(await db.select().from(workCenter)).toHaveLength(0);
    expect(await db.select().from(workflow)).toHaveLength(0);
    expect(await db.select().from(workflowNode)).toHaveLength(0);
    expect(await db.select().from(environmentSpec)).toHaveLength(0);
  } finally { await close(); }
});

// `if (!envId) continue;` in importWfcenterx's step 4 exists for a link whose environment was
// excluded from the package at export time (e.g. scope: 'effective' dropped a Draft
// environment a workflow still points at). Empirically, buildWfcenterx does not currently
// produce that exact shape: collectWorkCenters's per-work-center envKeyById filters both a
// work center's `environments` array AND the natural-key refs on its own workflows from the
// SAME scope-filtered query, so a scope-excluded link is dropped from the workflow's
// `environments` array too, not left dangling — exporting this exact seed with scope
// 'effective' yields `environments: []` on the workflow, never a ref pointing at nothing.
// So a plain round trip never actually reaches the `continue` line. To drive it for real, the
// dropped ref is re-attached by hand after export — producing exactly the shape the guard
// defends against (a workflow ref whose target never made it into the package) without
// touching import.ts. This also still proves the exporter's own scope-exclusion behavior via
// the first two assertions below (both empty, as buildWfcenterx really produces them).
test('importWfcenterx skips a link whose environment is absent from the package', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'e1', name: 'Env', workCenterId: root.id, version: '1.0.0', state: 'Draft',
      specJsonb: { local_id: 'Env', oid: 'e1' },
    }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective',
      specJsonb: { local_id: 'Mix', oid: 'w1' },
    }).returning();
    await db.insert(workflowEnvironment)
      .values({ workflowId: wf.id, environmentSpecId: env.id, source: 'manual' });
    return root.id;
  }, 'effective');

  const zip = new AdmZip(buf);
  const manifestEntry = findManifestEntry(zip);
  const manifest = JSON.parse(zip.readAsText(manifestEntry));
  // The exporter's own scope-exclusion behavior, proven as-is before any hand-editing:
  expect(manifest.workCenters[0].environments).toEqual([]);
  expect(manifest.workCenters[0].workflows[0].environments).toEqual([]);
  // Re-attach the dropped ref so the importer actually has something to resolve and fail to
  // find — the scenario `if (!envId) continue` exists to handle.
  manifest.workCenters[0].workflows[0].environments = [
    { oid: 'e1', version: '1.0.0', state: 'Draft', source: 'manual' },
  ];
  const patchedBuf = writeManifest(zip, manifestEntry, manifest);

  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, patchedBuf, { mode: 'create', parentWorkCenterId: null });

    expect(report.workflows).toEqual({ created: 1, alreadyPresent: 0 });
    expect(report.links.created).toBe(0);   // skipped, not linked
    const rows = await db.select().from(workflow);
    expect(rows).toHaveLength(1);
    expect(rows[0].oid).toBe('w1');
    expect(await db.select().from(workflowEnvironment)).toHaveLength(0);
  } finally { await close(); }
});

async function packageWithGrant() {
  return exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [r] = await db.insert(role).values({ name: 'Operator', description: 'Runs it' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective',
      specJsonb: {
        local_id: 'Root', oid: 'w1',
        children: [{ local_id: 'Fill', oid: 'n1', steps: [] }],
        steps: [],
      },
    }).returning();
    const [rootNode] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'w1', name: 'Root', depth: 0,
    }).returning();
    const [fill] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n1', parentNodeId: rootNode.id, name: 'Fill', depth: 1,
    }).returning();
    await db.insert(workflowAllowedRole)
      .values({ workflowId: wf.id, workflowNodeId: fill.id, roleId: r.id });
    return root.id;
  });
}

test('importWfcenterx creates missing roles by name', async () => {
  const buf = await packageWithGrant();
  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId: null });
    expect(report.roles.created).toBe(1);
    const [r] = await db.select().from(role);
    expect(r).toMatchObject({ name: 'Operator', description: 'Runs it' });
  } finally { await close(); }
});

// role.name is globally UNIQUE — an existing role must be reused, never duplicated. Also
// proves the reused role's id actually reaches grant resolution: if idByName were populated
// only for newly-created roles (not the pre-existing one), the grant using this role would
// silently land in report.grants.unresolved instead of being applied — the same allowlist
// gap the race read-back guards against, reached through the "already exists" path instead.
test('importWfcenterx reuses a role that already exists by name, and its grant still resolves', async () => {
  const buf = await packageWithGrant();
  const { db, close } = await makeTestDb();
  try {
    const [existing] = await db.insert(role).values({ name: 'Operator', description: 'Pre-existing' }).returning();
    const report = await importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId: null });

    expect(report.roles.created).toBe(0);
    const rows = await db.select().from(role);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('Pre-existing');   // not overwritten by the package

    expect(report.grants).toEqual({ created: 1, alreadyPresent: 0, unresolved: [] });
    const [grant] = await db.select().from(workflowAllowedRole);
    expect(grant.roleId).toBe(existing.id);   // resolved against the REUSED role's id
  } finally { await close(); }
});

// §8.6.3 — one shape for both modes. Create fills the merge-only sections with their empty
// values rather than omitting them, so the renderer never handles `undefined`.
test('importWfcenterx returns the unified report shape in create mode', async () => {
  const buf = await seededPackage();
  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId: null });

    expect(report.workCenters).toEqual({ matched: 0, created: 1 });
    expect(report.links).toEqual({ created: 0, alreadyPresent: 0 });
    expect(report.grants).toEqual({ created: 0, alreadyPresent: 0, unresolved: [] });
    expect(report.configChanges).toEqual([]);
    expect(report.targetOnlyGrants).toEqual([]);
    expect(report.warnings).toEqual([]);
  } finally { await close(); }
});

// Both counter tests below craft a package a real export cannot produce, and that is the point.
// `report.links.created` / `report.grants.created` sit after an `onConflictDoNothing`, so they
// count ATTEMPTS rather than INSERTS. In create mode every work center is brand new, so no
// insert can lose a conflict and the miscount is unreachable through a round trip — which is
// exactly why it survived P2. It stops being unreachable in P3: merge mode resolves against an
// existing subtree where conflicts are routine, and spec §8.6 requires the preview's counts to
// equal what the confirmed run actually does. A duplicate ref inside one package drives the
// same `onConflictDoNothing`-inserted-nothing branch that a merge will hit constantly, so the
// counters can be pinned honestly now, before any merge-preview code is built on top of them.

test('importWfcenterx counts a link once when the manifest lists the same env ref twice', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'e1', name: 'Env', workCenterId: root.id, version: '1.0.0', state: 'Effective',
      specJsonb: { local_id: 'Env', oid: 'e1' },
    }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective',
      specJsonb: { local_id: 'Mix', oid: 'w1' },
    }).returning();
    await db.insert(workflowEnvironment)
      .values({ workflowId: wf.id, environmentSpecId: env.id, source: 'manual' });
    return root.id;
  });

  // workflow_environment's composite PK means the SOURCE database cannot hold this row twice,
  // so the duplicate has to be introduced into the manifest by hand.
  const zip = new AdmZip(buf);
  const manifestEntry = findManifestEntry(zip);
  const manifest = JSON.parse(zip.readAsText(manifestEntry));
  const refs = manifest.workCenters[0].workflows[0].environments;
  expect(refs).toHaveLength(1);
  refs.push({ ...refs[0] });
  const dupBuf = writeManifest(zip, manifestEntry, manifest);

  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, dupBuf, { mode: 'create', parentWorkCenterId: null });

    expect(await db.select().from(workflowEnvironment)).toHaveLength(1);
    expect(report.links.created).toBe(1);   // one row exists, so one creation is reported
    expect(report.links.alreadyPresent).toBe(1);
  } finally { await close(); }
});

test('importWfcenterx counts a grant once when allowed-roles.json lists it twice', async () => {
  const buf = await packageWithGrant();

  // workflow_allowed_role_uq means the SOURCE database cannot hold this grant twice either.
  const zip = new AdmZip(buf);
  const grantsEntry = zip.getEntry('roles/allowed-roles.json')!;
  const grantsFile = JSON.parse(zip.readAsText(grantsEntry));
  expect(grantsFile.grants).toHaveLength(1);
  grantsFile.grants.push({ ...grantsFile.grants[0] });
  zip.updateFile(grantsEntry, Buffer.from(JSON.stringify(grantsFile, null, 2), 'utf8'));
  const dupBuf = zip.toBuffer();

  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, dupBuf, { mode: 'create', parentWorkCenterId: null });

    expect(await db.select().from(workflowAllowedRole)).toHaveLength(1);
    expect(report.grants).toEqual({ created: 1, alreadyPresent: 1, unresolved: [] });
  } finally { await close(); }
});

// `work_center.dispatch_params` was removed outright (user decision 2026-07-30), so every
// package written by P1 or P2 carries a `dispatchParams` key this manifest type no longer
// declares. formatVersion is deliberately NOT bumped for the removal: no writer for the column
// ever existed outside the importer, so every package in the wild carries `dispatchParams:
// null` — semantically identical to its absence — and readWfcenterx ignores unknown manifest
// keys. This pins that tolerance so a later move to strict manifest validation cannot silently
// orphan those packages. A non-null value is used deliberately: it proves the key is IGNORED
// rather than merely absent-and-therefore-harmless.
test('importWfcenterx ignores the removed dispatchParams key in a pre-removal package', async () => {
  const zip = new AdmZip(await seededPackage());
  const manifestEntry = findManifestEntry(zip);
  const manifest = JSON.parse(zip.readAsText(manifestEntry));
  manifest.workCenters[0].dispatchParams = { maxQueue: 5 };
  const oldBuf = writeManifest(zip, manifestEntry, manifest);

  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, oldBuf, { mode: 'create', parentWorkCenterId: null });

    expect(report.workCenters.created).toBe(1);
    const [wc] = await db.select().from(workCenter);
    expect(wc.name).toBe('Line');
    expect('dispatchParams' in wc).toBe(false);   // no column, and nothing smuggled elsewhere
  } finally { await close(); }
});

test('importWfcenterx reapplies the per-node grant by resolving its node path', async () => {
  const buf = await packageWithGrant();
  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId: null });

    expect(report.grants).toEqual({ created: 1, alreadyPresent: 0, unresolved: [] });
    const [grant] = await db.select().from(workflowAllowedRole);
    const [node] = await db.select().from(workflowNode).where(eq(workflowNode.id, grant.workflowNodeId));
    expect(node.name).toBe('Fill');   // landed on the right node, not the root
  } finally { await close(); }
});

// Report, never guess (spec §8.7): a grant that cannot be resolved must not fail the import
// and must not silently vanish.
test('importWfcenterx reports an unresolvable grant instead of failing', async () => {
  const buf = await packageWithGrant();
  const zip = new AdmZip(buf);
  const grants = JSON.parse(zip.getEntry('roles/allowed-roles.json')!.getData().toString('utf8'));
  grants.grants[0].nodePath = 'Root/Nowhere';
  zip.updateFile('roles/allowed-roles.json', Buffer.from(JSON.stringify(grants)));

  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, zip.toBuffer(), { mode: 'create', parentWorkCenterId: null });

    expect(report.grants.created).toBe(0);
    expect(report.grants.unresolved).toHaveLength(1);
    expect(report.grants.unresolved[0]).toContain('Root/Nowhere');
    expect(await db.select().from(workflowAllowedRole)).toHaveLength(0);
    expect(await db.select().from(workflow)).toHaveLength(1);   // the import still succeeded
  } finally { await close(); }
});

// workflow_allowed_role is an ALLOWLIST: a grant applied to the WRONG node — e.g. because a
// node-path cache leaked across workflows — is worse than a grant failing to apply at all.
// Two workflows in the same work center here have IDENTICAL node trees (both 'Root/Fill'),
// each with a grant naming a DIFFERENT role on its own 'Root/Fill'. Only per-workflow
// isolation (the pathsByWorkflowId cache keyed by workflow id, and the workflowId filter on
// the node query that seeds it) can resolve both correctly.
async function packageWithTwoWorkflowsSharingAPath() {
  return exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [operator] = await db.insert(role).values({ name: 'Operator', description: 'Runs it' }).returning();
    const [supervisor] = await db.insert(role).values({ name: 'Supervisor', description: 'Oversees it' }).returning();

    const [wfA] = await db.insert(workflow).values({
      oid: 'wA', name: 'Mix A', workCenterId: root.id, version: '1.0.0', state: 'Effective',
      specJsonb: {
        local_id: 'Root', oid: 'wA',
        children: [{ local_id: 'Fill', oid: 'nA', steps: [] }],
        steps: [],
      },
    }).returning();
    const [rootA] = await db.insert(workflowNode).values({
      workflowId: wfA.id, nodeOid: 'wA', name: 'Root', depth: 0,
    }).returning();
    const [fillA] = await db.insert(workflowNode).values({
      workflowId: wfA.id, nodeOid: 'nA', parentNodeId: rootA.id, name: 'Fill', depth: 1,
    }).returning();
    await db.insert(workflowAllowedRole)
      .values({ workflowId: wfA.id, workflowNodeId: fillA.id, roleId: operator.id });

    const [wfB] = await db.insert(workflow).values({
      oid: 'wB', name: 'Mix B', workCenterId: root.id, version: '1.0.0', state: 'Effective',
      specJsonb: {
        local_id: 'Root', oid: 'wB',
        children: [{ local_id: 'Fill', oid: 'nB', steps: [] }],
        steps: [],
      },
    }).returning();
    const [rootB] = await db.insert(workflowNode).values({
      workflowId: wfB.id, nodeOid: 'wB', name: 'Root', depth: 0,
    }).returning();
    const [fillB] = await db.insert(workflowNode).values({
      workflowId: wfB.id, nodeOid: 'nB', parentNodeId: rootB.id, name: 'Fill', depth: 1,
    }).returning();
    await db.insert(workflowAllowedRole)
      .values({ workflowId: wfB.id, workflowNodeId: fillB.id, roleId: supervisor.id });

    return root.id;
  });
}

// Builds a two-level package: root 'Line' with child 'Cell'.
async function twoLevelPackage() {
  return exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({
      name: 'Line', description: 'from package', sortOrder: 7, dispatchPolicy: 'round_robin',
    }).returning();
    await db.insert(workCenter).values({ name: 'Cell', parentWorkCenterId: root.id });
    return root.id;
  });
}

// §8.4 — descendants match by name, level by level, under the caller's target.
test('importWfcenterx merges into an existing subtree, matching descendants by name', async () => {
  const buf = await twoLevelPackage();
  const { db, close } = await makeTestDb();
  try {
    const [target] = await db.insert(workCenter).values({ name: 'Live Line' }).returning();
    await db.insert(workCenter).values({ name: 'Cell', parentWorkCenterId: target.id });

    const report = await importWfcenterx(db, buf, {
      mode: 'merge', targetWorkCenterId: target.id, confirmed: true,
    });

    // Both the root and the existing 'Cell' matched; nothing new was created.
    expect(report.workCenters).toEqual({ matched: 2, created: 0 });
    expect(await db.select().from(workCenter)).toHaveLength(2);
    expect(report.rootWorkCenterId).toBe(target.id);
  } finally { await close(); }
});

// A package work center with no counterpart is created alongside ones that match.
test('importWfcenterx creates a package work center the target does not have', async () => {
  const buf = await twoLevelPackage();
  const { db, close } = await makeTestDb();
  try {
    const [target] = await db.insert(workCenter).values({ name: 'Live Line' }).returning();

    const report = await importWfcenterx(db, buf, {
      mode: 'merge', targetWorkCenterId: target.id, confirmed: true,
    });

    expect(report.workCenters).toEqual({ matched: 1, created: 1 });
    const rows = await db.select().from(workCenter);
    const cell = rows.find((r) => r.name === 'Cell')!;
    expect(cell.parentWorkCenterId).toBe(target.id);
  } finally { await close(); }
});

// D10 — the package's config wins on a matched row, and each real difference is itemised.
test('importWfcenterx overwrites a matched work center config and records the changes', async () => {
  const buf = await twoLevelPackage();
  const { db, close } = await makeTestDb();
  try {
    const [target] = await db.insert(workCenter).values({
      name: 'Live Line', description: 'local note', sortOrder: 0, dispatchPolicy: 'manual',
    }).returning();

    const report = await importWfcenterx(db, buf, {
      mode: 'merge', targetWorkCenterId: target.id, confirmed: true,
    });

    const [row] = await db.select().from(workCenter).where(eq(workCenter.id, target.id));
    expect(row).toMatchObject({
      description: 'from package', sortOrder: 7, dispatchPolicy: 'round_robin',
    });
    expect(row.name).toBe('Live Line');   // identity, never overwritten

    const fields = report.configChanges.map((c) => c.field).sort();
    expect(fields).toEqual(['description', 'dispatchPolicy', 'sortOrder']);
    const policy = report.configChanges.find((c) => c.field === 'dispatchPolicy')!;
    expect(policy).toMatchObject({ from: 'manual', to: 'round_robin', workflow: null });
  } finally { await close(); }
});

// §8.6 — configChanges records only fields that actually DIFFER, so an empty list is a real
// signal that no local tuning is at risk.
test('importWfcenterx records no configChanges when the package agrees with the target', async () => {
  const buf = await twoLevelPackage();
  const { db, close } = await makeTestDb();
  try {
    const [target] = await db.insert(workCenter).values({
      name: 'Live Line', description: 'from package', sortOrder: 7, dispatchPolicy: 'round_robin',
    }).returning();

    const before = (await db.select().from(workCenter)
      .where(eq(workCenter.id, target.id)))[0].updatedAt;

    const report = await importWfcenterx(db, buf, {
      mode: 'merge', targetWorkCenterId: target.id, confirmed: true,
    });

    expect(report.configChanges).toEqual([]);
    // No UPDATE fired. Without this, the assertion above passes vacuously —
    // configChanges is [] on ANY implementation that never populates it.
    const after = (await db.select().from(workCenter)
      .where(eq(workCenter.id, target.id)))[0].updatedAt;
    expect(after).toEqual(before);
  } finally { await close(); }
});

// D10 for the per-entry override. The entry already exists, so insertWorkflowEntry reports
// already_present and writes nothing — the update below is the importer's own, and it names
// one column so provenance cannot ride along.
test('importWfcenterx overwrites an already-present entry dispatch override on merge', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective',
      dispatchPolicy: 'round_robin', sourceFilename: 'from-package.WFmasterX',
      specJsonb: { local_id: 'Mix', oid: 'w1' },
    });
    return root.id;
  });

  const { db, close } = await makeTestDb();
  try {
    const [target] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: target.id, version: '1.0.0', state: 'Effective',
      dispatchPolicy: 'manual', sourceFilename: 'loaded-locally.WFmasterX',
      specJsonb: { local_id: 'Mix', oid: 'w1' },
    });

    const report = await importWfcenterx(db, buf, {
      mode: 'merge', targetWorkCenterId: target.id, confirmed: true,
    });

    const [wf] = await db.select().from(workflow);
    expect(wf.dispatchPolicy).toBe('round_robin');                 // D10: config transfers
    expect(wf.sourceFilename).toBe('loaded-locally.WFmasterX');    // §8.5.2: history does not
    expect(report.workflows).toEqual({ created: 0, alreadyPresent: 1 });

    const change = report.configChanges.find((c) => c.workflow !== null)!;
    expect(change).toMatchObject({
      field: 'dispatchPolicy', from: 'manual', to: 'round_robin',
      workflow: { oid: 'w1', version: '1.0.0', state: 'Effective' },
    });
  } finally { await close(); }
});

// Create mode must NOT overwrite: a colliding entry there is reported already-present and
// left alone, exactly as P2 shipped it. Create mode always builds a BRAND-NEW work center, so
// the only way an entry can collide there is if the PACKAGE ITSELF declares the same
// (oid, version, state) twice — a real export cannot produce that (the source db's unique
// index on (work_center_id, oid, version, state) forbids the duplicate row), so it is crafted
// by hand, same idiom as "counts a link once ..." / "counts a grant once ..." below.
test('importWfcenterx leaves an already-present entry untouched in create mode', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Effective',
      dispatchPolicy: 'round_robin', specJsonb: { local_id: 'Mix', oid: 'w1' },
    });
    return root.id;
  });

  const zip = new AdmZip(buf);
  const manifestEntry = findManifestEntry(zip);
  const manifest = JSON.parse(zip.readAsText(manifestEntry));
  const workflows = manifest.workCenters[0].workflows;
  expect(workflows).toHaveLength(1);
  // Second copy of the SAME entry, declaring a DIFFERENT dispatchPolicy — both point at the
  // same file, since only the manifest entry (not the spec) carries dispatchPolicy.
  workflows.push({ ...workflows[0], dispatchPolicy: 'manual' });
  const dupBuf = writeManifest(zip, manifestEntry, manifest);

  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, dupBuf, { mode: 'create', parentWorkCenterId: null });

    // alreadyPresent: 1 proves the collision branch actually fired in create mode.
    expect(report.workflows).toEqual({ created: 1, alreadyPresent: 1 });
    expect(report.configChanges).toEqual([]);
    const [wf] = await db.select().from(workflow);
    expect(wf.dispatchPolicy).toBe('round_robin');   // the FIRST copy's value, not overwritten
  } finally { await close(); }
});

test('importWfcenterx isolates node-path resolution per workflow when two workflows share an identical path', async () => {
  const buf = await packageWithTwoWorkflowsSharingAPath();
  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId: null });
    expect(report.grants).toEqual({ created: 2, alreadyPresent: 0, unresolved: [] });

    const wfRows = await db.select().from(workflow);
    const wfAId = wfRows.find((w) => w.oid === 'wA')!.id;
    const wfBId = wfRows.find((w) => w.oid === 'wB')!.id;
    const operatorId = (await db.select().from(role).where(eq(role.name, 'Operator')))[0].id;
    const supervisorId = (await db.select().from(role).where(eq(role.name, 'Supervisor')))[0].id;

    const grants = await db.select().from(workflowAllowedRole);
    expect(grants).toHaveLength(2);
    for (const grant of grants) {
      const [node] = await db.select().from(workflowNode).where(eq(workflowNode.id, grant.workflowNodeId));
      expect(node.name).toBe('Fill');
      // The node a grant landed on must belong to the SAME workflow the grant is recorded
      // against — never the other workflow's node, even though both are named 'Fill' at the
      // identical path 'Root/Fill'.
      expect(node.workflowId).toBe(grant.workflowId);
    }

    const grantA = grants.find((g) => g.workflowId === wfAId)!;
    const grantB = grants.find((g) => g.workflowId === wfBId)!;
    expect(grantA.roleId).toBe(operatorId);   // A's grant kept A's role, not B's
    expect(grantB.roleId).toBe(supervisorId);
  } finally { await close(); }
});

// D9 (§8.5.1) — a merge never deletes. Everything the target has and the package lacks
// survives, and a target-only GRANT is additionally reported so the divergence is visible.
test('importWfcenterx leaves target-only rows in place and reports target-only grants', async () => {
  const buf = await packageWithGrant();   // work center 'Line', workflow w1, grant Operator@Root/Fill

  const { db, close } = await makeTestDb();
  try {
    const [target] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    // An entry the package does not contain at all.
    await db.insert(workflow).values({
      oid: 'local-only', name: 'Local', workCenterId: target.id,
      version: '1.0.0', state: 'Effective', specJsonb: { local_id: 'Local', oid: 'local-only' },
    });
    // The package's own workflow, already present, carrying a grant the package does NOT declare.
    const [wf] = await db.insert(workflow).values({
      oid: 'w1', name: 'Root', workCenterId: target.id, version: '1.0.0', state: 'Effective',
      specJsonb: { local_id: 'Root', oid: 'w1' },
    }).returning();
    const [rootNode] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'w1', name: 'Root', depth: 0,
    }).returning();
    const [fill] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n1', parentNodeId: rootNode.id, name: 'Fill', depth: 1,
    }).returning();
    const [supervisor] = await db.insert(role).values({ name: 'Supervisor' }).returning();
    await db.insert(workflowAllowedRole)
      .values({ workflowId: wf.id, workflowNodeId: fill.id, roleId: supervisor.id });

    const report = await importWfcenterx(db, buf, {
      mode: 'merge', targetWorkCenterId: target.id, confirmed: true,
    });

    // Nothing was removed.
    const names = (await db.select().from(workflow)).map((w) => w.name).sort();
    expect(names).toEqual(['Local', 'Root']);
    // The target-only grant survives untouched...
    const grants = await db.select().from(workflowAllowedRole);
    expect(grants.some((g) => g.roleId === supervisor.id)).toBe(true);
    // ...and is reported.
    expect(report.targetOnlyGrants).toEqual([{
      workCenterPath: 'Line',
      workflow: { oid: 'w1', version: '1.0.0', state: 'Effective' },
      nodePath: 'Root/Fill',
      role: 'Supervisor',
    }]);
  } finally { await close(); }
});

// A grant the package DOES declare is not target-only, even though it already exists.
test('importWfcenterx does not report a grant the package also declares as target-only', async () => {
  const buf = await packageWithGrant();
  const { db, close } = await makeTestDb();
  try {
    // First merge creates everything; the second sees it all already present.
    const [target] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await importWfcenterx(db, buf, { mode: 'merge', targetWorkCenterId: target.id, confirmed: true });

    const report = await importWfcenterx(db, buf, {
      mode: 'merge', targetWorkCenterId: target.id, confirmed: true,
    });

    expect(report.targetOnlyGrants).toEqual([]);
    expect(report.grants.alreadyPresent).toBe(1);
    expect(report.grants.created).toBe(0);
  } finally { await close(); }
});

// buildNodePaths returns null for TWO different reasons (carry-over.ts's own docstring): a
// broken parent chain, and a path shared by two same-named siblings. A target-only grant that
// lands on an ambiguous node cannot be named, so it cannot go in targetOnlyGrants — but merge
// never deletes, so the grant survives in the database untouched, and silently dropping it here
// would hide exactly the divergence targetOnlyGrants exists to surface. It must be warned
// about instead.
test('importWfcenterx warns instead of silently dropping a target-only grant on an ambiguous node path', async () => {
  const buf = await packageWithGrant();   // work center 'Line', workflow oid w1, grant Operator@Root/Fill

  const { db, close } = await makeTestDb();
  try {
    const [target] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w1', name: 'Root', workCenterId: target.id, version: '1.0.0', state: 'Effective',
      specJsonb: { local_id: 'Root', oid: 'w1' },
    }).returning();
    const [rootNode] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'w1', name: 'Root', depth: 0,
    }).returning();
    // Two siblings sharing a name make 'Root/Fill' ambiguous for BOTH — buildNodePaths maps
    // each to null, not to a real path.
    const [fillA] = await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n1', parentNodeId: rootNode.id, name: 'Fill', depth: 1,
    }).returning();
    await db.insert(workflowNode).values({
      workflowId: wf.id, nodeOid: 'n2', parentNodeId: rootNode.id, name: 'Fill', depth: 1,
    });
    const [supervisor] = await db.insert(role).values({ name: 'Supervisor' }).returning();
    // A grant the package does not declare, sitting on the now-ambiguous node.
    await db.insert(workflowAllowedRole)
      .values({ workflowId: wf.id, workflowNodeId: fillA.id, roleId: supervisor.id });

    const report = await importWfcenterx(db, buf, {
      mode: 'merge', targetWorkCenterId: target.id, confirmed: true,
    });

    // Cannot be named, so it is not (and cannot be) in targetOnlyGrants...
    expect(report.targetOnlyGrants).toEqual([]);
    // ...but the divergence is surfaced, not silently swallowed.
    expect(report.warnings.some((w) => w.includes('Supervisor'))).toBe(true);
    // Merge never deletes: the grant itself is untouched in the database.
    const grants = await db.select().from(workflowAllowedRole).where(eq(workflowAllowedRole.workflowId, wf.id));
    expect(grants.some((g) => g.roleId === supervisor.id)).toBe(true);
  } finally { await close(); }
});

// §8.6 — an unconfirmed merge resolves fully and then rolls back. The database must be
// untouched afterwards. THIS is the test that stops §8.6.1's sentinel throw being "cleaned up"
// into a return, which would turn every preview into an applied merge.
test('importWfcenterx writes nothing when a merge is not confirmed', async () => {
  const buf = await twoLevelPackage();
  const { db, close } = await makeTestDb();
  try {
    const [target] = await db.insert(workCenter).values({
      name: 'Live Line', dispatchPolicy: 'manual',
    }).returning();

    const preview = await importWfcenterx(db, buf, {
      mode: 'merge', targetWorkCenterId: target.id, confirmed: false,
    });

    expect(preview.workCenters).toEqual({ matched: 1, created: 1 });
    expect(preview.configChanges.length).toBeGreaterThan(0);

    // Nothing landed: no new work center, and the target's config is as it was.
    expect(await db.select().from(workCenter)).toHaveLength(1);
    const [row] = await db.select().from(workCenter);
    expect(row.dispatchPolicy).toBe('manual');
  } finally { await close(); }
});

// §8.6/§10 — the preview's numbers are the confirmed run's numbers, because the same
// statements produce both. Asserted with nothing modifying the target in between; §8.6.2
// accepts drift under concurrent modification, so do NOT try to make this hold against a race.
test('a merge preview reports the same counts the confirmed run does', async () => {
  const buf = await packageWithGrant();
  const { db, close } = await makeTestDb();
  try {
    const [target] = await db.insert(workCenter).values({ name: 'Line' }).returning();

    const preview = await importWfcenterx(db, buf, {
      mode: 'merge', targetWorkCenterId: target.id, confirmed: false,
    });
    const applied = await importWfcenterx(db, buf, {
      mode: 'merge', targetWorkCenterId: target.id, confirmed: true,
    });

    expect(applied.workCenters).toEqual(preview.workCenters);
    expect(applied.workflows).toEqual(preview.workflows);
    expect(applied.environments).toEqual(preview.environments);
    expect(applied.links).toEqual(preview.links);
    expect(applied.roles).toEqual(preview.roles);
    expect(applied.grants).toEqual(preview.grants);
    expect(applied.configChanges).toEqual(preview.configChanges);
  } finally { await close(); }
});

// ── Auto-claim round-trip (spec 2026-08-14 D4) ───────────────────────────────

test('importWfcenterx round-trips autoClaim at both the work-center and workflow level', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line', autoClaim: true }).returning();
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Draft',
      specJsonb: { local_id: 'Mix', oid: 'w1' }, autoClaim: false,
    });
    return root.id;
  });

  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId: null });
    const [wc] = await db.select().from(workCenter).where(eq(workCenter.id, report.rootWorkCenterId));
    expect(wc.autoClaim).toBe(true);
    const [wf] = await db.select().from(workflow).where(eq(workflow.workCenterId, wc.id));
    expect(wf.autoClaim).toBe(false);
  } finally { await close(); }
});

test('merge records autoClaim configChanges at both levels when the package differs', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line', autoClaim: true }).returning();
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Draft',
      specJsonb: { local_id: 'Mix', oid: 'w1' }, autoClaim: true,
    });
    return root.id;
  });

  const { db, close } = await makeTestDb();
  try {
    // Target: same identity, differing autoClaim at both levels (wc false, workflow null).
    const [target] = await db.insert(workCenter).values({ name: 'Live Line', autoClaim: false }).returning();
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: target.id, version: '1.0.0', state: 'Draft',
      specJsonb: { local_id: 'Mix', oid: 'w1' },
    });

    const report = await importWfcenterx(db, buf, { mode: 'merge', targetWorkCenterId: target.id, confirmed: true });

    const wcChange = report.configChanges.find((c) => c.field === 'autoClaim' && c.workflow === null)!;
    expect(wcChange).toMatchObject({ from: false, to: true });
    const wfChange = report.configChanges.find((c) => c.field === 'autoClaim' && c.workflow !== null)!;
    expect(wfChange).toMatchObject({ from: null, to: true });

    const [wcRow] = await db.select().from(workCenter).where(eq(workCenter.id, target.id));
    expect(wcRow.autoClaim).toBe(true);
    const [wfRow] = await db.select().from(workflow).where(eq(workflow.workCenterId, target.id));
    expect(wfRow.autoClaim).toBe(true);
  } finally { await close(); }
});

// Merge-mode back-compat (review fix): an ABSENT autoClaim key means "package predates the
// feature", so merging an old package must PRESERVE hand-set auto-claim on the target — at
// both levels — and record no autoClaim configChanges.
test('merging a pre-feature package preserves hand-set autoClaim on the target', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Draft',
      specJsonb: { local_id: 'Mix', oid: 'w1' },
    });
    return root.id;
  });
  const zip = new AdmZip(buf);
  const entry = findManifestEntry(zip)!;
  const manifest = JSON.parse(zip.readAsText(entry));
  for (const wc of manifest.workCenters) {
    delete wc.autoClaim;
    for (const w of wc.workflows ?? []) delete w.autoClaim;
  }
  zip.updateFile(entry, Buffer.from(JSON.stringify(manifest)));

  const { db, close } = await makeTestDb();
  try {
    const [target] = await db.insert(workCenter).values({ name: 'Live Line', autoClaim: true }).returning();
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: target.id, version: '1.0.0', state: 'Draft',
      specJsonb: { local_id: 'Mix', oid: 'w1' }, autoClaim: true,
    });

    const report = await importWfcenterx(db, zip.toBuffer(), { mode: 'merge', targetWorkCenterId: target.id, confirmed: true });

    expect(report.configChanges.filter((c) => c.field === 'autoClaim')).toEqual([]);
    const [wcRow] = await db.select().from(workCenter).where(eq(workCenter.id, target.id));
    expect(wcRow.autoClaim).toBe(true);
    const [wfRow] = await db.select().from(workflow).where(eq(workflow.workCenterId, target.id));
    expect(wfRow.autoClaim).toBe(true);
  } finally { await close(); }
});

// Backward compatibility: a pre-2026-08-14 package (no autoClaim keys anywhere) imports with
// the column defaults — wc false, workflow null — rather than failing or writing junk.
test('a package without autoClaim fields imports with defaults', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(workflow).values({
      oid: 'w1', name: 'Mix', workCenterId: root.id, version: '1.0.0', state: 'Draft',
      specJsonb: { local_id: 'Mix', oid: 'w1' },
    });
    return root.id;
  });
  // Strip the autoClaim keys the current exporter writes, simulating an old package.
  const zip = new AdmZip(buf);
  const entry = findManifestEntry(zip)!;
  const manifest = JSON.parse(zip.readAsText(entry));
  for (const wc of manifest.workCenters) {
    delete wc.autoClaim;
    for (const w of wc.workflows ?? []) delete w.autoClaim;
  }
  zip.updateFile(entry, Buffer.from(JSON.stringify(manifest)));

  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, zip.toBuffer(), { mode: 'create', parentWorkCenterId: null });
    const [wc] = await db.select().from(workCenter).where(eq(workCenter.id, report.rootWorkCenterId));
    expect(wc.autoClaim).toBe(false);
    const [wf] = await db.select().from(workflow).where(eq(workflow.workCenterId, wc.id));
    expect(wf.autoClaim).toBeNull();
  } finally { await close(); }
});

// Task 5: environment import must call materializeEnvironmentRegistry so a WFcenterX carrying
// resource declarations populates the work center's shared registry, not just environment_spec.
test('importWfcenterx materializes an embedded environment\'s resource declarations', async () => {
  const buf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(environmentSpec).values({
      oid: 'e1', name: 'Env', workCenterId: root.id, version: '1.0.0', state: 'Effective',
      specJsonb: {
        local_id: 'Env', oid: 'e1',
        resource_property_specifications: [{ name: 'Printer', resource_type: 'binary exclusive use' }],
      },
    });
    return root.id;
  });

  const { db, close } = await makeTestDb();
  try {
    const report = await importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId: null });
    expect(Array.isArray(report.warnings)).toBe(true);
    const [wc] = await db.select().from(workCenter).where(eq(workCenter.id, report.rootWorkCenterId));
    const rows = await db.select().from(wcResource);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Printer');
    expect(rows[0].workCenterId).toBe(wc.id);
  } finally { await close(); }
});

// Fix follow-up (task 5 review): the already-present branch must pass the environment_spec
// row's REAL downloaded_at into materializeEnvironmentRegistry, not a fabricated `new Date()`.
// downloadedAt is tier 3 of the definition-precedence rule (Effective beats not, then higher
// version, then later downloadedAt — see environment-precedence.ts), and compareDefinitionPrecedence
// treats an EXACT tie as "incumbent keeps it" (0 is not > 0). A fabricated "now" would make an
// unchanged re-import always look strictly newer than its own prior declaration, so a tie that
// should be a no-op would instead silently let the incoming side win and overwrite a shared
// resource's definition on every re-import.
//
// This test backdates the environment_spec row's downloaded_at to a known past instant, then
// MERGES a second package declaring the SAME (oid, version, state) — so state and version are
// deliberately equal, forcing the comparison down to tier 3 — but a CONFLICTING resource
// declaration. Under the fix, the incoming side reads the same row's real (backdated)
// downloadedAt, exactly matching the incumbent's own origin lookup: a genuine tie, so the
// incumbent's original declaration must survive. Under the old fabricated-`new Date()` code,
// "now" is unambiguously later than the backdated incumbent, so the incoming side would win and
// the assertion below would fail — that is the direction that makes this test discriminate.
test('importWfcenterx already-present branch uses the environment_spec row\'s real downloadedAt for precedence ties, not a fabricated now', async () => {
  const firstBuf = await exportFrom(async (db) => {
    const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await db.insert(environmentSpec).values({
      oid: 'e1', name: 'Env', workCenterId: root.id, version: '1.0.0', state: 'Effective',
      specJsonb: {
        local_id: 'Env', oid: 'e1',
        resource_property_specifications: [{ name: 'Printer', resource_type: 'binary exclusive use' }],
      },
    });
    return root.id;
  });

  const { db, close } = await makeTestDb();
  try {
    const first = await importWfcenterx(db, firstBuf, { mode: 'create', parentWorkCenterId: null });

    // Backdate the just-created environment_spec row to an unambiguous past instant, so the
    // comparison below cannot depend on how fast the test happens to execute.
    const [envRow] = await db.select().from(environmentSpec).where(eq(environmentSpec.oid, 'e1'));
    await db.update(environmentSpec)
      .set({ downloadedAt: new Date('2020-01-01T00:00:00.000Z') })
      .where(eq(environmentSpec.id, envRow.id));

    // A second package: same (oid, version, state) as above, but Printer is now a CONFLICTING
    // declaration (named pool instead of binary exclusive use).
    const secondBuf = await exportFrom(async (sdb) => {
      const [root2] = await sdb.insert(workCenter).values({ name: 'Other' }).returning();
      await sdb.insert(environmentSpec).values({
        oid: 'e1', name: 'Env', workCenterId: root2.id, version: '1.0.0', state: 'Effective',
        specJsonb: {
          local_id: 'Env', oid: 'e1',
          resource_property_specifications: [{ name: 'Printer', resource_type: 'named pool', names: ['P1'] }],
        },
      });
      return root2.id;
    });

    // Merge into the SAME target work center, so the natural-key match (workCenterId, oid,
    // version, state) hits the already-present branch under test.
    await importWfcenterx(db, secondBuf, {
      mode: 'merge', targetWorkCenterId: first.rootWorkCenterId, confirmed: true,
    });

    const [resource] = await db.select().from(wcResource)
      .where(eq(wcResource.workCenterId, first.rootWorkCenterId));
    // A genuine tie must keep the INCUMBENT definition. This fails under the old
    // fabricated-new-Date() code, which always lets the incoming side win the tie instead.
    expect(resource.resourceType).toBe('binary exclusive use');
  } finally { await close(); }
});

// ── ISA 88 type name (typeName) ──────────────────────────────────────────────

function rewriteManifest(buf: Buffer, edit: (wc: any) => void): Buffer {
  const zip = new AdmZip(buf);
  const entry = findManifestEntry(zip)!;
  const manifest = JSON.parse(zip.readAsText(entry));
  for (const wc of manifest.workCenters) edit(wc);
  zip.updateFile(entry, Buffer.from(JSON.stringify(manifest)));
  return zip.toBuffer();
}

const plainLinePackage = () => exportFrom(async (db) => {
  const [root] = await db.insert(workCenter).values({ name: 'Line' }).returning();
  return root.id;
});

test('readWfcenterx rejects a non-string typeName but accepts absent and null', async () => {
  const buf = await plainLinePackage();
  expect(() => readWfcenterx(rewriteManifest(buf, (wc) => { wc.typeName = 5; })))
    .toThrowError(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
  expect(() => readWfcenterx(rewriteManifest(buf, (wc) => { wc.typeName = null; }))).not.toThrow();
  expect(() => readWfcenterx(rewriteManifest(buf, (wc) => { delete wc.typeName; }))).not.toThrow();
});

test('create import: typeName is carried; absent gives null', async () => {
  const buf = await plainLinePackage();
  const { db, close } = await makeTestDb();
  try {
    const typed = await importWfcenterx(db, rewriteManifest(buf, (wc) => { wc.typeName = 'Unit'; }),
      { mode: 'create', parentWorkCenterId: null });
    const [a] = await db.select().from(workCenter).where(eq(workCenter.id, typed.rootWorkCenterId));
    expect(a.typeName).toBe('Unit');
    await db.delete(workCenter).where(eq(workCenter.id, typed.rootWorkCenterId));
    const untyped = await importWfcenterx(db, rewriteManifest(buf, (wc) => { delete wc.typeName; }),
      { mode: 'create', parentWorkCenterId: null });
    const [b] = await db.select().from(workCenter).where(eq(workCenter.id, untyped.rootWorkCenterId));
    expect(b.typeName).toBeNull();
  } finally { await close(); }
});

test('merge import: absent typeName keeps, null clears, string overwrites', async () => {
  const buf = await plainLinePackage();
  const run = async (edit: (wc: any) => void) => {
    const { db, close } = await makeTestDb();
    try {
      const [target] = await db.insert(workCenter).values({ name: 'Live Line', typeName: 'Area' }).returning();
      const report = await importWfcenterx(db, rewriteManifest(buf, edit),
        { mode: 'merge', targetWorkCenterId: target.id, confirmed: true });
      const [row] = await db.select().from(workCenter).where(eq(workCenter.id, target.id));
      return { type: row.typeName, changes: report.configChanges.filter((c) => c.field === 'typeName') };
    } finally { await close(); }
  };
  expect(await run((wc) => { delete wc.typeName; })).toEqual({ type: 'Area', changes: [] });
  const cleared = await run((wc) => { wc.typeName = null; });
  expect(cleared.type).toBeNull();
  expect(cleared.changes).toEqual([expect.objectContaining({ field: 'typeName', from: 'Area', to: null })]);
  const set = await run((wc) => { wc.typeName = 'Site'; });
  expect(set.type).toBe('Site');
  expect(set.changes).toEqual([expect.objectContaining({ field: 'typeName', from: 'Area', to: 'Site' })]);
});
