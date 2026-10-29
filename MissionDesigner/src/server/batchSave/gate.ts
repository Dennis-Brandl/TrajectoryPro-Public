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

// Phase 3: per-op capability gate shared by batchSave phase1 (pre-check) and
// phase2 (in-tx re-check). Visibility (404) is the caller's job — this assumes
// the library row is already resolved.

import type { Principal } from '../authz/policy'
import { canDo } from '../authz/policy'
import { EDIT_LOCKED_STATES_DEFAULT } from '../authz/rights'

export interface BatchOpLib {
  teamId: string | null
  entityType: string
}

export type BatchGateResult = { ok: true } | { ok: false; status: 403 | 409; code: 'forbidden' | 'edit_locked' }

/**
 * - create (root, `specState` null): needs the `create` right.
 * - create (child of an EXISTING root, `specState` = root's state): needs
 *   `create` AND the root must not be edit-locked — attaching children to a
 *   published tree is a content mutation.
 * - update: needs `edit` AND the spec's current state must not be edit-locked.
 * - delete: needs `delete` AND the state must be Obsolete or not edit-locked.
 */
export function gateBatchOp(
  p: Principal,
  op: 'create' | 'update' | 'delete',
  lib: BatchOpLib,
  specState: string | null,
  // Static fallback — real callers pass `await editLockedStates()`.
  locked: Set<string> = new Set(EDIT_LOCKED_STATES_DEFAULT),
): BatchGateResult {
  if (p.isAdministrator) return { ok: true }
  switch (op) {
    case 'create': {
      if (!canDo(p, 'create', lib)) return { ok: false, status: 403, code: 'forbidden' }
      if (specState !== null && locked.has(specState)) {
        return { ok: false, status: 409, code: 'edit_locked' }
      }
      return { ok: true }
    }
    case 'update': {
      if (!canDo(p, 'edit', lib)) return { ok: false, status: 403, code: 'forbidden' }
      if (specState !== null && locked.has(specState)) {
        return { ok: false, status: 409, code: 'edit_locked' }
      }
      return { ok: true }
    }
    case 'delete': {
      if (!canDo(p, 'delete', lib)) return { ok: false, status: 403, code: 'forbidden' }
      if (specState !== null && specState !== 'Obsolete' && locked.has(specState)) {
        return { ok: false, status: 409, code: 'edit_locked' }
      }
      return { ok: true }
    }
  }
}
