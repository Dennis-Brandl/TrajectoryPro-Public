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

// Per-spec UI capabilities for the sidebar row menu — the client mirror of the
// server's canTransition/canDelete + the new-version=create rule (design §7/D8).
// Drives which row actions (Change State / New Version / Delete) a user sees,
// so transition-only roles (Approver/Publisher) aren't locked out by an
// edit-only gate. The server still re-authorizes every action.

import type { MePrincipal } from '@/stores/specificationStore/apiClient'
import { principalCan, principalHasRight } from '@/stores/principalStore'
import {
  legalTargets,
  rightForEdge,
  categoryForEntityType,
  editLockedStateSet,
  isEditLockedState,
} from '@/lib/lifecycle'

export interface SpecRowCapabilities {
  canChangeState: boolean
  canCreateVersion: boolean
  canDeleteSpec: boolean
}

const NONE: SpecRowCapabilities = { canChangeState: false, canCreateVersion: false, canDeleteSpec: false }

export function specRowCapabilities(
  principal: MePrincipal | null,
  library: { teamId?: string | null; entityType: string } | null | undefined,
  specState: string,
): SpecRowCapabilities {
  if (!principal || !library) return NONE
  const admin = principal.isAdministrator

  // Change state: admin, or ≥1 legal transition whose per-edge right the user holds.
  const canChangeState =
    admin ||
    (library.teamId != null &&
      legalTargets(specState).some((to) => {
        const verb = rightForEdge(specState, to)
        return (
          verb != null &&
          principalHasRight(principal, library.teamId as string, `${categoryForEntityType(library.entityType)}:${verb}`)
        )
      }))

  // New version is a CREATE (design D8) — valid even on an edit-locked source.
  const canCreateVersion = principalCan(principal, library, 'create')

  // Delete mirrors server canDelete: delete right AND (Obsolete OR not edit-locked).
  const canDeleteSpec =
    admin ||
    (principalCan(principal, library, 'delete') &&
      (specState === 'Obsolete' || !isEditLockedState(specState, editLockedStateSet(principal.editLockedStates))))

  return { canChangeState, canCreateVersion, canDeleteSpec }
}
