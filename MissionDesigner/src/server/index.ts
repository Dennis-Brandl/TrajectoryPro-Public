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

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { auth } from './lib/auth'
import { v2Routes } from './routes/v2'
import { backupRoutes } from './routes/backup'
import { adminRoutes } from './routes/admin'
import { hasAdminAccount } from './lib/seed'
import { shouldUseSecureCookies } from './lib/deploy-policy'
import { db, bootstrapDatabase, databaseSchemaStatus } from './lib/db'
import { getSetupStatus, isSetupComplete } from './lib/setupState'
import { sql } from 'drizzle-orm'
import fs from 'node:fs'
import { securityHeaders } from './middleware/security-headers'
import { clientIpMiddleware, parseTrustedProxies } from './lib/clientIp'
import { mountAuthRateLimit } from './middleware/authRateLimit'
import { mountGeneralApiRateLimit } from './middleware/generalApiRateLimit'
import { mountSignupGate } from './middleware/signupGate'
import { supersedeSweep } from './lifecycle/supersedeSweep'
import { runAuthPurge } from './lifecycle/authPurge'

const app = new Hono()

// Catch-all error handler: log the real error server-side (so failures like a
// missing table show up in container logs) and return a structured code instead
// of Hono's opaque default 500 — which the client otherwise surfaces as the
// useless "500 unknown".
app.onError((err, c) => {
  console.error(`[unhandled] ${c.req.method} ${c.req.path}:`, err)
  return c.json({ code: 'internal' }, 500)
})

// Phase 3 (design §8): periodic auto-supersede sweep. The lazy per-library
// sweeps on the two version-display GETs keep reads fresh; this timer catches
// idle databases. Guarded out of tests so vitest workers never leak timers.
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => supersedeSweep(Date.now()), 60_000).unref()
  // Expired session/verification rows are never read again; purge
  // 60 s after start, then daily.
  setTimeout(() => void runAuthPurge(), 60_000).unref()
  setInterval(() => void runAuthPurge(), 86_400_000).unref()
}

// Request logging
app.use('*', logger())

// Security headers applied first, before all other middleware
app.use('*', securityHeaders())

// CORS middleware — Accept requests from any localhost port (Vite may use different
// ports if 5173 is busy), or from an explicit allowlist via ALLOWED_ORIGINS env var.
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      if (!origin) return 'http://localhost:5173'

      // If an explicit allowlist is configured, honour it exclusively
      const allowedOrigins = process.env.ALLOWED_ORIGINS
      if (allowedOrigins) {
        const list = allowedOrigins.split(',').map((o) => o.trim())
        return list.includes(origin) ? origin : null
      }

      // Development fallback: allow any localhost origin
      if (origin.startsWith('http://localhost:')) return origin

      return 'http://localhost:5173'
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['POST', 'GET', 'PATCH', 'DELETE', 'OPTIONS', 'PUT'],
  }),
)

// Client IP for every limiter below and for better-auth's own (clientIp.ts). Mounted
// before them all, and unconditionally, so a client-sent copy of the header is always
// replaced.
app.use('/api/*', clientIpMiddleware(parseTrustedProxies(process.env.TRUSTED_PROXIES)))

// Rate limiting — only active in production (NODE_ENV=production).
// In development, localhost requests share a single IP key which makes even
// modest limits (10/min) trigger on normal browser usage (preflights, session
// checks, navigations).
if (process.env.NODE_ENV === 'production') {
  // Auth rate limit (strict): throttle ONLY sign-in/sign-up POSTs (the
  // brute-force surface). sign-out is deliberately excluded — rate-limiting
  // logout 429s the request, leaving the session uncleared so the user can't
  // log out — as is the better-auth client's frequent GET get-session polling.
  // See mountAuthRateLimit.
  mountAuthRateLimit(app)

  // Backstop for the legacy /api/* routes only (RATE_LIMIT_READS_PER_MIN per
  // user, else per IP). /api/auth/* is owned by the auth limiter above and
  // /api/v2/* by rateLimitV2 (per-user read + mutation budgets, limits.ts).
  // See mountGeneralApiRateLimit.
  mountGeneralApiRateLimit(app)
}

