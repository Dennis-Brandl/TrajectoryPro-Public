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

import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export const BROKER_TOKEN_ERROR = 'missing or wrong broker token';

const EVENTS_PATH = /^\/trajectory\/v1\/instances\/[^/]+\/events$/;

const sha256 = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

/** sha256 both sides, then crypto.timingSafeEqual — constant time regardless of length. */
export function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) return false;
  return timingSafeEqual(sha256(presented), sha256(expected));
}

/** Skips GET /health and OPTIONS. Accepts `Authorization: Bearer <token>`; on
 *  GET /trajectory/v1/instances/:id/events ONLY also accepts `?token=`. Else 401 { error: BROKER_TOKEN_ERROR }. */
export function brokerAuth(token: string): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method;
    const path = c.req.path;
    if (method === 'OPTIONS' || (method === 'GET' && path === '/health')) return next();
    const header = c.req.header('authorization');
    let presented = header && /^Bearer /i.test(header) ? header.slice(7).trim() : undefined;
    if (presented === undefined && method === 'GET' && EVENTS_PATH.test(path)) presented = c.req.query('token');
    if (!tokenMatches(presented, token)) return c.json({ error: BROKER_TOKEN_ERROR }, 401);
    return next();
  };
}
