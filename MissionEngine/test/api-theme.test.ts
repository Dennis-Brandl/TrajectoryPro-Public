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

// Spec 2026-10-09 §13: GET /api/theme (public site theme, membership-gated work-center theme,
// ETag/304) and the live `theme` SSE event fed by the pilot_theme NOTIFY.
import { expect, test, vi } from 'vitest';
import { workCenter } from 'mission-control-db/src/db/schema/index';
import { writeSiteTheme, PILOT_THEME_CHANNEL } from 'mission-control-db/src/dao/pilot-theme-store';
import { writeWorkCenterTheme } from 'mission-control-db/src/dao/pilot-theme-chain';
import { LAYER_ORDER, checkContrast, type ResolvedTheme } from 'mission-control-db/src/dao/pilot-theme';
import { makeApi } from './helpers/api.js';
import { makeTestDb } from './helpers/db.js';
import { OperatorEventHub } from '../src/api/events.js';

interface Payload { rev: number; theme: { appTitle: string; font: string }; css: string; fontFamily: string | null; etag: string }

const ETAG_RE = (rev: number) => new RegExp(`^"${rev}-[0-9a-f]{16}"$`);

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('GET /api/theme needs no session and serves the shipped defaults at rev 0', async () => {
  const { app, close } = await makeApi();
  const res = await app.request('/api/theme');
  expect(res.status).toBe(200);
  expect(res.headers.get('etag')).toMatch(ETAG_RE(0));
  expect(res.headers.get('cache-control')).toBe('no-cache');
  const body = await res.json() as Payload;
  expect(body.etag).toBe(res.headers.get('etag'));
  expect(body.rev).toBe(0);
  expect(body.theme.appTitle).toBe('Mission Pilot');
  expect(body.fontFamily).toBe('Inter');
  expect(body.css.startsWith(LAYER_ORDER)).toBe(true);
  await close();
});

test('a site theme write bumps the rev and reaches the response', async () => {
  const { db, app, close } = await makeApi();
  await writeSiteTheme(db, { schema: 1, appTitle: 'Acme Pilot', colors: { light: { brand: '#7c3aed' } } });
  const res = await app.request('/api/theme');
  expect(res.headers.get('etag')).toMatch(ETAG_RE(1));
  const body = await res.json() as Payload;
  expect(body.rev).toBe(1);
  expect(body.theme.appTitle).toBe('Acme Pilot');
  expect(body.css).toContain('--pilot-brand: #7c3aed;');
  await close();
});

test('If-None-Match with the current ETag -> 304 and no body; an older one -> 200', async () => {
  const { db, app, close } = await makeApi();
  const before = (await app.request('/api/theme')).headers.get('etag')!;
  await writeSiteTheme(db, { schema: 1 });
  const etag = (await app.request('/api/theme')).headers.get('etag')!;
  const same = await app.request('/api/theme', { headers: { 'if-none-match': etag } });
  expect(same.status).toBe(304);
  expect(same.headers.get('etag')).toBe(etag);
  expect(await same.text()).toBe('');
  const stale = await app.request('/api/theme', { headers: { 'if-none-match': before } });
  expect(stale.status).toBe(200);
  await close();
});

test('the ETag covers the response, not just the rev: a bare-rev validator from an older payload format misses', async () => {
  const { app, close } = await makeApi();
  // A Pilot that cached a rev-0 payload before the payload changed shape (a deploy, not a
  // theme save) must get the new payload, not a 304 that pins the old CSS (final review).
  const res = await app.request('/api/theme', { headers: { 'if-none-match': '"0"' } });
  expect(res.status).toBe(200);
  await close();
});

test('?workCenterId: 401 without a session, 403 for a non-member or a malformed id, 200 for a member', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'Theme WC' }).returning();
  await seedOperator('op-theme@example.com', wc.id);
  await seedOperator('op-theme-outsider@example.com');
  const member = await cookieFor('op-theme@example.com');
  const outsider = await cookieFor('op-theme-outsider@example.com');

  expect((await app.request(`/api/theme?workCenterId=${wc.id}`)).status).toBe(401);
  expect((await app.request(`/api/theme?workCenterId=${wc.id}`, { headers: { cookie: outsider } })).status).toBe(403);
  expect((await app.request('/api/theme?workCenterId=not-a-uuid', { headers: { cookie: member } })).status).toBe(403);
  const ok = await app.request(`/api/theme?workCenterId=${wc.id}`, { headers: { cookie: member } });
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as Payload).rev).toBe(0);
  await close();
});

