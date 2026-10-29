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
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { appUser } from 'mission-control-db/src/db/schema/index';
import { userView } from 'mission-control-db/src/dao/hierarchies';
import { updateUser, findUserByLoginName, normalizeLoginName, isValidLoginName } from 'mission-control-db/src/dao/users';
import {
  setAccessLevel,
  setAccessLevelGuarded,
  setUserStatusGuarded,
  hasRight,
  ACCESS_LEVELS,
  type AccessLevel,
} from 'mission-control-db/src/dao/access';
import { auth } from '../lib/auth';
import { requireSession, requirePermission, type Vars } from '../middleware/auth';
import { requireUuidParams } from '../middleware/validate';
import { errorBody, httpError, sendError } from '../lib/errors';
import { readJsonObject } from '../lib/json-body';

export const usersRoutes = new Hono<{ Variables: Vars }>();

// GET /users (the flat list) already exists in pickers.ts under user:read — reused as-is.
usersRoutes.use('/users', requireSession);
usersRoutes.use('/users/*', requireSession);

// better-auth's default minimum; the plugin rejects shorter ones anyway — validating
// here yields a clean 400 instead of a wrapped APIError.
const MIN_PASSWORD_LENGTH = 8;

usersRoutes.get(
  '/users/:id',
  requireUuidParams('id'),
  requirePermission('user:read'),
  async (c) => {
    const view = await userView(db, c.req.param('id'));
    if (!view) return httpError(c, 404, 'not_found', 'User not found');
    return c.json(view);
  },
);

// Users ARE logins (spec §4): creation is an access-tier action. In-process
// signUpEmail bypasses the HTTP signupGate — this route is the only creation path
// (the plugin's create-user endpoint is blocked by adminGate).
usersRoutes.post('/users', requirePermission('access:create'), async (c) => {
  const inputRaw = await readJsonObject(c);
  if (!inputRaw) return c.json(errorBody('bad_request', 'Request body must be a JSON object'), 400);
  const input = inputRaw as {
    email?: string; displayName?: string; password?: string; accessLevel?: string; loginName?: string;
  };
  // better-auth persists emails lowercased; normalize up front so the format check,
  // duplicate pre-check, signUpEmail, and the re-select below all agree on one casing.
  if (typeof input.email === 'string') input.email = input.email.trim().toLowerCase();
  if (!input.email || typeof input.email !== 'string' || !/\S+@\S+\.\S+/.test(input.email)) {
    return httpError(c, 400, 'validation', 'A valid email is required');
  }
  if (!input.displayName || typeof input.displayName !== 'string') {
    return httpError(c, 400, 'validation', 'displayName is required');
  }
  if (!input.password || typeof input.password !== 'string' || input.password.length < MIN_PASSWORD_LENGTH) {
    return httpError(c, 400, 'validation', `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (input.accessLevel !== undefined && !(ACCESS_LEVELS as readonly string[]).includes(input.accessLevel)) {
    return httpError(c, 400, 'validation', 'accessLevel must be administrator, steward, or viewer');
  }
  // Spec 2026-09-06 D6: the login name is required at creation and normalised like the email.
  const loginName = typeof input.loginName === 'string' ? normalizeLoginName(input.loginName) : '';
  if (!isValidLoginName(loginName)) {
    return httpError(c, 400, 'validation', 'loginName must be 2–64 characters of lowercase letters, digits, dot, underscore or hyphen, starting with a letter or digit');
  }
  const [existing] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, input.email));
  if (existing) return httpError(c, 409, 'conflict', 'Email already in use');
  if (await findUserByLoginName(db, loginName)) return httpError(c, 409, 'conflict', 'Login name already in use');
  try {
    await auth.api.signUpEmail({
      body: { email: input.email, password: input.password, name: input.displayName },
    });
    const [created] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, input.email));
    if (!created) return httpError(c, 500, 'internal', 'User creation did not persist');
    // Follow-up writes after sign-up (the same pattern setAccessLevel uses): better-auth's
    // insert cannot carry loginName — the 0031 trigger derived a placeholder from the email
    // and this replaces it with the requested one. A lost race here surfaces as
    // LOGIN_NAME_CONFLICT → 409 through sendError.
    await updateUser(db, created.id, { loginName });
    // Applies the requested tier AND the better-auth role mirror. 'viewer' is the column
    // default but setting explicitly keeps the mirror invariant unconditional.
    await setAccessLevel(db, created.id, (input.accessLevel ?? 'viewer') as AccessLevel);
    const view = await userView(db, created.id);
    return c.json(view, 201);
  } catch (err) {
    // Duplicate-email race (pre-check passed, signUpEmail lost the race) surfaces as a
    // logged 500 — acceptable for an admin console; the pre-check handles the honest case.
    return sendError(c, err, 'Create failed');
  }
});

usersRoutes.patch(
  '/users/:id',
  requireUuidParams('id'),
  requirePermission('user:edit'),
  async (c) => {
    const inputRaw = await readJsonObject(c);
    if (!inputRaw) return c.json(errorBody('bad_request', 'Request body must be a JSON object'), 400);
    const input = inputRaw as { displayName?: unknown; loginName?: unknown; email?: unknown };
    const patch: { displayName?: string; loginName?: string; email?: string } = {};
    if (input.displayName !== undefined) {
      if (typeof input.displayName !== 'string' || input.displayName.trim() === '') {
        return httpError(c, 400, 'validation', 'displayName must be a non-empty string');
      }
      patch.displayName = input.displayName;
    }
    if (input.loginName !== undefined) {
      if (typeof input.loginName !== 'string') return httpError(c, 400, 'validation', 'loginName must be a string');
      patch.loginName = input.loginName;   // normalised + validated by the DAO (LOGIN_NAME_INVALID → 400)
    }
    if (input.email !== undefined) {
      // The email is the sign-in identifier, so changing it is an access-tier action like
      // Set password — the route's user:edit alone would let a steward lock anyone out.
      const principal = c.get('principal');
      if (principal.accessLevel !== 'administrator' && !hasRight(principal, 'access:edit')) {
        return httpError(c, 403, 'forbidden', 'Missing permission: access:edit');
      }
      if (typeof input.email !== 'string') return httpError(c, 400, 'validation', 'email must be a string');
      // Normalised + validated by the DAO (EMAIL_INVALID → 400, EMAIL_CONFLICT → 409).
      // Sessions survive — they are keyed on the user id, not the email.
      patch.email = input.email;
    }
    if (patch.displayName === undefined && patch.loginName === undefined && patch.email === undefined) {
      return httpError(c, 400, 'validation', 'displayName, loginName or email is required');
    }
    try {
      await updateUser(db, c.req.param('id'), patch);
      const view = await userView(db, c.req.param('id'));
      return c.json(view);
    } catch (err) {
      return sendError(c, err, 'Update failed');
    }
  },
);

// Password set = plugin call with the ACTOR's headers (its adminMiddleware sees the
// mirrored role), then revoke the target's sessions: whoever held the old credential
// is signed out everywhere (spec §6.1). In-process calls bypass adminGate by nature.
usersRoutes.post(
  '/users/:id/password',
  requireUuidParams('id'),
  requirePermission('access:edit'),
  async (c) => {
    const id = c.req.param('id');
    const inputRaw = await readJsonObject(c);
    if (!inputRaw) return c.json(errorBody('bad_request', 'Request body must be a JSON object'), 400);
    const input = inputRaw as { newPassword?: string };
    if (!input.newPassword || typeof input.newPassword !== 'string' || input.newPassword.length < MIN_PASSWORD_LENGTH) {
      return httpError(c, 400, 'validation', `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const [target] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.id, id));
    if (!target) return httpError(c, 404, 'not_found', 'User not found');
    try {
      await auth.api.setUserPassword({
        body: { userId: id, newPassword: input.newPassword },
        headers: c.req.raw.headers,
      });
    } catch (err) {
      return sendError(c, err, 'Password set failed');
    }
    // Split from the write above: if THIS throws, the password change already committed —
    // an honest response says so (code 'partial') instead of implying total failure. A
    // retry re-runs both calls; setUserPassword is idempotent and revocation converges.
    try {
      await auth.api.revokeUserSessions({ body: { userId: id }, headers: c.req.raw.headers });
    } catch (err) {
      console.error(`[route] POST ${c.req.path}: password set but session revocation failed:`, err);
      return httpError(c, 500, 'partial', 'Password was set, but revoking the user’s sessions failed — retry to sign them out everywhere');
    }
    return c.json({ ok: true });
  },
);

