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

import { useState } from 'react'
import { Button } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'
import { usePrincipal } from '@/stores/principalStore'
import { isGlobalTeam } from '@/lib/global-team'

/**
 * Mission Designer landing screen, shown when no workflow specification is selected.
 * Branded welcome that asks the user to pick a STARTING TEAM. Continue commits
 * the choice to libraryStore.selectedTeamId — which the left-sidebar
 * TeamFilterDropdown also honors, so the hierarchy scopes to the same team —
 * and dismisses the screen. No content is created here (Pro authors create
 * content via the hierarchy; the free-version create-form has been removed).
 */
export function WorkflowPlaceholder() {
  const principal = usePrincipal()
  // GLOBAL is everyone's shared read-only shelf, not a starting team — offered only to its
  // members and administrators, who can work in it (spec 2026-10-12).
  const teams = (principal?.teams ?? []).filter(
    (t) =>
      !isGlobalTeam(t.id) ||
      principal?.isAdministrator ||
      principal?.memberships.includes(t.id) ||
      (principal?.rightsByTeam[t.id]?.length ?? 0) > 0,
  )
  const selectedTeamId = useLibraryStore((s) => s.selectedTeamId)
  const setSelectedTeamId = useLibraryStore((s) => s.setSelectedTeamId)

  const [isDismissed, setIsDismissed] = useState(false)
  // Local selection, committed only on Continue. Starts empty; the adjustment
  // below adopts a team once the principal has loaded (it populates after first render).
  const [teamId, setTeamId] = useState('')

  // Adopt the store's team if it is still one the user can see, else the first
  // team. Mirrors the sidebar TeamFilterDropdown's default so the two start
  // matching. Runs once teams load and re-points only while teamId is invalid,
  // so it never fights a user's manual choice. Adjust-state-during-render
  // (react.dev "storing information from previous renders") rather than an
  // effect: the first paint already shows the adopted team.
  if (teams.length > 0 && !teams.some((t) => t.id === teamId)) {
    const valid = teams.some((t) => t.id === selectedTeamId)
    setTeamId(valid ? (selectedTeamId as string) : teams[0].id)
  }

  const handleContinue = () => {
    if (!teamId) return
    setSelectedTeamId(teamId)
    setIsDismissed(true)
  }

  if (isDismissed) {
    return <div className="flex-1 bg-slate-50 dark:bg-slate-900" />
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-900">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 p-8 w-full max-w-3xl text-center">
        <img
          src="/MissionDesignerStartGraphic.png"
          alt="Mission Designer"
          className="mx-auto mb-6 w-full h-auto rounded-lg bg-white"
        />
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Welcome to Mission Designer</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-6">
          Create and manage team-scoped Workflows, Workflow Libraries, Environment Specifications, and Action
          Specifications. Please select a starting team.
        </p>

        {teams.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-400 dark:text-slate-500">
              You don't belong to any team yet — ask an administrator to add you.
            </p>
            <Button disabled className="w-full" size="lg">
              Continue
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-left">
              <label htmlFor="start-team" className="sr-only">
                Starting team
              </label>
              <select
                id="start-team"
                aria-label="Starting team"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full h-10 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2 text-sm text-slate-700 dark:text-slate-200"
              >
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {isGlobalTeam(t.id) ? 'GLOBAL (shared)' : t.name}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={handleContinue} disabled={!teamId} className="w-full" size="lg">
              Continue
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