test('notifyTheme sends the rev to every session in every work center; a throwing sender is dropped', async () => {
  const { db, close } = await makeTestDb();
  const hub = new OperatorEventHub(db);
  const inbox = vi.fn();
  const a = vi.fn();
  const b = vi.fn();
  const bad = vi.fn(() => { throw new Error('closed'); });
  hub.register('a', { userId: 'u1', workCenterId: 'wc-1', send: inbox, sendTheme: a });
  hub.register('b', { userId: 'u2', workCenterId: 'wc-2', send: inbox, sendTheme: b });
  hub.register('bad', { userId: 'u3', workCenterId: 'wc-1', send: inbox, sendTheme: bad });
  hub.register('old', { userId: 'u4', workCenterId: 'wc-1', send: inbox });

  hub.notifyTheme(7);
  expect(a).toHaveBeenCalledWith(7);
  expect(b).toHaveBeenCalledWith(7);
  expect(bad).toHaveBeenCalledTimes(1);

  hub.notifyTheme(8);
  expect(a).toHaveBeenCalledTimes(2);
  expect(bad).toHaveBeenCalledTimes(1);
  expect(inbox).not.toHaveBeenCalled();
  await close();
});

test('GET /api/events relays a theme notification as `event: theme` with the rev', async () => {
  const { db: hubDb, close: closeHubDb } = await makeTestDb();
  const hub = new OperatorEventHub(hubDb);
  const { db, app, cookieFor, seedOperator, close } = await makeApi(hub);
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-theme-sse@example.com', wc.id);
  const cookie = await cookieFor('op-theme-sse@example.com');

  const res = await app.request(`/api/events?workCenterId=${wc.id}`, { headers: { cookie } });
  const reader = res.body!.getReader();
  await reader.read(); // the first inbox snapshot
  hub.notifyTheme(5);
  const { value } = await reader.read();
  const chunk = new TextDecoder().decode(value);
  expect(chunk).toContain('event: theme');
  expect(chunk).toContain('data: {"rev":5}');

  await reader.cancel();
  await close();
  await closeHubDb();
});

test('PIN: writeSiteTheme NOTIFYs pilot_theme with the new rev (real PGlite LISTEN)', async () => {
  const { db, client, close } = await makeTestDb();
  const received: string[] = [];
  await client.listen(PILOT_THEME_CHANNEL, (payload) => { received.push(payload); });
  await writeSiteTheme(db, { schema: 1 });
  await writeSiteTheme(db, { schema: 1, font: 'lato' });
  await waitFor(() => received.length >= 2);
  expect(received).toEqual(['1', '2']);
  await close();
});

test('?workCenterId resolves site → root → … → this work center, field by field (spec §8.2)', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [root] = await db.insert(workCenter).values({ name: 'Plant' }).returning();
  const [line] = await db.insert(workCenter).values({ name: 'Line 3', parentWorkCenterId: root!.id }).returning();
  const [cell] = await db.insert(workCenter).values({ name: 'Cell A', parentWorkCenterId: line!.id }).returning();
  await writeSiteTheme(db, { schema: 1, appTitle: 'Acme Pilot', font: 'lato' });
  await writeWorkCenterTheme(db, root!.id, { schema: 1, colors: { light: { brand: '#15803d' } } });
  await writeWorkCenterTheme(db, line!.id, { schema: 1, appTitle: 'Line 3 Pilot', wcAccent: '#f59e0b' });
  await seedOperator('op-chain@example.com', cell!.id);
  const cookie = await cookieFor('op-chain@example.com');

  const res = await app.request(`/api/theme?workCenterId=${cell!.id}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { rev: number; theme: ResolvedTheme; css: string };
  expect(body.rev).toBe(3);
  expect(body.theme.appTitle).toBe('Line 3 Pilot');
  expect(body.theme.font).toBe('lato');
  expect(body.theme.colors.light.brand).toBe('#15803d');
  expect(body.theme.wcAccent).toBe('#f59e0b');
  expect(body.css).toContain('--pilot-wc-accent: #f59e0b;');

  const site = (await (await app.request('/api/theme')).json()) as { theme: ResolvedTheme };
  expect(site.theme.appTitle).toBe('Acme Pilot'); // the bare request ignores work-center layers
  expect(site.theme.colors.light.brand).toBeNull();
  await close();
});

test('an override a later site change broke is served with readable colours (spec §11)', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'Branded' }).returning();
  await writeWorkCenterTheme(db, wc!.id, { schema: 1, appTitle: 'Branded Pilot', colors: { light: { accentFg: '#ffffff' } } });
  await writeSiteTheme(db, { schema: 1, colors: { light: { brand: '#d97706' } } });
  await seedOperator('op-broken@example.com', wc!.id);
  const cookie = await cookieFor('op-broken@example.com');
  const body = (await (await app.request(`/api/theme?workCenterId=${wc!.id}`, { headers: { cookie } })).json()) as { theme: ResolvedTheme };
  expect(body.theme.appTitle).toBe('Branded Pilot'); // the override is applied; only its broken pair falls back
  expect(body.theme.colors.light.accentFg).toBe('#0b1220');
  expect(checkContrast(body.theme).failures).toEqual([]);
  await close();
});

test('PIN: a work-center theme write NOTIFYs pilot_theme with the new rev', async () => {
  const { db, client, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'Notify WC' }).returning();
  const received: string[] = [];
  await client.listen(PILOT_THEME_CHANNEL, (payload) => { received.push(payload); });
  await writeWorkCenterTheme(db, wc!.id, { schema: 1, font: 'lato' });
  await waitFor(() => received.length >= 1);
  expect(received).toEqual(['1']);
  await close();
});
