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
//
// User-testing fix (blank image boxes in the Pilot): GET /api/instances/:instanceId/images/:filename
// serves the workflow_image bytes the ingest extracted from the .WFmasterX's images/ entries.
// The Pilot's TaskScreen builds <img> URLs of exactly this shape from a task's instanceId
// and the form_document image block's bare-filename src.
import { expect, test } from 'vitest';
import {
  workCenter, workflow, workflowInstance, workflowImage,
} from 'mission-control-db/src/db/schema/index';
import { makeApi, type ApiHarness } from './helpers/api.js';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

/** Minimal workflow + instance + one stored image ('photo.png'). */
async function seedInstanceWithImage(db: ApiHarness['db'], workCenterId: string) {
  const oid = `wf-img-${Math.random()}`;
  const spec = { local_id: 'wf', oid, version: '1.0.0', steps: [], connections: [] };
  const [wf] = await db.insert(workflow).values({
    workCenterId, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const runtimeNumber = Math.floor(Math.random() * 1_000_000) + 1;
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId, triggeredBy: 'manual', status: 'running',
    specJsonb: spec, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  await db.insert(workflowImage).values({
    workflowId: wf.id, filename: 'photo.png', mimeType: 'image/png', dataBase64: PNG_BYTES.toString('base64'),
  });
  return { workflowId: wf.id, instanceId: wi.id };
}

test('unauthenticated image GET -> 401 (session gate covers it)', async () => {
  const { db, app, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const { instanceId } = await seedInstanceWithImage(db, wc.id);

  const res = await app.request(`/api/instances/${instanceId}/images/photo.png`);
  expect(res.status).toBe(401);
  await close();
});

test('a work-center member gets the bytes back with the stored content type and a private cache header', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-img@example.com', wc.id);
  const { instanceId } = await seedInstanceWithImage(db, wc.id);
  const cookie = await cookieFor('op-img@example.com');

  const res = await app.request(`/api/instances/${instanceId}/images/photo.png`, { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/png');
  expect(res.headers.get('cache-control')).toContain('private');
  expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG_BYTES);
  await close();
});

test('a non-member of the instance work center -> 403', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-outsider@example.com'); // no work_center_user row
  const { instanceId } = await seedInstanceWithImage(db, wc.id);
  const cookie = await cookieFor('op-outsider@example.com');

  const res = await app.request(`/api/instances/${instanceId}/images/photo.png`, { headers: { cookie } });
  expect(res.status).toBe(403);
  await close();
});

test('unknown instance and malformed instance id both -> 404 (no uuid-cast 500)', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-404@example.com', wc.id);
  const cookie = await cookieFor('op-404@example.com');

  const gone = await app.request('/api/instances/00000000-0000-4000-8000-000000000000/images/photo.png', { headers: { cookie } });
  expect(gone.status).toBe(404);
  const malformed = await app.request('/api/instances/not-a-uuid/images/photo.png', { headers: { cookie } });
  expect(malformed.status).toBe(404);
  await close();
});

test('a filename with no stored row -> 404; URL-encoded filenames decode before lookup', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-fname@example.com', wc.id);
  const { workflowId, instanceId } = await seedInstanceWithImage(db, wc.id);
  await db.insert(workflowImage).values({
    workflowId, filename: 'a b.png', mimeType: 'image/png', dataBase64: PNG_BYTES.toString('base64'),
  });
  const cookie = await cookieFor('op-fname@example.com');

  const missing = await app.request(`/api/instances/${instanceId}/images/nope.png`, { headers: { cookie } });
  expect(missing.status).toBe(404);
  const encoded = await app.request(`/api/instances/${instanceId}/images/a%20b.png`, { headers: { cookie } });
  expect(encoded.status).toBe(200);
  await close();
});
