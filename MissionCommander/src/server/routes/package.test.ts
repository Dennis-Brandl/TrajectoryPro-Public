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
import { describe, it, test, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import AdmZip from 'adm-zip';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { migrateTestDb, resetDb } from '../test/fixture';
import { mockSessionAs, seedUser } from '../test/harness';
import { createWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { buildWfcenterx } from 'mission-control-db/src/package/export';
import { workCenter } from 'mission-control-db/src/db/schema/index';
import { app } from '../app';
import { packageRoutes } from './package';
import type { Vars } from '../middleware/auth';

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); });

async function asViewer() {
  mockSessionAs(await seedUser(db, { email: 'v@x.io', displayName: 'V', accessLevel: 'viewer' }));
}

describe('GET /api/work-centers/:id/package', () => {
  it('returns a zip named after the work center', async () => {
    await asViewer();
    const wc = await createWorkCenter(db, { name: 'Bottle Line' });

    const res = await app.request(`/api/work-centers/${wc.id}/package`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/zip');
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''Bottle%20Line.WFcenterX");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(new AdmZip(buf).getEntries().some((e) => e.entryName === 'Bottle Line.WFcenter')).toBe(true);
  });

  // Work-center names are unrestricted text. A raw name in the header would emit something
  // malformed, and browsers would save the file under a mangled name.
  it('RFC 5987-encodes a non-ASCII work-center name', async () => {
    await asViewer();
    const wc = await createWorkCenter(db, { name: 'Línea "A"' });

    const res = await app.request(`/api/work-centers/${wc.id}/package`);

    const cd = res.headers.get('content-disposition')!;
    expect(cd).toContain("filename*=UTF-8''");
    expect(cd).not.toContain('"A"');           // the raw quote must not reach the header
    expect(res.status).toBe(200);
  });

  it('requires a session', async () => {
    const res = await app.request('/api/work-centers/00000000-0000-0000-0000-000000000000/package');
    expect(res.status).toBe(401);
  });

  it('404s an unknown work center', async () => {
    await asViewer();
    const res = await app.request('/api/work-centers/00000000-0000-0000-0000-000000000000/package');
    expect(res.status).toBe(404);
  });

  it('rejects an unknown scope', async () => {
    await asViewer();
    const wc = await createWorkCenter(db, { name: 'Line' });
    const res = await app.request(`/api/work-centers/${wc.id}/package?scope=nope`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/work-centers/:id/package/preview', () => {
  it('returns counts and warnings as JSON', async () => {
    await asViewer();
    const wc = await createWorkCenter(db, { name: 'Line' });

    const res = await app.request(`/api/work-centers/${wc.id}/package/preview`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      workCenters: 1, workflows: 0, environments: 0, roles: 0, grants: 0, warnings: [],
    });
  });
});

// The two tests above run against the assembled `app`, where work-centers.ts's own
// '/work-centers/*' requireSession mount (registered earlier in app.ts) already covers these
// same paths — so neither an anonymous-401 nor an authenticated-200 assertion against `app`
// can tell you whether packageRoutes' OWN requireSession mount is doing anything at all.
// Mounting packageRoutes alone, with nothing else supplying a principal, isolates it: this is
// the one assertion that actually fails if that mount is removed from package.ts (verified by
// hand — see the task-6 fix report).
describe('packageRoutes in isolation (no sibling router to fall back on)', () => {
  it('requireSession populates the principal that requirePermission then reads', async () => {
    await asViewer();
    const wc = await createWorkCenter(db, { name: 'Isolated' });
    const isolated = new Hono<{ Variables: Vars }>().route('/api', packageRoutes);

    const res = await isolated.request(`/api/work-centers/${wc.id}/package`);

    expect(res.status).toBe(200);
  });
});

async function packageBuffer(name: string) {
  const wc = await createWorkCenter(db, { name });
  const { buffer } = await buildWfcenterx(db, wc.id, {
    scope: 'all', exportedAt: new Date('2026-07-28T12:00:00.000Z'),
  });
  return buffer;
}

function importForm(buf: Buffer, parentWorkCenterId?: string) {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(buf)]), 'pkg.WFcenterX');
  if (parentWorkCenterId) fd.append('parentWorkCenterId', parentWorkCenterId);
  return fd;
}

