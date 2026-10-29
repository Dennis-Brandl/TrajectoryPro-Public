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
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { DaoError, type DaoErrorCode } from 'mission-control-db/src/dao/errors';

// Closed set of wire error codes the server may emit.
export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'validation',
  'too_large',
  'internal',
  'partial',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

// DaoError.code → HTTP status. Record over the DaoErrorCode UNION (not string), so this
// map is exhaustive by construction: a code added to mission-control-db's DAO_ERROR_CODES
// without a row here is a compile error, and a retired code cannot linger. The old failure
// mode — an unmapped code silently answering 400 — can no longer happen at build time; the
// runtime `?? 400` below survives only as a cross-build-skew belt.
const DAO_STATUS: Record<DaoErrorCode, number> = {
  WORK_CENTER_NOT_FOUND: 404,
  PARENT_NOT_FOUND: 404,
  LINK_TARGET_NOT_FOUND: 404,
  // app_user.email, changed from the user Edit dialog (it is the sign-in identifier).
  EMAIL_CONFLICT: 409,
  EMAIL_INVALID: 400,
  // Spec 2026-09-06 D6: app_user.login_name.
  LOGIN_NAME_CONFLICT: 409,
  LOGIN_NAME_INVALID: 400,
  USER_NOT_FOUND: 404,
  ROLE_NOT_FOUND: 404,
  WORKFLOW_NOT_FOUND: 404,
  WORK_CENTER_NAME_CONFLICT: 409,
  WORK_CENTER_CYCLE: 409,
  WORK_CENTER_HAS_CHILDREN: 409,
  WORK_CENTER_IN_USE: 409,
  // Mission Engine (phase 3): deleteWorkCenter refuses unconditionally — even ?confirm=true —
  // while any of its runtime workflows sit in an active status. Unmapped would silently 400
  // (bad_request) a request that is not malformed at all.
  WORK_CENTER_HAS_ACTIVE_RUNTIME: 409,
  WORKFLOW_IN_USE: 409,
  ENVIRONMENT_IN_USE: 409,
  ROLE_NAME_CONFLICT: 409,
  LAST_ADMIN: 409,
  SYSTEM_ROLE: 409,
  ROLE_IN_USE: 409,
  // The work-center delete preflight: dependents exist and the caller must confirm.
  // 409 (not 400) because nothing about the request is malformed — spec §8.1.
  CONFIRMATION_REQUIRED: 409,
  CONTROL_GRANT_INVALID: 400,
  SELF_CHANGE_FORBIDDEN: 403,
  INVALID_DISPATCH_POLICY: 400,
  INVALID_PACKAGE: 400,
  INVALID_RUNTIME_ID_TEMPLATE: 400,
  INVALID_SCOPE: 400,
  NAME_TOO_LONG: 400,
  TYPE_NAME_TOO_LONG: 400,
  // An internal invariant broke mid-ingest (a row vanished between insert and relookup).
  // The default 400 would blame the caller for a server fault.
  INGEST_FAILED: 500,
  RUNTIME_MASTER_NOT_FOUND: 404,
  RUNTIME_NOT_FOUND: 404,
  RUNTIME_INVALID_STATE: 409,
  RUNTIME_PARAM_INVALID: 400,
  RUNTIME_MASTER_INVALID: 400,
  HISTORY_NOT_FOUND: 404,
  HISTORY_FILTER_INVALID: 400,
};

/** The mapped code list, exported so tests can assert a retired code is truly absent. */
export const DAO_STATUS_KEYS = Object.keys(DAO_STATUS);

// `code: string` (not DaoErrorCode) on purpose: at runtime a code can arrive from a build
// of mission-control-db newer than this one; the 400 fallback covers that skew.
export function daoErrorStatus(code: string): number {
  return DAO_STATUS[code as DaoErrorCode] ?? 400;
}

function daoWireCode(status: number): ErrorCode {
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 403) return 'forbidden';
  // Anything 5xx is a server fault (today: INGEST_FAILED). Falling through to
  // 'bad_request' would label a 500 response as the caller's mistake.
  if (status >= 500) return 'internal';
  return 'bad_request';
}

export function httpError(c: Context, status: number, code: ErrorCode, message: string): Response {
  return c.json(errorBody(code, message), status as ContentfulStatusCode);
}

/** Map a caught DaoError to a response; return null if it isn't a DaoError (rethrow those). */
export function sendDaoError(c: Context, err: unknown): Response | null {
  if (!(err instanceof DaoError)) return null;
  const status = daoErrorStatus(err.code);
  return c.json(errorBody(daoWireCode(status), err.message || err.code), status as ContentfulStatusCode);
}

/**
 * Route catch-block handler: map a DaoError to its response, or log + 500 anything else.
 * A route catch block that does `sendDaoError(c, err) ?? httpError(c, 500, ...)` returns a
 * Response either way, so app.onError never runs for the non-DaoError branch — without a log
 * here, a genuine bug (bad SQL, driver error, etc.) 500s silently with no trace. DaoErrors are
 * expected 4xx outcomes and are intentionally not logged.
 */
export function sendError(c: Context, err: unknown, fallbackMessage: string): Response {
  const daoResponse = sendDaoError(c, err);
  if (daoResponse) return daoResponse;
  console.error(`[route] ${c.req.method} ${c.req.path}:`, err);
  return httpError(c, 500, 'internal', fallbackMessage);
}
