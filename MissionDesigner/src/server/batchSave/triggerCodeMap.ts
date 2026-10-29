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

// Phase 35 §2.4: Trigger RAISE → closed enum mapping.
// Every SELECT RAISE(ABORT, '...') in Section 1 MUST have an entry here;
// triggerCodeMap.test.ts walks sqlite_master at test time and asserts it.

import type { V2ErrorCode } from '../errors/v2'

export const TRIGGER_CODE_MAP: Record<string, V2ErrorCode> = {
  // library triggers (§1 lines 162-240)
  'library.id is immutable': 'schema_mismatch',
  'parent library does not exist': 'parent_not_found',
  // Task 8: same-team parent trigger replaced the same-user variant. Maps to the
  // same client code as the retired 'parent library must belong to same user'.
  'parent library must belong to same team': 'cross_user_library_parent',
  // GLOBAL holds no workflow libraries (spec 2026-10-12 U2).
  'workflow libraries cannot belong to GLOBAL': 'schema_mismatch',
  // specification triggers (§1 lines 304-350)
  'duplicate child name under same parent': 'schema_mismatch',
  'parent specification does not exist': 'parent_not_found',
  'child rootSpecificationId mismatch': 'cross_tree_proxy',
  'cannot reparent across trees': 'cross_tree_proxy',
  'specification.id/libraryId/rootSpecificationId are immutable': 'schema_mismatch',
  // proxy_reference (§1 lines 437-487)
  'proxy reference: target spec does not exist': 'parent_not_found',
  'proxy reference: parent spec does not exist': 'parent_not_found',
  'proxy reference crosses trees': 'cross_tree_proxy',
  // image triggers (§1 lines 510-532 + B1 amendment)
  'image.specificationId/id/mimeType are immutable': 'schema_mismatch',
  'image_blob is content-addressed and immutable; only refCount may change': 'schema_mismatch',
  'image_reference rows are immutable; delete and re-insert': 'schema_mismatch',
  // library_environment (§1 lines 597-621)
  'environmentLibraryId must reference an environment library': 'schema_mismatch',
  // Task 8: same-team env trigger (fires on both library_environment and
  // specification_environment). Maps to the same client code as the retired
  // cross-account/isShared variant (removed in slice 6b).
  'environment library must belong to the same team': 'cross_user_library_parent',
  'library_environment rows are immutable; delete and re-insert': 'schema_mismatch',
  // specification_environment (§1 lines 637-696)
  'environment overrides allowed on root specs only': 'schema_mismatch',
  'specification_environment rows are immutable; delete and re-insert': 'schema_mismatch',
}

export function mapTriggerMessageToCode(msg: string): V2ErrorCode | null {
  return TRIGGER_CODE_MAP[msg] ?? null
}
