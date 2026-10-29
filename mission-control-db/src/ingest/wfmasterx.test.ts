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
import { buildWfmasterx } from '../seed/sample-bundle.js';
import { ingestWorkflowPackage } from './wfmasterx.js';
import { workflow, workflowNode, workflowUiStep, workflowEnvironment, environmentSpec, workCenter, workflowAllowedRole, role, workflowImage, wcResource, workflowSignatureRole } from '../db/schema/index.js';
import { pgErrorCode } from '../dao/errors.js';
import { MAX_NAME_LENGTH } from '../dao/names.js';
import AdmZip from 'adm-zip';

const rootSpec = {
  local_id: 'Bake', oid: 'wf-1', version: '2.0.0', state: 'Effective', schemaVersion: '4.0',
  steps: [
    { local_id: 'Start', oid: 's0', step_type: 'START' },
    { local_id: 'Confirm', oid: 's1', step_type: 'USER_INTERACTION' },
    { local_id: 'OK?', oid: 's2', step_type: 'YES_NO' },
  ],
  connections: [],
  environment_specifications: [{ local_id: 'Kitchen', oid: 'env-1', version: '1.0.0', library_name: 'KitchenLib', included_actions: [] }],
  children: [
    { local_id: 'Sub', oid: 'wf-1-c1', parentChildSpecId: null, version: '1.0.0', state: 'Effective',
      steps: [{ local_id: 'Plate', oid: 's3', step_type: 'USER_INTERACTION' }], connections: [] },
  ],
};

test('a second load of the same (oid, version, state) is a no-op', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const buf = buildWfmasterx({ oid: 'wf-1', local_id: 'Bottle Fill', version: '1.0.0', state: 'Draft' });
    const first = await ingestWorkflowPackage(db, buf, { workCenterId: wc.id });
    const second = await ingestWorkflowPackage(db, buf, { workCenterId: wc.id });
    expect(first.status).toBe('loaded');
    expect(second.status).toBe('already_present');
    expect(second.workflowId).toBe(first.workflowId);
    expect(await db.select().from(workflow)).toHaveLength(1);
  } finally { await close(); }
});

test('a changed state at the same version is a NEW independent entry', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const draft = await ingestWorkflowPackage(db,
      buildWfmasterx({ oid: 'wf-1', local_id: 'BF', version: '1.0.0', state: 'Draft' }), { workCenterId: wc.id });

    // Seed a role assignment on the draft entry's (only) node BEFORE loading the Effective
    // entry, so carryOverConfig has something real to carry. This makes the ordering assertion
    // below load-bearing: with rolesCarried always 0 (no role rows at all), it would pass
    // identically whether carry-over ran before or after insertNode — it wouldn't be able to
    // fail if that ordering ever regressed. A path match ('BF' — the root node's only name,
    // unambiguous on both sides) requires the new entry's nodes to already exist to succeed.
    const [op] = await db.insert(role).values({ name: 'Operator' }).returning();
    const [draftNode] = await db.select().from(workflowNode).where(eq(workflowNode.workflowId, draft.workflowId));
    await db.insert(workflowAllowedRole).values({
      workflowId: draft.workflowId, workflowNodeId: draftNode.id, roleId: op.id,
    });

    const eff = await ingestWorkflowPackage(db,
      buildWfmasterx({ oid: 'wf-1', local_id: 'BF', version: '1.0.0', state: 'Effective' }), { workCenterId: wc.id });
    expect(eff.status).toBe('loaded');
    expect(eff.workflowId).not.toBe(draft.workflowId);
    expect(await db.select().from(workflow)).toHaveLength(2);

    // carryOverConfig (Task 3) must be wired in AFTER the new entry's nodes exist: the newer
    // entry's report should point back at the prior LOADED entry for the same (work center, oid),
    // and the seeded role must actually be carried — proving insertNode ran first.
    expect(draft.carriedOver).toMatchObject({ sourceWorkflowId: null, dispatchPolicy: null, rolesCarried: 0 });
    expect(eff.carriedOver).toMatchObject({ sourceWorkflowId: draft.workflowId, rolesCarried: 1 });
  } finally { await close(); }
});