// First-run sign-up gate (design D6 / spec §4.2): close public sign-up once the
// install is bootstrapped. Mounted UNCONDITIONALLY (unlike the rate limiter,
// which is prod-only) — it is a correctness invariant, not a dev-noisy throttle —
// and BEFORE the better-auth handler so it runs first. Admin-initiated creation
// uses the server adapter directly and bypasses it.
mountSignupGate(app, async () => isSetupComplete())

// Health check endpoint — verifies DB connectivity AND that the schema is fully
// initialized. A connectivity-only check (SELECT 1) stays green over an empty
// database; checking the tables makes the Docker HEALTHCHECK go red when the
// schema is missing instead of serving a broken app.
app.get('/api/health', async (c) => {
  try {
    await db.execute(sql`SELECT 1`)
  } catch {
    return c.json({ status: 'error', message: 'Database connection failed' }, 503)
  }
  const { ok, missingTables } = await databaseSchemaStatus()
  if (!ok) {
    return c.json({ status: 'error', message: 'Database schema incomplete', missingTables }, 503)
  }
  return c.json({ status: 'ok' })
})

// Check if any admin account exists (no auth required; used by the first-run setup flow)
app.get('/api/has-admin', async (c) => {
  const exists = await hasAdminAccount()
  return c.json({ hasAdmin: exists })
})

// First-run status for the startup wizard + route guards (no auth required).
app.get('/api/setup-status', async (c) => {
  return c.json(await getSetupStatus())
})

// Better-Auth handler
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

// Backup routes
app.route('/api', backupRoutes)

// Admin routes
app.route('/api', adminRoutes)

// Phase 35 §5.3: new /api/v2/* surface (Plan 2a). Reachable but unused by client.
app.route('/api/v2', v2Routes)

// Static file serving for production (when frontend is built into ./public/)
if (fs.existsSync('./public/index.html')) {
  app.use('*', serveStatic({ root: './public' }))
  // SPA fallback: serve index.html for any unmatched route (client-side routing)
  app.get('*', (c) => {
    const html = fs.readFileSync('./public/index.html', 'utf-8')
    return c.html(html)
  })
}

// Bootstrap the database (runs DDL, triggers, seed, verify) before binding the port.
// A bootstrap failure rejects the top-level await and aborts the process — we must
// never serve on a broken or uninitialized DB.
await bootstrapDatabase()

// Resolve setup state once after bootstrap so the startup log (sync callback below)
// can reference it without calling the now-async isSetupComplete() inside a sync fn.
const setupDone = await isSetupComplete()

// Start server
const server = serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT) || 3000,
  },
  () => {
    const port = Number(process.env.PORT) || 3000
    console.log(`Server running on port ${port}`)
    const baseURL = process.env.BASE_URL || 'http://localhost:3000'
    console.log('────────────────────────────────────────────')
    console.log('Mission Designer — DEMONSTRATION system, not hardened for production.')
    console.log(
      `  Sign-up: ${setupDone ? 'CLOSED (setup complete — accounts are admin-created)' : 'OPEN (first-run setup pending)'}`,
    )
    console.log(
      `  Secure cookies: ${shouldUseSecureCookies(baseURL) ? 'on (HTTPS)' : 'off (HTTP — put behind a TLS proxy to expose)'}`,
    )
    console.log('────────────────────────────────────────────')
    if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
      console.warn('WARNING: ALLOWED_ORIGINS is not set. CORS will only allow localhost origins.')
    }
  },
)

// Graceful shutdown — allow in-flight requests to complete
const shutdown = () => {
  console.log('Shutting down gracefully...')
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10000)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

export default app
