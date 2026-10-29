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
//
// Shared harness for the operator API test suites (Task 8, reused by Tasks 9/10): a fresh
// PGlite db + the engine's own better-auth mount (sign-up enabled, same fixture-user pattern
// Task 7's api-auth.test.ts established) + the API app wired to both.
import { eq } from 'drizzle-orm';
import { appUser, workCenterUser, workCenterUserRole } from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './db.js';
import { testDeps } from './pump.js';
import { createAuth } from '../../src/api/auth.js';
import { createApiApp } from '../../src/api/app.js';
import type { OperatorEventHub } from '../../src/api/events.js';
import type { EngineDeps } from '../../src/config.js';

const TEST_PASSWORD = 'password-123';

export interface ApiHarness {
  db: Awaited<ReturnType<typeof makeTestDb>>['db'];
  app: ReturnType<typeof createApiApp>;
  auth: ReturnType<typeof createAuth>;
  deps: EngineDeps;
  /** Signs in and hands back the raw Set-Cookie value. Forwarding it verbatim as a request's
   *  Cookie header works because better-auth's cookie parser only looks for its own named
   *  cookie among the ';'-separated pairs, ignoring the Path/HttpOnly attribute pairs that
   *  come along for the ride (proven in Task 7's api-auth.test.ts). */
  cookieFor(email: string, password?: string): Promise<string>;
  /** Signs a real account up through better-auth — same path production login uses — and,
   *  when `wcId` is given, makes it a work_center_user. Returns the app_user id. */
  seedOperator(email: string, wcId?: string, password?: string): Promise<string>;
  /** Grants roles to an existing work-center member (spec 2026-09-06: roles are per work center). */
  grantRoles(userId: string, wcId: string, roleIds: string[]): Promise<void>;
  close(): Promise<void>;
}

export async function makeApi(hub: OperatorEventHub | null = null, depsOverrides: Partial<EngineDeps> = {}): Promise<ApiHarness> {
  const { db, close } = await makeTestDb();
  const auth = createAuth(db, { baseURL: 'http://127.0.0.1:3006', secret: 'test-secret', allowSignUp: true });
  const deps = testDeps(depsOverrides);
  const app = createApiApp(db, deps, auth, hub);

  async function cookieFor(email: string, password: string = TEST_PASSWORD): Promise<string> {
    const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    const cookie = res.headers.get('set-cookie');
    if (!cookie) throw new Error(`sign-in failed for ${email}: ${res.status}`);
    return cookie;
  }

  async function seedOperator(email: string, wcId?: string, password: string = TEST_PASSWORD): Promise<string> {
    await auth.api.signUpEmail({ body: { email, password, name: email } });
    const [row] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, email));
    if (wcId) await db.insert(workCenterUser).values({ workCenterId: wcId, userId: row.id });
    return row.id;
  }

  async function grantRoles(userId: string, wcId: string, roleIds: string[]): Promise<void> {
    if (roleIds.length === 0) return;
    await db.insert(workCenterUserRole).values(roleIds.map((roleId) => ({ workCenterId: wcId, userId, roleId }))).onConflictDoNothing();
  }

  return { db, app, auth, deps, cookieFor, seedOperator, grantRoles, close };
}
