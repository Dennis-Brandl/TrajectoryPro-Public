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

import { GLOBAL_TEAM_ID, allowedInGlobal } from '@/lib/global-team'
import { useMemo, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@mission/ui'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { Button } from '@mission/ui'
import { Plus, Loader2 } from 'lucide-react'
import { useLibraryStore } from '@/stores/libraryStore'
import { usePrincipal, principalHasRight } from '@/stores/principalStore'
import { categoryForEntityType } from '@/lib/lifecycle'
import { createLibrary } from '@/stores/specificationStore/libraryCrud'

/**
 * Dialog for creating a new top-level library. Phase 5d: the library is created
 * in a team the user can create in. The team list is `principal.teams` filtered
 * to those holding `<category>:library.create`; it defaults to the sidebar's
 * selected team and is hidden when only one team is eligible.
 */
export function CreateLibraryDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeEntityType = useLibraryStore((s) => s.activeEntityType)
  const selectedTeamId = useLibraryStore((s) => s.selectedTeamId)
  const principal = usePrincipal()

  const category = categoryForEntityType(activeEntityType)
  const eligibleTeams = useMemo(
    () =>
      (principal?.teams ?? []).filter(
        (t) =>
          principalHasRight(principal, t.id, `${category}:library.create`) &&
          // GLOBAL never holds workflow libraries (spec 2026-10-12 U2).
          (t.id !== GLOBAL_TEAM_ID || allowedInGlobal(activeEntityType)),
      ),
    [principal, category, activeEntityType],
  )
  const defaultTeamId =
    selectedTeamId && eligibleTeams.some((t) => t.id === selectedTeamId) ? selectedTeamId : (eligibleTeams[0]?.id ?? '')
  const [teamId, setTeamId] = useState(defaultTeamId)
  // Guard against a stale choice if the eligible set shifts while mounted.
  const effectiveTeamId = eligibleTeams.some((t) => t.id === teamId) ? teamId : defaultTeamId

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Library name is required')
      return
    }
    if (!effectiveTeamId) {
      setError('You do not have permission to create a library in any team')
      return
    }

    setIsCreating(true)
    setError(null)

    const result = await createLibrary({
      name: name.trim(),
      entityType: activeEntityType as 'workflow' | 'action' | 'environment' | 'step',
      teamId: effectiveTeamId,
    })

    setIsCreating(false)

    if (result) {
      setName('')
      setOpen(false)
    } else {
      setError('Failed to create library. Name may already exist.')
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (newOpen) {
      setTeamId(defaultTeamId)
    } else {
      setName('')
      setError(null)
    }
  }

  const entityTypeLabel = {
    workflow: 'Workflow',
    step: 'Step',
    environment: 'Environment',
    action: 'Action',
  }[activeEntityType]

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <Plus className="h-4 w-4 mr-2" />
          New Library
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input')?.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Create {entityTypeLabel} Library</AlertDialogTitle>
          <AlertDialogDescription>
            Enter a name for your new {entityTypeLabel.toLowerCase()} library.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-4 space-y-4">
          {eligibleTeams.length > 1 && (
            <div>
              <Label htmlFor="library-team">Team</Label>
              <select
                id="library-team"
                aria-label="Team"
                value={effectiveTeamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="mt-2 w-full h-9 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2 text-sm text-slate-700 dark:text-slate-200"
              >
                {eligibleTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <Label htmlFor="library-name">Library Name</Label>
            <Input
              id="library-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`My ${entityTypeLabel} Library`}
              className="mt-2"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isCreating) {
                  handleCreate()
                }
              }}
            />
          </div>
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isCreating}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleCreate} disabled={isCreating || !name.trim() || !effectiveTeamId}>
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
