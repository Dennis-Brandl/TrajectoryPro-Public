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

import { timingSafeEqual } from 'node:crypto'
import type { Request, RequestHandler } from 'express'

/** Constant-time string comparison (length-guarded — timingSafeEqual throws on length mismatch). */
function keysMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// EventSource cannot send headers, so the event streams alone accept ?token=<key>.
const EVENT_STREAM_PATH = /^\/trajectory\/v1\/(instances|properties)\/[^/]+\/events$/

function extractKey(req: Request): string | undefined {
  const header = req.headers['x-api-key']
  if (typeof header === 'string') return header

  const authorization = req.headers['authorization']
  if (typeof authorization === 'string') {
    const m = /^bearer\s+(.+)$/i.exec(authorization.trim())
    if (m) return m[1]
  }

  if (req.method === 'GET') {
    const path = req.originalUrl.split('?')[0] ?? ''
    const token = req.query['token']
    if (EVENT_STREAM_PATH.test(path) && typeof token === 'string') return token
  }
  return undefined
}

/**
 * API key authentication. The key always comes from ACTIONS_API_KEY (the server
 * refuses to boot without it). Accepts X-API-Key, Authorization: Bearer, and —
 * for the two SSE event routes only — a ?token= query parameter.
 */
export function createApiKeyAuth(expectedKey: string): RequestHandler {
  return (req, res, next) => {
    const provided = extractKey(req)
    if (provided === undefined || !keysMatch(provided, expectedKey)) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid or missing API key', details: {} },
      })
      return
    }
    next()
  }
}
