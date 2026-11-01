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

// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { V2_ERROR_CODES, v2ErrorBody, scrubSqliteText, isV2ErrorCode, type V2ErrorCode } from '../v2'

describe('v2 error codes: closed enum', () => {
  it('contains every 422 code from §2.2', () => {
    const required: V2ErrorCode[] = [
      'schema_mismatch',
      'cycle_detected',
      'parent_not_found',
      'image_not_found',
      'cross_tree_proxy',
      'duplicate_id_in_batch',
      'data_blob_invalid',
      'image_mime_invalid',
      'image_ref_unpaired',
      'unknown_field',
      'cross_user_library_parent',
    ]
    for (const code of required) {
      expect(V2_ERROR_CODES).toContain(code)
      expect(isV2ErrorCode(code)).toBe(true)
    }
  })

  it('includes generic codes used outside the 422 enum', () => {
    expect(V2_ERROR_CODES).toContain('internal')
    expect(V2_ERROR_CODES).toContain('unauthenticated')
    expect(V2_ERROR_CODES).toContain('not_found')
    expect(V2_ERROR_CODES).toContain('forbidden')
    expect(V2_ERROR_CODES).toContain('too_many_libraries')
    expect(V2_ERROR_CODES).toContain('tree_too_large')
    expect(V2_ERROR_CODES).toContain('image_blob_not_found')
    expect(V2_ERROR_CODES).toContain('payload_too_large')
    expect(V2_ERROR_CODES).toContain('rate_limited')
  })

  it('rejects unknown codes', () => {
    expect(isV2ErrorCode('totally_made_up')).toBe(false)
  })
})

describe('v2ErrorBody: shapes the response body', () => {
  it('returns { code } for simple errors', () => {
    expect(v2ErrorBody('not_found')).toEqual({ code: 'not_found' })
  })

  it('merges extra fields when provided', () => {
    expect(v2ErrorBody('parent_not_found', { parentId: 'abc' })).toEqual({
      code: 'parent_not_found',
      parentId: 'abc',
    })
  })

  it('does not return raw SQLite text even if extra contains message fields', () => {
    const body = v2ErrorBody('internal', { message: 'SQLITE_CONSTRAINT_TRIGGER: xxxx' })
    expect(body.code).toBe('internal')
  })
})

describe('v2 error codes — Plan 2b additions', () => {
  it.each([
    'zip_too_large',
    'zip_entry_too_large',
    'zip_total_too_large',
    'zip_too_many_entries',
    'zip_filename_invalid',
    'zip_image_mime_invalid',
    'json_envelope_invalid',
    'unsupported_schema_version',
    'too_many_images',
  ])('%s is in the closed enum', (code) => {
    expect(isV2ErrorCode(code)).toBe(true)
  })
})

describe('scrubSqliteText: strips unsafe substrings', () => {
  it('drops SQLITE_* error prefixes', () => {
    const s = scrubSqliteText('SQLITE_CONSTRAINT_TRIGGER: cross_tree_proxy')
    expect(s).toBe('')
  })

  it('drops RAISE messages', () => {
    const s = scrubSqliteText('proxy reference crosses trees')
    expect(s).toBe('')
  })

  it('leaves unrelated short text alone', () => {
    const s = scrubSqliteText('this is fine')
    expect(s).toBe('this is fine')
  })
})

describe('v2 error codes — Phase 3 state-gating additions', () => {
  it.each(['illegal_transition', 'edit_locked', 'library_has_released_specs'])('%s is in the closed enum', (code) => {
    expect(isV2ErrorCode(code)).toBe(true)
  })
})

describe('v2 error codes — Phase 4a management additions', () => {
  it('global_team_protected is in the closed enum', () => {
    expect(isV2ErrorCode('global_team_protected')).toBe(true)
  })

  it('team_not_empty is in the closed enum', () => {
    expect(isV2ErrorCode('team_not_empty')).toBe(true)
  })
})

describe('v2 error codes — Phase 5d accounts additions', () => {
  it('last_admin is in the closed enum', () => {
    expect(isV2ErrorCode('last_admin')).toBe(true)
  })
})

describe('v2 error codes — Startup wizard slice 1 additions', () => {
  it('setup_incomplete is in the closed enum', () => {
    expect(isV2ErrorCode('setup_incomplete')).toBe(true)
  })
})

describe('v2 error codes — wflibx import + signup gate registration (audit item 3)', () => {
  // These were emitted by the routes long before they were enumerated here —
  // the closed-enum contract ("any code returned to a client MUST be in this
  // list") was silently violated. Registered together; the emitting sites are
  // src/server/routes/v2/packages.ts and src/server/middleware/signupGate.ts.
  it.each([
    'bad_request',
    'malformed_zip',
    'missing_manifest',
    'wrong_package_type',
    'unsupported_package_version',
    'preview_expired',
    'missing_resolution',
    'forbidden_entity_types',
    'commit_failed',
    'signup_closed',
    'move_name_conflict',
    'move_target_invalid',
  ])('%s is in the closed enum', (code) => {
    expect(isV2ErrorCode(code)).toBe(true)
  })
})
