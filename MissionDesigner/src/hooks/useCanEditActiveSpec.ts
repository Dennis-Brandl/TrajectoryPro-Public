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

// Whether the current user may EDIT the currently-open specification — the
// single source of truth for client-side read-only gating across the canvas,
// properties panel, palette, and detail editors. Mirrors policy.isEditable():
// admin → true; otherwise the spec's state must not be edit-locked AND the user
// must hold `${category}:edit` in the owning team. The server re-checks on save.

import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { usePrincipal, principalHasRight } from '@/stores/principalStore'
import { categoryForEntityType, editLockedStateSet, isEditLockedState } from '@/lib/lifecycle'

export function useCanEditActiveSpec(): boolean {
  const principal = usePrincipal()
  const selectedLibraryId = useLibraryStore((s) => s.selectedLibraryId)
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)
  const lib = useSpecificationStore((s) => (selectedLibraryId ? s.libraries.get(selectedLibraryId) : undefined))
  const spec = useSpecificationStore((s) =>
    selectedSpecificationId ? s.specs.get(selectedSpecificationId) : undefined,
  )

  if (!principal) return false
  if (principal.isAdministrator) return true
  if (!lib || lib.teamId == null) return false
  const locked = editLockedStateSet(principal.editLockedStates)
  if (spec && isEditLockedState(spec.state, locked)) return false
  return principalHasRight(principal, lib.teamId, `${categoryForEntityType(lib.entityType)}:edit`)
}
