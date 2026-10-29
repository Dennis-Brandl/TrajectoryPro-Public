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
import { vi } from 'vitest';
import type { Hono } from 'hono';
import { db } from '../lib/db';
import { appUser } from 'mission-control-db/src/db/schema/index';
import type { AccessLevel } from 'mission-control-db/src/dao/access';

// Hoisted before any import runs, so middleware sees the mocked auth. getSession
// returns a session for whatever id mockSessionAs last set. The admin-plugin/api fns
// used by routes are mocked here too: signUpEmail materializes a real app_user row
// (mimicking better-auth minus the credential), so create-flows can read it back;
// setUserPassword/revokeUserSessions just record calls — their REAL behavior is
// proven in lib/admin-auth.test.ts.
vi.mock('../lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => {
        const uid = (globalThis as { __cmTestUserId?: string }).__cmTestUserId;
        return uid ? { user: { id: uid } } : null;
      }),
      signUpEmail: vi.fn(async ({ body }: { body: { email: string; password: string; name: string } }) => {
        const { db: database } = await import('../lib/db');
        const { appUser: appUserTable } = await import('mission-control-db/src/db/schema/index');
        await database.insert(appUserTable).values({ email: body.email, displayName: body.name });
        return {};
      }),
      setUserPassword: vi.fn(async () => ({ status: true })),
      revokeUserSessions: vi.fn(async () => ({ success: true })),
    },
    handler: () => new Response(null, { status: 404 }),
  },
}));

export function mockSessionAs(userId: string | null): void {
  if (userId) (globalThis as { __cmTestUserId?: string }).__cmTestUserId = userId;
  else delete (globalThis as { __cmTestUserId?: string }).__cmTestUserId;
}

export async function seedUser(
  database: typeof db,
  u: { email: string; displayName: string; accessLevel?: AccessLevel; status?: 'active' | 'disabled'; loginName?: string },
): Promise<string> {
  const [row] = await database
    .insert(appUser)
    .values({
      email: u.email,
      displayName: u.displayName,
      accessLevel: u.accessLevel ?? 'viewer',
      status: u.status ?? 'active',
      // Omitted → the 0031 trigger derives one from the email (e.g. 'a' → 'user', 's' → 'user-2').
      ...(u.loginName !== undefined ? { loginName: u.loginName } : {}),
    })
    .returning();
  return row.id;
}

export async function req(
  app: Hono<any>,
  method: string,
  path: string,
  opts: { json?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers = new Headers(opts.headers ?? {});
  if (opts.json !== undefined) headers.set('content-type', 'application/json');
  return app.request(path, {
    method,
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
}
