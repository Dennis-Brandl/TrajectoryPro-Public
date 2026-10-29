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
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { brandAsset } from 'mission-control-db/src/db/schema/index';
import { mockSessionAs, seedUser, req } from '../test/harness';
import { migrateTestDb, resetDb } from '../test/fixture';
import { app } from '../app';
import { db } from '../lib/db';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const LOGO = `<svg ${NS} viewBox="0 0 100 40"><rect width="100" height="40" fill="#1d4ed8"/></svg>`;
const OTHER = `<svg ${NS} viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

type Uploaded = { id: string; mime: string; width: number; height: number };

function upload(bytes: Buffer | string, name = 'logo.svg') {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(typeof bytes === 'string' ? Buffer.from(bytes) : bytes)], name));
  return app.request('/api/brand-assets', { method: 'POST', body: form });
}
const message = async (res: Response) => ((await res.json()) as { error: { message: string } }).error.message;

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); });

async function asAdmin() {
  mockSessionAs(await seedUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' }));
}

describe('brand-asset routes (spec 2026-10-09 §8.3, §12)', () => {
  it('an administrator uploads an SVG → 201 with its id and size; it is then served without a session', async () => {
    await asAdmin();
    const res = await upload(LOGO);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Uploaded;
    expect(body).toEqual({ id: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), mime: 'image/svg+xml', width: 100, height: 40 });
    mockSessionAs(null);
    const got = await app.request(`/api/brand/${body.id}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/svg+xml');
    expect(got.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect(got.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(await got.text()).toContain('width="100"');
  });

  it('the same file twice gives the same id and one stored asset', async () => {
    await asAdmin();
    const a = (await (await upload(LOGO)).json()) as Uploaded;
    const b = (await (await upload(LOGO)).json()) as Uploaded;
    expect(b.id).toBe(a.id);
    expect(await db.select().from(brandAsset)).toHaveLength(1);
  });

  it('the type comes from the bytes: a PNG named logo.svg is stored as a PNG', async () => {
    await asAdmin();
    const res = await upload(PNG_1x1, 'logo.svg');
    expect(res.status).toBe(201);
    expect(((await res.json()) as Uploaded).mime).toBe('image/png');
  });

  it('a steward with settings:edit gets 403; no session gets 401', async () => {
    mockSessionAs(await seedUser(db, { email: 's@x.io', displayName: 'S', accessLevel: 'steward' }));
    const res = await upload(LOGO);
    expect(res.status).toBe(403);
    expect(await message(res)).toBe('Pilot branding requires an administrator');
    mockSessionAs(null);
    expect((await upload(LOGO)).status).toBe(401);
    expect(await db.select().from(brandAsset)).toHaveLength(0);
  });

  it('refusals: an SVG with a script, a non-image, no file → 422 with the reason; nothing stored', async () => {
    await asAdmin();
    const script = await upload(`<svg ${NS} viewBox="0 0 10 10"><script>alert(1)</script></svg>`);
    expect(script.status).toBe(422);
    expect(await message(script)).toBe('This SVG contains scripts or external references.');
    const text = await upload('hello', 'logo.png');
    expect(text.status).toBe(422);
    expect(await message(text)).toBe('A logo must be a PNG or SVG image.');
    const none = await app.request('/api/brand-assets', { method: 'POST', body: new FormData() });
    expect(none.status).toBe(422);
    expect(await message(none)).toBe('file is required');
    expect(await db.select().from(brandAsset)).toHaveLength(0);
  });

  it('a body well over 256 KB → 413 before it is read', async () => {
    await asAdmin();
    const res = await upload(Buffer.alloc(400 * 1024, 0x20), 'big.svg');
    expect(res.status).toBe(413);
    expect(await message(res)).toBe('A logo must be at most 256 KB.');
  });

  it('GET of an unknown or malformed id → 404', async () => {
    mockSessionAs(null);
    expect((await app.request(`/api/brand/sha256:${'0'.repeat(64)}`)).status).toBe(404);
    expect((await app.request('/api/brand/logo.png')).status).toBe(404);
  });

  it('replacing the site logo deletes the old asset (spec §8.1)', async () => {
    await asAdmin();
    const a = (await (await upload(LOGO)).json()) as Uploaded;
    const b = (await (await upload(OTHER)).json()) as Uploaded;
    const logo = (u: Uploaded) => ({ id: u.id, mime: u.mime, alt: 'Acme' });
    expect((await req(app, 'PUT', '/api/system-settings', { json: { pilotTheme: { schema: 1, logo: logo(a) } } })).status).toBe(200);
    expect((await req(app, 'PUT', '/api/system-settings', { json: { pilotTheme: { schema: 1, logo: logo(b) } } })).status).toBe(200);
    expect((await app.request(`/api/brand/${a.id}`)).status).toBe(404);
    expect((await app.request(`/api/brand/${b.id}`)).status).toBe(200);
  });
});
