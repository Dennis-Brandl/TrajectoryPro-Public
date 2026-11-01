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

// Phase 35 §2.2 / §2.4: closed error enum for the /api/v2/* surface.
// Any error code returned to a client MUST be in this list. Handlers that
// want to add a new code edit THIS file, THIS test, and the spec §2.2 table
// in one commit.

export const V2_ERROR_CODES = [
  // §2.2: 422 enum (payload validation)
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
  // §2.2: other statuses
  'unauthenticated', // 401 — auth boundary only (session missing/expired/foreign); business paths use not_found
  'not_found', // 404
  'forbidden', // 403
  'rate_limited', // 429
  'internal', // 500
  // §2.5 / §2.9 / §2.13: 413 sub-codes
  'payload_too_large',
  'too_many_libraries',
  'tree_too_large',
  // §2.6: image-specific
  'image_blob_not_found',
  // §2.4: 409 codes
  'conflict', // 409 (unique constraint)
  'library_not_empty', // 409 (DELETE blocked)
  'library_has_released_specs', // 409 (DELETE blocked — released specs in the tree)
  // Phase 3: lifecycle state machine
  'illegal_transition', // 409 — non-admin forces an edge not in the legal table
  'edit_locked', // 409 (content write or delete blocked by the spec's state)
  // Phase 4a (management): 409 codes
  'team_not_empty', // 409 (DELETE blocked — team still owns libraries)
  'global_team_protected', // 409 (GLOBAL cannot be renamed or deleted — spec 2026-10-12)
  // Phase 5d (accounts): 409 codes
  'last_admin', // 409 (PATCH blocked — cannot remove the last administrator)
  // Startup wizard (slice 1): 409 codes
  'setup_incomplete', // 409 (setup-complete blocked — invariants not yet met)
  // §2.10: import-specific
  'zip_too_large',
  'zip_entry_too_large',
  'zip_total_too_large',
  'zip_too_many_entries',
  'zip_filename_invalid',
  'zip_image_mime_invalid',
  'json_envelope_invalid',
  'unsupported_schema_version',
  'too_many_images',
  // wflibx library-package import (preview/commit routes) — emitted since the
  // feature shipped but only registered with the audit-item-3 cleanup.
  'bad_request', // 400 — malformed request shape (missing file field / invalid JSON body)
  'malformed_zip', // 400 — ZIP failed to open
  'missing_manifest', // 400 — no manifest.json entry
  'wrong_package_type', // 400 — manifest.packageType is not 'workflow-library'
  'unsupported_package_version', // 400 — manifest.packageVersion unsupported / oidIndex missing
  'preview_expired', // 410 — previewId no longer in the server-side cache
  'missing_resolution', // 422 — a conflict row arrived with no keep/replace resolution
  'forbidden_entity_types', // 403 — bundle carries entity types the caller may not import
  'commit_failed', // 500 — import transaction rolled back
  // Move between libraries
  'move_name_conflict', // 409 — destination library already has an element with this name
  'move_target_invalid', // 422 — destination is the same library, another type or team, or not allowed
  // Signup gate middleware
  'signup_closed', // 403 — self-serve signup disabled
] as const

export type V2ErrorCode = (typeof V2_ERROR_CODES)[number]

export function isV2ErrorCode(s: string): s is V2ErrorCode {
  return (V2_ERROR_CODES as readonly string[]).includes(s)
}

export function v2ErrorBody(code: V2ErrorCode, extra?: Record<string, unknown>): Record<string, unknown> {
  if (!extra) return { code }
  return { code, ...extra }
}

// Scrubber: collapses any string that contains SQLite internals or Section 1
// RAISE messages down to the empty string. Used defensively by the generic
// error translator so a future catch-handler that forwards `err.message`
// cannot leak internals by accident.
const SCRUB_PATTERNS: RegExp[] = [
  /SQLITE_[A-Z_]+/i,
  /SQL(?:ite)? error:/i,
  /RAISE\(/i,
  // §1 RAISE strings — add a new pattern here whenever a new trigger raises
  // a new message, so the scrubber can never leak it.
  /proxy reference crosses trees/i,
  /proxy reference: target spec does not exist/i,
  /proxy reference: parent spec does not exist/i,
  /parent library does not exist/i,
  /parent library must belong to same team/i,
  /parent specification does not exist/i,
  /child rootSpecificationId mismatch/i,
  /cannot reparent across trees/i,
  /library\.id is immutable/i,
  /specification\.id\/libraryId\/rootSpecificationId are immutable/i,
  /image\.specificationId\/id\/mimeType are immutable/i,
  /image_blob is content-addressed and immutable/i,
  /image_reference rows are immutable/i,
  /library_environment rows are immutable/i,
  /specification_environment rows are immutable/i,
  /environmentLibraryId must reference an environment library/i,
  /environment library must belong to the same team/i,
  /environment overrides allowed on root specs only/i,
  /workflow libraries cannot belong to GLOBAL/i,
]

export function scrubSqliteText(input: string): string {
  if (!input) return input
  for (const re of SCRUB_PATTERNS) {
    if (re.test(input)) return ''
  }
  return input
}
