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

import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { makeTestDb } from './helpers/db.js';
import { createApp } from '../src/app.js';
import { EventHub } from '../src/events.js';

const TOKEN = 't'.repeat(40);
const ORIGIN = 'http://localhost:3004';
const AUTH = { authorization: `Bearer ${TOKEN}` };

async function build() {
  const { db, close } = await makeTestDb();
  const app = createApp({ db, hub: new EventHub(), now: () => new Date(), pingMs: 25, token: TOKEN, corsOrigins: [ORIGIN] });
  return { app, close };
}

test('GET /health needs no token', async () => {
  const { app, close } = await build();
  try { expect((await app.request('/health')).status).toBe(200); } finally { await close(); }
});

test('every other route without the token is 401 with the spec body', async () => {
  const { app, close } = await build();
  try {
    const id = randomUUID();
    const calls: Array<[string, string]> = [
      ['GET', '/trajectory/v1/capabilities'], ['GET', `/trajectory/v1/instances/${id}`],
      ['POST', '/trajectory/v1/actions/x/invoke'], ['POST', `/trajectory/v1/instances/${id}/command`],
      ['DELETE', `/trajectory/v1/instances/${id}`], ['GET', `/trajectory/v1/instances/${id}/events`],
    ];
    for (const [method, path] of calls) {
      const res = await app.request(path, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(await res.json()).toEqual({ error: 'missing or wrong broker token' });
    }
  } finally { await close(); }
});

test('a wrong token is 401; the right one passes', async () => {
  const { app, close } = await build();
  try {
    expect((await app.request('/trajectory/v1/capabilities', { headers: { authorization: `Bearer ${'w'.repeat(40)}` } })).status).toBe(401);
    expect((await app.request('/trajectory/v1/capabilities', { headers: AUTH })).status).toBe(200);
  } finally { await close(); }
});

test('?token= is accepted on the events route only', async () => {
  const { app, close } = await build();
  try {
    expect((await app.request(`/trajectory/v1/instances/${randomUUID()}/events?token=${TOKEN}`)).status).toBe(404);
    expect((await app.request(`/trajectory/v1/capabilities?token=${TOKEN}`)).status).toBe(401);
  } finally { await close(); }
});

test('preflight from the Tester needs no token and allows Authorization', async () => {
  const { app, close } = await build();
  try {
    const res = await app.request('/trajectory/v1/capabilities', { method: 'OPTIONS', headers: {
      origin: ORIGIN, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
  } finally { await close(); }
});

test('another origin gets no CORS header', async () => {
  const { app, close } = await build();
  try {
    const res = await app.request('/trajectory/v1/capabilities', { headers: { ...AUTH, origin: 'http://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  } finally { await close(); }
});

test('a 401 to the Tester still carries CORS so it can show the error', async () => {
  const { app, close } = await build();
  try {
    const res = await app.request('/trajectory/v1/capabilities', { headers: { origin: ORIGIN } });
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  } finally { await close(); }
});
