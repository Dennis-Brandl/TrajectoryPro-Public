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
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { canonicalHost, canonicalHostRedirect } from './canonical-host';

const BASE = 'http://localhost:3005';

describe('canonicalHostRedirect', () => {
  it('swaps a loopback host mismatch, preserving path and query', () => {
    expect(canonicalHostRedirect('http://127.0.0.1:3005/libraries?tab=workflows', BASE))
      .toBe('http://localhost:3005/libraries?tab=workflows');
  });

  it('returns null when the browser is already on the canonical host', () => {
    expect(canonicalHostRedirect('http://localhost:3005/libraries', BASE)).toBeNull();
  });

  it('works in the other direction when BASE_URL names 127.0.0.1', () => {
    expect(canonicalHostRedirect('http://localhost:3005/', 'http://127.0.0.1:3005'))
      .toBe('http://127.0.0.1:3005/');
  });

  it('keeps the REQUEST scheme and port, swapping only the hostname', () => {
    // Only the hostname decides the cookie jar — cookies ignore the port entirely. And the
    // request's own scheme/port demonstrably reached us, whereas a BASE_URL port can be
    // stale or misconfigured; borrowing it could bounce the user to a dead port.
    expect(canonicalHostRedirect('http://127.0.0.1:8080/x', 'http://localhost:9999'))
      .toBe('http://localhost:8080/x');
  });

  it('never redirects when BASE_URL is a real deployment origin', () => {
    // A remote BASE_URL means this rule is off entirely: sending a loopback visitor (an
    // operator on the host, port-forwarded) to a public origin would be a surprise.
    expect(canonicalHostRedirect('http://127.0.0.1:3005/x', 'https://command.example.com')).toBeNull();
  });

  it('never redirects a non-loopback visitor', () => {
    // A LAN/proxied visitor's host is not ours to rewrite; the loopback cookie-jar split
    // is the only problem this solves.
    expect(canonicalHostRedirect('http://192.168.1.20:3005/x', BASE)).toBeNull();
    expect(canonicalHostRedirect('http://command.example.com/x', BASE)).toBeNull();
  });

  it('returns null when BASE_URL is unset or unparseable', () => {
    expect(canonicalHostRedirect('http://127.0.0.1:3005/x', undefined)).toBeNull();
    expect(canonicalHostRedirect('http://127.0.0.1:3005/x', '')).toBeNull();
    expect(canonicalHostRedirect('http://127.0.0.1:3005/x', 'not-a-url')).toBeNull();
    expect(canonicalHostRedirect('http://127.0.0.1:3005/x', '/')).toBeNull();
  });

  it('leaves ::1 alone — in step with the CORS and trustedOrigins layers', () => {
    // app.ts's CORS policy and lib/auth.ts's trustedOrigins both trust exactly `localhost`
    // and `127.0.0.1`. Adding a third spelling HERE would invent a fourth policy; the three
    // layers staying identical is what keeps this area debuggable.
    expect(canonicalHostRedirect('http://[::1]:3005/x', BASE)).toBeNull();
  });
});

function hostApp() {
  const app = new Hono();
  app.use('*', canonicalHost(BASE));
  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  app.get('*', (c) => c.html('<!doctype html><title>spa</title>'));
  return app;
}
const doc = { headers: { accept: 'text/html,application/xhtml+xml' } };

describe('canonicalHost middleware', () => {
  it('302s a document navigation arriving on the non-canonical loopback host', async () => {
    const res = await hostApp().request('http://127.0.0.1:3005/libraries', doc);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:3005/libraries');
  });

  it('passes a document navigation through on the canonical host', async () => {
    const res = await hostApp().request('http://localhost:3005/libraries', doc);
    expect(res.status).toBe(200);
  });

  it('never redirects /api/* — an XHR must fail honestly, not follow a host swap', async () => {
    // A redirected API call would arrive at the canonical host WITHOUT the caller's cookies
    // and 401 there, converting a clear misconfiguration into a confusing auth error.
    const res = await hostApp().request('http://127.0.0.1:3005/api/health', doc);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('never redirects a non-document GET (assets, fetch)', async () => {
    const res = await hostApp().request('http://127.0.0.1:3005/assets/app.js', {
      headers: { accept: '*/*' },
    });
    expect(res.status).toBe(200);
  });

  it('never redirects a non-GET request', async () => {
    const app = hostApp();
    app.post('*', (c) => c.json({ ok: true }));
    const res = await app.request('http://127.0.0.1:3005/anything', { method: 'POST', ...doc });
    expect(res.status).toBe(200);
  });

  it('is inert when BASE_URL is unset', async () => {
    const app = new Hono();
    app.use('*', canonicalHost(undefined));
    app.get('*', (c) => c.text('ok'));
    const res = await app.request('http://127.0.0.1:3005/libraries', doc);
    expect(res.status).toBe(200);
  });
});
