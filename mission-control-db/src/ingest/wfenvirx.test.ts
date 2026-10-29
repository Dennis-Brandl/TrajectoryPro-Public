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
import { buildWfenvirx, buildWfmasterx } from '../seed/sample-bundle.js';
import { ingestEnvironmentPackage } from './wfenvirx.js';
import { ingestWorkflowPackage } from './wfmasterx.js';
import { environmentSpec, workflow, workCenter, wcResource, wcValueProperty } from '../db/schema/index.js';
import { MAX_NAME_LENGTH } from '../dao/names.js';
import AdmZip from 'adm-zip';

test('an environment package loads into the target work center', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const res = await ingestEnvironmentPackage(db, buildWfenvirx({
      oid: 'env-1', local_id: 'Line Env', version: '1.0.0', state: 'Draft', included_actions: [],
    }), { workCenterId: wc.id });
    expect(res.specs).toHaveLength(1);
    expect(res.specs[0].status).toBe('loaded');
    const [row] = await db.select().from(environmentSpec);
    expect(row.workCenterId).toBe(wc.id);
  } finally { await close(); }
});

test('re-loading the identical environment package is a no-op', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const buf = buildWfenvirx({ oid: 'env-1', local_id: 'Line Env', version: '1.0.0', state: 'Draft', included_actions: [] });
    await ingestEnvironmentPackage(db, buf, { workCenterId: wc.id });
    const again = await ingestEnvironmentPackage(db, buf, { workCenterId: wc.id });
    expect(again.specs[0].status).toBe('already_present');
    expect(await db.select().from(environmentSpec)).toHaveLength(1);
  } finally { await close(); }
});

test('a new state at the same version is a new independent entry', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    await ingestEnvironmentPackage(db,
      buildWfenvirx({ oid: 'env-1', local_id: 'E', version: '1.0.0', state: 'Draft', included_actions: [] }), { workCenterId: wc.id });
    await ingestEnvironmentPackage(db,
      buildWfenvirx({ oid: 'env-1', local_id: 'E', version: '1.0.0', state: 'Effective', included_actions: [] }), { workCenterId: wc.id });
    expect(await db.select().from(environmentSpec)).toHaveLength(2);
  } finally { await close(); }
});

// Coverage debt: state-varying and work-center-varying independence are both tested through
// ingest (above / below), but version-varying was not tested at all for environment_spec —
// neither via direct insert nor through ingestEnvironmentPackage.
test('a changed version at the same state is a new independent entry, loaded through ingest', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const v1 = await ingestEnvironmentPackage(db,
      buildWfenvirx({ oid: 'env-1', local_id: 'E', version: '1.0.0', state: 'Draft', included_actions: [] }), { workCenterId: wc.id });
    const v2 = await ingestEnvironmentPackage(db,
      buildWfenvirx({ oid: 'env-1', local_id: 'E', version: '2.0.0', state: 'Draft', included_actions: [] }), { workCenterId: wc.id });
    expect(v1.specs[0].status).toBe('loaded');
    expect(v2.specs[0].status).toBe('loaded');
    expect(v2.specs[0].id).not.toBe(v1.specs[0].id);

    const rows = await db.select().from(environmentSpec).where(eq(environmentSpec.oid, 'env-1'));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual([v1.specs[0].id, v2.specs[0].id].sort());
  } finally { await close(); }
});

test('the same package in two work centers yields two independent entries', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [a] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [b] = await db.insert(workCenter).values({ name: 'Line 2' }).returning();
    const buf = buildWfenvirx({ oid: 'env-1', local_id: 'Line Env', version: '1.0.0', state: 'Draft', included_actions: [] });
    const one = await ingestEnvironmentPackage(db, buf, { workCenterId: a.id });
    const two = await ingestEnvironmentPackage(db, buf, { workCenterId: b.id });
    expect(one.specs[0].id).not.toBe(two.specs[0].id);
    expect(one.specs[0].status).toBe('loaded');
    expect(two.specs[0].status).toBe('loaded');
  } finally { await close(); }
});