// PGlite serializes every query onto one connection, so a real Promise.all race between two
// ingestWorkflowPackage() calls can't be forced through this harness — both calls just run
// to completion one after another, and the second always resolves via the fast-path SELECT.
// What CAN be verified directly, inside a real transaction (matching ingestWorkflowPackage's
// own execution context — the original version of this test ran everything through `db`
// directly, i.e. autocommit, which is the one context where this bug is invisible):
//   1. catch-and-re-read is fatal. Postgres aborts a transaction on ANY statement error, so
//      catching a 23505 and then re-reading in the SAME transaction fails with 25P02 "current
//      transaction is aborted" — not the row. This is exactly the shape the original ingest
//      catch block used, and exactly the bug that made it lose its race with a 500 instead of
//      answering already_present.
//   2. ON CONFLICT DO NOTHING never raises, so the transaction stays healthy and the recovery
//      re-read succeeds — this is the pattern wfmasterx.ts now uses.
test('a duplicate insert inside a transaction poisons it — recovery must be ON CONFLICT DO NOTHING, not catch-and-re-read', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const key = { oid: 'wf-1', name: 'BF', workCenterId: wc.id, version: '1.0.0', state: 'Draft', specJsonb: {} };
    const [first] = await db.insert(workflow).values(key).returning();
    const uqWhere = and(
      eq(workflow.workCenterId, wc.id), eq(workflow.oid, 'wf-1'),
      eq(workflow.version, '1.0.0'), eq(workflow.state, 'Draft'),
    );

    // 1. The anti-pattern: catch the 23505, then try to recover in the same transaction.
    let poisoned: unknown;
    try {
      await db.transaction(async (tx) => {
        try {
          await tx.insert(workflow).values(key);
        } catch {
          // swallow, mirroring the original catch block — then try to recover. This throws.
        }
        return tx.select({ id: workflow.id }).from(workflow).where(uqWhere).limit(1);
      });
    } catch (err) {
      poisoned = err;
    }
    expect(poisoned).toBeDefined();
    expect(pgErrorCode(poisoned)).toBe('25P02');

    // 2. The fix: ON CONFLICT DO NOTHING + conditional re-read, both in one healthy transaction.
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(workflow).values(key)
        .onConflictDoNothing({ target: [workflow.workCenterId, workflow.oid, workflow.version, workflow.state] })
        .returning();
      if (inserted) return [inserted];
      return tx.select({ id: workflow.id }).from(workflow).where(uqWhere).limit(1);
    });
    expect(row[0]?.id).toBe(first.id);
  } finally { await close(); }
});

// Coverage debt: state-varying and work-center-varying independence are both tested through
// ingest (above / below), but version-varying was not — the schema-level test in
// direct-load.test.ts only exercises it via a direct insert, never through ingestWorkflowPackage.
test('a changed version at the same state is a NEW independent entry, loaded through ingest', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const v1 = await ingestWorkflowPackage(db,
      buildWfmasterx({ oid: 'wf-1', local_id: 'BF', version: '1.0.0', state: 'Draft' }), { workCenterId: wc.id });
    const v2 = await ingestWorkflowPackage(db,
      buildWfmasterx({ oid: 'wf-1', local_id: 'BF', version: '2.0.0', state: 'Draft' }), { workCenterId: wc.id });
    expect(v1.status).toBe('loaded');
    expect(v2.status).toBe('loaded');
    expect(v2.workflowId).not.toBe(v1.workflowId);

    const rows = await db.select().from(workflow).where(eq(workflow.oid, 'wf-1'));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual([v1.workflowId, v2.workflowId].sort());
  } finally { await close(); }
});

