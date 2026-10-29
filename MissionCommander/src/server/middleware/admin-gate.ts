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
import { canonicalize } from './path';

// DEFAULT-CLOSED allowlist over the better-auth admin-plugin surface (spec §6.3). Only the
// endpoints this app actually calls may reach the handler; every other /api/auth/admin/*
// path — the conflicting writes (remove/set-role/update/create/ban/unban/set-password) AND
// any endpoint a future better-auth version adds — is 404'd, indistinguishable from an
// unmounted route. This replaces the earlier fail-OPEN blocklist: a newly exposed admin
// capability is now denied until explicitly listed here, not silently reachable.
// In-process auth.api.* calls (seed, our password route) never pass through Hono, so this
// gate cannot affect them — the same property signupGate relies on.
const ALLOWED_ADMIN_PATHS = new Set([
  '/api/auth/admin/list-user-sessions',
  '/api/auth/admin/revoke-user-session',
  '/api/auth/admin/revoke-user-sessions',
  '/api/auth/admin/impersonate-user',
  '/api/auth/admin/stop-impersonating',
]);

const ADMIN_PREFIX = '/api/auth/admin/';

// Pure policy decision, unit-tested exhaustively. canonicalize() first so trailing slashes,
// duplicate separators, and %-escapes (incl. %2F) resolve to the spelling better-auth would
// route, then default-closed under the admin prefix.
export function isBlockedAdminPath(rawPath: string): boolean {
  const path = canonicalize(rawPath);
  return path.startsWith(ADMIN_PREFIX) && !ALLOWED_ADMIN_PATHS.has(path);
}

export const adminGate: MiddlewareHandler = async (c, next) => {
  if (isBlockedAdminPath(c.req.path)) {
    return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  }
  await next();
};
