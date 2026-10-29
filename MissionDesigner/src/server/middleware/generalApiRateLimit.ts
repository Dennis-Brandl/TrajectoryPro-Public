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
import { clientIpKey } from '../lib/clientIp'
import { RATE_LIMIT_READS_PER_MIN } from '../limits'

/**
 * Key requests on the signed-in user when there is one, else on the client IP
 * as clientIpMiddleware resolved it (proxy headers count only from TRUSTED_PROXIES).
 */
function userThenIpKey(c: Context): string {
  const user = c.get('user') as { id?: string } | undefined
  if (user?.id) return `user:${user.id}`
  return clientIpKey(c)
}

/**
 * Backstop rate limit for the LEGACY `/api/*` routes (health, setup-status,
 * has-admin, backup, legacy admin). It deliberately does NOT count:
 *  - `/api/auth/*` — owned by mountAuthRateLimit (only sign-in/sign-up POSTs
 *    are throttled; sign-out and get-session polling must never be).
 *  - `/api/v2/*`  — owned by rateLimitV2, which keys per user and keeps
 *    separate read / mutation budgets (limits.ts). Counting v2 traffic here
 *    as well used to put a flat 100/min cap on top of the 600/min read budget,
 *    and opening one workflow with 8 libraries was enough to trip it.
 *
 * The ceiling is RATE_LIMIT_READS_PER_MIN so the two limiters can never
 * disagree about what a busy-but-legitimate minute looks like.
 *
 * `keyFn` is injectable for tests (the limiter's store is module-global).
 */
export function mountGeneralApiRateLimit(app: Hono, keyFn: (c: Context) => string = userThenIpKey): void {
  const limiter = rateLimit({ windowMs: 60_000, maxRequests: RATE_LIMIT_READS_PER_MIN, keyFn })
  app.use('/api/*', async (c, next) => {
    const path = c.req.path
    if (path.startsWith('/api/auth/') || path.startsWith('/api/v2/')) return next()
    return limiter(c, next)
  })
}