test('the same package in two work centers yields two independent entries', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [a] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [b] = await db.insert(workCenter).values({ name: 'Line 2' }).returning();
    const buf = buildWfmasterx({ oid: 'wf-1', local_id: 'BF', version: '1.0.0', state: 'Draft' });
    const one = await ingestWorkflowPackage(db, buf, { workCenterId: a.id });
    const two = await ingestWorkflowPackage(db, buf, { workCenterId: b.id });
    expect(one.workflowId).not.toBe(two.workflowId);
    expect(one.status).toBe('loaded');
    expect(two.status).toBe('loaded');
  } finally { await close(); }
});

test('Designer library identity is stored as provenance and never routes the row', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const buf = buildWfmasterx({
      oid: 'wf-1', local_id: 'BF', version: '1.0.0', state: 'Draft',
      library_name: 'Packaging Masters', library_oid: 'lib-7',
    });
    const res = await ingestWorkflowPackage(db, buf, { workCenterId: wc.id });
    const [row] = await db.select().from(workflow).where(eq(workflow.id, res.workflowId));
    expect(row.workCenterId).toBe(wc.id);
    expect(row.sourceLibraryName).toBe('Packaging Masters');
    expect(row.sourceLibraryOid).toBe('lib-7');
  } finally { await close(); }
});

test('an embedded environment lands in the same work center and dedupes across workflows', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const env = { oid: 'env-1', local_id: 'Line Env', version: '1.0.0', state: 'Draft' };
    await ingestWorkflowPackage(db,
      buildWfmasterx({ oid: 'wf-1', local_id: 'A', version: '1.0.0', state: 'Draft', environment_specifications: [env] }),
      { workCenterId: wc.id });
    await ingestWorkflowPackage(db,
      buildWfmasterx({ oid: 'wf-2', local_id: 'B', version: '1.0.0', state: 'Draft', environment_specifications: [env] }),
      { workCenterId: wc.id });
    expect(await db.select().from(environmentSpec)).toHaveLength(1);
    expect(await db.select().from(workflowEnvironment)).toHaveLength(2);
  } finally { await close(); }
});

test('ingest indexes nodes + UI/YES_NO steps, extracts embedded env, and a second load is a no-op', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const buf = buildWfmasterx(rootSpec, [{ libName: 'KitchenLib', lib: { local_id: 'KitchenLib', oid: 'envlib-1', version: '1.0.0', environment_specifications: [{ local_id: 'Kitchen', oid: 'env-1', version: '1.0.0', included_actions: [] }] } }]);

    const r1 = await ingestWorkflowPackage(db, buf, { workCenterId: wc.id, effectiveFrom: new Date('2026-01-01') });
    expect(r1.status).toBe('loaded');
    expect(r1.nodeCount).toBe(2);      // root + 1 child
    expect(r1.uiStepCount).toBe(3);    // 2 in root (USER_INTERACTION + YES_NO) + 1 in child
    expect(r1.envCount).toBe(1);

    const [wf] = await db.select().from(workflow).where(eq(workflow.oid, 'wf-1'));
    expect(wf.version).toBe('2.0.0');
    expect(wf.workCenterId).toBe(wc.id);

    // A second identical load is a no-op: no new rows anywhere, same workflowId reported.
    const r2 = await ingestWorkflowPackage(db, buf, { workCenterId: wc.id });
    expect(r2.status).toBe('already_present');
    expect(r2.workflowId).toBe(r1.workflowId);
    expect(await db.select().from(workflowNode).where(eq(workflowNode.workflowId, wf.id))).toHaveLength(2);
    expect(await db.select().from(workflowUiStep).where(eq(workflowUiStep.workflowId, wf.id))).toHaveLength(3);
    expect(await db.select().from(workflowEnvironment).where(eq(workflowEnvironment.workflowId, wf.id))).toHaveLength(1);
  } finally { await close(); }
});

