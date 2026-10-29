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

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from './db'
import * as schema from '../db/schema'
import { hasAdminAccount, promoteToAdmin } from './seed'
import { shouldUseSecureCookies } from './deploy-policy'
import { CLIENT_IP_HEADER } from './clientIp'

const baseURL = process.env.BASE_URL || 'http://localhost:3000'
const isProduction = process.env.NODE_ENV === 'production'
const authSecret = process.env.BETTER_AUTH_SECRET
const useSecureCookies = shouldUseSecureCookies(baseURL)

// Enforce a real secret in production — without this, session tokens can be forged
if (isProduction && (!authSecret || authSecret === 'change-me-in-production')) {
  console.error(
    'FATAL: BETTER_AUTH_SECRET is not set or is the example value.\n' +
      'Generate a secret with: openssl rand -hex 32\n' +
      'Set it in your .env file or environment variables.',
  )
  process.exit(1)
}
if (!isProduction && (!authSecret || authSecret === 'change-me-in-production')) {
  console.warn('WARNING: BETTER_AUTH_SECRET is not set. Using insecure default for development only.')
}

export const auth = betterAuth({
  secret: authSecret,
  baseURL,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    // Sign-up availability is governed at the route layer by the first-run gate
    // (src/server/middleware/signupGate.ts — design D6 / spec §4.2): public
    // sign-up is open only while the install is un-bootstrapped and 403s after.
    // Keep it enabled here so that gate is the single source of truth.
    // Admin-initiated creation uses the server adapter directly (never the public
    // route), so it is unaffected.
    disableSignUp: false,
  },
  advanced: {
    // Secure cookies require HTTPS; engage them when the public base URL is https.
    useSecureCookies,
    // App-distinct prefix: Mission Designer, Mission Commander, and the Engine/Mission Pilot all run
    // better-auth on localhost ports, and cookies are per-HOST — with the shared
    // default prefix they clobbered each other's session token (2026-08-20: every
    // trip to the Pilot/CM 401'd Designer's next batch-save).
    cookiePrefix: 'mission-designer',
    // The rate limit keys on the IP clientIpMiddleware resolves (clientIp.ts).
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const adminExists = await hasAdminAccount()
          if (!adminExists) {
            await promoteToAdmin(user.id)
          }
        },
      },
    },
  },
  user: {
    additionalFields: {
      isAdministrator: {
        type: 'boolean',
        defaultValue: false,
        input: false,
      },
    },
  },
  trustedOrigins: (request) => {
    const origin = request?.headers?.get?.('origin') ?? ''
    const origins: string[] = []

    // In production, only trust explicitly configured origins
    const allowedOrigins = process.env.ALLOWED_ORIGINS
    if (allowedOrigins) {
      const allowed = allowedOrigins.split(',').map((o) => o.trim())
      if (allowed.includes(origin)) origins.push(origin)
      return origins
    }

    // Development fallback: allow localhost and private network IPs
    try {
      const url = new URL(origin)
      const host = url.hostname
      if (host === 'localhost' || host === '127.0.0.1' || /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
        origins.push(url.origin)
      }
    } catch {
      /* invalid origin */
    }
    return origins
  },
})
