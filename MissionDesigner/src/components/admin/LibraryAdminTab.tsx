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

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { ChevronRight, ChevronDown, Trash2, Loader2, FolderOpen, FileText, ArrowRightLeft } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mission/ui'
import { Button } from '@mission/ui'
import { DeleteLibraryDialog } from '@/components/library/DeleteLibraryDialog'
import { listTeams, moveLibrary, adminErrorMessage, AdminApiError, type TeamWithCounts } from '@/lib/admin/adminClient'
import { GLOBAL_TEAM_ID, allowedInGlobal } from '@/lib/global-team'

interface LibraryRow {
  id: string
  createdByUserId: string | null
  teamId: string
  teamName: string | null
  name: string
  entityType: string
  description: string | null
  createdAt: number
  updatedAt: number
  ownerName: string | null
  ownerEmail: string | null
}

interface SpecRow {
  id: string
  libraryId: string
  name: string
  description: string | null
  createdAt: number
  updatedAt: number
}

interface LibraryAdminTabProps {
  entityType: string
}

export function LibraryAdminTab({ entityType }: LibraryAdminTabProps) {
  const [libraries, setLibraries] = useState<LibraryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedLibId, setExpandedLibId] = useState<string | null>(null)
  const [specs, setSpecs] = useState<SpecRow[]>([])
  const [loadingSpecs, setLoadingSpecs] = useState(false)
  const [deleteLibTarget, setDeleteLibTarget] = useState<LibraryRow | null>(null)
  const [deleteSpecTarget, setDeleteSpecTarget] = useState<SpecRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [moveTarget, setMoveTarget] = useState<LibraryRow | null>(null)
  const [teams, setTeams] = useState<TeamWithCounts[]>([])
  const [moveTeamId, setMoveTeamId] = useState('')
  const [moving, setMoving] = useState(false)

  const openMove = async (lib: LibraryRow) => {
    setMoveTarget(lib)
    setMoveTeamId('')
    try {
      setTeams(await listTeams())
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to load teams'))
    }
  }

  const handleMove = async () => {
    if (!moveTarget || !moveTeamId) return
    setMoving(true)
    try {
      try {
        await moveLibrary(moveTarget.id, moveTeamId)
      } catch (err) {
        const references =
          err instanceof AdminApiError && err.extra.conflictType === 'referenced' ? err.extra.references : 0
        if (!references) throw err
        const ok = window.confirm(
          `${references} items in other teams use this library and will lose access to it after the move. Move anyway?`,
        )
        if (!ok) return
        await moveLibrary(moveTarget.id, moveTeamId, true)
      }
      toast.success(`Moved library: ${moveTarget.name}`)
      setMoveTarget(null)
      fetchLibraries()
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to move library'))
    } finally {
      setMoving(false)
    }
  }

  // GLOBAL holds action, environment and step libraries only (spec 2026-10-12 U2).
  const moveOptions = moveTarget
    ? teams.filter(
        (t) => t.id !== moveTarget.teamId && (t.id !== GLOBAL_TEAM_ID || allowedInGlobal(moveTarget.entityType)),
      )
    : []

  // Stable per entityType so the effect below re-fetches exactly when the tab changes.
  const fetchLibraries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/libraries?entityType=${entityType}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to fetch libraries')
      const data = await res.json()
      setLibraries(data.libraries)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch libraries')
    } finally {
      setLoading(false)
    }
  }, [entityType])

  useEffect(() => {
    fetchLibraries()
  }, [fetchLibraries])

  const handleExpand = async (libId: string) => {
    if (expandedLibId === libId) {
      setExpandedLibId(null)
      return
    }
    setExpandedLibId(libId)
    setLoadingSpecs(true)
    try {
      const res = await fetch(`/api/admin/specifications?libraryId=${libId}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to fetch specifications')
      const data = await res.json()
      setSpecs(data.specifications)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to fetch specifications')
    } finally {
      setLoadingSpecs(false)
    }
  }

  const handleLibraryDeleted = () => {
    if (!deleteLibTarget) return
    toast.success(`Deleted library: ${deleteLibTarget.name}`)
    if (expandedLibId === deleteLibTarget.id) {
      setExpandedLibId(null)
    }
    setDeleteLibTarget(null)
    fetchLibraries()
  }

  const handleDeleteSpec = async () => {
    if (!deleteSpecTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/specifications/${deleteSpecTarget.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete specification')
      }
      toast.success(`Deleted specification: ${deleteSpecTarget.name}`)
      setDeleteSpecTarget(null)
      // Refresh specs for the expanded library
      if (expandedLibId) {
        const specRes = await fetch(`/api/admin/specifications?libraryId=${expandedLibId}`, { credentials: 'include' })
        if (specRes.ok) {
          const data = await specRes.json()
          setSpecs(data.specifications)
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete specification')
    } finally {
      setDeleting(false)
    }
  }

  const formatDate = (ts: number) => {
    if (!ts) return '—'
    return new Date(ts).toLocaleDateString()
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 capitalize">
            {entityType} Libraries
          </h2>
          <span className="text-sm text-slate-500 dark:text-slate-400">{libraries.length} libraries</span>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && <div className="text-sm text-destructive py-4 text-center">{error}</div>}

        {!loading && !error && libraries.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8">No {entityType} libraries found.</div>
        )}

        {!loading && !error && libraries.length > 0 && (
          <div className="space-y-1">
            {libraries.map((lib) => (
              <div key={lib.id}>
                <div
                  className="flex items-center gap-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  onClick={() => handleExpand(lib.id)}
                >
                  {expandedLibId === lib.id ? (
                    <ChevronDown className="h-4 w-4 text-slate-400 dark:text-slate-500 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-400 dark:text-slate-500 shrink-0" />
                  )}
                  <FolderOpen className="h-4 w-4 text-slate-400 dark:text-slate-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{lib.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Team: {lib.teamName || '—'} · Created by {lib.ownerName || lib.ownerEmail || 'Unknown'} |{' '}
                      {formatDate(lib.createdAt)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
                    title={`Move library: ${lib.name}`}
                    aria-label={`Move library: ${lib.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      openMove(lib)
                    }}
                  >
                    <ArrowRightLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    title={`Delete library: ${lib.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteLibTarget(lib)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Expanded specifications list */}
                {expandedLibId === lib.id && (
                  <div className="ml-8 border-l-2 border-slate-200 dark:border-slate-700 pl-3 py-1 space-y-1">
                    {loadingSpecs ? (
                      <div className="flex items-center gap-2 py-2 text-sm text-slate-500 dark:text-slate-400">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading specifications...
                      </div>
                    ) : specs.length === 0 ? (
                      <div className="text-xs text-muted-foreground py-2">No specifications in this library.</div>
                    ) : (
                      specs.map((spec) => (
                        <div
                          key={spec.id}
                          className="flex items-center gap-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5"
                        >
                          <FileText className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm truncate">{spec.name}</div>
                            <div className="text-xs text-muted-foreground">Updated {formatDate(spec.updatedAt)}</div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                            title={`Delete specification: ${spec.name}`}
                            onClick={() => setDeleteSpecTarget(spec)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete library dialog */}
      {deleteLibTarget && (
        <DeleteLibraryDialog
          library={deleteLibTarget}
          open
          onOpenChange={(v) => !v && setDeleteLibTarget(null)}
          onDeleted={handleLibraryDeleted}
        />
      )}

      {/* Delete specification dialog */}
      <AlertDialog open={moveTarget !== null} onOpenChange={(open) => !open && setMoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move “{moveTarget?.name}” to another team</AlertDialogTitle>
            <AlertDialogDescription>
              The library and its child libraries move together. Libraries in GLOBAL can be used by every team.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <select
            aria-label="Target team"
            value={moveTeamId}
            onChange={(e) => setMoveTeamId(e.target.value)}
            className="w-full h-9 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2 text-sm"
          >
            <option value="" disabled>
              Choose a team…
            </option>
            {moveOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id === GLOBAL_TEAM_ID ? 'GLOBAL (shared)' : t.name}
              </option>
            ))}
          </select>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={moving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!moveTeamId || moving}
              onClick={(e) => {
                e.preventDefault()
                handleMove()
              }}
            >
              Move
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteSpecTarget} onOpenChange={(v) => !v && setDeleteSpecTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete specification?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-medium text-foreground">{deleteSpecTarget?.name}</span>{' '}
              and any child specifications. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteSpec} disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
