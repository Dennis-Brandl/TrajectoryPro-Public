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
import { usePrincipal, principalCan } from '@/stores/principalStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { allowedInGlobal, isGlobalTeam, libraryLabel } from '@/lib/global-team'
import { flushNow } from '@/stores/specificationStore/saveScheduler'
import {
  copySpecificationToLibrary,
  moveErrorMessage,
  moveSpecificationToLibrary,
} from '@/lib/api/specification-mutations'

export interface MoveToLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  spec: Specification
  library: Library
  onSuccess: (r: { libraryId: string; specId: string; fromLibraryId: string; movedRootIds: string[] }) => void
  onCopied: (r: { libraryId: string; copiedRootIds: string[] }) => void
}

export function MoveToLibraryDialog({
  open,
  onOpenChange,
  spec,
  library,
  onSuccess,
  onCopied,
}: MoveToLibraryDialogProps) {
  const principal = usePrincipal()
  const allLibraries = useSpecificationStore((s) => s.libraries)
  const [targetId, setTargetId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Same team and entity type; GLOBAL too for environments/actions when the principal may use it.
  // Sub-libraries are listed under their parent's name.
  const targets = useMemo(() => {
    const libs = Array.from(allLibraries.values())
    const byId = new Map(libs.map((l) => [l.id, l]))
    const path = (l: { name: string; parentLibraryId: string | null }): string => {
      const parent = l.parentLibraryId ? byId.get(l.parentLibraryId) : undefined
      return parent ? `${path(parent)} / ${l.name}` : l.name
    }
    return libs
      .filter((l) => {
        if (l.id === library.id || l.entityType !== library.entityType) return false
        if (l.teamId === library.teamId) return true
        if (!isGlobalTeam(l.teamId) || !allowedInGlobal(l.entityType)) return false
        return principalCan(principal, l, 'library.create') && principalCan(principal, l, 'library.delete')
      })
      .map((l) => ({ id: l.id, name: l.name, label: libraryLabel({ name: path(l), teamId: l.teamId }) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [allLibraries, library, principal])

  async function handleSubmit(mode: 'move' | 'copy') {
    if (!targetId || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      // Pending edits must be on the server first: both work on the stored rows by raw SQL.
      try {
        await flushNow()
      } catch {
        setError(`Save your pending changes before ${mode === 'copy' ? 'copying' : 'moving'} (the save failed).`)
        return
      }
      const target = targets.find((t) => t.id === targetId)
      if (mode === 'copy') {
        const copied = await copySpecificationToLibrary(spec.id, targetId)
        toast.success(`Copied "${spec.name}" to "${target?.name ?? ''}"`)
        onCopied(copied)
        onOpenChange(false)
        setTargetId('')
        return
      }
      const result = await moveSpecificationToLibrary(spec.id, targetId)
      const refs = result.referencesUpdated > 0 ? `, ${result.referencesUpdated} references updated` : ''
      toast.success(`Moved "${spec.name}" to "${target?.name ?? ''}"${refs}`)
      onSuccess({
        libraryId: result.libraryId,
        specId: spec.id,
        fromLibraryId: library.id,
        movedRootIds: result.movedRootIds,
      })
      onOpenChange(false)
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
          <DialogTitle>Copy/Move to Library — {spec.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="move-target-library">Destination library</Label>
            <select
              id="move-target-library"
              aria-label="Destination library"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full h-9 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2 text-sm text-slate-700 dark:text-slate-200"
            >
              <option value="">Choose a library…</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-slate-500">
            <strong>Move</strong> takes all versions of this element to that library. References to it keep working.
          </p>
          <p className="text-xs text-slate-500">
            <strong>Copy</strong> leaves it here and adds a copy of all its versions, keeping their states. References
            keep pointing at the original.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => handleSubmit('copy')} disabled={!targetId || submitting}>
            Copy
          </Button>
          <Button onClick={() => handleSubmit('move')} disabled={!targetId || submitting}>
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
