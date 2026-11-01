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
import { isGlobalTeam } from '@/lib/global-team'

export interface SpecRowCapabilities {
  canChangeState: boolean
  canCreateVersion: boolean
  canDeleteSpec: boolean
  canMoveToLibrary: boolean
  canMoveToTeam: boolean
}

const MOVABLE_ENTITY_TYPES: readonly string[] = ['workflow', 'environment', 'action']

const NONE: SpecRowCapabilities = {
  canChangeState: false,
  canCreateVersion: false,
  canDeleteSpec: false,
  canMoveToLibrary: false,
  canMoveToTeam: false,
}

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

  // Move to Library: the Librarian pair (library.create + library.delete) in the source team.
  // Step-library elements are not movable (their references carry library ids the server does not rewrite).
  const canMoveToLibrary =
    MOVABLE_ENTITY_TYPES.includes(library.entityType) &&
    (admin ||
      (principalCan(principal, library, 'library.create') && principalCan(principal, library, 'library.delete')))

  // Move to Team: workflows only; needs the Librarian pair in the source team AND in at least one
  // other non-GLOBAL team. The server still demands create rights in the destination when it must
  // copy — that surfaces as a 403 `missing` list.
  const canMoveToTeam =
    library.entityType === 'workflow' &&
    canMoveToLibrary &&
    principal.teams.some(
      (t) =>
        t.id !== library.teamId &&
        !isGlobalTeam(t.id) &&
        !t.isGlobal &&
        (admin ||
          (principalHasRight(principal, t.id, 'workflow:library.create') &&
            principalHasRight(principal, t.id, 'workflow:library.delete'))),
    )

  return { canChangeState, canCreateVersion, canDeleteSpec, canMoveToLibrary, canMoveToTeam }
}