test('a malformed child (missing oid) rolls back the whole insert, leaving no partial entry', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const brokenRootSpec = {
      ...rootSpec, oid: 'wf-broken',
      children: [
        { local_id: 'Broken', oid: undefined, parentChildSpecId: null, version: '1.0.0', state: 'Effective', steps: [], connections: [] },
      ],
    };
    const buf = buildWfmasterx(brokenRootSpec);
    await expect(ingestWorkflowPackage(db, buf, { workCenterId: wc.id })).rejects.toThrow();

    // The whole transaction — workflow row included — must have rolled back.
    expect(await db.select().from(workflow).where(eq(workflow.oid, 'wf-broken'))).toHaveLength(0);
  } finally { await close(); }
});

// Regression guard for the import 400-vs-500 fix: the ingest layer must throw a typed
// DaoError('INVALID_PACKAGE') on malformed input (route maps it to 400) — distinct from a
// DB fault, which propagates as a plain error (route 500s). Route tests mock ingest, so this
// is the only coverage that the real function upholds its half of that contract.
test('malformed input throws INVALID_PACKAGE (non-zip buffer, and a zip with no root .WFmaster)', async () => {
  const { db, close } = await makeTestDb();
  try {
    // meta.workCenterId is required by the type but never read here: both failures throw
    // while parsing the zip/JSON, before the transaction (and meta) is ever touched.
    const unusedMeta = { workCenterId: 'unused-parse-fails-first' };
    // Not a zip at all → adm-zip parse failure → INVALID_PACKAGE (catch-all branch).
    await expect(ingestWorkflowPackage(db, Buffer.from('not a package'), unusedMeta)).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    // A valid zip lacking the root .WFmaster JSON → explicit INVALID_PACKAGE.
    const zip = new AdmZip();
    zip.addFile('readme.txt', Buffer.from('no root here'));
    await expect(ingestWorkflowPackage(db, zip.toBuffer(), unusedMeta)).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
  } finally {
    await close();
  }
});

// Regression guard: with libraries gone, nothing else on the load path validates the artifact
// name (resolveLibraryByName used to do it indirectly). An over-long name must fail as a typed
// DaoError, not escape the error mapper as a raw SQLSTATE 54000 and 500 the route.
test('an over-long workflow name fails as a DaoError, not a raw Postgres error', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const buf = buildWfmasterx({ oid: 'wf-1', local_id: 'x'.repeat(MAX_NAME_LENGTH + 1), version: '1.0.0', state: 'Draft' });
    await expect(ingestWorkflowPackage(db, buf, { workCenterId: wc.id })).rejects.toMatchObject({ code: 'NAME_TOO_LONG' });
    expect(await db.select().from(workflow).where(eq(workflow.oid, 'wf-1'))).toHaveLength(0);
  } finally { await close(); }
});

test('a first ingest with no state defaults to Draft', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const stateless = { ...rootSpec };
    delete (stateless as { state?: string }).state;
    const r = await ingestWorkflowPackage(db, buildWfmasterx(stateless), { workCenterId: wc.id });
    expect(r.state).toBe('Draft');
    const [row] = await db.select().from(workflow).where(eq(workflow.oid, 'wf-1'));
    expect(row.state).toBe('Draft');
  } finally { await close(); }
});

// ── package images → workflow_image rows ──
// Designer's .WFmasterX carries image bytes as images/ ZIP entries; form_document image
// blocks reference them by BARE filename (src). These pin the ingest-side extraction.

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]);

function imageDoc(src: string, imageOid?: string) {
  return { sections: [{ rows: [{ blocks: [{ type: 'image', src, ...(imageOid ? { imageOid } : {}) }] }] }] };
}

test('a form-element image ({imageOid}-{filename} entry) lands in workflow_image keyed by bare filename', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = {
      oid: 'wf-img', local_id: 'Img', version: '1.0.0', state: 'Draft',
      steps: [{ local_id: 'S', oid: 's1', step_type: 'USER_INTERACTION', form_document: imageDoc('photo.png', 'IMG1') }],
      connections: [],
    };
    const r = await ingestWorkflowPackage(db,
      buildWfmasterx(spec, [], [{ path: 'IMG1-photo.png', bytes: PNG_BYTES }]), { workCenterId: wc.id });

    const rows = await db.select().from(workflowImage).where(eq(workflowImage.workflowId, r.workflowId));
    expect(rows).toHaveLength(1);
    expect(rows[0].filename).toBe('photo.png');
    expect(rows[0].mimeType).toBe('image/png');
    expect(rows[0].dataBase64).toBe(PNG_BYTES.toString('base64'));
  } finally { await close(); }
});

