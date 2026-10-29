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
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as loadChecks from 'mission-control-db/src/ingest/load-checks';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { migrateTestDb, resetDb } from '../test/fixture';
import { mockSessionAs, seedUser } from '../test/harness';
import { createWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { buildWfmasterx, buildWfenvirx } from 'mission-control-db/src/seed/sample-bundle';
import { workflow, environmentSpec, role, workflowSignatureRole } from 'mission-control-db/src/db/schema/index';
import { MAX_IMPORT_BYTES } from '../middleware/upload-limit';
import { app } from '../app';

// Real package buffers, not mocks: the whole point of this route is that it hands the right
// bytes to the right ingest, and a mocked ingest cannot show that the extension routing or
// the per-pair transaction isolation actually work.
vi.mock('mission-control-db/src/ingest/load-checks', async (orig) => {
  const real = await orig<typeof import('mission-control-db/src/ingest/load-checks')>();
  return { ...real, actionServerWarnings: vi.fn(real.actionServerWarnings) };
});

const wfPackage = (over: Record<string, unknown> = {}) =>
  buildWfmasterx({ oid: 'wf-1', local_id: 'Bottle Fill', version: '1.0.0', state: 'Draft', ...over });
const envPackage = (over: Record<string, unknown> = {}) =>
  buildWfenvirx({ oid: 'env-1', local_id: 'Line Env', version: '1.0.0', state: 'Draft', included_actions: [], ...over });

function form(parts: { files?: { buf: Buffer; name: string }[]; also?: string[] }): FormData {
  const fd = new FormData();
  for (const f of parts.files ?? []) fd.append('file', new Blob([new Uint8Array(f.buf)]), f.name);
  for (const a of parts.also ?? []) fd.append('alsoWorkCenterId', a);
  return fd;
}

const post = (wcId: string, fd: FormData) =>
  app.request(`/api/work-centers/${wcId}/load`, { method: 'POST', body: fd });

type Result = {
  filename: string; workCenterId: string; kind: string; status: string; message?: string;
  name?: string; version?: string; state?: string; rolesCarried?: number; rolesCreated?: string[];
  specs?: { name: string; status: string }[];
  warnings?: string[];
};
const results = async (res: Response) => ((await res.json()) as { results: Result[] }).results;

const MISSING = '00000000-0000-0000-0000-000000000000';

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); });

async function asSteward() {
  mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
}