usersRoutes.post(
  '/users/:id/access',
  requireUuidParams('id'),
  requirePermission('access:edit'),
  async (c) => {
    const inputRaw = await readJsonObject(c);
    if (!inputRaw) return c.json(errorBody('bad_request', 'Request body must be a JSON object'), 400);
    const input = inputRaw as { accessLevel?: string };
    if (!input.accessLevel || !(ACCESS_LEVELS as readonly string[]).includes(input.accessLevel)) {
      return httpError(c, 400, 'validation', 'accessLevel must be administrator, steward, or viewer');
    }
    try {
      await setAccessLevelGuarded(db, c.get('principal').userId, c.req.param('id'), input.accessLevel as AccessLevel);
      const view = await userView(db, c.req.param('id'));
      return c.json(view);
    } catch (err) {
      return sendError(c, err, 'Access change failed');
    }
  },
);

usersRoutes.post(
  '/users/:id/status',
  requireUuidParams('id'),
  requirePermission('access:edit'),
  async (c) => {
    const inputRaw = await readJsonObject(c);
    if (!inputRaw) return c.json(errorBody('bad_request', 'Request body must be a JSON object'), 400);
    const input = inputRaw as { status?: string };
    if (input.status !== 'active' && input.status !== 'disabled') {
      return httpError(c, 400, 'validation', "status must be 'active' or 'disabled'");
    }
    try {
      await setUserStatusGuarded(db, c.get('principal').userId, c.req.param('id'), input.status);
    } catch (err) {
      return sendError(c, err, 'Status change failed');
    }
    // Disable is M2's only lockout mechanism. The better-auth admin plugin's own checks
    // on the live /api/auth/admin/* endpoints never consult app_user.status, so a
    // disabled administrator's surviving session would still pass them — revoke it
    // in-process here (same pattern as the password route). Never revoke on enable.
    // Split from the write above: if THIS throws, the status change already committed —
    // an honest response says so (code 'partial') instead of implying total failure. A
    // retry re-runs both calls; setUserStatusGuarded is idempotent and revocation converges.
    if (input.status === 'disabled') {
      try {
        await auth.api.revokeUserSessions({ body: { userId: c.req.param('id') }, headers: c.req.raw.headers });
      } catch (err) {
        console.error(`[route] POST ${c.req.path}: user disabled but session revocation failed:`, err);
        return httpError(c, 500, 'partial', 'User was disabled, but revoking their sessions failed — retry to sign them out everywhere');
      }
    }
    const view = await userView(db, c.req.param('id'));
    return c.json(view);
  },
);