test('a bare-filename entry (UI parameter image) and a child-step form image both resolve', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = {
      oid: 'wf-img2', local_id: 'Img2', version: '1.0.0', state: 'Draft',
      steps: [{
        local_id: 'S', oid: 's1', step_type: 'USER_INTERACTION',
        ui_parameter_specifications: [{ type: 'Image', value: 'logo.jpg' }],
      }],
      connections: [],
      children: [
        { local_id: 'Sub', oid: 'wf-img2-c1', parentChildSpecId: null, version: '1.0.0', state: 'Draft',
          // no imageOid on the block — the export prefixes with the STEP oid, so only the
          // suffix match can resolve this one
          steps: [{ local_id: 'P', oid: 's2', step_type: 'USER_INTERACTION', form_document: imageDoc('sub.png') }],
          connections: [] },
      ],
    };
    const r = await ingestWorkflowPackage(db,
      buildWfmasterx(spec, [], [
        { path: 'logo.jpg', bytes: JPG_BYTES },
        { path: 's2-sub.png', bytes: PNG_BYTES },
      ]), { workCenterId: wc.id });

    const rows = await db.select().from(workflowImage).where(eq(workflowImage.workflowId, r.workflowId));
    expect(rows.map((x) => x.filename).sort()).toEqual(['logo.jpg', 'sub.png']);
    expect(rows.find((x) => x.filename === 'logo.jpg')!.mimeType).toBe('image/jpeg');
  } finally { await close(); }
});

test('re-loading an already-present package backfills (and refreshes) its images', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = {
      oid: 'wf-img3', local_id: 'Img3', version: '1.0.0', state: 'Draft',
      steps: [{ local_id: 'S', oid: 's1', step_type: 'USER_INTERACTION', form_document: imageDoc('photo.png', 'IMG1') }],
      connections: [],
    };
    // First load: a package built BEFORE ingest extracted images (or with the bytes missing).
    const first = await ingestWorkflowPackage(db, buildWfmasterx(spec), { workCenterId: wc.id });
    expect(await db.select().from(workflowImage)).toHaveLength(0);

    // Re-loading the same (oid, version, state) is a spec no-op — but the images still land.
    const second = await ingestWorkflowPackage(db,
      buildWfmasterx(spec, [], [{ path: 'IMG1-photo.png', bytes: PNG_BYTES }]), { workCenterId: wc.id });
    expect(second.status).toBe('already_present');
    const rows = await db.select().from(workflowImage).where(eq(workflowImage.workflowId, first.workflowId));
    expect(rows).toHaveLength(1);

    // And a THIRD load with different bytes refreshes them — last load wins.
    await ingestWorkflowPackage(db,
      buildWfmasterx(spec, [], [{ path: 'IMG1-photo.png', bytes: JPG_BYTES }]), { workCenterId: wc.id });
    const [refreshed] = await db.select().from(workflowImage).where(eq(workflowImage.workflowId, first.workflowId));
    expect(refreshed.dataBase64).toBe(JPG_BYTES.toString('base64'));
  } finally { await close(); }
});

test('http/https/data/sentinel srcs and unreferenced zip images produce no rows', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = {
      oid: 'wf-img4', local_id: 'Img4', version: '1.0.0', state: 'Draft',
      steps: [{
        local_id: 'S', oid: 's1', step_type: 'USER_INTERACTION',
        form_document: { sections: [{ rows: [{ blocks: [
          { type: 'image', src: 'https://example.com/x.png' },
          { type: 'image', src: 'data:image/png;base64,AAAA' },
          { type: 'image', src: 'No image selected' },
        ] }] }] },
      }],
      connections: [],
    };
    const r = await ingestWorkflowPackage(db,
      buildWfmasterx(spec, [], [{ path: 'stray-orphan.png', bytes: PNG_BYTES }]), { workCenterId: wc.id });
    expect(await db.select().from(workflowImage).where(eq(workflowImage.workflowId, r.workflowId))).toHaveLength(0);
  } finally { await close(); }
});