describe('POST /api/work-centers/:id/load', () => {
  it('loads one package into the target work center', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();

    const res = await post(wc.id, form({ files: [{ buf: wfPackage(), name: 'bottle.WFmasterX' }] }));
    expect(res.status).toBe(200);

    const rows = await results(res);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      filename: 'bottle.WFmasterX', workCenterId: wc.id, kind: 'workflow', status: 'loaded',
      name: 'Bottle Fill', version: '1.0.0', state: 'Draft',
    });

    const [row] = await db.select().from(workflow);
    expect(row.workCenterId).toBe(wc.id);
  });

  it('fans out to the additional work centers, reporting one result per pair', async () => {
    const a = await createWorkCenter(db, { name: 'Line 1' });
    const b = await createWorkCenter(db, { name: 'Line 2' });
    const c = await createWorkCenter(db, { name: 'Line 3' });
    await asSteward();

    const res = await post(a.id, form({
      files: [{ buf: wfPackage(), name: 'bottle.WFmasterX' }],
      also: [b.id, c.id],
    }));
    expect(res.status).toBe(200);

    const rows = await results(res);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'loaded')).toBe(true);
    expect(rows.map((r) => r.workCenterId).sort()).toEqual([a.id, b.id, c.id].sort());

    // Three INDEPENDENT copies — same oid in three work centers is three entries (spec D3).
    const all = await db.select().from(workflow);
    expect(all).toHaveLength(3);
    expect(new Set(all.map((w) => w.workCenterId)).size).toBe(3);
  });

  it('de-duplicates a target that is also passed as alsoWorkCenterId', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();

    const res = await post(wc.id, form({
      files: [{ buf: wfPackage(), name: 'bottle.WFmasterX' }],
      also: [wc.id],
    }));

    // One pair, not two: a steward who also ticks the current work center in the dialog
    // must not get a spurious "already present" second row for it.
    expect(await results(res)).toHaveLength(1);
    expect(await db.select().from(workflow)).toHaveLength(1);
  });

  it('reports already_present per pair on a second identical load', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();
    const fd = () => form({ files: [{ buf: wfPackage(), name: 'bottle.WFmasterX' }] });

    expect((await results(await post(wc.id, fd())))[0].status).toBe('loaded');
    expect((await results(await post(wc.id, fd())))[0].status).toBe('already_present');
    expect(await db.select().from(workflow)).toHaveLength(1);
  });

  it('a Draft reload reports replaced and carries the warnings', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();
    const env = { oid: 'env-x', local_id: 'EnvX', included_actions: [{ oid: 'act-1' }], action_server_specifications: [] };
    const send = (extra: Record<string, unknown>) =>
      post(wc.id, form({ files: [{ buf: wfPackage({ environment_specifications: [env], ...extra }), name: 'bottle.WFmasterX' }] }));

    expect((await results(await send({})))[0].status).toBe('loaded');
    const [second] = await results(await send({ description: 'changed' }));
    expect(second.status).toBe('replaced');
    expect(second.warnings).toContain(
      `Environment "EnvX" has no action server bound in this work center. Set it under the work center's environment bindings before running.`);
  });

  it('a failing load check leaves the committed load as loaded, with a note', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(loadChecks.actionServerWarnings).mockRejectedValueOnce(new Error('boom'));
    const [r] = await results(await post(wc.id, form({ files: [{ buf: wfPackage(), name: 'bottle.WFmasterX' }] })));
    expect(r.status).toBe('loaded');
    expect(r.warnings).toContain('Load checks could not be run.');
    expect(await db.select().from(workflow)).toHaveLength(1);
  });

  it('rejects an unknown target work center with 400 before doing any work', async () => {
    await asSteward();
    // Spec §7.1. A well-formed uuid naming a deleted work center must NOT reach ingest —
    // it would trip the NOT NULL FK and surface as a 500 for a foreseeable user action.
    const res = await post(MISSING, form({ files: [{ buf: wfPackage(), name: 'bottle.WFmasterX' }] }));
    expect(res.status).toBe(400);
    expect(await db.select().from(workflow)).toHaveLength(0);
  });

  it('rejects an unknown id in alsoWorkCenterId the same way, loading nothing at all', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();

    const res = await post(wc.id, form({
      files: [{ buf: wfPackage(), name: 'bottle.WFmasterX' }],
      also: [MISSING],
    }));
    expect(res.status).toBe(400);
    // All-or-nothing on target validation: the valid pair must not be committed either,
    // or a steward would get a partial fan-out with no way to tell which half ran.
    expect(await db.select().from(workflow)).toHaveLength(0);
  });

  it('rejects a malformed alsoWorkCenterId with 400', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();
    const res = await post(wc.id, form({
      files: [{ buf: wfPackage(), name: 'bottle.WFmasterX' }],
      also: ['not-a-uuid'],
    }));
    expect(res.status).toBe(400);
    expect(await db.select().from(workflow)).toHaveLength(0);
  });

  it('400s a malformed :id before touching the body', async () => {
    await asSteward();
    const res = await app.request('/api/work-centers/not-a-uuid/load', {
      method: 'POST', body: form({ files: [{ buf: wfPackage(), name: 'b.WFmasterX' }] }),
    });
    expect(res.status).toBe(400);
  });

  it('400s when no file part is present', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();
    expect((await post(wc.id, new FormData())).status).toBe(400);
  });

  it('fails only its own pair on a corrupt package', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();

    const res = await post(wc.id, form({
      files: [
        { buf: wfPackage(), name: 'good.WFmasterX' },
        { buf: Buffer.from('not a zip at all'), name: 'bad.WFmasterX' },
      ],
    }));
    expect(res.status).toBe(200);

    const rows = await results(res);
    expect(rows).toHaveLength(2);
    const good = rows.find((r) => r.filename === 'good.WFmasterX')!;
    const bad = rows.find((r) => r.filename === 'bad.WFmasterX')!;
    expect(good.status).toBe('loaded');
    expect(bad.status).toBe('failed');
    expect(bad.message).toBeTruthy();

    // Each ingest owns its own transaction, so the good one is committed despite the
    // sibling failure — that is the whole point of reporting per pair (spec §6.2).
    expect(await db.select().from(workflow)).toHaveLength(1);
  });

  it('routes by extension: .WFmasterX to the workflow ingest, .WFenvirX to the environment ingest', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();

    const res = await post(wc.id, form({
      files: [
        { buf: wfPackage(), name: 'bottle.WFmasterX' },
        { buf: envPackage(), name: 'line.WFenvirX' },
      ],
    }));
    expect(res.status).toBe(200);

    const rows = await results(res);
    expect(rows.find((r) => r.filename === 'bottle.WFmasterX')!.kind).toBe('workflow');
    const env = rows.find((r) => r.filename === 'line.WFenvirX')!;
    expect(env.kind).toBe('environment');
    expect(env.status).toBe('loaded');
    expect(env.specs).toHaveLength(1);

    expect(await db.select().from(workflow)).toHaveLength(1);
    const specs = await db.select().from(environmentSpec).where(eq(environmentSpec.oid, 'env-1'));
    expect(specs).toHaveLength(1);
    expect(specs[0].workCenterId).toBe(wc.id);
  });

  it('is case-insensitive on the extension', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();
    const res = await post(wc.id, form({ files: [{ buf: envPackage(), name: 'line.wfenvirx' }] }));
    expect((await results(res))[0].kind).toBe('environment');
  });

  it('reports already_present for an environment package whose specs are all unchanged', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();
    const fd = () => form({ files: [{ buf: envPackage(), name: 'line.WFenvirX' }] });

    expect((await results(await post(wc.id, fd())))[0].status).toBe('loaded');
    expect((await results(await post(wc.id, fd())))[0].status).toBe('already_present');
    expect(await db.select().from(environmentSpec)).toHaveLength(1);
  });

  it('carries a resource-name collision warning from the environment ingest onto the result', async () => {
    // Not a stub: this file hands real package bytes to the real ingest on purpose (top-of-file
    // comment), so the route's warnings plumbing is proven with a genuine collision — two
    // environments in one work center declaring "Printer" differently — rather than a mocked
    // return value the route could pass through without the field ever meaning anything.
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();
    await post(wc.id, form({
      files: [{ buf: envPackage({
        oid: 'env-a', local_id: 'EnvA', state: 'Draft',
        resource_property_specifications: [{ name: 'Printer', resource_type: 'binary exclusive use' }],
      }), name: 'a.WFenvirX' }],
    }));

    const res = await post(wc.id, form({
      files: [{ buf: envPackage({
        oid: 'env-b', local_id: 'EnvB', state: 'Effective',
        resource_property_specifications: [{ name: 'Printer', resource_type: 'named pool', names: ['P1'] }],
      }), name: 'b.WFenvirX' }],
    }));
    expect(res.status).toBe(200);

    const rows = await results(res);
    expect(rows).toHaveLength(1);
    expect(rows[0].warnings).toHaveLength(1);
    expect(rows[0].warnings![0]).toContain('Printer');
  });

  it('requires a session', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    mockSessionAs(null);
    const res = await post(wc.id, form({ files: [{ buf: wfPackage(), name: 'bottle.WFmasterX' }] }));
    expect(res.status).toBe(401);
  });

  it('requires the create rights — a viewer is refused', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    const res = await post(wc.id, form({ files: [{ buf: wfPackage(), name: 'bottle.WFmasterX' }] }));
    expect(res.status).toBe(403);
    expect(await db.select().from(workflow)).toHaveLength(0);
  });

  it('413s a package over the size limit', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(MAX_IMPORT_BYTES + 1)]), 'huge.WFmasterX');
    const res = await post(wc.id, fd);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('too_large');
  });

  it('403s (not 413) when a viewer uploads an oversized package — the permission check runs first', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(MAX_IMPORT_BYTES + 1)]), 'huge.WFmasterX');
    expect((await post(wc.id, fd)).status).toBe(403);
  });

  it('records the loading user as downloadedBy', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    const uid = await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' });
    mockSessionAs(uid);

    await post(wc.id, form({ files: [{ buf: wfPackage(), name: 'bottle.WFmasterX' }] }));
    const [row] = await db.select().from(workflow);
    expect(row.downloadedBy).toBe(uid);
    expect(row.sourceFilename).toBe('bottle.WFmasterX');
  });

  // An e-signature block's roleName must exist as a role before the first signature (engine
  // fails with SIGNATURE_ROLE_UNKNOWN otherwise): the load creates it, links it to the
  // entry, and reports the created names so the results dialog can show them.
  it('creates the roles a package names in its e-signature blocks and reports them', async () => {
    const wc = await createWorkCenter(db, { name: 'Line 1' });
    await asSteward();
    const pkg = wfPackage({
      steps: [{
        local_id: 'Sign', oid: 's1', step_type: 'USER_INTERACTION',
        form_document: { version: 2, sections: [{ id: 's', rows: [{ id: 'r', blocks: [
          { id: 'b', type: 'esignature', fieldName: 'sig', roleName: 'Time Sheet Approver' },
        ] }] }] },
      }],
    });
    const res = await post(wc.id, form({ files: [{ buf: pkg, name: 'sign.WFmasterX' }] }));
    expect(res.status).toBe(200);
    const [row] = await results(res);
    expect(row).toMatchObject({ status: 'loaded', rolesCreated: ['Time Sheet Approver'] });

    const [created] = await db.select().from(role).where(eq(role.name, 'Time Sheet Approver'));
    expect(created).toBeTruthy();
    const [wf] = await db.select().from(workflow);
    expect(await db.select().from(workflowSignatureRole)).toEqual([{ workflowId: wf.id, roleId: created.id }]);

    // A re-load reports nothing created (already_present path still links, idempotently).
    const again = await results(await post(wc.id, form({ files: [{ buf: pkg, name: 'sign.WFmasterX' }] })));
    expect(again[0]).toMatchObject({ status: 'already_present', rolesCreated: [] });
    expect(await db.select().from(workflowSignatureRole)).toHaveLength(1);
  });
});
