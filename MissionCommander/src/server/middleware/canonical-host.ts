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
import type { MiddlewareHandler } from 'hono';

// The two spellings every other layer trusts: app.ts's CORS `origin` callback and
// lib/auth.ts's trustedOrigins(). Keep all three in step — a mismatch between them is
// exactly how the :3005 INVALID_ORIGIN bug got in.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

function loopbackHostOf(url: URL): string | null {
  return LOOPBACK_HOSTS.has(url.hostname) ? url.hostname : null;
}

function parse(url: string | undefined): URL | null {
  // BASE_URL is '/' under Vite/vitest (its default public base path) — the same trap
  // lib/auth.ts documents. Treat it, and anything unparseable, as unset.
  if (!url || url === '/') return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * The canonical-host URL to send a browser to, or null to leave it alone.
 *
 * `localhost` and `127.0.0.1` resolve to the same server but are DIFFERENT cookie hosts,
 * and cookies ignore the port. So signing in on one and returning on the other silently
 * presents no session cookie at all: every /api call 401s and the app looks wiped, with
 * the data sitting untouched in Postgres. Nothing in the CORS or trusted-origins layers
 * catches this — both spellings are trusted; the browser simply never sends the cookie.
 *
 * Deliberately narrow, so it can never strand anyone: it fires only when BOTH the visitor
 * and BASE_URL are loopback. A real deployment (remote BASE_URL) disables it entirely, and
 * a non-loopback visitor is never rewritten.
 */
export function canonicalHostRedirect(requestUrl: string, baseUrl: string | undefined): string | null {
  const base = parse(baseUrl);
  const req = parse(requestUrl);
  if (!base || !req) return null;

  const canonical = loopbackHostOf(base);
  if (!canonical || !loopbackHostOf(req)) return null;
  if (req.hostname === canonical) return null;

  // Swap ONLY the hostname. The request's scheme and port demonstrably reached us; a
  // BASE_URL port may be stale, and borrowing it could bounce the user to a dead port.
  // The hostname is the whole of the cookie-jar problem anyway.
  const target = new URL(req.toString());
  target.hostname = canonical;
  return target.toString();
}

/**
 * Redirects a document navigation that arrived on the wrong loopback hostname to the one
 * BASE_URL names, so a deployment has exactly one cookie jar.
 *
 * Scoped to top-level HTML navigations. `/api/*` is excluded on purpose: a redirected XHR
 * would arrive at the canonical host without the caller's cookies and 401 there, turning a
 * plain misconfiguration into a confusing auth failure. Assets are excluded because they
 * are same-document and carry no session meaning.
 */
export function canonicalHost(baseUrl: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    const isDocument = c.req.method === 'GET'
      && !c.req.path.startsWith('/api/')
      && (c.req.header('accept') ?? '').includes('text/html');
    if (isDocument) {
      const target = canonicalHostRedirect(c.req.url, baseUrl);
      if (target) return c.redirect(target, 302);
    }
    await next();
  };
}
