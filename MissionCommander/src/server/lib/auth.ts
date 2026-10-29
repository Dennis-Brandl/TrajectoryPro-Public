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
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { admin } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { db, schema } from './db';
import { CLIENT_IP_HEADER } from './client-ip';
import { appUser } from 'mission-control-db/src/db/schema/index';
import { setAccessLevel } from 'mission-control-db/src/dao/access';
import { ACCOUNT_DISABLED_MESSAGE, isUserDisabled } from 'mission-control-db/src/dao/account-status';

const authSecret = process.env.BETTER_AUTH_SECRET ?? 'insecure-dev-secret-change-me';

// Vite/vitest sets process.env.BASE_URL to '/' (its default public base path), which is
// truthy and would slip past a plain `|| fallback`; better-auth then rejects '/' as an
// invalid base URL. Treat '/' as unset — mirrors better-auth's own `env.BASE_URL !== '/'`.
const rawBaseUrl = process.env.BASE_URL;
const baseURL = rawBaseUrl && rawBaseUrl !== '/' ? rawBaseUrl : 'http://localhost:3002';

/**
 * Origins better-auth's CSRF/origin check will accept.
 *
 * MUST stay in step with app.ts's CORS policy, which admits any origin whose hostname is
 * `localhost` or `127.0.0.1`, on any port and either scheme. These two layers previously
 * disagreed: this list hardcoded `http://localhost:5173` + `http://localhost:3002`, so a
 * deployment on any other port answered a browser at 127.0.0.1 with INVALID_ORIGIN while
 * localhost happened to work — and only by accident, because better-auth implicitly trusts
 * its own baseURL. The container publishes :3005, which is exactly that case.
 *
 * The `:*` wildcard is a better-auth origin pattern, matched against the whole origin
 * (auth/trusted-origins.mjs). It is bounded, not a prefix match: `http://localhost:*`
 * rejects `http://localhost.evil.com` and `http://127.0.0.1.evil.com`.
 *
 * Loopback is safe to trust broadly here for the same reason the CORS layer already does:
 * only software on the user's own machine can present a loopback origin. Anything remote
 * must be named explicitly in ALLOWED_ORIGINS.
 *
 * Exported for tests. NOTE they can only assert this list, not better-auth's enforcement
 * of it: better-auth sets `skipOriginCheck: isTest() ? true : false`, so its origin-check
 * middleware is disabled under vitest.
 */
export function trustedOrigins(): string[] {
  const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return [
    'http://localhost:*', 'https://localhost:*',
    'http://127.0.0.1:*', 'https://127.0.0.1:*',
    ...allowed,
  ];
}

export const auth = betterAuth({
  secret: authSecret,
  baseURL,
  // Let the DB fill every id from its uuid defaultRandom() (app_user.id is uuid).
  // cookiePrefix: app-distinct — the three Mission Suite better-auth apps share the
  // localhost cookie jar (per HOST, not per port); the default prefix made them clobber
  // each other's session token (2026-08-20). See auth.cookie.test.ts.
  // ipAddress: the rate limit keys on the IP clientIpMiddleware resolves (client-ip.ts).
  advanced: {
    database: { generateId: false },
    cookiePrefix: 'mission-commander',
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
  },
  database: drizzleAdapter(db, {
    provider: 'pg',
    // Map better-auth's `user` model onto the existing app_user table; session/
    // account/verification match by name.
    schema: {
      ...schema,
      user: appUser,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: { enabled: true, disableSignUp: false },
  // Admin plugin (spec §6.2): set-user-password, session management, impersonation.
  // Authorization rides app_user.role, which is a pure MIRROR of access_level
  // (dao/access.ts setAccessLevel) — 'admin' ⇔ our Administrator tier. The plugin's
  // conflicting endpoints are blocked by adminGate (middleware/admin-gate.ts).
  // Defaults are stated explicitly: they must match roleForLevel()'s values.
  plugins: [admin({ defaultRole: 'user', adminRoles: ['admin'] })],
  user: {
    modelName: 'user', // resolved to appUser via the schema map above
    // better-auth field → Drizzle *property key* (NOT the SQL column name). The
    // drizzle adapter indexes the table object by these values (`appUser[key]`),
    // and appUser's keys are camelCase JS properties, so `display_name` etc. would
    // resolve to `undefined` ("field does not exist in the Drizzle schema"). Drizzle
    // itself maps `displayName`→display_name via the column definition. `name`→
    // displayName is the only true rename; the rest are identity (better-auth's
    // default field names already equal appUser's property keys) but kept explicit.
    fields: {
      name: 'displayName',
      emailVerified: 'emailVerified',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // First-run: promote the first-ever account to Administrator.
          const admins = await db
            .select({ id: appUser.id })
            .from(appUser)
            .where(eq(appUser.accessLevel, 'administrator'));
          if (admins.length === 0) {
            await setAccessLevel(db, user.id, 'administrator');
          }
        },
      },
    },
    session: {
      create: {
        // A disabled account never gets a session — sign-in and admin impersonation alike.
        // (requireSession already rejects disabled users on API calls; this closes creation.)
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
