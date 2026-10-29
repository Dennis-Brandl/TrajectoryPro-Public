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
// better-auth's built-in rate limit keys on the client IP it reads from a request header.
// Without one it falls back to a single bucket shared by every user (sign-in: 3 per 10 s for
// everyone). These pin how the engine resolves that IP and hands it to better-auth.
import { expect, test } from 'vitest';
import { Hono } from 'hono';
import { makeTestDb } from './helpers/db.js';
import { createAuth } from '../src/api/auth.js';
import { CLIENT_IP_HEADER, clientIpMiddleware, parseTrustedProxies, resolveClientIp } from '../src/api/client-ip.js';

test('without trusted proxies the socket peer is the client and X-Forwarded-For is ignored', () => {
  expect(resolveClientIp('203.0.113.7', '198.51.100.1', null)).toBe('203.0.113.7');
  expect(resolveClientIp('203.0.113.7', undefined, null)).toBe('203.0.113.7');
});

test('an IPv4-mapped IPv6 peer is reported as plain IPv4', () => {
  expect(resolveClientIp('::ffff:203.0.113.7', undefined, null)).toBe('203.0.113.7');
});

test('no peer or an unparseable peer resolves to null', () => {
  expect(resolveClientIp(undefined, '198.51.100.1', null)).toBeNull();
  expect(resolveClientIp('not-an-ip', undefined, null)).toBeNull();
});

test('a peer that is not a trusted proxy is the client, even when proxies are configured', () => {
  const trusted = parseTrustedProxies('10.0.0.0/8');
  expect(resolveClientIp('203.0.113.7', '198.51.100.1', trusted)).toBe('203.0.113.7');
});

test('behind a trusted proxy the rightmost untrusted X-Forwarded-For hop is the client', () => {
  const trusted = parseTrustedProxies('10.0.0.0/8, 172.16.0.5');
  // A client-forged leftmost entry is skipped: only hops added by trusted proxies count.
  expect(resolveClientIp('10.1.2.3', '1.1.1.1, 198.51.100.9, 172.16.0.5', trusted)).toBe('198.51.100.9');
});

test('behind a trusted proxy with no usable hop the proxy itself is the key', () => {
  const trusted = parseTrustedProxies('10.0.0.0/8');
  expect(resolveClientIp('10.1.2.3', undefined, trusted)).toBe('10.1.2.3');
  expect(resolveClientIp('10.1.2.3', '10.9.9.9', trusted)).toBe('10.1.2.3');
  expect(resolveClientIp('10.1.2.3', 'garbage', trusted)).toBe('10.1.2.3');
});

test('IPv6 proxy ranges match', () => {
  const trusted = parseTrustedProxies('fd00::/8');
  expect(resolveClientIp('fd12::1', '2001:db8::5', trusted)).toBe('2001:db8::5');
});

test('TRUSTED_PROXIES: unset or blank means none; a bad entry is refused at startup', () => {
  expect(parseTrustedProxies(undefined)).toBeNull();
  expect(parseTrustedProxies(' , ')).toBeNull();
  expect(() => parseTrustedProxies('10.0.0.0/8, proxy.example.com')).toThrow(/TRUSTED_PROXIES.*proxy\.example\.com/);
  expect(() => parseTrustedProxies('10.0.0.0/33')).toThrow(/TRUSTED_PROXIES.*10\.0\.0\.0\/33/);
});

test('the middleware replaces a client-sent client-IP header instead of trusting it', async () => {
  const app = new Hono();
  app.use('*', clientIpMiddleware(null));
  app.get('/probe', (c) => c.text(c.req.raw.headers.get(CLIENT_IP_HEADER) ?? '(none)'));
  // app.request has no socket, so there is no peer: the forged value must be dropped.
  const res = await app.request('/probe', { headers: { [CLIENT_IP_HEADER]: '6.6.6.6' } });
  expect(await res.text()).toBe('(none)');
});

test('better-auth reads the client IP from the header the middleware sets', async () => {
  const { db, close } = await makeTestDb();
  const auth = createAuth(db, { baseURL: 'http://127.0.0.1:3006', secret: 'test-secret' });
  expect(auth.options.advanced?.ipAddress?.ipAddressHeaders).toEqual([CLIENT_IP_HEADER]);
  await close();
});
