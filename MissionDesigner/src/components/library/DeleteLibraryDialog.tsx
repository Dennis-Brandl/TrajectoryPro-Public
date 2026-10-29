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

import { useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from '@mission/ui'
import { api } from '@/stores/specificationStore/apiClient'
import { deleteLibrary } from '@/stores/specificationStore/libraryCrud'
import { usePrincipal } from '@/stores/principalStore'
import type { ReleasedSpecSummary } from '@/types/library'

interface DeleteLibraryDialogProps {
  library: { id: string; name: string }
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs after the library was deleted. */
  onDeleted: () => void
}

function describeSpec(s: ReleasedSpecSummary): string {
  const base = `${s.name} v${s.version} (${s.state})`
  if (s.embeddedCount <= 0) return base
  return `${base}, includes ${s.embeddedCount} embedded sub-workflow${s.embeddedCount === 1 ? '' : 's'}`
}

/**
 * One delete-library confirmation for every entry point. Fetches the released
 * workflows under the library each time it opens; an administrator confirms
 * the exact list, anyone else is told to make them Obsolete first.
 */
export function DeleteLibraryDialog({ library, open, onOpenChange, onDeleted }: DeleteLibraryDialogProps) {
  const principal = usePrincipal()
  const isAdmin = principal?.isAdministrator === true
  const [released, setReleased] = useState<ReleasedSpecSummary[] | null>(null)
  const [checkFailed, setCheckFailed] = useState(false)
  const [listChanged, setListChanged] = useState(false)
  const [notEmpty, setNotEmpty] = useState(false)
  const [otherError, setOtherError] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [prevKey, setPrevKey] = useState<string | null>(null)

  // Adjust state during render: each open (or a different library) starts a fresh check.
  const key = open ? library.id : null
  if (key !== prevKey) {
    setPrevKey(key)
    if (open) {
      setReleased(null)
      setCheckFailed(false)
      setListChanged(false)
      setNotEmpty(false)
      setOtherError(false)
    }
  }

  // The check itself; an answer from an earlier open or another library is dropped.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    api
      .getLibraryDeleteCheck(library.id)
      .then((r) => {
        if (!cancelled) setReleased(r.releasedSpecs)
      })
      .catch(() => {
        if (!cancelled) setCheckFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, library.id])

  const checking = released === null && !checkFailed
  const hasReleased = (released?.length ?? 0) > 0
  const canDelete = !checking && !checkFailed && !deleting && !notEmpty && (!hasReleased || isAdmin)

  const handleDelete = async () => {
    setDeleting(true)
    setListChanged(false)
    setOtherError(false)
    const result = await deleteLibrary(library.id, hasReleased ? released!.map((s) => s.id) : undefined)
    setDeleting(false)
    if (result.ok) {
      onOpenChange(false)
      onDeleted()
      return
    }
    if (result.code === 'library_has_released_specs' && result.releasedSpecs) {
      setReleased(result.releasedSpecs)
      setListChanged(true)
    } else if (result.code === 'library_not_empty') {
      setNotEmpty(true)
    } else {
      setOtherError(true)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Library</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{library.name}"? This also deletes every specification in it and in its
            sub-libraries. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 text-sm">
          {checking && <p>Checking…</p>}
          {checkFailed && (
            <p className="text-destructive">Could not check the library. Close this dialog and try again.</p>
          )}
          {hasReleased && (
            <>
              {isAdmin ? (
                <p className="font-medium text-destructive">
                  {released!.length === 1
                    ? 'This library contains 1 released workflow. Deleting it removes it permanently.'
                    : `This library contains ${released!.length} released workflows. Deleting it removes them permanently.`}
                </p>
              ) : (
                <p className="font-medium">Make these Obsolete first, then delete the library.</p>
              )}
              <ul className="list-disc pl-5">
                {released!.map((s) => (
                  <li key={s.id}>{describeSpec(s)}</li>
                ))}
              </ul>
            </>
          )}
          {listChanged && isAdmin && <p className="text-destructive">The list changed — check it and confirm again.</p>}
          {notEmpty && (
            <p className="text-destructive">A workflow outside this library links into it. Remove that link first.</p>
          )}
          {otherError && <p className="text-destructive">The library could not be deleted.</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={handleDelete} disabled={!canDelete}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
