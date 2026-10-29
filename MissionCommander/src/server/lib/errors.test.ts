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
import { describe, it, expect } from 'vitest';
import { daoErrorStatus, errorBody, sendDaoError, DAO_STATUS_KEYS } from './errors';
import { DaoError } from 'mission-control-db/src/dao/errors';

describe('error mapping', () => {
  it('maps each DaoError code to the correct status', () => {
    expect(daoErrorStatus('WORK_CENTER_NOT_FOUND')).toBe(404);
    expect(daoErrorStatus('PARENT_NOT_FOUND')).toBe(404);
    expect(daoErrorStatus('LINK_TARGET_NOT_FOUND')).toBe(404);
    expect(daoErrorStatus('WORK_CENTER_NAME_CONFLICT')).toBe(409);
    expect(daoErrorStatus('WORK_CENTER_CYCLE')).toBe(409);
    expect(daoErrorStatus('WORK_CENTER_HAS_CHILDREN')).toBe(409);
    expect(daoErrorStatus('WORK_CENTER_IN_USE')).toBe(409);
    expect(daoErrorStatus('INVALID_DISPATCH_POLICY')).toBe(400);
    expect(daoErrorStatus('SOMETHING_ELSE')).toBe(400); // unknown DaoError → 400
  });

  it('errorBody wraps code + message', () => {
    expect(errorBody('forbidden', 'nope')).toEqual({ error: { code: 'forbidden', message: 'nope' } });
  });
});

describe('M2 DaoError mappings', () => {
  it.each([
    ['USER_NOT_FOUND', 404],
    ['ROLE_NOT_FOUND', 404],
    ['ROLE_NAME_CONFLICT', 409],
    ['SELF_CHANGE_FORBIDDEN', 403],
    ['LAST_ADMIN', 409],
    ['SYSTEM_ROLE', 409],
    ['ROLE_IN_USE', 409],
  ])('%s → %i', (code, status) => {
    expect(daoErrorStatus(code)).toBe(status);
  });

  it('403 maps to the forbidden wire code', async () => {
    const responses: Array<{ body: unknown; status: number }> = [];
    const c = { json: (body: unknown, status: number) => { responses.push({ body, status }); return new Response(); } };
    sendDaoError(c as never, new DaoError('SELF_CHANGE_FORBIDDEN', 'nope'));
    expect(responses[0].status).toBe(403);
    expect((responses[0].body as { error: { code: string } }).error.code).toBe('forbidden');
  });
});

describe('M3 DaoError mappings', () => {
  it('maps workflow/environment in-use to 409', () => {
    expect(daoErrorStatus('WORKFLOW_IN_USE')).toBe(409);
    expect(daoErrorStatus('ENVIRONMENT_IN_USE')).toBe(409);
  });
});

describe('M3 P4 spec DaoError mappings', () => {
  it.each([
    // The four LIBRARY_* rows that lived here are gone with M6 — see the M6 block below,
    // which asserts their absence rather than their mapping.
    ['WORKFLOW_NOT_FOUND', 404],
  ])('%s → %i', (code, status) => {
    expect(daoErrorStatus(code)).toBe(status);
  });

  it('no longer maps ENVIRONMENT_NOT_FOUND (retired with M6; nothing raises it)', () => {
    // The old guard rationale — an unmapped code silently defaults to 400 — is now solved
    // structurally: DAO_STATUS is a Record over mission-control-db's DaoErrorCode union,
    // so a NEW code cannot land without a mapping (compile error), and a retired code
    // cannot linger (compile error the moment it leaves DAO_ERROR_CODES).
    expect(DAO_STATUS_KEYS).not.toContain('ENVIRONMENT_NOT_FOUND');
  });
});

describe('M6 dao code mapping', () => {
  it('maps the two codes P1 introduced', () => {
    // 409: the work-center delete preflight is a confirmable refusal, not a bad request.
    expect(daoErrorStatus('CONFIRMATION_REQUIRED')).toBe(409);
    // 500: INGEST_FAILED means an internal invariant broke (a row vanished between an
    // insert and its relookup). Nothing the caller sent is wrong, so 400 would lie.
    expect(daoErrorStatus('INGEST_FAILED')).toBe(500);
  });

  it('no longer maps library codes', () => {
    // The library concept is gone; these can no longer be raised. They must not linger as
    // dead entries implying a surface that still exists.
    for (const code of ['LIBRARY_NOT_FOUND', 'LIBRARY_NAME_CONFLICT', 'LIBRARY_IN_USE', 'LIBRARY_NAME_INVALID']) {
      expect(DAO_STATUS_KEYS).not.toContain(code);
    }
  });

  it('still defaults an unknown code to 400', () => {
    expect(daoErrorStatus('SOMETHING_NEW')).toBe(400);
  });

  it('gives a 500-mapped code the internal wire code, not bad_request', () => {
    // daoWireCode fell through to 'bad_request' for anything it did not recognise, which
    // would have labelled a 500 response as a client error.
    const responses: Array<{ body: unknown; status: number }> = [];
    const c = { json: (body: unknown, status: number) => { responses.push({ body, status }); return new Response(); } };
    sendDaoError(c as never, new DaoError('INGEST_FAILED', 'row vanished'));
    expect(responses[0].status).toBe(500);
    expect((responses[0].body as { error: { code: string } }).error.code).toBe('internal');
  });
});

describe('Mission Engine dao code mapping', () => {
  it('maps the work-center delete active-runtime guard to 409, not the unmapped-code default 400', () => {
    // deleteWorkCenter throws this before the CONFIRMATION_REQUIRED check, and it blocks
    // unconditionally (even with confirmed:true). Without this mapping the unknown-code
    // default silently 400s a request that is not malformed at all.
    expect(daoErrorStatus('WORK_CENTER_HAS_ACTIVE_RUNTIME')).toBe(409);
  });
});
