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
import { GLOBAL_TEAM_ID } from '@/lib/global-team'
import { categoryForEntityType } from '@/lib/lifecycle'
import { principalCan, principalHasRight } from '@/stores/principalStore'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'

/**
 * Whether a client-side import may add missing specs to an existing library it resolved by
 * name. A GLOBAL library is only written by people with rights there (spec 2026-10-12 §4.6);
 * anyone else uses it as-is. Team libraries keep today's behaviour — the server decides.
 */
export function mayAddSpecsTo(
  lib: { teamId?: string | null; entityType: string },
  principal: MePrincipal | null,
): boolean {
  if (lib.teamId !== GLOBAL_TEAM_ID) return true
  return principalCan(principal, lib, 'create')
}

/**
 * Whether the sidebar's Import button applies for this person. Action, environment and step
 * packages land in the selected team, so they need `library.create` there; a workflow package
 * picks its team in the import dialog, which never offers GLOBAL (workflow libraries cannot
 * belong to it), so it needs that right in some other team. No team selected keeps the
 * any-team rule the button had before.
 */
export function mayImportLibraryInto(
  principal: MePrincipal | null,
  selectedTeamId: string | null,
  entityType: string,
): boolean {
  if (!principal) return false
  if (principal.isAdministrator) return true
  const right = `${categoryForEntityType(entityType)}:library.create`
  if (entityType === 'workflow' || selectedTeamId == null) {
    return Object.entries(principal.rightsByTeam).some(
      ([teamId, rights]) => (entityType !== 'workflow' || teamId !== GLOBAL_TEAM_ID) && rights.includes(right),
    )
  }
  return principalHasRight(principal, selectedTeamId, right)
}
