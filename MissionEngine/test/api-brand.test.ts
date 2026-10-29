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
// Spec 2026-10-09 §12 / R5: logos are served without a session (the login screen shows the
// site logo), immutable (ids are content hashes), nosniff, and an SVG sandboxed by CSP.
import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { storeBrandAsset } from 'mission-control-db/src/dao/brand-assets';
import { makeApi } from './helpers/api.js';

const idOf = (data: Buffer) => `sha256:${createHash('sha256').update(data).digest('hex')}`;

test('GET /api/brand/:id needs no session and serves an SVG immutable, nosniff and sandboxed', async () => {
  const { db, app, close } = await makeApi();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  await storeBrandAsset(db, { id: idOf(svg), mime: 'image/svg+xml', data: svg, width: 10, height: 10 });
  const res = await app.request(`/api/brand/${idOf(svg)}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/svg+xml');
  expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
  expect(Buffer.from(await res.arrayBuffer()).equals(svg)).toBe(true);
  await close();
});

test('a PNG is served with no CSP', async () => {
  const { db, app, close } = await makeApi();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await storeBrandAsset(db, { id: idOf(png), mime: 'image/png', data: png, width: 1, height: 1 });
  const res = await app.request(`/api/brand/${idOf(png)}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/png');
  expect(res.headers.get('content-security-policy')).toBeNull();
  await close();
});

test('an unknown or malformed id is 404, never 401', async () => {
  const { app, close } = await makeApi();
  expect((await app.request(`/api/brand/sha256:${'0'.repeat(64)}`)).status).toBe(404);
  expect((await app.request('/api/brand/logo.png')).status).toBe(404);
  await close();
});
