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

import type { Context, Next } from 'hono'
import { clientIpKey } from '../lib/clientIp'

interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Max requests per window
  keyFn?: (c: Context) => string // Extract rate limit key (default: IP)
  methods?: string[] // If set, only these HTTP methods are limited; others pass through uncounted.
}

// Store: key → { count, windowStart }
const store = new Map<string, { count: number; windowStart: number }>()

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now - entry.windowStart > 300000) store.delete(key)
  }
}, 300000)

export function rateLimit(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    // Only throttle the configured methods (e.g. credential-submitting POSTs).
    // Benign reads — notably the better-auth client's frequent GET get-session
    // polling — pass through uncounted so they can't exhaust a login limit.
    if (config.methods && !config.methods.includes(c.req.method)) {
      return next()
    }
    // Default key: the client IP clientIpMiddleware resolved (never a raw forwarded header).
    const key = config.keyFn ? config.keyFn(c) : clientIpKey(c)
    const now = Date.now()
    let entry = store.get(key)

    if (!entry || now - entry.windowStart > config.windowMs) {
      entry = { count: 0, windowStart: now }
      store.set(key, entry)
    }

    entry.count++

    if (entry.count > config.maxRequests) {
      // Same shape as the v2 limiter's 429: the client renders `${status} ${code}`,
      // so a code-less body surfaced as "429 unknown".
      const retryAfterMs = Math.max(0, config.windowMs - (now - entry.windowStart))
      c.header('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))))
      return c.json({ error: 'Too many requests', code: 'rate_limited' }, 429)
    }

    await next()
  }
}