// Envelope 5.0 is tolerated deliberately, not accidentally — schema_version is ungated text.
test('a schemaVersion 5.0 package ingests and stores its envelope version', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    await ingestWorkflowPackage(db, buildWfmasterx({ ...rootSpec, schemaVersion: '5.0' }), { workCenterId: wc.id });
    const [row] = await db.select().from(workflow).where(eq(workflow.oid, 'wf-1'));
    expect(row.schemaVersion).toBe('5.0');
  } finally { await close(); }
});

test('a workflow package materializes its embedded environment resources', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const out = await ingestWorkflowPackage(db, buildWfmasterx({
      oid: 'wf-1', local_id: 'Fill', version: '1.0.0', state: 'Effective',
      steps: [], connections: [],
      environment_specifications: [{
        oid: 'env-1', local_id: 'DemoLine', version: '1.0.0', state: 'Effective',
        resource_property_specifications: [{ name: 'Printer', resource_type: 'binary exclusive use' }],
      }],
    }), { workCenterId: wc.id });
    expect(out.status).toBe('loaded');
    expect(Array.isArray(out.warnings)).toBe(true);
    const [row] = await db.select().from(wcResource);
    expect(row.name).toBe('Printer');
    expect(row.workCenterId).toBe(wc.id);
  } finally { await close(); }
});

// E-signature roles (form_document `roleName`) are created by name on load and linked to the
// entry, so the role exists before the first signature and the Roles tab lists it.
test('load creates the e-signature roles a package names, links them, and re-links on an already_present re-load', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    await db.insert(role).values({ name: 'Line Lead', description: 'pre-existing' });
    const esigDoc = (roleName: string) => ({
      version: 2, sections: [{ id: 's', rows: [{ id: 'r', blocks: [{ id: 'b', type: 'esignature', fieldName: 'sig', roleName }] }] }],
    });
    const spec = {
      local_id: 'Approve', oid: 'wf-esig', version: '1.0.0', state: 'Effective',
      steps: [
        { local_id: 'Start', oid: 's0', step_type: 'START' },
        { local_id: 'Sign', oid: 's1', step_type: 'USER_INTERACTION', form_document: esigDoc(' Time Sheet Approver ') },
      ],
      children: [{ local_id: 'Sub', oid: 'wf-esig-c1', parentChildSpecId: null, version: '1.0.0', state: 'Effective',
        steps: [{ local_id: 'Decide', oid: 's2', step_type: 'YES_NO', form_document: esigDoc('Line Lead') }], connections: [] }],
      connections: [],
    };

    const first = await ingestWorkflowPackage(db, buildWfmasterx(spec), { workCenterId: wc.id });
    expect(first.status).toBe('loaded');
    expect(first.rolesCreated).toEqual(['Time Sheet Approver']);   // Line Lead already existed
    expect(first.warnings).toEqual([]);
    const roles = await db.select().from(role).orderBy(role.name);
    expect(roles.map((r) => r.name)).toEqual(['Line Lead', 'Time Sheet Approver']);
    const links = await db.select().from(workflowSignatureRole).where(eq(workflowSignatureRole.workflowId, first.workflowId));
    expect(links.map((l) => l.roleId).sort()).toEqual(roles.map((r) => r.id).sort());

    // The already_present fast path still links (backfill by re-load) and creates nothing.
    const second = await ingestWorkflowPackage(db, buildWfmasterx(spec), { workCenterId: wc.id });
    expect(second.status).toBe('already_present');
    expect(second.rolesCreated).toEqual([]);
    expect(await db.select().from(workflowSignatureRole)).toHaveLength(2);
    expect(await db.select().from(role)).toHaveLength(2);
  } finally { await close(); }
});
