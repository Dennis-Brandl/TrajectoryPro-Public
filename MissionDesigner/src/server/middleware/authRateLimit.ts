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

import type { Context, Hono } from 'hono'
import { rateLimit } from './rate-limit'

/**
 * Max credential-submitting POSTs (sign-in + sign-up, counted together per IP)
 * per minute before a 429. Sized for a shared-IP deployment where one client
 * legitimately switches between several accounts, while still being a
 * meaningful brute-force guard.
 */
export const AUTH_RATE_LIMIT_MAX = 20

/**
 * Mount the auth rate limiter on ONLY the credential-submission endpoints —
 * `sign-in/*` and `sign-up/*` (the brute-force surface).
 *
 * Everything else under `/api/auth/*` is deliberately NOT throttled:
 *  - `sign-out` — rate-limiting logout returns 429, so the session is never
 *    cleared and the user cannot actually log out (they bounce back into the
 *    app). Logging out is never an attack surface.
 *  - `get-session` — the better-auth client polls it on every page load/focus,
 *    far past any sane credential limit.
 *
 * `keyFn` is injectable for tests (the limiter's store is module-global and
 * keyed by IP in production); production passes nothing → keyed on client IP.
 */
export function mountAuthRateLimit(app: Hono, keyFn?: (c: Context) => string): void {
  const limiter = rateLimit({ windowMs: 60_000, maxRequests: AUTH_RATE_LIMIT_MAX, methods: ['POST'], keyFn })
  app.use('/api/auth/sign-in/*', limiter)
  app.use('/api/auth/sign-up/*', limiter)
}