async function asSteward() {
  mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
}

describe('POST /api/work-centers/import', () => {
  it('imports a package as a new root work center', async () => {
    await asSteward();
    const buf = await packageBuffer('Source Line');
    await resetDb();                       // import into a clean instance
    await asSteward();

    const res = await app.request('/api/work-centers/import', { method: 'POST', body: importForm(buf) });

    expect(res.status).toBe(200);
    const report = await res.json();
    expect(report.workCenters.created).toBe(1);
    expect(report.rootWorkCenterId).toBeTruthy();
  });

  it('rejects a non-package upload with 400', async () => {
    await asSteward();
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(Buffer.from('not a zip'))]), 'bad.WFcenterX');
    const res = await app.request('/api/work-centers/import', { method: 'POST', body: fd });
    expect(res.status).toBe(400);
  });

  it('409s when the root work-center name is already taken', async () => {
    await asSteward();
    const buf = await packageBuffer('Clash');
    // 'Clash' still exists, so importing it again collides at the root level.
    const res = await app.request('/api/work-centers/import', { method: 'POST', body: importForm(buf) });
    expect(res.status).toBe(409);
  });

  it('requires a session', async () => {
    mockSessionAs(null);
    const res = await app.request('/api/work-centers/import', { method: 'POST', body: new FormData() });
    expect(res.status).toBe(401);
  });

  // A viewer can read a package but must not be able to write one into the instance.
  it('403s a viewer', async () => {
    mockSessionAs(await seedUser(db, { email: 'v2@x.io', displayName: 'V', accessLevel: 'viewer' }));
    const res = await app.request('/api/work-centers/import', { method: 'POST', body: new FormData() });
    expect(res.status).toBe(403);
  });

  it('rejects a missing file part with 400', async () => {
    await asSteward();
    const res = await app.request('/api/work-centers/import', { method: 'POST', body: new FormData() });
    expect(res.status).toBe(400);
  });

  // A whitespace-only parentWorkCenterId (e.g. a form field left blank by the client but
  // still submitted) must be treated the same as "no parent" — a new root — not passed
  // through to the DAO as if it were a real id.
  it('imports as a new root when parentWorkCenterId is whitespace-only', async () => {
    await asSteward();
    const buf = await packageBuffer('Whitespace Parent');
    await resetDb();
    await asSteward();

    const res = await app.request('/api/work-centers/import', {
      method: 'POST', body: importForm(buf, '   '),
    });

    expect(res.status).toBe(200);
    const report = await res.json();
    expect(report.workCenters.created).toBe(1);
  });

  // A malformed parentWorkCenterId (not a UUID at all — a name, a truncated id, garbage)
  // must fail cleanly with 400, not reach the DAO's `eq(workCenter.id, parentId)` against a
  // Postgres uuid column, which throws a raw driver error that 500s.
  it('rejects a malformed parentWorkCenterId with 400', async () => {
    await asSteward();
    const buf = await packageBuffer('Malformed Parent');
    const res = await app.request('/api/work-centers/import', {
      method: 'POST', body: importForm(buf, 'not-an-id'),
    });
    expect(res.status).toBe(400);
  });

  // A well-formed but nonexistent parentWorkCenterId is a legitimate 404 (PARENT_NOT_FOUND),
  // proving the new shape validation does not swallow that existing path.
  it('404s a well-formed but nonexistent parentWorkCenterId', async () => {
    await asSteward();
    const buf = await packageBuffer('Real Parent Test');
    const res = await app.request('/api/work-centers/import', {
      method: 'POST', body: importForm(buf, '00000000-0000-0000-0000-000000000000'),
    });
    expect(res.status).toBe(404);
  });
});

// A package with one child under its root, so a merge produces a non-trivial report: the root
// always MATCHES the caller's target (merge resolves the root by id, not by name — see
// import.ts), and the child — which the target does not have — is CREATED. That asymmetry is
// what lets the tests below tell "the merge actually ran against real data" apart from a stub
// that always reports zeros.
async function packageBufferWithChild(rootName: string, childName: string) {
  const root = await createWorkCenter(db, { name: rootName });
  await createWorkCenter(db, { name: childName, parentWorkCenterId: root.id });
  const { buffer } = await buildWfcenterx(db, root.id, {
    scope: 'all', exportedAt: new Date('2026-07-28T12:00:00.000Z'),
  });
  return buffer;
}