// Regression guard for the import 400-vs-500 fix (see wfmasterx.test.ts): malformed input
// must throw DaoError('INVALID_PACKAGE') so the route can 400 it, distinct from a DB fault (500).
test('malformed input throws INVALID_PACKAGE (non-zip buffer, and a zip with no inner .WFenvir)', async () => {
  const { db, close } = await makeTestDb();
  try {
    // meta.workCenterId is required by the type but never read here: both failures throw
    // while parsing the zip/JSON, before the transaction (and meta) is ever touched.
    const unusedMeta = { workCenterId: 'unused-parse-fails-first' };
    await expect(ingestEnvironmentPackage(db, Buffer.from('not a package'), unusedMeta)).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    const zip = new AdmZip();
    zip.addFile('readme.txt', Buffer.from('no inner env here'));
    await expect(ingestEnvironmentPackage(db, zip.toBuffer(), unusedMeta)).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
  } finally {
    await close();
  }
});

test('library-shape WFenvirX ingests each environment_specifications[] element into the target work center', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const lib = {
      local_id: 'KitchenLib', oid: 'envlib-2', version: '1.0.0',
      environment_specifications: [
        { local_id: 'Kitchen', oid: 'env-20', version: '1.0.0', state: 'Draft', included_actions: [] },
        { local_id: 'Pantry', oid: 'env-21', version: '1.0.0', state: 'Draft', included_actions: [] },
      ],
    };
    const r = await ingestEnvironmentPackage(db, buildWfenvirx(lib), { workCenterId: wc.id });
    expect(r.specs.map((s) => s.status)).toEqual(['loaded', 'loaded']);
    expect(r.specs.map((s) => s.name)).toEqual(['Kitchen', 'Pantry']);

    const rows = await db.select().from(environmentSpec);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.workCenterId).toBe(wc.id);
  } finally { await close(); }
});

// A package's specs are ingested in one transaction, so a mid-loop failure rolls the whole
// file back — the pull report's ok/failed verdict then matches what actually persisted.
test('library-shape WFenvirX rolls back ALL specs if one fails mid-loop (per-file transaction)', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const lib = {
      local_id: 'BadLib', oid: 'envlib-5', version: '1.0.0',
      environment_specifications: [
        { local_id: 'Good', oid: 'env-50', version: '1.0.0', included_actions: [] },
        { local_id: 'Bad', oid: undefined, version: '1.0.0', included_actions: [] }, // missing oid → NOT NULL violation mid-loop
      ],
    };
    await expect(ingestEnvironmentPackage(db, buildWfenvirx(lib), { workCenterId: wc.id })).rejects.toThrow();
    // The earlier 'Good' spec must have rolled back with the failed 'Bad' — nothing from this file persists.
    expect(await db.select().from(environmentSpec).where(eq(environmentSpec.oid, 'env-50'))).toHaveLength(0);
  } finally { await close(); }
});

test('env provenance (Designer library identity) is recorded as metadata but never routes the row', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = {
      local_id: 'Cross Workflow Sync', oid: 'env-44', version: '1.0.0', state: 'Draft',
      library_name: 'First Environment Library', library_oid: '68d51585', included_actions: [],
    };
    await ingestEnvironmentPackage(db, buildWfenvirx(spec), { workCenterId: wc.id });

    const [row] = await db.select().from(environmentSpec).where(eq(environmentSpec.oid, 'env-44'));
    expect(row.workCenterId).toBe(wc.id);
    expect(row.sourceLibraryName).toBe('First Environment Library');
    expect(row.sourceLibraryOid).toBe('68d51585');
  } finally { await close(); }
});

// Regression guard: with libraries gone, nothing else on the load path validates the artifact
// name (resolveLibraryByName used to do it indirectly). An over-long name must fail as a typed
// DaoError, not escape the error mapper as a raw SQLSTATE 54000 and 500 the route.
test('an over-long environment name fails as a DaoError, not a raw Postgres error', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const buf = buildWfenvirx({
      oid: 'env-1', local_id: 'x'.repeat(MAX_NAME_LENGTH + 1), version: '1.0.0', state: 'Draft', included_actions: [],
    });
    await expect(ingestEnvironmentPackage(db, buf, { workCenterId: wc.id })).rejects.toMatchObject({ code: 'NAME_TOO_LONG' });
    expect(await db.select().from(environmentSpec).where(eq(environmentSpec.oid, 'env-1'))).toHaveLength(0);
  } finally { await close(); }
});

