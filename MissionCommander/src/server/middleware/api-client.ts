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
import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { db } from '../lib/db';
import { authenticateApiToken, type ApiClientPrincipal, type ApiClientScope } from 'mission-control-db/src/dao/api-clients';
import { parseTrustedProxies, resolveClientIp } from '../lib/client-ip';
import { httpError } from '../lib/errors';

// Authentication for the external scheduling interface (spec 2026-11-08 §8.1). Only
// `Authorization: Bearer mcx_...` counts. A session cookie or a query-string token never does,
// so a browser that is signed in cannot be steered into acting as an API client.

export type ApiClientVars = { apiClient: ApiClientPrincipal };

const FAIL_MAX = 10;
const FAIL_WINDOW_MS = 60_000;
export const MAX_TRACKED_IPS = 10_000;
const NO_IP = 'unknown';

// Read once at startup, like app.ts does for the sign-in routes. A bad entry throws here.
const trustedProxies = parseTrustedProxies(process.env.TRUSTED_PROXIES);

/**
 * The caller's IP, resolved here from the socket (and X-Forwarded-For only when the peer is a
 * trusted proxy). Nothing the client sends in a header of its own, including
 * x-mission-client-ip, is read, so no other middleware has to be mounted first.
 */
function callerIp(c: Context): string {
  let peer: string | undefined;
  try {
    peer = getConnInfo(c).remote.address;
  } catch {
    peer = undefined; // no socket (app.request without an env)
  }
  return resolveClientIp(peer, c.req.raw.headers.get('x-forwarded-for') ?? undefined, trustedProxies) ?? NO_IP;
}

// IP -> times of its recent failed token checks, oldest first. Only failures are recorded.
// Insertion order tracks recency of the latest failure, so the oldest keys are evicted first.
const failures = new Map<string, number[]>();

function recentFailures(ip: string, now: number): number[] {
  const list = failures.get(ip);
  if (!list) return [];
  const live = list.filter((t) => now - t < FAIL_WINDOW_MS);
  if (live.length === 0) failures.delete(ip);
  else if (live.length !== list.length) failures.set(ip, live);
  return live;
}

function recordFailure(ip: string, now: number): void {
  const live = recentFailures(ip, now);
  live.push(now);
  failures.delete(ip); // re-insert so Map order tracks recency
  failures.set(ip, live);
  for (const key of failures.keys()) {
    if (failures.size <= MAX_TRACKED_IPS) break;
    failures.delete(key);
  }
}

/** Test hooks. */
export function resetApiClientLimiter(): void {
  failures.clear();
}
export function apiClientLimiterSize(): number {
  return failures.size;
}

/**
 * A database error's own message can carry the query parameters, and for this feature one of
 * them is a token hash. Log only the driver-level cause, or a fixed text.
 */
export function safeErrorText(err: unknown): string {
  const cause = err instanceof Error ? err.cause : undefined;
  return cause instanceof Error ? cause.message : 'database error';
}

const unauthorized = (c: Context) => {
  c.header('WWW-Authenticate', 'Bearer');
  return httpError(c, 401, 'unauthorized', 'Invalid or expired API token');
};

/** The one 404 body of the external interface. */
export const notFound = (c: Context) => httpError(c, 404, 'not_found', 'Not found');

export const requireApiClient: MiddlewareHandler<{ Variables: ApiClientVars }> = async (c, next) => {
  const ip = callerIp(c);
  const now = Date.now();
  const recent = recentFailures(ip, now);
  if (recent.length >= FAIL_MAX) {
    const retryAfter = Math.max(1, Math.ceil((recent[recent.length - FAIL_MAX]! + FAIL_WINDOW_MS - now) / 1000));
    c.header('Retry-After', String(retryAfter));
    return httpError(c, 429, 'rate_limited', 'Too many failed attempts. Try again later.');
  }
  const header = c.req.header('authorization');
  // No credential offered is not a guess, so it does not count against the IP.
  if (header === undefined) return unauthorized(c);
  const match = /^bearer (\S+)$/i.exec(header);
  let principal: ApiClientPrincipal | null = null;
  if (match) {
    try {
      principal = await authenticateApiToken(db, match[1]!, new Date(now));
    } catch (err) {
      console.error('[api-client] token check failed:', safeErrorText(err));
      return httpError(c, 500, 'internal', 'Internal error');
    }
  }
  if (!principal) {
    recordFailure(ip, now);
    return unauthorized(c);
  }
  c.set('apiClient', principal);
  await next();
};

/**
 * Gate on a scope and, by default, on the `:wc` route parameter being in the client's work-center
 * list. The default is closed: a missing `wc` param is a 404 too, whatever the route is called or
 * wherever the guard is mounted. A work center outside the list answers 404 with the same body as
 * one that does not exist, so a client cannot probe which ones exist. The one route that has no
 * work center opts out explicitly with `{ workCenter: false }`.
 */
export function requireClientScope(
  scope: ApiClientScope,
  opts: { workCenter?: boolean } = {},
): MiddlewareHandler<{ Variables: ApiClientVars }> {
  const checkWorkCenter = opts.workCenter !== false;
  return async (c, next) => {
    const client = c.get('apiClient');
    if (!client) return unauthorized(c);
    if (!client.scopes.includes(scope)) return httpError(c, 403, 'forbidden', `Missing scope: ${scope}`);
    if (checkWorkCenter) {
      const wc = c.req.param('wc');
      if (!wc || !client.workCenterIds.includes(wc)) return notFound(c);
    }
    await next();
  };
}