function mergeForm(buf: Buffer, targetWorkCenterId: string, confirmed?: string) {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(buf)]), 'pkg.WFcenterX');
  fd.append('mode', 'merge');
  fd.append('targetWorkCenterId', targetWorkCenterId);
  if (confirmed !== undefined) fd.append('confirmed', confirmed);
  return fd;
}

describe('POST /api/work-centers/import — mode', () => {
  // §8.9: the existing renderer (packages.import) and the existing e2e suite both post
  // without a `mode` field at all. A route that starts requiring `mode` — e.g. reading it with
  // no `|| 'create'` fallback and then rejecting anything that isn't the literal string
  // "create" or "merge" — would 400 every request either of those callers makes. Asserting the
  // create-mode SHAPE (workCenters.matched === 0, the field only merge ever sets) rather than
  // just the status code also catches a route that defaults the omitted field into 'merge'.
  test('POST /work-centers/import defaults to create mode when no mode is sent', async () => {
    await asSteward();
    const buf = await packageBuffer('Default Mode Root');
    await resetDb();                       // import into a clean instance
    await asSteward();

    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(buf)]), 'pkg.WFcenterX');
    // Deliberately no 'mode' field — this is exactly what today's client sends.
    const res = await app.request('/api/work-centers/import', { method: 'POST', body: fd });

    expect(res.status).toBe(200);
    const report = await res.json();
    expect(report.workCenters.created).toBe(1);
    expect(report.workCenters.matched).toBe(0);
  });

  test('rejects an unrecognised mode value with 400', async () => {
    await asSteward();
    const buf = await packageBuffer('Bad Mode Root');
    await resetDb();                       // import into a clean instance — isolate the mode check
    await asSteward();
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(buf)]), 'pkg.WFcenterX');
    fd.append('mode', 'overwrite');
    const res = await app.request('/api/work-centers/import', { method: 'POST', body: fd });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/work-centers/import — merge mode', () => {
  // §8.9, the string-coercion trap: `Boolean('false')` is `true`. A route that coerces the raw
  // multipart field with `Boolean(field('confirmed'))` instead of `field('confirmed') ===
  // 'true'` would treat this request as confirmed and APPLY the merge the steward was still
  // previewing. Same rule and same reasoning as DELETE /work-centers/:id
  // (routes/work-centers.ts:105, "Strict equality, not truthiness").
  test('a merge with confirmed="false" previews and does not apply', async () => {
    await asSteward();
    const buf = await packageBufferWithChild('Merge Source', 'Merge Child');
    const target = await createWorkCenter(db, { name: 'Merge Target A' });

    const res = await app.request('/api/work-centers/import', {
      method: 'POST', body: mergeForm(buf, target.id, 'false'),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('conflict');
    expect(body.error.impact.workCenters.matched).toBe(1);
    expect(body.error.impact.workCenters.created).toBe(1);

    // The DAO ran the resolution for real and rolled it back (Task 5) — prove the route
    // did not somehow still apply it: the child the package would create must not exist.
    const children = await db.select().from(workCenter).where(eq(workCenter.parentWorkCenterId, target.id));
    expect(children).toHaveLength(0);
  });

  // A distinct implementation bug from the one above: a route that reads the field as
  // `field('confirmed') !== 'false'` (defaulting an ABSENT field to confirmed) rather than
  // `=== 'true'` would apply the merge on this request even though the caller never confirmed
  // anything — the omitted-field case, not the explicit-false case.
  test('an unconfirmed merge answers 409 with the impact summary', async () => {
    await asSteward();
    const buf = await packageBufferWithChild('Merge Source 2', 'Merge Child 2');
    const target = await createWorkCenter(db, { name: 'Merge Target B' });

    const res = await app.request('/api/work-centers/import', {
      method: 'POST', body: mergeForm(buf, target.id),   // confirmed omitted entirely
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('conflict');
    expect(body.error.impact.workCenters.matched).toBe(1);
    expect(body.error.impact.workCenters.created).toBe(1);

    const children = await db.select().from(workCenter).where(eq(workCenter.parentWorkCenterId, target.id));
    expect(children).toHaveLength(0);
  });

  // The positive case for both traps above: proves confirmed="true" is not just answered with
  // 200, but genuinely reaches the DAO as `confirmed: true` and is actually written — a route
  // that always passes `confirmed: false` to importWfcenterx (or that maps the local
  // `confirmed` flag to the response status but not to the DAO call) would still 200 here with
  // an identical report body, because Task 5's report describes the resolved work whether or
  // not it was rolled back. Only a real DB read can catch that.
  test('a confirmed merge answers 200 with the report', async () => {
    await asSteward();
    const buf = await packageBufferWithChild('Merge Source 3', 'Merge Child 3');
    const target = await createWorkCenter(db, { name: 'Merge Target C' });

    const res = await app.request('/api/work-centers/import', {
      method: 'POST', body: mergeForm(buf, target.id, 'true'),
    });

    expect(res.status).toBe(200);
    const report = await res.json();
    expect(report.workCenters.matched).toBe(1);
    expect(report.workCenters.created).toBe(1);
    expect(report.rootWorkCenterId).toBe(target.id);

    const children = await db.select().from(workCenter).where(eq(workCenter.parentWorkCenterId, target.id));
    expect(children).toHaveLength(1);
    expect(children[0]!.name).toBe('Merge Child 3');
  });

  // Defense in depth on the merge path specifically: a viewer holds none of
  // work_center:create / workflow:create / environment:create, so the route's outer
  // requirePermission chain already refuses before the body is even parsed.
  //
  // NOTE ON COVERAGE — this does NOT exercise the merge branch's own `work_center:edit` check.
  // As the brief documents, TIER_RIGHTS today is all-or-nothing per tier outside `access:*`:
  // every seedable principal that holds the three create rights (steward, administrator) also
  // holds work_center:edit, and no seedable principal holds the three create rights without
  // it. seedUser only accepts the three real AccessLevel values, and requireSession always
  // derives the principal from the DB via loadPrincipal — there is no seam in this harness to
  // inject a principal with create-but-not-edit rights into a real request through the
  // assembled route. That inner check is therefore untestable with today's rights model; it is
  // still correct to have written it (see the code comment at package.ts on the merge branch),
  // and the "confirmed merge" test above at least proves it does not spuriously reject a real
  // steward.
  test('a merge attempt by a viewer is refused with 403', async () => {
    mockSessionAs(await seedUser(db, { email: 'v3@x.io', displayName: 'V3', accessLevel: 'viewer' }));
    const target = await createWorkCenter(db, { name: 'Merge Target D' });
    const buf = await packageBuffer('Merge Source 4');

    const res = await app.request('/api/work-centers/import', {
      method: 'POST', body: mergeForm(buf, target.id, 'true'),
    });

    expect(res.status).toBe(403);
  });

  // Well-formed uuid, no such row. Root-level merge resolution assigns
  // `existingId = opts.targetWorkCenterId` unconditionally (import.ts) without itself checking
  // existence — the DAO only discovers the vanished target inside applyWorkCenterConfig. A
  // route that skipped its OWN pre-check and simply forwarded an unvalidated mode='merge'
  // request would still need to reach the DAO at all to get a 404; a route that silently fell
  // back to create-mode behaviour on an unrecognised branch would instead 200. Either wrong
  // implementation is caught by asserting 404 specifically.
  test('a merge naming a non-existent target answers 404', async () => {
    await asSteward();
    const buf = await packageBuffer('Merge Source 5');

    const res = await app.request('/api/work-centers/import', {
      method: 'POST',
      body: mergeForm(buf, '00000000-0000-0000-0000-000000000000', 'true'),
    });

    expect(res.status).toBe(404);
  });

  // Without the route's own isUuid check, 'not-a-uuid' would reach
  // `eq(workCenter.id, targetWorkCenterId)` against a Postgres uuid column, throw a raw driver
  // error, and fall through app.onError's non-DaoError branch to a generic 500 — exactly the
  // failure mode parentWorkCenterId already guards against on the create-mode branch.
  test('a merge with a malformed targetWorkCenterId answers 400, not 500', async () => {
    await asSteward();
    const buf = await packageBuffer('Merge Source 6');

    const res = await app.request('/api/work-centers/import', {
      method: 'POST', body: mergeForm(buf, 'not-a-uuid', 'true'),
    });

    expect(res.status).toBe(400);
  });
});