test('an ingest with no state defaults to Draft', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const stateless = { local_id: 'Kitchen', oid: 'env-43', version: '1.0.0', included_actions: [] };
    const r = await ingestEnvironmentPackage(db, buildWfenvirx(stateless), { workCenterId: wc.id });
    expect(r.specs[0].state).toBe('Draft');
    const [row] = await db.select().from(environmentSpec).where(eq(environmentSpec.oid, 'env-43'));
    expect(row.state).toBe('Draft');
  } finally { await close(); }
});

test('loading an env package materializes its resources and value properties', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const buf = buildWfenvirx({
      oid: 'env-1', local_id: 'DemoLine', version: '1.0.0', state: 'Effective', included_actions: [],
      resource_property_specifications: [{ name: 'Printer', resource_type: 'binary exclusive use' }],
      value_property_specifications: [{ name: 'Recipe', entries: [{ name: 'Target', value: '80' }] }],
    });
    const out = await ingestEnvironmentPackage(db, buf, { workCenterId: wc.id });
    expect(out.warnings).toEqual([]);
    expect(await db.select().from(wcResource)).toHaveLength(1);
    expect(await db.select().from(wcValueProperty)).toHaveLength(1);
  } finally { await close(); }
});

test('re-loading an already-present env package still materializes (self-healing registry)', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const buf = buildWfenvirx({
      oid: 'env-1', local_id: 'DemoLine', version: '1.0.0', state: 'Effective', included_actions: [],
      resource_property_specifications: [{ name: 'Printer', resource_type: 'binary exclusive use' }],
    });
    await ingestEnvironmentPackage(db, buf, { workCenterId: wc.id });
    // Wipe the registry to simulate a row lost before materialization existed.
    await db.delete(wcResource);
    const out = await ingestEnvironmentPackage(db, buf, { workCenterId: wc.id });
    expect(out.specs[0].status).toBe('already_present');
    expect(await db.select().from(wcResource)).toHaveLength(1);
  } finally { await close(); }
});

test('a conflicting redeclaration across two env packages surfaces a warning', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    await ingestEnvironmentPackage(db, buildWfenvirx({
      oid: 'env-a', local_id: 'EnvA', version: '1.0.0', state: 'Draft', included_actions: [],
      resource_property_specifications: [{ name: 'Printer', resource_type: 'binary exclusive use' }],
    }), { workCenterId: wc.id });
    const out = await ingestEnvironmentPackage(db, buildWfenvirx({
      oid: 'env-b', local_id: 'EnvB', version: '1.0.0', state: 'Effective', included_actions: [],
      resource_property_specifications: [{ name: 'Printer', resource_type: 'named pool', names: ['P1'] }],
    }), { workCenterId: wc.id });
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain('Printer');
  } finally { await close(); }
});

test('re-loading a changed Draft environment package replaces it and lists the workflows that picked it up', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const mkEnv = (uri: string) => ({
      oid: 'env-1', local_id: 'Line Env', version: '1.0.0', state: 'Draft', included_actions: [],
      action_server_specifications: [{ name: 'AS', uri }],
    });
    await ingestWorkflowPackage(db, buildWfmasterx({
      oid: 'wf-1', local_id: 'Bottle Fill', version: '1.0.0', state: 'Draft', environment_specifications: [mkEnv('http://old')],
    }), { workCenterId: wc.id });
    const res = await ingestEnvironmentPackage(db, buildWfenvirx(mkEnv('http://new')), { workCenterId: wc.id });
    expect(res.specs[0].status).toBe('replaced');
    expect(res.updatedWorkflows).toEqual(['Bottle Fill']);
    const [wf] = await db.select().from(workflow);
    expect((wf.specJsonb as any).environment_specifications[0].action_server_specifications[0].uri).toBe('http://new');
    const again = await ingestEnvironmentPackage(db, buildWfenvirx(mkEnv('http://new')), { workCenterId: wc.id });
    expect(again.specs[0].status).toBe('already_present');
    expect(again.specs[0].message).toBe('No changes since the last load.');
    expect(again.updatedWorkflows).toEqual([]);
  } finally { await close(); }
});
