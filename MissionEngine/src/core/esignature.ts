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
// Spec 2026-09-06 D4/D7/D8: the engine verifies an e-signature itself, in the submit route,
// before the instance transaction opens. FormKit is NOT an engine dependency, so the block is
// found by walking the frozen form_document the same way validator.ts walks it.
import { and, eq } from 'drizzle-orm';
import { account, workCenterUser } from 'mission-control-db/src/db/schema/index';
import { findUserByLoginName, normalizeLoginName } from 'mission-control-db/src/dao/users';
import { findRoleByName } from 'mission-control-db/src/dao/roles';
import { userHoldsRoleInWorkCenter } from 'mission-control-db/src/dao/work-center-user-roles';
import type { Db } from '../db.js';
import type { EngineAuth } from '../api/auth.js';
import { EngineError } from './submit.js';

export interface ESignatureBlockDef {
  fieldName: string;
  label?: string;
  meaning?: string;
  roleName?: string;
  requireDifferentUser?: boolean;
  outputParameter?: string;
}

/** First esignature block in document order, or null (D9). Tolerates any malformed shape. */
export function findESignatureBlock(formDocument: unknown): ESignatureBlockDef | null {
  const doc = formDocument as Record<string, unknown> | null | undefined;
  const sections = doc?.['sections'];
  if (!Array.isArray(sections)) return null;
  for (const section of sections as Array<Record<string, unknown>>) {
    const rows = section?.['rows'];
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Array<Record<string, unknown>>) {
      const blocks = row?.['blocks'];
      if (!Array.isArray(blocks)) continue;
      for (const el of blocks as Array<Record<string, unknown>>) {
        // Review fix (fix round 1, finding 3): match on `type` alone and fail CLOSED. Requiring
        // a string `fieldName` here used to make a malformed block (author dropped fieldName)
        // invisible — `esig` came back null and the step submitted with no signature at all,
        // silently. A missing fieldName now degrades to '' (still a valid, honest string) rather
        // than un-finding the block; submit.ts skips the output-binding override when it's empty.
        if (el?.['type'] !== 'esignature') continue;
        const str = (k: string) => (typeof el[k] === 'string' ? (el[k] as string) : undefined);
        return {
          fieldName: str('fieldName') ?? '',
          label: str('label'), meaning: str('meaning'), outputParameter: str('outputParameter'),
          roleName: str('roleName')?.trim() || undefined,
          requireDifferentUser: el['requireDifferentUser'] === true,
        };
      }
    }
  }
  return null;
}

/** HTTP status per spec §5.1; every other EngineError stays 409 in the route. */
export const SIGNATURE_HTTP_STATUS: Record<string, number> = {
  SIGNATURE_REQUIRED: 400,
  SIGNATURE_INVALID_CREDENTIALS: 403,
  SIGNATURE_SAME_USER: 403,
  SIGNATURE_NOT_MEMBER: 403,
  SIGNATURE_ROLE_UNKNOWN: 403,
  SIGNATURE_ROLE_MISSING: 403,
};

/** A verification failure. Carries what the failed audit row needs about the signer, if resolved
 *  — and, for SIGNATURE_ROLE_MISSING only, the role that was found but not held (the role never
 *  resolves for any other code: SIGNATURE_ROLE_UNKNOWN means no such role exists at all). */
export class SignatureError extends EngineError {
  constructor(
    code: string,
    message: string,
    public readonly signerUserId: string | null = null,
    public readonly signerDisplayName: string | null = null,
    public readonly roleId: string | null = null,
  ) {
    super(code, message);
    this.name = 'SignatureError';
  }
}

export interface VerifiedSignature {
  signer: { id: string; loginName: string; displayName: string };
  role: { id: string; name: string } | null;
  esig: ESignatureBlockDef;
}

export interface VerifySignatureInput {
  esig: ESignatureBlockDef;
  loginName: string;
  password: string;
  workCenterId: string;
  operatorUserId: string;
}

export async function verifySignature(db: Db, auth: EngineAuth, input: VerifySignatureInput): Promise<VerifiedSignature> {
  const loginName = normalizeLoginName(input.loginName);
  const user = await findUserByLoginName(db, loginName);
  // D7: unknown login, disabled user and wrong password are one code. The hash check runs only
  // for an existing active user; better-auth's verify is the same scrypt Mission Commander uses.
  let ok = false;
  if (user && user.status === 'active') {
    const [cred] = await db.select({ password: account.password }).from(account)
      .where(and(eq(account.userId, user.id), eq(account.providerId, 'credential')));
    if (cred?.password) ok = await (await auth.$context).password.verify({ hash: cred.password, password: input.password });
  }
  if (!user || !ok) {
    throw new SignatureError('SIGNATURE_INVALID_CREDENTIALS', 'Login name or password is incorrect', user?.id ?? null, user?.displayName ?? null);
  }
  if (input.esig.requireDifferentUser && user.id === input.operatorUserId) {
    throw new SignatureError('SIGNATURE_SAME_USER', 'A different user than the operator must sign', user.id, user.displayName);
  }
  const [member] = await db.select({ userId: workCenterUser.userId }).from(workCenterUser)
    .where(and(eq(workCenterUser.userId, user.id), eq(workCenterUser.workCenterId, input.workCenterId)));
  if (!member) {
    throw new SignatureError('SIGNATURE_NOT_MEMBER', 'That user is not a member of this work center', user.id, user.displayName);
  }
  let roleRow: { id: string; name: string } | null = null;
  if (input.esig.roleName) {
    const found = await findRoleByName(db, input.esig.roleName);
    if (!found) {
      throw new SignatureError('SIGNATURE_ROLE_UNKNOWN', `No role named "${input.esig.roleName}" exists in Mission Commander`, user.id, user.displayName);
    }
    if (!(await userHoldsRoleInWorkCenter(db, input.workCenterId, user.id, found.id))) {
      throw new SignatureError('SIGNATURE_ROLE_MISSING', `${user.displayName} does not hold the role "${found.name}" in this work center`, user.id, user.displayName, found.id);
    }
    roleRow = { id: found.id, name: found.name };
  }
  return { signer: { id: user.id, loginName: user.loginName, displayName: user.displayName }, role: roleRow, esig: input.esig };
}
