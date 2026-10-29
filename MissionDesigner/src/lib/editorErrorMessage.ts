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

// Editor-side mirror of adminClient.adminErrorMessage (Phase 4b): maps v2 error
// codes ({ code, ... } bodies; status is wire-only, design D15) to human toast
// text. Accepts an ApiError, a SaveError-shaped { code } object, or anything
// else (→ fallback). Keep the editor's denial copy here, not scattered in
// catch blocks.

import { ApiError } from '@/stores/specificationStore/apiClient'

function codeOf(err: unknown): string | null {
  if (err instanceof ApiError) return err.code
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code
  }
  return null
}

export function editorErrorMessage(err: unknown, fallback: string): string {
  switch (codeOf(err)) {
    case 'forbidden':
      return "You don't have permission to do that."
    case 'edit_locked':
      return "This item is locked in its current lifecycle state and can't be edited."
    case 'illegal_transition':
      return "That state change isn't allowed from the current state."
    case 'conflict':
      return 'That name or version is already in use.'
    case 'unauthenticated':
      // Deliberately NO auto-redirect: a redirect on a failed save would destroy
      // unsaved canvas work; the operator signs back in on their own terms.
      return 'Your session has expired — sign in again to continue.'
    case 'not_found':
      return 'It may have been deleted — refresh and try again.'
    case 'library_not_empty':
      return 'This library still contains items — delete or move them first.'
    case 'library_has_released_specs':
      return 'This library contains released workflows — make them Obsolete first.'
    case 'schema_mismatch':
      return 'Some of the information entered is invalid.'
    case 'still_changing':
      return 'Some changes could not be saved yet — try again, or discard them.'
    default:
      return fallback
  }
}
