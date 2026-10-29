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

// Phase 5b: scopes the library sidebar to one team at a time (design §3 — a
// user may belong to several teams; admins see all teams). Reads the team list
// from the 5a principal store; writes the choice to libraryStore.selectedTeamId,
// which useFilteredLibraries honors. A member of no team renders nothing.

import { GLOBAL_TEAM_ID } from '@/lib/global-team'
import { useEffect, useMemo } from 'react'
import { useLibraryStore } from '@/stores/libraryStore'
import { usePrincipal } from '@/stores/principalStore'

export function TeamFilterDropdown() {
  const principal = usePrincipal()
  const teams = useMemo(() => principal?.teams ?? [], [principal])
  const selectedTeamId = useLibraryStore((s) => s.selectedTeamId)
  const setSelectedTeamId = useLibraryStore((s) => s.setSelectedTeamId)

  // Default to the first team; re-point if the current (e.g. persisted) choice
  // is no longer one the user can see. Leaves null when there are no teams.
  useEffect(() => {
    if (teams.length > 0 && !teams.some((t) => t.id === selectedTeamId)) {
      setSelectedTeamId(teams[0].id)
    }
  }, [teams, selectedTeamId, setSelectedTeamId])

  if (teams.length === 0) return null

  return (
    <div>
      <label htmlFor="team-filter" className="sr-only">
        Filter by team
      </label>
      <select
        id="team-filter"
        aria-label="Filter by team"
        value={selectedTeamId ?? ''}
        onChange={(e) => setSelectedTeamId(e.target.value)}
        className="w-full h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2 text-sm text-slate-700 dark:text-slate-200"
      >
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.id === GLOBAL_TEAM_ID ? 'GLOBAL (shared)' : t.name}
          </option>
        ))}
      </select>
    </div>
  )
}
