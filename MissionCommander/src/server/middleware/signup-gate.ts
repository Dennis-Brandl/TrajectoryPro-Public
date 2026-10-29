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
import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { appUser } from 'mission-control-db/src/db/schema/index';
import { canonicalize } from './path';

// Mounted on the broad /api/auth/* prefix (same rationale as adminGate): a narrow
// /api/auth/sign-up/* mount is skipped by Hono for an encoded separator (sign-up%2Femail),
// which would let a post-bootstrap sign-up slip past the gate. isSignupPath() canonicalizes
// and matches, and it is checked BEFORE the DB read so non-signup auth traffic pays only a
// string comparison, not a query.
export function isSignupPath(rawPath: string): boolean {
  return canonicalize(rawPath).startsWith('/api/auth/sign-up');
}

// Public sign-up is open ONLY while the install is un-bootstrapped (no administrator).
// Once the first-run admin exists, self-service sign-up is 403 — afterward only
// administrators mint logins (spec §5). Server-side auth.api.signUpEmail (seed / admin
// actions) does not pass through this HTTP gate, so it is unaffected.
export const signupGate: MiddlewareHandler = async (c, next) => {
  if (isSignupPath(c.req.path)) {
    const [admin] = await db
      .select({ id: appUser.id })
      .from(appUser)
      .where(eq(appUser.accessLevel, 'administrator'))
      .limit(1);
    if (admin) return c.json({ error: { code: 'forbidden', message: 'Public sign-up is closed' } }, 403);
  }
  await next();
};
