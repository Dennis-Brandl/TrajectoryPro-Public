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

import { DISPATCH_POLICIES } from '../db/schema/index.js';

/**
 * The closed set of DaoError codes across the suite (audit item 2's contract surface).
 * Every code thrown by this package lives here, plus INVALID_SCOPE (thrown by the Mission
 * Commander's package route with this same class). The constructor is typed against this
 * union, so a new `new DaoError('X')` site fails to compile until X is added here — and
 * the Mission Commander's DAO_STATUS map is a Record over this union, so adding a code here
 * fails to compile there until it gets an HTTP status. Silent-400 drift is impossible in
 * either direction. Retired codes are REMOVED (ENVIRONMENT_NOT_FOUND fell with M6's
 * library removal), not kept as dead map weight.
 */
export const DAO_ERROR_CODES = [
  'CONFIRMATION_REQUIRED',
  'CONTROL_GRANT_INVALID',
  'ENVIRONMENT_IN_USE',
  'HISTORY_FILTER_INVALID',
  'HISTORY_NOT_FOUND',
  'INGEST_FAILED',
  'INVALID_DISPATCH_POLICY',
  'INVALID_PACKAGE',
  'INVALID_RUNTIME_ID_TEMPLATE',
  'INVALID_SCOPE',
  'LAST_ADMIN',
  'LINK_TARGET_NOT_FOUND',
  'EMAIL_CONFLICT',
  'EMAIL_INVALID',
  'LOGIN_NAME_CONFLICT',
  'LOGIN_NAME_INVALID',
  'NAME_TOO_LONG',
  'PARENT_NOT_FOUND',
  'ROLE_IN_USE',
  'ROLE_NAME_CONFLICT',
  'ROLE_NOT_FOUND',
  'RUNTIME_INVALID_STATE',
  'RUNTIME_MASTER_INVALID',
  'RUNTIME_MASTER_NOT_FOUND',
  'RUNTIME_NOT_FOUND',
  'RUNTIME_PARAM_INVALID',
  'SELF_CHANGE_FORBIDDEN',
  'SYSTEM_ROLE',
  'TYPE_NAME_TOO_LONG',
  'USER_NOT_FOUND',
  'WORKFLOW_IN_USE',
  'WORKFLOW_NOT_FOUND',
  'WORK_CENTER_CYCLE',
  'WORK_CENTER_HAS_ACTIVE_RUNTIME',
  'WORK_CENTER_HAS_CHILDREN',
  'WORK_CENTER_IN_USE',
  'WORK_CENTER_NAME_CONFLICT',
  'WORK_CENTER_NOT_FOUND',
] as const;
export type DaoErrorCode = (typeof DAO_ERROR_CODES)[number];

/** Typed domain error. `code` is what the HTTP layer maps to a status; message is for logs. */
export class DaoError extends Error {
  constructor(public readonly code: DaoErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'DaoError';
  }
}

export function assertDispatchPolicy(policy: string | null | undefined): void {
  if (policy != null && !(DISPATCH_POLICIES as readonly string[]).includes(policy)) {
    throw new DaoError('INVALID_DISPATCH_POLICY', `Unknown dispatch policy: ${policy}`);
  }
}

/**
 * SQLSTATE from a driver error. drizzle >=0.44 wraps driver errors in a DrizzleQueryError
 * with the pg error under `.cause`; earlier versions surfaced `.code` directly. Check both.
 */
export function pgErrorCode(err: unknown): string | undefined {
  const direct = (err as { code?: unknown } | null)?.code;
  if (typeof direct === 'string') return direct;
  const nested = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof nested === 'string' ? nested : undefined;
}

/**
 * Constraint name from a driver error (23505/23503), same drizzle wrapping caveat as
 * pgErrorCode. Undefined when the driver did not surface it — callers must then fall back
 * to the error text, which Postgres always suffixes with the constraint name.
 */
export function pgConstraintName(err: unknown): string | undefined {
  const direct = (err as { constraint?: unknown } | null)?.constraint;
  if (typeof direct === 'string') return direct;
  const nested = (err as { cause?: { constraint?: unknown } } | null)?.cause?.constraint;
  return typeof nested === 'string' ? nested : undefined;
}

/** True when `err` names `constraint` either via the driver field or in its message text. */
export function pgViolates(err: unknown, constraint: string): boolean {
  if (pgConstraintName(err) === constraint) return true;
  const msg = `${(err as Error | null)?.message ?? ''} ${(err as { cause?: Error } | null)?.cause?.message ?? ''}`;
  return msg.includes(constraint);
}
