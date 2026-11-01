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

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Label } from '@mission/ui'
import type { Library, Specification } from '@/types/library'
import { usePrincipal, principalHasRight } from '@/stores/principalStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { isGlobalTeam } from '@/lib/global-team'
import { flushNow } from '@/stores/specificationStore/saveScheduler'
import { copySpecificationToTeam, moveErrorMessage, moveSpecificationToTeam } from '@/lib/api/specification-mutations'

export interface MoveToTeamDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  spec: Specification
  library: Library
  onSuccess: (r: {
    libraryId: string
    specId: string
    fromLibraryId: string
    movedRootIds: string[]
    teamId: string
    librariesCreated: boolean
    touchedLibraryIds?: string[]
  }) => void
  onCopied: (r: {
    libraryId: string
    copiedRootIds: string[]
    librariesCreated: boolean
    touchedLibraryIds?: string[]
  }) => void
}

const SELECT_CLASS =
  'w-full h-9 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2 text-sm text-slate-700 dark:text-slate-200'

export function MoveToTeamDialog({ open, onOpenChange, spec, library, onSuccess, onCopied }: MoveToTeamDialogProps) {
  const principal = usePrincipal()
  const allLibraries = useSpecificationStore((s) => s.libraries)
  const [teamId, setTeamId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Teams where the principal holds the workflow Librarian pair (admins: every team).
  const teams = useMemo(
    () =>
      (principal?.teams ?? []).filter(
        (t) =>
          t.id !== library.teamId &&
          !isGlobalTeam(t.id) &&
          !t.isGlobal &&
          principalHasRight(principal, t.id, 'workflow:library.create') &&
          principalHasRight(principal, t.id, 'workflow:library.delete'),
      ),
    [principal, library.teamId],
  )

  // The store already holds every library the user can see, so no extra fetch is needed.
  // Sub-libraries are listed under their parent's name.
  const libraries = useMemo(() => {
    const all = Array.from(allLibraries.values())
    const byId = new Map(all.map((l) => [l.id, l]))
    const path = (l: { name: string; parentLibraryId: string | null }): string => {
      const parent = l.parentLibraryId ? byId.get(l.parentLibraryId) : undefined
      return parent ? `${path(parent)} / ${l.name}` : l.name
    }
    return all
      .filter((l) => l.teamId === teamId && l.entityType === 'workflow')
      .map((l) => ({ id: l.id, name: l.name, label: path(l) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [allLibraries, teamId])

  async function handleSubmit(mode: 'move' | 'copy') {
    if (!teamId || !targetId || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      try {
        await flushNow()
      } catch {
        setError(`Save your pending changes before ${mode === 'copy' ? 'copying' : 'moving'} (the save failed).`)
        return
      }
      const result =
        mode === 'copy'
          ? await copySpecificationToTeam(spec.id, teamId, targetId)
          : await moveSpecificationToTeam(spec.id, teamId, targetId)
      const target = libraries.find((l) => l.id === targetId)
      const extras: string[] = []
      if (result.librariesCreated.length > 0) {
        extras.push(`libraries created: ${result.librariesCreated.map((l) => l.name).join(', ')}`)
      }
      if (result.elementsCopied > 0) extras.push(`${result.elementsCopied} elements copied`)
      toast.success(
        `${mode === 'copy' ? 'Copied' : 'Moved'} "${spec.name}" to "${target?.name ?? ''}"${extras.length > 0 ? ` (${extras.join('; ')})` : ''}`,
      )
      if ('copiedRootIds' in result) {
        onCopied({
          libraryId: result.libraryId,
          copiedRootIds: result.copiedRootIds,
          librariesCreated: result.librariesCreated.length > 0,
          touchedLibraryIds: result.touchedLibraryIds,
        })
      } else {
        onSuccess({
          libraryId: result.libraryId,
          specId: spec.id,
          fromLibraryId: library.id,
          movedRootIds: result.movedRootIds,
          teamId: result.teamId,
          librariesCreated: result.librariesCreated.length > 0,
          touchedLibraryIds: result.touchedLibraryIds,
        })
      }
      onOpenChange(false)
      setTeamId('')
      setTargetId('')
    } catch (err) {
      setError(moveErrorMessage(err, mode === 'copy' ? 'Failed to copy' : 'Failed to move'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy/Move to Team — {spec.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="move-target-team">Destination team</Label>
            <select
              id="move-target-team"
              aria-label="Destination team"
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value)
                setTargetId('')
              }}
              className={SELECT_CLASS}
            >
              <option value="">Choose a team…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          {teamId && (
            <div className="space-y-1">
              <Label htmlFor="move-target-workflow-library">Workflow library</Label>
              <select
                id="move-target-workflow-library"
                aria-label="Workflow library"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">Choose a library…</option>
                {libraries.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="text-xs text-slate-500">
            <strong>Move</strong> takes the workflow out of this team. <strong>Copy</strong> leaves it here and adds a
            copy of all its versions there, keeping their states.
          </p>
          <p className="text-xs text-slate-500">
            Either way, environments, actions and sub-workflows it uses are copied into that team&apos;s libraries of
            the same name when missing.
          </p>
          <p className="text-xs text-slate-500">
            Copying needs create rights in that team; you&apos;ll be told if any are missing.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => handleSubmit('copy')} disabled={!teamId || !targetId || submitting}>
            Copy
          </Button>
          <Button onClick={() => handleSubmit('move')} disabled={!teamId || !targetId || submitting}>
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
