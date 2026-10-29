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

// Phase 35 §2.2: per-user token bucket rate limiter.
// - RATE_LIMIT_MUTATING_PER_MIN mutating (POST/PUT/PATCH/DELETE) per minute
// - RATE_LIMIT_READS_PER_MIN reads (GET/HEAD, plus the read-shaped POSTs listed
//   in READ_SHAPED_POSTS) per minute
//
// Process-local memory; single-instance deployment (spec accepts this).

import type { MiddlewareHandler } from 'hono'
import { RATE_LIMIT_MUTATING_PER_MIN, RATE_LIMIT_READS_PER_MIN } from '../../limits'
import { v2ErrorBody } from '../../errors/v2'

interface Bucket {
  tokens: number
  windowStart: number // ms since epoch
}

const readBuckets = new Map<string, Bucket>()
const mutateBuckets = new Map<string, Bucket>()

const MINUTE_MS = 60_000

function takeToken(bucket: Map<string, Bucket>, userId: string, capacity: number, windowMs: number): boolean {
  const now = Date.now()
  let b = bucket.get(userId)
  if (!b || now - b.windowStart >= windowMs) {
    b = { tokens: capacity, windowStart: now }
    bucket.set(userId, b)
  }
  if (b.tokens <= 0) return false
  b.tokens--
  return true
}

/**
 * POST endpoints that only READ (the body is a query, not a change). They are
 * charged to the reads bucket: bulk-fetch in particular is issued once per
 * environment/action library every time a workflow opens, so with a few dozen
 * libraries it would otherwise exhaust the much smaller mutating budget.
 * Matched by suffix because v2Routes is mounted under /api/v2.
 */
const READ_SHAPED_POSTS = ['/specifications/bulk-fetch']

export function isReadRequest(method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true
  if (method === 'POST') return READ_SHAPED_POSTS.some((suffix) => path.endsWith(suffix))
  return false
}

function retryAfterSeconds(bucket: Bucket, windowMs: number): number {
  const remaining = Math.max(0, windowMs - (Date.now() - bucket.windowStart))
  return Math.ceil(remaining / 1000)
}

interface SessionLike {
  userId: string
}

export const rateLimitV2: MiddlewareHandler = async (c, next) => {
  const session = c.get('v2Session') as SessionLike | undefined
  if (!session) {
    return next()
  }
  const userId = session.userId

  if (!isReadRequest(c.req.method, c.req.path)) {
    if (!takeToken(mutateBuckets, userId, RATE_LIMIT_MUTATING_PER_MIN, MINUTE_MS)) {
      const b = mutateBuckets.get(userId)!
      c.header('Retry-After', String(retryAfterSeconds(b, MINUTE_MS)))
      return c.json(v2ErrorBody('rate_limited', { bucket: 'mutating-per-min' }), 429)
    }
  } else {
    if (!takeToken(readBuckets, userId, RATE_LIMIT_READS_PER_MIN, MINUTE_MS)) {
      const b = readBuckets.get(userId)!
      c.header('Retry-After', String(retryAfterSeconds(b, MINUTE_MS)))
      return c.json(v2ErrorBody('rate_limited', { bucket: 'reads-per-min' }), 429)
    }
  }

  await next()
}

/** Test helper — wipes all buckets. Do NOT call from production code. */
export function resetRateLimitBucketsForTests(): void {
  readBuckets.clear()
  mutateBuckets.clear()
}
