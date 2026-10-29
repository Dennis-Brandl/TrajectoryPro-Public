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
import type { Context, MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { appUser } from 'mission-control-db/src/db/schema/index';
import { loadPrincipal, hasRight, type Principal } from 'mission-control-db/src/dao/access';
import { isMissionSystemCommander } from 'mission-control-db/src/dao/work-centers';
import { httpError } from '../lib/errors';

export type Vars = { principal: Principal };

// Re-reads the principal fresh from the DB on every request (spec §5). Rejects
// missing sessions, deleted users, and disabled accounts with 401.
export const requireSession: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const userId = session?.user?.id;
  if (!userId) return httpError(c, 401, 'unauthorized', 'Authentication required');

  const principal = await loadPrincipal(db, userId);
  if (!principal) return httpError(c, 401, 'unauthorized', 'Authentication required');

  const [row] = await db.select({ status: appUser.status }).from(appUser).where(eq(appUser.id, userId));
  if (!row || row.status === 'disabled') return httpError(c, 401, 'unauthorized', 'Account is disabled');

  c.set('principal', principal);
  await next();
};

// Gate a route on a specific right. Administrator short-circuits (spec §5).
export function requirePermission(right: string): MiddlewareHandler<{ Variables: Vars }> {
  return async (c, next) => {
    const principal = c.get('principal');
    if (!principal) return httpError(c, 401, 'unauthorized', 'Authentication required');
    if (principal.accessLevel === 'administrator' || hasRight(principal, right)) {
      await next();
      return;
    }
    return httpError(c, 403, 'forbidden', `Missing permission: ${right}`);
  };
}

// Gate a route on the administrator access level specifically — not any right in the
// CATEGORY_VERBS model. Environment-binding writes are an operational/infra concern (which
// Action Server a work center's runtime workflows dial), not one of the curated
// work_center/workflow/environment/user/role/access categories, so there is no natural right
// to gate it on; administrator-only is the deliberate bar (task-19 brief).
export const requireAdministrator: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  const principal = c.get('principal');
  if (!principal) return httpError(c, 401, 'unauthorized', 'Authentication required');
  if (principal.accessLevel !== 'administrator') {
    return httpError(c, 403, 'forbidden', 'Requires administrator');
  }
  await next();
};

// Gate a route on the Mission System Commander flag for a work center resolved from the request
// (workflow row for creates, instance row for instance-scoped routes — spec §6.1).
// Administrator bypasses, consistent with requirePermission. Null resolution = 404: the
// subject does not exist, and existence is already visible to any session via the read routes.
export function requireMissionSystemCommander(
  resolveWorkCenterId: (c: Context<{ Variables: Vars }>) => Promise<string | null>,
): MiddlewareHandler<{ Variables: Vars }> {
  return async (c, next) => {
    const principal = c.get('principal');
    if (!principal) return httpError(c, 401, 'unauthorized', 'Authentication required');
    const workCenterId = await resolveWorkCenterId(c);
    if (!workCenterId) return httpError(c, 404, 'not_found', 'Not found');
    if (principal.accessLevel === 'administrator'
      || await isMissionSystemCommander(db, workCenterId, principal.userId)) {
      await next();
      return;
    }
    return httpError(c, 403, 'forbidden', 'Requires Mission System Commander for this work center');
  };
}
