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
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import * as schema from 'mission-control-db/src/db/schema/index';
import { appUser } from 'mission-control-db/src/db/schema/index';
import { ACCOUNT_DISABLED_MESSAGE, isUserDisabled } from 'mission-control-db/src/dao/account-status';
import type { Db } from '../db.js';
import { CLIENT_IP_HEADER } from './client-ip.js';

/** Same loopback stance as CM's auth.ts: only software on the user's own machine can present
 *  a loopback origin; anything remote must be named in ALLOWED_ORIGINS. */
export function trustedOrigins(): string[] {
  const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return ['http://localhost:*', 'https://localhost:*', 'http://127.0.0.1:*', 'https://127.0.0.1:*', ...allowed];
}

/**
 * The engine's OWN better-auth mount on the shared DB (spec F2): same emails/passwords as CM
 * (shared account table), sessions land in the shared session table. Deliberately narrower
 * than CM's mount: NO admin plugin, NO first-admin promotion hook (CM owns provisioning),
 * and sign-up disabled in production — `allowSignUp` exists so tests can create fixture
 * users through the same code path CM uses.
 *
 * No explicit return-type annotation: `ReturnType<typeof betterAuth>` (betterAuth's generic
 * default) is `Auth<BetterAuthOptions>`, and `Auth<T>` is invariant in `T` (the DB adapter type
 * appears in both a producing and consuming position), so the concrete `Auth<{our literal
 * options shape}>` this call actually returns is NOT assignable to that generic-default alias.
 * Letting TS infer preserves the real, narrower type; `EngineAuth` is derived FROM it below so
 * the two can never drift apart.
 */
export function createAuth(db: Db, opts: { baseURL: string; secret: string; allowSignUp?: boolean }) {
  return betterAuth({
    secret: opts.secret,
    baseURL: opts.baseURL,
    basePath: '/api/auth',
    // cookiePrefix: app-distinct — the three Mission Suite better-auth apps share the
    // localhost cookie jar (per HOST, not per port); the default prefix made them clobber
    // each other's session token (2026-08-20). See test/auth-cookie-prefix.test.ts.
    // ipAddress: the rate limit keys on the IP clientIpMiddleware resolves (client-ip.ts).
    advanced: {
      database: { generateId: false },
      cookiePrefix: 'mission-engine',
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { ...schema, user: appUser, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: { enabled: true, disableSignUp: !(opts.allowSignUp ?? false) },
    user: {
      modelName: 'user',
      fields: { name: 'displayName', emailVerified: 'emailVerified', createdAt: 'createdAt', updatedAt: 'updatedAt' },
    },
    databaseHooks: {
      session: {
        create: {
          // A disabled account never gets a session (the shared status column is the switch).
          before: async (session) => {
            if (await isUserDisabled(db, session.userId)) {
              throw new APIError('FORBIDDEN', { message: ACCOUNT_DISABLED_MESSAGE, code: 'ACCOUNT_DISABLED' });
            }
          },
        },
      },
    },
    trustedOrigins,
  });
}

export type EngineAuth = ReturnType<typeof createAuth>;
